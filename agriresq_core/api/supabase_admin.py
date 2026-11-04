import json
import urllib.error
import urllib.parse
import urllib.request

from django.conf import settings


class SupabaseAdminError(Exception):
    pass


def _admin_request(url, method, payload):
    data = json.dumps(payload).encode() if payload is not None else None
    key = settings.SUPABASE_SERVICE_ROLE_KEY
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            'apikey': key,
            'Authorization': f'Bearer {key}',
            'Content-Type': 'application/json',
            'Prefer': 'return=representation',
        },
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            body = response.read().decode()
            return json.loads(body) if body else None
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors='replace')
        raise SupabaseAdminError(f'Supabase rejected the account update ({exc.code}): {detail[:300]}') from exc
    except urllib.error.URLError as exc:
        raise SupabaseAdminError(f'Could not reach Supabase to update the account: {exc.reason}') from exc


def get_admin_profile(user_id):
    if not settings.SUPABASE_SERVICE_ROLE_KEY:
        raise SupabaseAdminError('Account management is unavailable: configure SUPABASE_SERVICE_ROLE_KEY on the backend.')
    query = urllib.parse.urlencode({
        'id': f'eq.{user_id}',
        'select': 'id,role,is_active',
    })
    rows = _admin_request(
        f'{settings.SUPABASE_URL}/rest/v1/profiles?{query}',
        'GET',
        None,
    )
    return rows[0] if isinstance(rows, list) and rows else None


def _set_profile_active(user_id, is_active):
    query = urllib.parse.urlencode({'id': f'eq.{user_id}', 'select': 'id'})
    rows = _admin_request(
        f'{settings.SUPABASE_URL}/rest/v1/profiles?{query}',
        'PATCH',
        {'is_active': is_active},
    )
    if not isinstance(rows, list) or not rows:
        raise SupabaseAdminError('The account profile was not found or could not be updated.')


def set_account_active(user_id, is_active):
    if not settings.SUPABASE_SERVICE_ROLE_KEY:
        raise SupabaseAdminError('Account management is unavailable: configure SUPABASE_SERVICE_ROLE_KEY on the backend.')

    _set_profile_active(user_id, is_active)
    duration = 'none' if is_active else '876000h'
    try:
        _admin_request(
            f'{settings.SUPABASE_URL}/auth/v1/admin/users/{urllib.parse.quote(str(user_id), safe="")}',
            'PUT',
            {'ban_duration': duration},
        )
    except SupabaseAdminError as exc:
        try:
            _set_profile_active(user_id, not is_active)
        except SupabaseAdminError as rollback_error:
            raise SupabaseAdminError(
                f'{exc} The profile status could not be rolled back: {rollback_error}'
            ) from exc
        raise
