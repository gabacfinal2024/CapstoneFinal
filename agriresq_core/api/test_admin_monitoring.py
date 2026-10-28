"""Camera access: the owner, the people it is shared with, and always the administrator."""
from unittest import mock

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from . import device_services
from .models import Device, DeviceMonitor, DeviceScan
from .supabase_auth import SupabaseUser
from .test_devices import BUYER, OPERATOR, as_user

ADMIN = SupabaseUser('99999999-9999-9999-9999-999999999999', 'agriresq@gmail.com', 'ADMIN')


class AdminMonitoringTests(TestCase):
    def setUp(self):
        self.app = APIClient()
        self.app.credentials(HTTP_AUTHORIZATION='Bearer test-session')
        self.mine = Device.objects.create(operator_id=OPERATOR.id, name='Stall 1 Cam', mac='AA:BB:CC:DD:EE:01', device_token='token-one')
        self.theirs = Device.objects.create(operator_id='33333333-3333-3333-3333-333333333333', name='Stall 2 Cam',
                                            mac='AA:BB:CC:DD:EE:02', device_token='token-two')

    def test_admin_sees_every_camera(self):
        with as_user(ADMIN):
            r = self.app.get('/api/devices/')
        self.assertEqual(r.status_code, 200)
        self.assertEqual({d['name'] for d in r.json()}, {'Stall 1 Cam', 'Stall 2 Cam'})
        self.assertIn('operator_id', r.json()[0])

    def test_operator_still_sees_only_their_own(self):
        with as_user(OPERATOR):
            names = [d['name'] for d in self.app.get('/api/devices/').json()]
        self.assertEqual(names, ['Stall 1 Cam'])

    def test_admin_can_open_any_camera_and_its_history(self):
        with as_user(ADMIN):
            for path in (f'/api/devices/{self.theirs.id}/', f'/api/devices/{self.theirs.id}/scans/',
                         f'/api/devices/{self.theirs.id}/readings/', f'/api/devices/{self.theirs.id}/live/'):
                self.assertEqual(self.app.get(path).status_code, 200, path)

    def test_admin_can_use_any_camera_but_not_remove_it(self):
        url = f'/api/devices/{self.theirs.id}/'
        with as_user(ADMIN):
            body = self.app.get(url).json()
            self.assertEqual((body['my_access'], body['can_operate'], body['can_manage']), ('admin', True, False))
            self.assertEqual(self.app.patch(url, {'name': 'Renamed'}, format='json').status_code, 200)
            self.assertEqual(self.app.post(url + 'scan-now/', {}, format='json').status_code, 202)
            self.assertEqual(self.app.post(url + 'command/', {'command': 'reboot'}, format='json').status_code, 200)
            # owner-only: remove the camera, forget its Wi-Fi, choose who shares it, add cameras
            self.assertEqual(self.app.delete(url).status_code, 403)
            self.assertEqual(self.app.post(url + 'command/', {'command': 'forget_wifi'}, format='json').status_code, 403)
            self.assertEqual(self.app.post(url + 'monitors/', {'email': 'a@b.co'}, format='json').status_code, 403)
            self.assertEqual(self.app.post('/api/devices/pairing/', {'name': 'x'}, format='json').status_code, 403)
        self.theirs.refresh_from_db()
        self.assertEqual(self.theirs.name, 'Renamed')
        self.assertTrue(Device.objects.filter(pk=self.theirs.pk).exists())

    def test_buyers_still_have_no_access(self):
        with as_user(BUYER):
            self.assertEqual(self.app.get('/api/devices/').status_code, 403)


