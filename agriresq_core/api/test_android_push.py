from unittest.mock import Mock, patch

from django.test import SimpleTestCase

from .android_push import deliver_pending, message_payload


def delivery(delivery_id, notification_type):
    return {
        'delivery_id': delivery_id,
        'attempt': 1,
        'token': f'test-token-{delivery_id}',
        'user_id': 'test-recipient',
        'notification_id': 100 + delivery_id,
        'notification_type': notification_type,
    }


class AndroidPushTests(SimpleTestCase):
    def test_updates_and_risk_alerts_use_audible_android_channels(self):
        channels = {
            'NEW_MESSAGE': 'agriresq_updates',
            'AT_RISK_BATCH': 'agriresq_at_risk',
            'AT_RISK_LISTING': 'agriresq_at_risk',
        }
        for kind, channel in channels.items():
            with self.subTest(kind=kind):
                message = message_payload(delivery(1, kind))['message']
                self.assertEqual(message['data']['recipient_id'], 'test-recipient')
                notification = message['android']['notification']
                self.assertEqual(notification['channel_id'], channel)
                self.assertTrue(notification['default_sound'])
                self.assertEqual(notification['tag'], 'agriresq-101')

    @patch('api.android_push.supabase_rpc')
    def test_success_finishes_transient_failure_retries_and_unregistered_token_is_removed(self, rpc):
        rpc.return_value = [
            delivery(1, 'NEW_MESSAGE'),
            delivery(2, 'AT_RISK_BATCH'),
            delivery(3, 'AT_RISK_LISTING'),
        ]
        expired = Mock(ok=False, status_code=404)
        expired.json.return_value = {'error': {'details': [{'errorCode': 'UNREGISTERED'}]}}
        session = Mock()
        session.post.side_effect = [Mock(ok=True), Mock(ok=False, status_code=429), expired]

        with self.assertLogs('api.android_push', level='WARNING'):
            deliver_pending(session, 'https://fcm.example.test')

        self.assertEqual(rpc.call_args_list[0].args, ('claim_android_push',))
        self.assertEqual(session.post.call_count, 3)
        self.assertEqual(
            [
                (call.args[0], call.args[1]['p_delivery_id'], call.args[1]['p_remove_token'])
                for call in rpc.call_args_list[1:]
            ],
            [('finish_android_push', 1, False), ('finish_android_push', 3, True)],
        )
