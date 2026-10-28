from django.test import TestCase
from rest_framework.test import APIClient


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