class MonitorsAndGalleryTests(TestCase):
    SECOND = SupabaseUser('44444444-4444-4444-4444-444444444444', 'second@example.com', 'STALL_OPERATOR')

    def setUp(self):
        from datetime import timedelta
        from django.utils import timezone
        self.app = APIClient()
        self.app.credentials(HTTP_AUTHORIZATION='Bearer test-session')
        self.cam = Device.objects.create(operator_id=OPERATOR.id, name='Stall 1 Cam', mac='AA:BB:CC:DD:EE:01',
                                         device_token='token-one', product_id=7, ip='192.168.0.50')
        self.other = Device.objects.create(operator_id='33333333-3333-3333-3333-333333333333', name='Other Cam',
                                           mac='AA:BB:CC:DD:EE:02', device_token='token-two')
        kw = dict(crop_type='EGGPLANT', state='fresh', freshness_status='GREEN', ml_confidence=0.9)
        self.s1 = DeviceScan.objects.create(device=self.cam, **kw)
        self.s2 = DeviceScan.objects.create(device=self.cam, detected=False, **{**kw, 'state': 'none'})
        self.s3 = DeviceScan.objects.create(device=self.other, **kw)
        self.old = DeviceScan.objects.create(device=self.cam, **kw)
        DeviceScan.objects.filter(pk=self.old.pk).update(created_at=timezone.now() - timedelta(days=90))

    def lookup(self, person):
        return mock.patch('api.device_views.find_profile', return_value=person)

    def test_a_camera_works_with_only_its_owner_and_can_be_shared_with_one_person(self):
        person = {'id': self.SECOND.id, 'full_name': 'Second', 'email': 'second@example.com', 'role': 'STALL_OPERATOR'}
        third = {'id': '55555555-5555-5555-5555-555555555555', 'full_name': 'Third', 'email': 't@example.com', 'role': 'STALL_OPERATOR'}
        with as_user(OPERATOR):
            alone = self.app.get(f'/api/devices/{self.cam.id}/').json()
            # nobody is required to share it: no warning, the owner has full use
            self.assertEqual((alone['monitor_count'], alone['monitors_needed'], alone['ip'], alone['can_operate']),
                             (1, 0, '192.168.0.50', True))
            self.assertTrue(self.app.get(f'/api/devices/{self.cam.id}/monitors/').json()['ok'])
            with self.lookup(person):
                r = self.app.post(f'/api/devices/{self.cam.id}/monitors/', {'email': 'Second@Example.com'}, format='json')
            self.assertEqual(r.status_code, 201, r.content)
            self.assertEqual((r.json()['count'], r.json()['maximum']), (2, 2))
            # two people is the limit
            with self.lookup(third):
                r = self.app.post(f'/api/devices/{self.cam.id}/monitors/', {'email': 't@example.com'}, format='json')
            self.assertEqual(r.status_code, 400)
            self.assertIn('only one other person', str(r.json()))
        self.assertEqual(DeviceMonitor.objects.count(), 1)

    def test_shared_person_can_use_the_camera_but_not_remove_or_share_it(self):
        DeviceMonitor.objects.create(device=self.cam, user_id=self.SECOND.id, email='second@example.com')
        url = f'/api/devices/{self.cam.id}/'
        with as_user(self.SECOND):
            self.assertEqual([d['id'] for d in self.app.get('/api/devices/').json()], [self.cam.id])
            body = self.app.get(url).json()
            self.assertEqual((body['my_access'], body['can_operate'], body['can_manage']), ('monitor', True, False))
            self.assertEqual(self.app.get(url + 'live/').status_code, 200)
            self.assertEqual(self.app.patch(url, {'name': 'Shared edit'}, format='json').status_code, 200)
            self.assertEqual(self.app.post(url + 'scan-now/', {}, format='json').status_code, 202)
            self.assertEqual(self.app.delete(url).status_code, 403)
            self.assertEqual(self.app.post(url + 'command/', {'command': 'forget_wifi'}, format='json').status_code, 403)
            self.assertEqual(self.app.post(url + 'monitors/', {'email': 'a@b.co'}, format='json').status_code, 403)
            self.assertEqual(self.app.get(f'/api/devices/{self.other.id}/').status_code, 404)

    def test_shared_person_can_leave_but_not_remove_others(self):
        third = SupabaseUser('55555555-5555-5555-5555-555555555555', 't@example.com', 'STALL_OPERATOR')
        DeviceMonitor.objects.create(device=self.cam, user_id=self.SECOND.id)
        DeviceMonitor.objects.create(device=self.cam, user_id=third.id)
        base = f'/api/devices/{self.cam.id}/monitors/'
        with as_user(self.SECOND):
            self.assertEqual(self.app.delete(base + third.id + '/').status_code, 403)
            self.assertEqual(self.app.delete(base + self.SECOND.id + '/').status_code, 200)
        self.assertEqual(list(DeviceMonitor.objects.values_list('user_id', flat=True)), [third.id])

    def test_monitor_must_be_an_existing_stall_operator_and_not_the_owner(self):
        with as_user(OPERATOR):
            for person, text in ((None, 'No AgriResQ account'),
                                 ({'id': 'x', 'role': 'RESCUE_BUYER', 'email': 'b@b.co'}, 'stall operators'),
                                 ({'id': OPERATOR.id, 'role': 'STALL_OPERATOR', 'email': 'op@example.com'}, 'That is you')):
                with self.lookup(person):
                    r = self.app.post(f'/api/devices/{self.cam.id}/monitors/', {'email': 'x@y.co'}, format='json')
                self.assertEqual(r.status_code, 400)
                self.assertIn(text, str(r.json()))
        self.assertEqual(DeviceMonitor.objects.count(), 0)

    def test_owner_can_remove_a_monitor(self):
        DeviceMonitor.objects.create(device=self.cam, user_id=self.SECOND.id)
        with as_user(OPERATOR):
            r = self.app.delete(f'/api/devices/{self.cam.id}/monitors/{self.SECOND.id}/')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(DeviceMonitor.objects.count(), 0)

    def test_gallery_is_scoped_and_filterable(self):
        with as_user(OPERATOR):
            ids = {s['id'] for s in self.app.get('/api/scans/').json()['results']}
            only = self.app.get('/api/scans/?detected=1').json()['results']
        self.assertEqual(ids, {self.s1.id, self.s2.id, self.old.id})
        self.assertTrue(all(s['detected'] for s in only))
        with as_user(ADMIN):
            body = self.app.get('/api/scans/').json()
            self.assertEqual(len(body['results']), 4)
            self.assertEqual(body['results'][0]['device_name'] in ('Stall 1 Cam', 'Other Cam'), True)
            self.assertEqual(len(self.app.get(f'/api/scans/?device={self.other.id}').json()['results']), 1)

    def test_gallery_pages(self):
        with as_user(ADMIN):
            first = self.app.get('/api/scans/?limit=2').json()
            self.assertEqual(len(first['results']), 2)
            rest = self.app.get(f"/api/scans/?limit=2&before={first['next_before']}").json()
        self.assertEqual(len(rest['results']), 2)

    def test_batch_photos_follow_the_camera_linked_to_the_batch(self):
        with as_user(ADMIN):
            ids = {s['id'] for s in self.app.get('/api/batches/7/photos/').json()}
            self.assertEqual(self.app.get('/api/batches/999/photos/').json(), [])
        self.assertEqual(ids, {self.s1.id, self.s2.id, self.old.id})

    def test_old_pictures_are_pruned_but_corrected_ones_are_kept(self):
        from django.test import override_settings
        DeviceScan.objects.filter(pk=self.s1.pk).update(feedback_label='eggplant_fresh')
        DeviceScan.objects.filter(pk=self.s1.pk).update(created_at=self.old.created_at)
        with override_settings(SCAN_KEEP_PER_DEVICE=1, SCAN_KEEP_DAYS=30):
            removed = device_services.prune_scans()
        self.assertEqual(removed, 1)
        self.assertFalse(DeviceScan.objects.filter(pk=self.old.pk).exists())
        self.assertTrue(DeviceScan.objects.filter(pk=self.s1.pk).exists())


