from datetime import timedelta
from decimal import Decimal
from unittest import mock

from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from . import device_services, device_views
from .models import BatchClock, BatchSensorLink, Device, DeviceMonitor, DeviceReading
from .supabase_auth import SupabaseUser
from .test_devices import BUYER, OPERATOR, as_user


STALL_199 = SupabaseUser('33333333-3333-3333-3333-333333333333', 'operator199@example.test', 'STALL_OPERATOR')


class SharedBatchSensorTests(TestCase):
    def setUp(self):
        cache.clear()
        self.api = APIClient()
        self.api.credentials(HTTP_AUTHORIZATION='Bearer test-session')
        self.sensor = Device.objects.create(operator_id=OPERATOR.id, kind='SENSOR', dht_pin=4, name='Shared DHT22',
                                            mac='AA:BB:CC:DD:EE:01', device_token='shared-dht')
        self.share = DeviceMonitor.objects.create(device=self.sensor, user_id=STALL_199.id)
        self.product = {'id': 7, 'operator_id': STALL_199.id, 'crop_type': 'CARROT', 'quantity_kg': 10,
                        'freshness_status': 'GREEN', 'predicted_shelf_life': 5, 'freshness_percent': 80, 'is_listed': True}
        self.route = '/api/batches/7/sensor/'

    def test_shared_operator_can_assign_and_unassign_sensor_on_multiple_own_batches(self):
        products = {7: self.product, 8: {**self.product, 'id': 8, 'is_listed': False}}
        with as_user(STALL_199), mock.patch.object(device_views, 'has_service_key', return_value=True), \
                mock.patch.object(device_views, 'supabase_select', side_effect=lambda _, match: [products[match['id']]]):
            config = self.api.get(self.route).json()
            self.assertEqual([s['id'] for s in config['sensors']], [self.sensor.id])
            self.assertTrue(config['sensors'][0]['shared'])
            for pid in products:
                self.assertEqual(self.api.put(f'/api/batches/{pid}/sensor/', {'sensor_id': self.sensor.pk}, format='json').status_code, 200)
            clock = BatchClock.objects.get(product_id=7)
            self.assertEqual(self.api.put(self.route, {'sensor_id': self.sensor.pk}, format='json').status_code, 200)
            self.assertEqual(BatchClock.objects.get(product_id=7).last_tick, clock.last_tick)
            self.assertEqual(self.api.get(self.route).json()['sensor_id'], self.sensor.pk)
            self.assertEqual(self.api.put(self.route, {'sensor_id': None}, format='json').status_code, 200)
        self.assertEqual(list(self.sensor.batch_links.values_list('product_id', flat=True)), [8])

    def test_sensor_and_batch_access_are_independent_and_rotten_batch_cannot_link(self):
        private = Device.objects.create(operator_id=OPERATOR.id, kind='SENSOR', dht_pin=4,
                                        mac='AA:BB:CC:DD:EE:02', device_token='private-dht')
        with mock.patch.object(device_views, 'has_service_key', return_value=True), \
                mock.patch.object(device_views, 'supabase_select', return_value=[self.product]):
            with as_user(STALL_199):
                self.assertEqual(self.api.put(self.route, {'sensor_id': private.pk}, format='json').status_code, 404)
            with as_user(OPERATOR):
                self.assertEqual(self.api.put(self.route, {'sensor_id': self.sensor.pk}, format='json').status_code, 404)
            with as_user(BUYER):
                self.assertEqual(self.api.get(self.route).status_code, 403)
            self.product['freshness_status'] = 'RED'
            with as_user(STALL_199):
                self.assertEqual(self.api.put(self.route, {'sensor_id': self.sensor.pk}, format='json').status_code, 400)
        self.assertFalse(BatchSensorLink.objects.exists())

    def test_sensor_feed_ages_only_linked_batches_for_the_shared_operator(self):
        private_inventory = {**self.product, 'is_listed': False}
        unlinked = {**self.product, 'id': 8}
        BatchSensorLink.objects.create(product_id=7, operator_id=STALL_199.id, sensor=self.sensor)
        with mock.patch.object(device_services, 'has_service_key', return_value=True), \
                mock.patch.object(device_services, '_alerts'), \
                mock.patch.object(device_services, 'supabase_select',
                                  side_effect=lambda _, match: [private_inventory, unlinked] if match['operator_id'] == STALL_199.id else []), \
                mock.patch.object(device_services, '_age_product') as age, \
                mock.patch.object(device_services, 'pair_readings') as pair:
            reading = device_services.save_reading(self.sensor, 31, 74)
        age.assert_called_once()
        self.assertEqual(age.call_args.args[:3], (private_inventory, Decimal('31'), Decimal('74')))
        pair.assert_called_once_with([private_inventory], Decimal('31'), Decimal('74'), reading.created_at)

    def test_time_aging_uses_the_shared_sensor_instead_of_the_batch_owners_sensor(self):
        BatchSensorLink.objects.create(product_id=7, operator_id=STALL_199.id, sensor=self.sensor)
        own = Device.objects.create(operator_id=STALL_199.id, kind='SENSOR', dht_pin=4,
                                    mac='AA:BB:CC:DD:EE:02', device_token='own-dht')
        DeviceReading.objects.create(device=own, temperature_c=20, humidity_rh=90)
        DeviceReading.objects.create(device=self.sensor, temperature_c=31, humidity_rh=74)
        with mock.patch.object(device_services, 'has_service_key', return_value=True), \
                mock.patch.object(device_services, 'supabase_select', return_value=[self.product]), \
                mock.patch.object(device_services, '_age_product') as age:
            device_services.age_by_time()
        self.assertEqual(age.call_args.args[:3], (self.product, Decimal('31'), Decimal('74')))

    def test_batch_analysis_reads_the_selected_sensor_and_keeps_buyer_readings_private(self):
        BatchSensorLink.objects.create(product_id=7, operator_id=STALL_199.id, sensor=self.sensor)
        DeviceReading.objects.create(device=self.sensor, temperature_c=31, humidity_rh=74)
        with mock.patch.object(device_views, 'has_service_key', return_value=True), \
                mock.patch.object(device_views, 'supabase_select', return_value=[self.product]):
            with as_user(STALL_199):
                analysis = self.api.get('/api/batches/7/analysis/').json()
                self.assertEqual(analysis['climate']['temperature_c'], 31)
                self.assertEqual(analysis['climate']['humidity_rh'], 74)
            with as_user(BUYER):
                self.assertNotIn('climate', self.api.get('/api/batches/7/analysis/').json())

    def test_active_shared_listing_appears_on_the_sensor_and_access_removal_unlinks(self):
        BatchSensorLink.objects.create(product_id=7, operator_id=STALL_199.id, sensor=self.sensor)
        listing = {'id': 17, 'product': self.product, 'expires_at': (timezone.now() + timedelta(days=1)).isoformat()}
        with as_user(STALL_199), mock.patch.object(device_views, 'has_service_key', return_value=True), \
                mock.patch.object(device_views, 'supabase_select',
                                  side_effect=lambda _, match, _fields: [listing] if match.get('product_id') == [7] else []), \
                mock.patch.object(device_views, 'find_profile', return_value=None):
            self.assertEqual(self.api.get(f'/api/devices/{self.sensor.id}/').json()['sensor_listings'][0]['listing_id'], 17)
            self.assertEqual(self.api.delete(f'/api/devices/{self.sensor.id}/monitors/{STALL_199.id}/').status_code, 200)
        self.assertFalse(BatchSensorLink.objects.exists())
