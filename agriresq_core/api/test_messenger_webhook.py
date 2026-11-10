import hashlib
import hmac
import json
from unittest import mock

from django.test import SimpleTestCase, override_settings
from django.urls import reverse


class MessengerWebhookTests(SimpleTestCase):
    def setUp(self):
        self.url = reverse('messenger-webhook')

    @override_settings(FB_VERIFY_TOKEN='test-verify-token')
    def test_get_verification_returns_challenge_for_matching_token(self):
        response = self.client.get(self.url, {
            'hub.mode': 'subscribe',
            'hub.verify_token': 'test-verify-token',
            'hub.challenge': 'challenge-123',
        })

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, b'challenge-123')

    @override_settings(FB_VERIFY_TOKEN='test-verify-token')
    def test_get_verification_rejects_wrong_token(self):
        response = self.client.get(self.url, {
            'hub.mode': 'subscribe',
            'hub.verify_token': 'wrong-token',
            'hub.challenge': 'challenge-123',
        })

        self.assertEqual(response.status_code, 403)

    @override_settings(FB_APP_SECRET='test-app-secret')
    def test_post_rejects_invalid_signature(self):
        response = self.client.post(
            self.url,
            data=b'{"object":"page","entry":[]}',
            content_type='application/json',
            HTTP_X_HUB_SIGNATURE_256='sha256=invalid',
        )

        self.assertEqual(response.status_code, 403)

    @override_settings(FB_APP_SECRET='test-app-secret', FB_LOG_PSID=True)
    def test_valid_message_logs_sender_psid_without_logging_payload(self):
        payload = {
            'object': 'page',
            'entry': [{
                'messaging': [{
                    'sender': {'id': 'test-page-scoped-id'},
                    'recipient': {'id': 'test-page-id'},
                    'message': {'text': 'message text must not be logged'},
                }],
            }],
        }
        body = json.dumps(payload).encode('utf-8')
        digest = hmac.new(b'test-app-secret', body, hashlib.sha256).hexdigest()

        with mock.patch('api.messenger_views.log') as logger:
            response = self.client.post(
                self.url,
                data=body,
                content_type='application/json',
                HTTP_X_HUB_SIGNATURE_256=f'sha256={digest}',
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, b'EVENT_RECEIVED')
        logger.info.assert_called_once_with('MESSENGER PSID: %s', 'test-page-scoped-id')
        self.assertNotIn('message text must not be logged', str(logger.info.call_args))

    @override_settings(FB_APP_SECRET='test-app-secret')
    def test_post_rejects_malformed_json_with_valid_signature(self):
        body = b'{invalid json'
        digest = hmac.new(b'test-app-secret', body, hashlib.sha256).hexdigest()
        response = self.client.post(
            self.url,
            data=body,
            content_type='application/json',
            HTTP_X_HUB_SIGNATURE_256=f'sha256={digest}',
        )

        self.assertEqual(response.status_code, 400)