class SensorNodeTests(TestCase):
    """A plain ESP32 + DHT22 pairs like a camera and shows up with readings."""

    def test_sensor_node_pairs_reports_and_is_visible_to_admin(self):
        from django.utils import timezone
        from datetime import timedelta
        from .models import PairingCode
        PairingCode.objects.create(code='ABC234', operator_id=OPERATOR.id, name='Stall sensors', crop_type='EGGPLANT',
                                   expires_at=timezone.now() + timedelta(minutes=10))
        node = APIClient()
        r = node.post('/api/devices/claim/', {'code': 'ABC234', 'mac': 'AA:BB:CC:DD:EE:77', 'fw': 'sensor-1.0.0',
                                              'kind': 'SENSOR', 'dht_pin': 4}, format='json')
        self.assertEqual(r.status_code, 201, r.content)
        node.credentials(HTTP_X_DEVICE_TOKEN=r.json()['device_token'])
        self.assertEqual(node.post('/api/devices/heartbeat/', {'rssi': -60}, format='json').status_code, 200)
        self.assertEqual(node.post('/api/devices/reading/', {'temperature_c': 31.4, 'humidity_rh': 71.0},
                                   format='json').status_code, 201)
        device = Device.objects.get()
        self.assertEqual((device.kind, device.dht_pin, device.auto_scan), ('SENSOR', 4, False))

        app = APIClient()
        app.credentials(HTTP_AUTHORIZATION='Bearer test-session')
        with as_user(ADMIN):
            body = app.get('/api/devices/').json()[0]
        self.assertEqual((body['kind'], body['online'], body['latest_reading']['temperature_c']), ('SENSOR', True, 31.4))
        self.assertTrue(body['ip'])

    def test_a_camera_claim_stays_a_camera(self):
        from django.utils import timezone
        from datetime import timedelta
        from .models import PairingCode
        PairingCode.objects.create(code='ZZZ234', operator_id=OPERATOR.id, crop_type='CARROT',
                                   expires_at=timezone.now() + timedelta(minutes=10))
        r = APIClient().post('/api/devices/claim/', {'code': 'ZZZ234', 'mac': 'AA:BB:CC:DD:EE:78'}, format='json')
        self.assertEqual(r.status_code, 201)
        self.assertEqual(Device.objects.get().kind, 'CAMERA')


