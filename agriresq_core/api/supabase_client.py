"""
Supabase REST client for Django backend (IoT + vision pipeline).
Uses the service role key for server-side writes (bypasses RLS), so it is only ever
read from the backend .env and never sent to the apps or the ESP32.
"""
import json
import urllib.parse
import urllib.request

from django.conf import settings


def has_service_key() -> bool:
    return bool(settings.SUPABASE_SERVICE_ROLE_KEY)


def _headers(prefer=None):
    key = settings.SUPABASE_SERVICE_ROLE_KEY or settings.SUPABASE_ANON_KEY
    h = {
        'apikey': key,
        'Authorization': f'Bearer {key}',
        'Content-Type': 'application/json',
    }
    if prefer:
        h['Prefer'] = prefer
    return h


def _query(match):
    return '&'.join(f'{k}=eq.{urllib.parse.quote(str(v))}' for k, v in (match or {}).items())


def _send(req):
    with urllib.request.urlopen(req, timeout=10) as resp:
        body = resp.read().decode()
        return json.loads(body) if body else None


def supabase_insert(table: str, payload: dict) -> dict:
    url = f'{settings.SUPABASE_URL}/rest/v1/{table}'
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode(), headers=_headers('return=representation'), method='POST',
    )
    data = _send(req)
    return data[0] if isinstance(data, list) else data


def supabase_upsert(table: str, payload: dict, on_conflict: str) -> dict:
    url = f'{settings.SUPABASE_URL}/rest/v1/{table}?on_conflict={on_conflict}'
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode(),
        headers=_headers('return=representation,resolution=merge-duplicates'), method='POST',
    )
    data = _send(req)
    return data[0] if isinstance(data, list) else data


def supabase_update(table: str, match: dict, payload: dict) -> None:
    url = f'{settings.SUPABASE_URL}/rest/v1/{table}?{_query(match)}'
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), headers=_headers(), method='PATCH')
    _send(req)


def supabase_select(table: str, match: dict = None, select='*') -> list:
    url = f'{settings.SUPABASE_URL}/rest/v1/{table}?select={select}'
    if match:
        url += '&' + _query(match)
    req = urllib.request.Request(url, headers=_headers())
    return _send(req) or []
