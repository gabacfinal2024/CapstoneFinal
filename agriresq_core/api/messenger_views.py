import hashlib
import hmac
import json
import logging

from django.conf import settings
from django.http import HttpResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

log = logging.getLogger(__name__)


@csrf_exempt
@require_http_methods(['GET', 'POST'])
def messenger_webhook(request):
    if request.method == 'GET':
        verify_token = request.GET.get('hub.verify_token', '')
        challenge = request.GET.get('hub.challenge', '')
        if not settings.FB_VERIFY_TOKEN:
            return HttpResponse('Webhook verification is not configured.', status=503)
        token_matches = hmac.compare_digest(
            verify_token.encode('utf-8'), settings.FB_VERIFY_TOKEN.encode('utf-8')
        )
        if request.GET.get('hub.mode') == 'subscribe' and challenge and token_matches:
            return HttpResponse(challenge, content_type='text/plain')
        return HttpResponse('Forbidden', status=403)

    app_secret = settings.FB_APP_SECRET
    if not app_secret:
        return HttpResponse('Webhook signature verification is not configured.', status=503)

    signature = request.headers.get('X-Hub-Signature-256', '')
    if not signature.startswith('sha256='):
        return HttpResponse('Invalid signature', status=403)
    expected = 'sha256=' + hmac.new(
        app_secret.encode('utf-8'), request.body, hashlib.sha256
    ).hexdigest()
    if not hmac.compare_digest(signature.encode('utf-8'), expected.encode('ascii')):
        return HttpResponse('Invalid signature', status=403)

    try:
        payload = json.loads(request.body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return HttpResponse('Invalid JSON', status=400)
    if not isinstance(payload, dict) or payload.get('object') != 'page':
        return HttpResponse('Unsupported webhook object', status=404)

    entries = payload.get('entry', [])
    if settings.FB_LOG_PSID and isinstance(entries, list):
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            events = entry.get('messaging', [])
            if not isinstance(events, list):
                continue
            for event in events:
                if not isinstance(event, dict):
                    continue
                message = event.get('message')
                if not isinstance(message, dict) or message.get('is_echo'):
                    continue
                sender = event.get('sender')
                psid = sender.get('id') if isinstance(sender, dict) else None
                if isinstance(psid, str) and psid:
                    log.info('MESSENGER PSID: %s', psid)

    return HttpResponse('EVENT_RECEIVED', content_type='text/plain')