class DhtConfigTests(TestCase):
    """Only the administrator configures the DHT22; a sensor node comes ready on GPIO 4 (D4)."""

    def setUp(self):
        self.app = APIClient()
        self.app.credentials(HTTP_AUTHORIZATION='Bearer test-session')
        self.sensor = Device.objects.create(operator_id=OPERATOR.id, name='Sensors', mac='AA:BB:CC:DD:EE:11',
                                            device_token='tok-s', kind='SENSOR', dht_pin=4)
        self.cam = Device.objects.create(operator_id=OPERATOR.id, name='Cam', mac='AA:BB:CC:DD:EE:12',
                                         device_token='tok-c', dht_pin=-1)

    def patch(self, device, body):
        return self.app.patch(f'/api/devices/{device.id}/', body, format='json')

    def test_operator_cannot_change_the_dht_pin_but_can_save_other_settings(self):
        with as_user(OPERATOR):
            self.assertEqual(self.patch(self.sensor, {'dht_pin': 5}).status_code, 403)
            self.assertEqual(self.patch(self.cam, {'dht_pin': 13}).status_code, 403)
            # a settings form that resends the unchanged pin still saves
            r = self.patch(self.sensor, {'name': 'Stall sensors', 'dht_pin': 4})
            self.assertEqual(r.status_code, 200, r.content)
        self.sensor.refresh_from_db()
        self.assertEqual((self.sensor.name, self.sensor.dht_pin), ('Stall sensors', 4))

    def test_admin_configures_the_pin_with_the_right_choices_per_board(self):
        with as_user(ADMIN):
            self.assertEqual(self.patch(self.cam, {'dht_pin': 13}).status_code, 200)
            self.assertEqual(self.patch(self.cam, {'dht_pin': 4}).status_code, 400)      # GPIO 4 is the camera's flash LED
            self.assertEqual(self.patch(self.sensor, {'dht_pin': 27}).status_code, 200)
            self.assertEqual(self.patch(self.sensor, {'dht_pin': 4}).status_code, 200)
            self.assertEqual(self.patch(self.sensor, {'dht_pin': 1}).status_code, 400)   # not a usable input pin
            self.assertEqual(self.patch(self.sensor, {'dht_pin': -1}).status_code, 200)  # switch the sensor off
        self.cam.refresh_from_db()
        self.assertEqual(self.cam.dht_pin, 13)


