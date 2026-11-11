import json
import logging
import re
import threading
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit

from django.conf import settings
from django.core import signing
from django.db import close_old_connections
from django.db.models import F
from django.utils import timezone

from .models import DeviceScan, MessengerDelivery

log = logging.getLogger(__name__)
SEND_TIMEOUT_SECONDS = 10
GRAPH_VERSION_RE = re.compile(r'^v\d+\.\d+$')


class MessengerConfigurationError(Exception):
    pass


class MessengerRejected(Exception):
    def __init__(self, error_code):
        self.error_code = error_code or 'API_REJECTED'


class MessengerOutcomeUnknown(Exception):
    pass


def _configured():
    return all((
        settings.FB_PAGE_ID,
        settings.FB_PAGE_TOKEN,
        settings.FB_API_VERSION,
        settings.FB_RECIPIENT_PSID,
    ))


def _image_url(scan):
    stored = scan.image
    if not stored:
        raise MessengerConfigurationError('Scan has no saved image.')

    if stored.startswith('https://'):
        parsed = urlsplit(stored)
        if not parsed.netloc or parsed.username or parsed.password:
            raise MessengerConfigurationError('Stored image URL is invalid.')
        return stored
    if stored.startswith(('http://', 'data:')):
        raise MessengerConfigurationError('Messenger requires an HTTPS image URL.')

    base = urlsplit(settings.DEVICE_SERVER_URL)
    if base.scheme != 'https' or not base.netloc or base.username or base.password:
        raise MessengerConfigurationError('DEVICE_SERVER_URL must be a public HTTPS URL.')

    media_root = Path(settings.MEDIA_ROOT).resolve()
    local_path = (media_root / stored).resolve()
    if media_root not in local_path.parents or not local_path.is_file():
        raise MessengerConfigurationError('Saved scan image is not available on the server.')

    token = signing.dumps({'scan_id': scan.pk, 'field': 'image'}, salt='scan-image')
    return (
        f'{base.scheme}://{base.netloc}/api/scans/{scan.pk}/image/{token}/image.jpg'
    )


def send_scan_image(scan):
    if not _configured():
        raise MessengerConfigurationError('Messenger environment is incomplete.')
    if not GRAPH_VERSION_RE.fullmatch(settings.FB_API_VERSION):
        raise MessengerConfigurationError('FB_API_VERSION must look like vNN.N.')

    image_url = _image_url(scan)
    body = json.dumps({
        'recipient': {'id': settings.FB_RECIPIENT_PSID},
        'message': {
            'attachment': {
                'type': 'image',
                'payload': {'url': image_url, 'is_reusable': True},
            },
        },
    }).encode('utf-8')
    request = urllib.request.Request(
        f'https://graph.facebook.com/{settings.FB_API_VERSION}/{settings.FB_PAGE_ID}/messages',
        data=body,
        headers={
            'Authorization': f'Bearer {settings.FB_PAGE_TOKEN}',
            'Content-Type': 'application/json',
        },
        method='POST',
    )

    try:
        with urllib.request.urlopen(request, timeout=SEND_TIMEOUT_SECONDS) as response:
            result = json.loads(response.read().decode('utf-8'))
    except urllib.error.HTTPError as exc:
        error_code = 'API_REJECTED'
        try:
            data = json.loads(exc.read().decode('utf-8'))
            code = data.get('error', {}).get('code')
            if isinstance(code, (str, int)) and re.fullmatch(r'[A-Za-z0-9_-]{1,40}', str(code)):
                error_code = str(code)
        except (json.JSONDecodeError, UnicodeDecodeError, AttributeError):
            pass
        raise MessengerRejected(error_code) from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise MessengerOutcomeUnknown from None
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise MessengerOutcomeUnknown from None

    message_id = result.get('message_id') if isinstance(result, dict) else None
    if not isinstance(message_id, str) or not message_id:
        raise MessengerOutcomeUnknown
    return message_id


def _claim_delivery(delivery_id, retry_failed=False):
    claimable = ['PENDING']
    if retry_failed:
        claimable.append('FAILED')
    updated = MessengerDelivery.objects.filter(
        pk=delivery_id, status__in=claimable,
    ).update(status='SENDING', attempts=F('attempts') + 1, error_code='')
    delivery = MessengerDelivery.objects.select_related('scan').get(pk=delivery_id)
    return delivery, updated == 1


def deliver_scan_notification(scan, retry_failed=False):
    delivery, _ = MessengerDelivery.objects.get_or_create(scan=scan)
    delivery, claimed = _claim_delivery(delivery.pk, retry_failed=retry_failed)
    if not claimed:
        return delivery

    try:
        message_id = send_scan_image(delivery.scan)
    except MessengerConfigurationError:
        MessengerDelivery.objects.filter(pk=delivery.pk, status='SENDING').update(
            status='FAILED', error_code='CONFIGURATION',
        )
        log.warning('Messenger delivery for scan %s failed: configuration or image unavailable.', scan.pk)
    except MessengerRejected as exc:
        MessengerDelivery.objects.filter(pk=delivery.pk, status='SENDING').update(
            status='FAILED', error_code=exc.error_code,
        )
        log.warning('Messenger rejected scan %s image (Meta error code %s).', scan.pk, exc.error_code)
    except MessengerOutcomeUnknown:
        MessengerDelivery.objects.filter(pk=delivery.pk, status='SENDING').update(
            status='UNKNOWN', error_code='OUTCOME_UNKNOWN',
        )
        log.warning('Messenger delivery outcome for scan %s is unknown; not retrying automatically.', scan.pk)
    else:
        MessengerDelivery.objects.filter(pk=delivery.pk, status='SENDING').update(
            status='SENT', message_id=message_id, sent_at=timezone.now(), error_code='',
        )
        log.info('Messenger image notification sent for scan %s.', scan.pk)

    delivery.refresh_from_db()
    return delivery


def _deliver_in_background(delivery_id):
    close_old_connections()
    try:
        delivery = MessengerDelivery.objects.select_related('scan').get(pk=delivery_id)
        deliver_scan_notification(delivery.scan)
    except MessengerDelivery.DoesNotExist:
        log.warning('Queued Messenger delivery %s no longer exists.', delivery_id)
    except Exception:
        MessengerDelivery.objects.filter(pk=delivery_id, status='SENDING').update(
            status='UNKNOWN', error_code='UNEXPECTED',
        )
        log.error('Unexpected Messenger delivery failure for queue item %s.', delivery_id)
    finally:
        close_old_connections()


def enqueue_scan_notification(scan_id):
    if not settings.FB_AUTO_NOTIFY_ENABLED:
        return

    scan = DeviceScan.objects.filter(
        pk=scan_id, source__in=('AUTO', 'MANUAL'), device__isnull=False,
        detected=True, image__gt='',
    ).first()
    if scan is None:
        return
    if not _configured():
        log.warning('Messenger notification skipped for scan %s: required FB settings are incomplete.', scan.pk)
        return

    delivery, created = MessengerDelivery.objects.get_or_create(scan=scan)
    if not created:
        return
    try:
        threading.Thread(
            target=_deliver_in_background,
            args=(delivery.pk,),
            name=f'messenger-scan-{scan.pk}',
            daemon=True,
        ).start()
    except RuntimeError:
        MessengerDelivery.objects.filter(pk=delivery.pk, status='PENDING').update(
            status='FAILED', error_code='WORKER_START',
        )
        log.exception('Could not start Messenger delivery worker for scan %s.', scan.pk)
