"""
Authenticate web/mobile app requests with the user's Supabase session.

The apps log in with Supabase Auth, so Django verifies the same access token by asking
Supabase who it belongs to (GET /auth/v1/user). This needs no JWT secret and works with
both legacy and asymmetric Supabase signing keys. Results are cached briefly.
"""
import hashlib
import json
import urllib.error
import urllib.request

from django.conf import settings
from django.core.cache import cache
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.permissions import SAFE_METHODS, BasePermission

CACHE_S = 300


class SupabaseUser:
    """Minimal user object for DRF (permissions, throttling)."""
    is_authenticated = True
    is_anonymous = False
    is_staff = False
    is_superuser = False

    def __init__(self, uid, email, role, full_name=''):
        self.id = self.pk = uid
        self.email = email
        self.role = role
        self.full_name = full_name

    def __str__(self):
        return self.email or self.id


def _get(path, token):
    req = urllib.request.Request(
        f"{settings.SUPABASE_URL}{path}",
        headers={'apikey': settings.SUPABASE_ANON_KEY, 'Authorization': f'Bearer {token}'},
    )
    with urllib.request.urlopen(req, timeout=8) as resp:
        return json.loads(resp.read().decode())


def resolve_token(token):
    key = 'sb-user-' + hashlib.sha256(token.encode()).hexdigest()
    cached = cache.get(key)
    if cached:
        return SupabaseUser(**cached)
    try:
        user = _get('/auth/v1/user', token)
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403):
            raise AuthenticationFailed('Session expired. Please log in again.')
        raise AuthenticationFailed(f'Could not verify session with Supabase ({exc.code}).')
    except OSError:
        raise AuthenticationFailed('Could not reach Supabase to verify the session.')
    try:
        rows = _get(f"/rest/v1/profiles?id=eq.{user['id']}&select=role,full_name", token)
    except OSError:
        rows = []
    profile = rows[0] if rows else {}
    data = {
        'uid': user['id'],
        'email': user.get('email', ''),
        'role': profile.get('role') or (user.get('user_metadata') or {}).get('role'),
        'full_name': profile.get('full_name') or '',
    }
    cache.set(key, data, CACHE_S)
    return SupabaseUser(**data)


class SupabaseAuthentication(BaseAuthentication):
    def authenticate(self, request):
        header = request.META.get('HTTP_AUTHORIZATION', '')
        if not header.startswith('Bearer '):
            return None
        return resolve_token(header[7:].strip()), None

    def authenticate_header(self, request):
        return 'Bearer'


class IsStallOperator(BasePermission):
    message = 'Only stall operator accounts can manage devices.'

    def has_permission(self, request, view):
        return isinstance(request.user, SupabaseUser) and request.user.role == 'STALL_OPERATOR'


class IsOperatorOrAdminReadOnly(BasePermission):
    """Stall operators and administrators use cameras (what each may do to a given camera is decided per
    camera in device_views.device_access: the owner and the people the owner shared it with, and always
    the administrator)."""
    message = 'Only stall operator and administrator accounts can use devices.'

    def has_permission(self, request, view):
        user = request.user
        return isinstance(user, SupabaseUser) and user.role in ('STALL_OPERATOR', 'ADMIN')


def find_profile(token, **eq):
    """One profiles row (id, full_name, email, role) matching the given equality filters, or None.
    Uses the caller's own session, so it sees exactly what that user is allowed to see."""
    from urllib.parse import quote
    query = '&'.join(f"{k}=eq.{quote(str(v), safe='')}" for k, v in eq.items())
    try:
        rows = _get(f"/rest/v1/profiles?{query}&select=id,full_name,email,role&limit=1", token)
    except OSError:
        return None
    return rows[0] if rows else None
