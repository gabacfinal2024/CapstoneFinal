import io
import json
import tempfile
import urllib.error
from pathlib import Path
from urllib.parse import urlsplit
from unittest import mock

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from . import device_services
from .messenger_service import _deliver_in_background, deliver_scan_notification, enqueue_scan_notification
from .models import Device, DeviceScan, MessengerDelivery
from .supabase_auth import SupabaseUser

ADMIN = SupabaseUser('99999999-9999-9999-9999-999999999999', 'admin@example.com', 'ADMIN')
OPERATOR = SupabaseUser('11111111-1111-1111-1111-111111111111', 'operator@example.com', 'STALL_OPERATOR')

MESSENGER_SETTINGS = {
    'FB_PAGE_ID': '123456789',
    'FB_PAGE_TOKEN': 'test-page-token',
    'FB_API_VERSION': 'v25.0',
    'FB_RECIPIENT_PSID': '987654321',
    'DEVICE_SERVER_URL': 'https://agriresq.onrender.com',
}


class MessengerDeliveryTests(TestCase):
    def setUp(self):
        self.device = Device.objects.create(
            operator_id=OPERATOR.id,
            name='Test camera',
            device_token='test-device-token',
            mac='AA:BB:CC:DD:EE:01',
        )
        self.scan = DeviceScan.objects.create(
            device=self.device,
            operator_id=OPERATOR.id,
            source='AUTO',
            crop_type='EGGPLANT',
            detected=True,
            detected_crop='EGGPLANT',
            state='fresh',
            freshness_status='GREEN',
            ml_confidence=0.95,
            image='https://storage.example.test/scans/1.jpg',
        )
        self.client = APIClient()

    @override_settings(**MESSENGER_SETTINGS)
    def test_sends_existing_public_image_using_page_authorization_header(self):
        response = mock.MagicMock()
        response.__enter__.return_value = response
        response.read.return_value = b'{"recipient_id":"987654321","message_id":"mid.test-1"}'
        with mock.patch('api.messenger_service.urllib.request.urlopen', return_value=response) as urlopen:
            delivery = deliver_scan_notification(self.scan)

        self.assertEqual(delivery.status, 'SENT')
        request = urlopen.call_args.args[0]
        self.assertEqual(request.full_url, 'https://graph.facebook.com/v25.0/123456789/messages')
        self.assertEqual(request.get_header('Authorization'), 'Bearer test-page-token')
        body = json.loads(request.data)
        self.assertEqual(body['recipient']['id'], '987654321')
        self.assertEqual(body['message']['attachment']['type'], 'image')
        self.assertEqual(body['message']['attachment']['payload']['url'], self.scan.image)
        self.assertEqual(body['message']['attachment']['payload']['is_reusable'], True)

    @override_settings(**MESSENGER_SETTINGS)
    def test_timeout_marks_outcome_unknown_and_prevents_duplicate_retry(self):
        with mock.patch('api.messenger_service.urllib.request.urlopen', side_effect=TimeoutError):
            delivery = deliver_scan_notification(self.scan)
            retry = deliver_scan_notification(self.scan, retry_failed=True)

        self.assertEqual(delivery.status, 'UNKNOWN')
        self.assertEqual(retry.status, 'UNKNOWN')
        self.assertEqual(delivery.attempts, 1)

    def test_unexpected_background_failure_is_marked_unknown(self):
        delivery = MessengerDelivery.objects.create(scan=self.scan)
        with mock.patch('api.messenger_service.send_scan_image', side_effect=RuntimeError), \
                mock.patch('api.messenger_service.log.error'):
            _deliver_in_background(delivery.pk)

        delivery.refresh_from_db()
        self.assertEqual(delivery.status, 'UNKNOWN')
        self.assertEqual(delivery.error_code, 'UNEXPECTED')

    def test_local_scan_file_gets_a_signed_public_https_url(self):
        from .messenger_service import _image_url

        with tempfile.TemporaryDirectory() as media_root:
            path = Path(media_root) / 'scans' / 'camera' / '1.jpg'
            path.parent.mkdir(parents=True)
            path.write_bytes(b'\xff\xd8test\xff\xd9')
            self.scan.image = 'scans/camera/1.jpg'
            self.scan.save(update_fields=['image'])
            with override_settings(
                MEDIA_ROOT=Path(media_root),
                DEVICE_SERVER_URL='https://agriresq.onrender.com',
            ):
                image_url = _image_url(self.scan)
                parsed = urlsplit(image_url)
                response = self.client.get(parsed.path)
                self.assertEqual(parsed.scheme, 'https')
                self.assertEqual(parsed.netloc, 'agriresq.onrender.com')
                self.assertEqual(response.status_code, 200)
                try:
                    self.assertEqual(b''.join(response.streaming_content), b'\xff\xd8test\xff\xd9')
                finally:
                    response.close()

    @override_settings(**MESSENGER_SETTINGS)
    def test_meta_rejection_records_only_error_code(self):
        error = urllib.error.HTTPError(
            'https://graph.facebook.com/test',
            400,
            'Bad Request',
            {},
            io.BytesIO(b'{"error":{"message":"invalid token","code":190}}'),
        )
        with mock.patch('api.messenger_service.urllib.request.urlopen', side_effect=error):
            delivery = deliver_scan_notification(self.scan)

        self.assertEqual(delivery.status, 'FAILED')
        self.assertEqual(delivery.error_code, '190')

    @override_settings(**MESSENGER_SETTINGS, FB_AUTO_NOTIFY_ENABLED=False)
    def test_admin_can_send_one_scan_once(self):
        response_body = io.BytesIO(b'{"recipient_id":"987654321","message_id":"mid.test-2"}')
        context = mock.MagicMock()
        context.__enter__.return_value = context
        context.read.return_value = response_body.getvalue()
        with mock.patch('api.supabase_auth.resolve_token', return_value=ADMIN), \
                mock.patch('api.messenger_service.urllib.request.urlopen', return_value=context) as urlopen:
            self.client.credentials(HTTP_AUTHORIZATION='Bearer test-session-token')
            first = self.client.post(f'/api/messenger/test-scan/{self.scan.pk}/')
            second = self.client.post(f'/api/messenger/test-scan/{self.scan.pk}/')

        self.assertEqual(first.status_code, 200, first.content)
        self.assertEqual(first.json()['status'], 'SENT')
        self.assertEqual(second.status_code, 409)
        self.assertEqual(urlopen.call_count, 1)

    @override_settings(**MESSENGER_SETTINGS)
    def test_non_admin_cannot_send_scan(self):
        with mock.patch('api.supabase_auth.resolve_token', return_value=OPERATOR), \
                mock.patch('api.messenger_service.urllib.request.urlopen') as urlopen:
            self.client.credentials(HTTP_AUTHORIZATION='Bearer test-session-token')
            response = self.client.post(f'/api/messenger/test-scan/{self.scan.pk}/')

        self.assertEqual(response.status_code, 403)
        urlopen.assert_not_called()

    @override_settings(**MESSENGER_SETTINGS, FB_AUTO_NOTIFY_ENABLED=True)
    def test_auto_camera_scan_is_enqueued_only_once(self):
        with mock.patch('api.messenger_service.threading.Thread') as thread:
            enqueue_scan_notification(self.scan.pk)
            enqueue_scan_notification(self.scan.pk)

        thread.assert_called_once()
        self.assertEqual(MessengerDelivery.objects.get(scan=self.scan).status, 'PENDING')

    @override_settings(FB_AUTO_NOTIFY_ENABLED=False)
    def test_auto_notifications_remain_disabled_until_explicitly_enabled(self):
        with mock.patch('api.messenger_service.threading.Thread') as thread:
            enqueue_scan_notification(self.scan.pk)

        thread.assert_not_called()
        self.assertFalse(MessengerDelivery.objects.filter(scan=self.scan).exists())

    def test_run_scan_queues_detected_camera_image(self):
        analysis = ({
                'crop_type': 'EGGPLANT', 'detected': True, 'detected_crop': 'EGGPLANT',
                'crop_mismatch': False, 'message': 'Detected', 'none_prob': 0.0,
                'state': 'fresh', 'freshness_status': 'GREEN', 'freshness_percent': 95,
                'days_to_spoil': 3, 'ml_confidence': 0.95, 'probs': {'fresh': 0.95},
                'low_confidence': False,
            }, mock.MagicMock())
        with mock.patch.object(device_services, 'analyze_image', return_value=analysis), \
                mock.patch.object(device_services, 'has_service_key', return_value=False), \
                mock.patch.object(device_services, '_save_image'), \
                mock.patch('api.messenger_service.enqueue_scan_notification') as enqueue:
            scan = device_services.run_scan(b'\xff\xd8test\xff\xd9', self.device, 'AUTO')

        enqueue.assert_called_once_with(scan.pk)

    def test_run_scan_does_not_save_or_queue_non_vegetable_frame(self):
        analysis = ({
                'crop_type': 'EGGPLANT', 'detected': False, 'detected_crop': None,
                'crop_mismatch': False, 'message': 'No supported vegetable detected.',
                'none_prob': 1.0, 'state': 'none', 'freshness_status': 'UNKNOWN',
                'freshness_percent': None, 'days_to_spoil': None, 'ml_confidence': 0.95,
                'probs': {'none': 1.0}, 'low_confidence': False,
            }, mock.MagicMock())
        with mock.patch.object(device_services, 'analyze_image', return_value=analysis), \
                mock.patch('api.messenger_service.enqueue_scan_notification') as enqueue:
            scan = device_services.run_scan(b'\xff\xd8test\xff\xd9', self.device, 'AUTO')

        self.assertFalse(scan.detected)
        self.assertFalse(scan.image)
        enqueue.assert_not_called()
