from uuid import UUID
from unittest.mock import patch

from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.test import APIClient

from .supabase_admin import SupabaseAdminError, set_account_active
from .supabase_auth import SupabaseUser, resolve_token


class APIRootPermissionTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_api_root_is_public(self):
        response = self.client.get('/api/', HTTP_ACCEPT='application/json')

        self.assertEqual(response.status_code, 200)
        self.assertIn('inventory', response.data)

    def test_protected_endpoint_still_requires_authentication(self):
        response = self.client.get('/api/dashboard/', HTTP_ACCEPT='application/json')

        self.assertEqual(response.status_code, 401)

    def test_deployed_frontend_origin_is_allowed_by_cors(self):
        response = self.client.get(
            '/api/devices/',
            HTTP_ACCEPT='application/json',
            HTTP_ORIGIN='https://capstonefinal-o9ek.onrender.com',
        )

        self.assertEqual(response['Access-Control-Allow-Origin'], 'https://capstonefinal-o9ek.onrender.com')


class AdminAccountStatusTests(TestCase):
    admin_id = '22c51c30-39dd-49db-a157-428bc9bf4230'
    operator_id = 'b7fb7f09-7636-4c0d-a143-351570cb6f46'

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(SupabaseUser(self.admin_id, 'admin@example.com', 'ADMIN'))

    @patch('api.admin_views.set_account_active')
    @patch('api.admin_views.get_admin_profile')
    def test_admin_can_deactivate_and_restore_operator(self, get_profile, set_active):
        get_profile.return_value = {'id': self.operator_id, 'role': 'STALL_OPERATOR', 'is_active': True}
        response = self.client.patch(
            f'/api/admin/users/{self.operator_id}/status/',
            {'is_active': False},
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.data['is_active'])
        set_active.assert_called_once_with(UUID(self.operator_id), False)

        get_profile.return_value = {'id': self.operator_id, 'role': 'STALL_OPERATOR', 'is_active': False}
        response = self.client.patch(
            f'/api/admin/users/{self.operator_id}/status/',
            {'is_active': True},
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        set_active.assert_called_with(UUID(self.operator_id), True)

    @patch('api.admin_views.get_admin_profile')
    def test_admin_cannot_deactivate_self_or_another_admin(self, get_profile):
        response = self.client.patch(
            f'/api/admin/users/{self.admin_id}/status/',
            {'is_active': False},
            format='json',
        )
        self.assertEqual(response.status_code, 400)
        get_profile.assert_not_called()

        get_profile.return_value = {'id': self.operator_id, 'role': 'ADMIN', 'is_active': True}
        response = self.client.patch(
            f'/api/admin/users/{self.operator_id}/status/',
            {'is_active': False},
            format='json',
        )
        self.assertEqual(response.status_code, 400)

    @patch('api.admin_views.get_admin_profile')
    def test_non_admin_cannot_change_account_status(self, get_profile):
        self.client.force_authenticate(SupabaseUser(self.operator_id, 'operator@example.com', 'STALL_OPERATOR'))
        response = self.client.patch(
            f'/api/admin/users/{self.admin_id}/status/',
            {'is_active': False},
            format='json',
        )
        self.assertEqual(response.status_code, 403)
        get_profile.assert_not_called()

    def test_account_status_requires_boolean(self):
        response = self.client.patch(
            f'/api/admin/users/{self.operator_id}/status/',
            {'is_active': 'false'},
            format='json',
        )
        self.assertEqual(response.status_code, 400)


class SupabaseAccountUpdateTests(TestCase):
    @override_settings(
        SUPABASE_URL='https://project.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY='test-service-key',
    )
    @patch('api.supabase_admin._admin_request')
    def test_deactivation_preserves_profile_and_bans_auth_user(self, request):
        request.return_value = [{'id': 'b7fb7f09-7636-4c0d-a143-351570cb6f46'}]
        set_account_active('b7fb7f09-7636-4c0d-a143-351570cb6f46', False)

        self.assertEqual(request.call_count, 2)
        profile_call, auth_call = request.call_args_list
        self.assertIn('/rest/v1/profiles?', profile_call.args[0])
        self.assertEqual(profile_call.args[1], 'PATCH')
        self.assertEqual(profile_call.args[2], {'is_active': False})
        self.assertIn('/auth/v1/admin/users/', auth_call.args[0])
        self.assertEqual(auth_call.args[1], 'PUT')
        self.assertEqual(auth_call.args[2], {'ban_duration': '876000h'})

    @override_settings(SUPABASE_SERVICE_ROLE_KEY='')
    def test_account_update_requires_backend_service_key(self):
        with self.assertRaisesMessage(SupabaseAdminError, 'SUPABASE_SERVICE_ROLE_KEY'):
            set_account_active('b7fb7f09-7636-4c0d-a143-351570cb6f46', False)


class SupabaseAccountAuthenticationTests(TestCase):
    @patch('api.supabase_client.supabase_select')
    @patch('api.supabase_client.has_service_key', return_value=True)
    @patch('api.supabase_auth._get')
    def test_inactive_profile_hidden_by_rls_is_rejected(self, get, has_service_key, select):
        cache.clear()
        get.side_effect = [
            {'id': 'b7fb7f09-7636-4c0d-a143-351570cb6f46', 'email': 'operator@example.com'},
            [],
        ]
        select.return_value = [{
            'role': 'STALL_OPERATOR',
            'full_name': 'Operator',
            'is_active': False,
        }]

        with self.assertRaisesMessage(AuthenticationFailed, 'deactivated'):
            resolve_token('inactive-account-test-token')
        select.assert_called_once()

    @patch('api.supabase_auth._get')
    def test_active_profile_authenticates(self, get):
        cache.clear()
        get.side_effect = [
            {'id': 'b7fb7f09-7636-4c0d-a143-351570cb6f46', 'email': 'operator@example.com'},
            [{'role': 'STALL_OPERATOR', 'full_name': 'Operator', 'is_active': True}],
        ]

        user = resolve_token('active-account-test-token')

        self.assertEqual(user.role, 'STALL_OPERATOR')
        self.assertTrue(user.is_active)

    @patch('api.supabase_client.supabase_select')
    @patch('api.supabase_client.has_service_key', return_value=True)
    @patch('api.supabase_auth._get')
    def test_account_status_is_rechecked_for_cached_tokens(self, get, has_service_key, select):
        cache.clear()
        get.side_effect = [
            {'id': 'b7fb7f09-7636-4c0d-a143-351570cb6f46', 'email': 'operator@example.com'},
            [{'role': 'STALL_OPERATOR', 'full_name': 'Operator', 'is_active': True}],
            [],
        ]
        select.return_value = [{
            'role': 'STALL_OPERATOR',
            'full_name': 'Operator',
            'is_active': False,
        }]

        resolve_token('status-freshness-test-token')
        with self.assertRaisesMessage(AuthenticationFailed, 'deactivated'):
            resolve_token('status-freshness-test-token')
        self.assertEqual(get.call_count, 3)