class StallConditionsTests(TestCase):
    def test_summary_reports_climate_vpd_and_what_it_does_to_each_crop(self):
        from decimal import Decimal
        from .models import DeviceReading
        dev = Device.objects.create(operator_id=OPERATOR.id, name='Sensors', mac='AA:BB:CC:DD:EE:31', device_token='tk31',
                                    kind='SENSOR', dht_pin=4)
        DeviceReading.objects.create(device=dev, temperature_c=Decimal('35'), humidity_rh=Decimal('60'))
        Device.objects.filter(pk=dev.pk).update(last_reading_at=timezone.now())
        app = APIClient()
        app.credentials(HTTP_AUTHORIZATION='Bearer test-session')
        for user in (OPERATOR, ADMIN):
            with as_user(user):
                body = app.get('/api/stall/conditions/').json()
            stall = [s for s in body['stalls'] if s['operator_id'] == OPERATOR.id][0]
            self.assertTrue(stall['measured'])
            self.assertEqual((stall['temperature_c'], stall['humidity_rh']), (35.0, 60.0))
            self.assertAlmostEqual(stall['vpd_kpa'], 2.25, delta=0.05)
            self.assertGreater(stall['aging']['EGGPLANT']['days_used_per_day'], 2.5)
            self.assertEqual(stall['aging']['EGGPLANT']['chu_per_hour'], 10.0)
        with as_user(BUYER):
            self.assertEqual(app.get('/api/stall/conditions/').status_code, 403)


class ReferenceEndpointTests(TestCase):
    def test_any_signed_in_user_can_read_the_evidence_and_parameters(self):
        app = APIClient()
        app.credentials(HTTP_AUTHORIZATION='Bearer test-session')
        with as_user(BUYER):
            body = app.get('/api/reference/shelf-life/').json()
        self.assertEqual(len(body['studies']), 7)
        self.assertTrue(all(s['url'].startswith('http') and s['citation'] for s in body['studies']))
        self.assertEqual(body['engine']['crops']['CARROT']['min_rh'], 75.0)
        self.assertEqual(body['engine']['crops']['EGGPLANT']['baseline_days_at_25c'], 5.0)
        self.assertEqual(APIClient().get('/api/reference/shelf-life/').status_code, 401)


