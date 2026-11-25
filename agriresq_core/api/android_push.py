"""Send queued Supabase notifications to the installed Android app."""
import json
import logging
import time

from .supabase_client import has_service_key, supabase_rpc

log = logging.getLogger(__name__)
MESSAGING_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging'
PUSH_TEXT = {
    'AT_RISK_BATCH': ('Batch is at risk', 'Open AgriResQ to check your batch.'),
    'AT_RISK_LISTING': ('At-risk listing available', 'Open AgriResQ to view the rescue listing.'),
}


def message_payload(delivery):
    kind = delivery['notification_type']
    title, body = PUSH_TEXT.get(kind, ('New AgriResQ notification', 'Open AgriResQ to view the update.'))
    notification_id = str(delivery['notification_id'])
    return {'message': {
        'token': delivery['token'],
        'notification': {'title': title, 'body': body},
        'data': {'notification_id': notification_id, 'recipient_id': delivery['user_id']},
        'android': {
            'priority': 'HIGH',
            'ttl': '300s',
            'notification': {
                'channel_id': 'agriresq_at_risk' if kind in PUSH_TEXT else 'agriresq_updates',
                'default_sound': True,
                'tag': f'agriresq-{notification_id}',
                'visibility': 'PRIVATE',
            },
        },
    }}


def deliver_pending(session, url):
    deliveries = supabase_rpc('claim_android_push') or []
    for delivery in deliveries:
        response = session.post(url, json=message_payload(delivery), timeout=8)
        expired_token = False
        if not response.ok:
            if response.status_code == 404:
                expired_token = any(
                    detail.get('errorCode') == 'UNREGISTERED'
                    for detail in response.json().get('error', {}).get('details', [])
                )
            if not expired_token:
                log.warning('Android push delivery %s returned HTTP %s', delivery['delivery_id'], response.status_code)
                if response.status_code != 400:
                    continue  # The lease expires so temporary Firebase failures can be retried.
        supabase_rpc('finish_android_push', {
            'p_delivery_id': delivery['delivery_id'],
            'p_attempt': delivery['attempt'],
            'p_token': delivery['token'],
            'p_remove_token': expired_token,
        })


def delivery_loop(account_json):
    from google.auth.transport.requests import AuthorizedSession
    from google.oauth2 import service_account

    if not has_service_key():
        log.error('Android push requires SUPABASE_SERVICE_ROLE_KEY')
        return
    try:
        account = json.loads(account_json)
        credentials = service_account.Credentials.from_service_account_info(account, scopes=[MESSAGING_SCOPE])
        url = f'https://fcm.googleapis.com/v1/projects/{credentials.project_id}/messages:send'
    except (ValueError, TypeError, KeyError):
        log.error('Invalid AGRIRESQ_FCM_SERVICE_ACCOUNT_JSON')
        return

    with AuthorizedSession(credentials, refresh_timeout=8) as session:
        while True:
            try:
                deliver_pending(session, url)
            except Exception as exc:
                log.warning('Android push worker failed (%s); queued messages will retry', type(exc).__name__)
            time.sleep(10)