class FreshnessAnalysisTests(TestCase):
    """The camera's ML verdicts over several scans, combined with the rules, and who may see what."""

    def setUp(self):
        self.app = APIClient()
        self.app.credentials(HTTP_AUTHORIZATION='Bearer test-session')
        self.cam = Device.objects.create(operator_id=OPERATOR.id, name='Cam', mac='AA:BB:CC:DD:EE:41', device_token='t41',
                                         product_id=7)
        self.product = {'id': 7, 'operator_id': OPERATOR.id, 'crop_type': 'EGGPLANT', 'freshness_status': 'AMBER',
                        'predicted_shelf_life': 2.4, 'freshness_percent': 48, 'is_listed': True, 'ml_confidence': 0.9}
        self.climate = {'latest_temp_c': 31.6, 'latest_humidity_rh': 70.6, 'latest_vpd_kpa': 1.4,
                        'chu_accumulated': 120.0, 'sensor_updated_at': '2026-10-27T11:00:00Z'}

    def scan(self, state, conf, minutes_ago=10, **kw):
        from datetime import timedelta
        status = {'fresh': 'GREEN', 'at-risk': 'AMBER', 'rotten': 'RED'}[state]
        s = DeviceScan.objects.create(device=self.cam, product_id=7, crop_type='EGGPLANT', state=state,
                                      freshness_status=status, ml_confidence=conf, **kw)
        DeviceScan.objects.filter(pk=s.pk).update(created_at=timezone.now() - timedelta(minutes=minutes_ago))
        return s

    def get(self, user, product=None):
        from . import device_views
        rows = {'products': [product or self.product], 'product_climate': [self.climate]}
        with as_user(user), \
                mock.patch.object(device_views, 'has_service_key', return_value=True), \
                mock.patch.object(device_views, 'supabase_select', side_effect=lambda t, m=None, **k: rows[t]):
            return self.app.get('/api/batches/7/analysis/')

    def test_several_agreeing_scans_give_a_high_trust_level(self):
        for i, c in enumerate((0.94, 0.9, 0.88)):
            self.scan('at-risk', c, minutes_ago=30 * (i + 1))
        body = self.get(OPERATOR).json()
        cam = body['camera']
        self.assertEqual((cam['state'], cam['scans'], cam['agreeing']), ('at-risk', 3, 3))
        self.assertAlmostEqual(cam['confidence'], 0.907, delta=0.01)
        self.assertEqual((body['level'], body['agreement']), ('HIGH', 'agree'))
        self.assertEqual(body['climate']['chu'], 120.0)             # the operator sees the heat units and VPD
        self.assertEqual(body['days_to_spoil'], 2.4)

    def test_a_split_camera_is_not_trusted(self):
        self.scan('at-risk', 0.9, 10)
        self.scan('fresh', 0.85, 20)
        self.scan('fresh', 0.8, 30)
        body = self.get(OPERATOR).json()
        self.assertEqual(body['camera']['state'], 'fresh')
        self.assertEqual(body['camera']['consistency'], 0.667)
        self.assertEqual(body['agreement'], 'rules_stricter')        # the camera sees good skin, heat used up the days
        self.assertEqual(body['level'], 'LOW')                        # 0.825 mean x 0.667 agree = 0.55: below the 0.6 trust floor

    def test_scans_the_model_was_unsure_about_do_not_count(self):
        self.scan('at-risk', 0.5, 10, low_confidence=True)
        self.scan('at-risk', 0.9, 20, detected=False)
        self.scan('at-risk', 0.9, 30, crop_mismatch=True)
        body = self.get(OPERATOR).json()
        self.assertIsNone(body['camera'])
        self.assertEqual(body['level'], 'RULES_ONLY')

    def test_buyers_get_days_and_camera_confidence_but_no_sensor_data(self):
        self.scan('at-risk', 0.92, 10)
        self.scan('at-risk', 0.9, 20)
        body = self.get(BUYER).json()
        self.assertEqual(body['days_to_spoil'], 2.4)
        self.assertEqual(body['camera']['state'], 'at-risk')
        self.assertNotIn('climate', body)
        for secret in ('31.6', '70.6', '120.0', 'vpd', 'chu', 'humidity', 'temperature'):
            self.assertNotIn(secret, str(body).lower())

    def test_a_buyer_cannot_open_an_unlisted_batch(self):
        self.assertEqual(self.get(BUYER, dict(self.product, is_listed=False)).status_code, 404)
        self.assertEqual(self.get(ADMIN, dict(self.product, is_listed=False)).status_code, 200)

    def test_another_operator_gets_no_sensor_part_of_a_batch_they_do_not_own(self):
        other = SupabaseUser('66666666-6666-6666-6666-666666666666', 'o@example.com', 'STALL_OPERATOR')
        self.assertNotIn('climate', self.get(other).json())


class ConsistencyOverrideTests(TestCase):
    """One noisy frame must not put a good batch on discount."""

    def test_a_single_unconfirmed_scan_does_not_change_the_status(self):
        from decimal import Decimal
        from . import device_services
        cam = Device.objects.create(operator_id='op-1', name='Cam', mac='AA:BB:CC:DD:EE:51', device_token='t51', product_id=7)
        product = {'id': 7, 'operator_id': 'op-1', 'crop_type': 'EGGPLANT', 'freshness_status': 'GREEN',
                   'predicted_shelf_life': 4.0}
        kw = dict(device=cam, product_id=7, crop_type='EGGPLANT', state='at-risk', freshness_status='AMBER',
                  days_to_spoil=Decimal('2'))
        weak = DeviceScan.objects.create(ml_confidence=0.7, **kw)
        with mock.patch.object(device_services, '_product', return_value=product), \
                mock.patch.object(device_services, 'supabase_update'), \
                mock.patch.object(device_services, '_apply') as apply:
            device_services.ml_override(cam, weak)
            apply.assert_not_called()                                     # 70 % and no second scan: wait
            DeviceScan.objects.create(ml_confidence=0.75, **kw)           # a second accepted scan agrees
            device_services.ml_override(cam, DeviceScan.objects.order_by('-pk').first())
            self.assertEqual(apply.call_args.args[2], 'AMBER')
            apply.reset_mock()
            DeviceScan.objects.all().delete()
            sure = DeviceScan.objects.create(ml_confidence=0.95, **kw)    # one very confident scan is enough
            device_services.ml_override(cam, sure)
            self.assertEqual(apply.call_args.args[2], 'AMBER')
