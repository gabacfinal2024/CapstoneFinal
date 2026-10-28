"""End-to-end tests of the smart-home device flow (docs/IOT_DEVICE_API.md).

Supabase is mocked / switched off; the freshness CNN runs for real on a few sample photos in
api/test_assets (eggplant, cucumber, carrot = target crops; tomato, bitter gourd = NOT targets).
Run:  ..\\.venv\\Scripts\\python manage.py test api
"""
import hashlib
import hmac
import io
import json
import shutil
import tempfile
from datetime import datetime, timedelta
from decimal import Decimal
from pathlib import Path
from unittest import mock

from django.core.management import call_command
from django.test import TestCase, override_settings
from django.utils import timezone
from PIL import Image
from rest_framework.test import APIClient

from . import background, device_services
from .models import Device, DeviceScan
from .supabase_auth import SupabaseUser

OPERATOR = SupabaseUser('11111111-1111-1111-1111-111111111111', 'op@example.com', 'STALL_OPERATOR')
BUYER = SupabaseUser('22222222-2222-2222-2222-222222222222', 'buyer@example.com', 'RESCUE_BUYER')
MAC = 'AA:BB:CC:DD:EE:01'
ASSETS = Path(__file__).parent / 'test_assets'
MEDIA = tempfile.mkdtemp()


def sample(name):
    return (ASSETS / f'{name}.jpg').read_bytes()


def solid(color=(120, 120, 120)):
    buf = io.BytesIO()
    Image.new('RGB', (320, 240), color).save(buf, 'JPEG')
    return buf.getvalue()


def as_user(user):
    return mock.patch('api.supabase_auth.resolve_token', return_value=user)


@override_settings(MEDIA_ROOT=Path(MEDIA), SUPABASE_SERVICE_ROLE_KEY='')
class DeviceFlowTests(TestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(MEDIA, ignore_errors=True)

    def setUp(self):
        self.app = APIClient()
        self.app.credentials(HTTP_AUTHORIZATION='Bearer test-session')
        self.cam = APIClient()

    def pair_and_claim(self, crop='EGGPLANT'):
        with as_user(OPERATOR):
            r = self.app.post('/api/devices/pairing/', {'name': 'Stall 41 Cam', 'crop_type': crop}, format='json')
        self.assertEqual(r.status_code, 201, r.content)
        code = r.json()['code']
        self.assertTrue(r.json()['server_url'].startswith('http://'))
        r = self.cam.post('/api/devices/claim/', {'code': code, 'mac': MAC, 'fw': '1.1.1', 'wifi_ssid': 'Stall-WiFi'},
                          format='json')
        self.assertEqual(r.status_code, 201, r.content)
        self.cam.credentials(HTTP_X_DEVICE_TOKEN=r.json()['device_token'])
        return code, r.json()

    def upload(self, data, source='MANUAL'):
        r = self.cam.generic('POST', '/api/devices/upload-scan/', data, content_type='image/jpeg',
                             HTTP_X_SCAN_SOURCE=source)
        self.assertEqual(r.status_code, 201, r.content)
        return r.json()

    # ── pairing, settings, commands ────────────────────────────────────────

    def test_full_flow(self):
        code, claim = self.pair_and_claim()
        self.assertEqual(claim['config']['crop_type'], 'EGGPLANT')
        with as_user(OPERATOR):
            r = self.app.get(f'/api/devices/pairing/{code}/')
        self.assertEqual(r.json()['status'], 'CLAIMED')
        dev = r.json()['device']
        self.assertEqual(dev['scan_mode'], 'schedule')
        self.assertEqual(dev['capture_times'], ['07:00', '12:00', '16:00'])   # paper Table 9
        dev_id = dev['id']

        r = self.cam.post('/api/devices/heartbeat/', {'rssi': -55, 'fw': '1.1.1', 'uptime_s': 12}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertIsNone(r.json()['command'])
        self.assertFalse(r.json()['config']['auto_scan'])          # schedule mode: the server drives the scans

        with as_user(OPERATOR):
            r = self.app.patch(f'/api/devices/{dev_id}/', {'crop_type': 'cucumber', 'scan_mode': 'interval',
                                                            'scan_interval_s': 60}, format='json')
            self.assertEqual(r.json()['crop_type'], 'CUCUMBER')
            self.app.post(f'/api/devices/{dev_id}/command/', {'command': 'reboot'}, format='json')
        r = self.cam.post('/api/devices/heartbeat/', {}, format='json').json()
        self.assertEqual(r['command'], 'reboot')
        self.assertTrue(r['config']['auto_scan'])
        self.assertEqual(r['config']['scan_interval_s'], 60)
        self.assertIsNone(self.cam.post('/api/devices/heartbeat/', {}, format='json').json()['command'])

        r = self.cam.post('/api/devices/reading/', {'temperature_c': 31.5, 'humidity_rh': 70}, format='json')
        self.assertEqual(r.status_code, 201, r.content)
        self.assertGreater(r.json()['vpd_kpa'], 0)
        self.assertEqual(self.cam.post('/api/devices/reading/', {'temperature_c': 300, 'humidity_rh': 70},
                                       format='json').status_code, 400)

        with as_user(OPERATOR):
            d = self.app.get('/api/devices/').json()[0]
            self.assertTrue(d['online'])
            self.assertIsNone(d['latest_reading'])       # a camera shows no sensor reading: the stall sensors do
            self.assertEqual(self.app.get(f'/api/devices/{dev_id}/readings/').json()[0]['temperature_c'], 31.5)
            live = self.app.get(f'/api/devices/{dev_id}/live/').json()
            self.assertIn('/stream/?sig=', live['stream_url'])
            self.assertEqual(self.app.get(live['snapshot_url'].split('testserver')[1] + 'x').status_code, 403)
            self.assertEqual(self.app.delete(f'/api/devices/{dev_id}/').status_code, 204)
        self.assertEqual(self.cam.post('/api/devices/heartbeat/', {}, format='json').status_code, 401)

    def test_settings_validation(self):
        self.pair_and_claim()
        dev_id = Device.objects.get().id
        with as_user(OPERATOR):
            ok = self.app.patch(f'/api/devices/{dev_id}/', {'capture_times': ['16:30', '06:00', '06:00']}, format='json')
            self.assertEqual(ok.json()['capture_times'], ['06:00', '16:30'])
            for bad in (['7:00'], ['25:00'], [], 'noon', ['07:00'] * 3 + ['08:00', '09:00', '10:00', '11:00']):
                r = self.app.patch(f'/api/devices/{dev_id}/', {'capture_times': bad}, format='json')
                self.assertEqual(r.status_code, 400, bad)
            self.assertEqual(self.app.patch(f'/api/devices/{dev_id}/', {'scan_mode': 'always'}, format='json').status_code, 400)

    def test_permissions_and_codes(self):
        with as_user(BUYER):
            self.assertEqual(self.app.post('/api/devices/pairing/', {}, format='json').status_code, 403)
        self.assertEqual(APIClient().get('/api/devices/').status_code, 401)
        self.assertEqual(self.cam.post('/api/devices/claim/', {'code': 'NOPE12', 'mac': MAC}, format='json').status_code, 400)
        self.assertEqual(self.cam.post('/api/devices/heartbeat/', {}, format='json').status_code, 401)
        self.pair_and_claim()
        other = SupabaseUser('33333333-3333-3333-3333-333333333333', 'x@example.com', 'STALL_OPERATOR')
        with as_user(other):
            self.assertEqual(self.app.get('/api/devices/').json(), [])
            self.assertEqual(self.app.get(f'/api/devices/{Device.objects.get().id}/').status_code, 404)

    def test_repair_same_camera_keeps_one_device(self):
        self.pair_and_claim()
        self.pair_and_claim()
        self.assertEqual(Device.objects.count(), 1)

    # ── open-set detection: only eggplant, cucumber and carrot ─────────────

    def test_target_vegetables_are_detected(self):
        self.pair_and_claim('EGGPLANT')
        for name, crop in (('eggplant', 'EGGPLANT'), ('cucumber', 'CUCUMBER'), ('carrot', 'CARROT')):
            Device.objects.update(crop_type=crop)
            scan = self.upload(sample(name))
            self.assertTrue(scan['detected'], (name, scan))
            self.assertEqual(scan['detected_crop'], crop)
            self.assertFalse(scan['crop_mismatch'])
            self.assertIn(scan['freshness_status'], ('GREEN', 'AMBER', 'RED'))
            self.assertAlmostEqual(sum(scan['probs'].values()), 1.0, places=2)
            self.assertTrue(scan['image_url'].endswith('.jpg'))

    def test_other_objects_are_rejected(self):
        self.pair_and_claim('EGGPLANT')
        for name in ('tomato', 'bitter_gourd'):
            scan = self.upload(sample(name))
            self.assertFalse(scan['detected'], (name, scan))
            self.assertEqual(scan['state'], 'none')
            self.assertEqual(scan['freshness_status'], 'UNKNOWN')
            self.assertIsNone(scan['freshness_percent'])
            self.assertIsNone(scan['days_to_spoil'])
            self.assertIsNone(scan['probs'])
            self.assertIn('No eggplant, cucumber or carrot', scan['message'])
        # an empty grey wall, as the camera sees when nothing is placed in front of it
        self.assertFalse(self.upload(solid())['detected'])

    def test_wrong_crop_is_flagged_not_saved_to_the_batch(self):
        self.pair_and_claim('CUCUMBER')                       # camera registered for cucumbers ...
        with mock.patch.object(device_services, 'ml_override') as override:
            Device.objects.update(product_id=7)
            scan = self.upload(sample('eggplant'))            # ... but an eggplant is in front of it
            self.assertTrue(scan['detected'])
            self.assertTrue(scan['crop_mismatch'])
            self.assertEqual(scan['detected_crop'], 'EGGPLANT')
            self.assertIn('looks like eggplant', scan['message'])
            override.assert_not_called()

    def test_automatic_empty_frames_are_not_stored(self):
        self.pair_and_claim()
        self.assertEqual(self.upload(solid(), 'AUTO')['image_url'], '')          # privacy: nobody on camera is kept
        self.assertTrue(self.upload(solid(), 'MANUAL')['image_url'].endswith('.jpg'))
        self.assertTrue(self.upload(sample('eggplant'), 'AUTO')['image_url'].endswith('.jpg'))
        with as_user(OPERATOR):
            dev_id = Device.objects.get().id
            self.assertEqual(len(self.app.get(f'/api/devices/{dev_id}/scans/').json()), 3)
            only = self.app.get(f'/api/devices/{dev_id}/scans/?detected=1').json()
            self.assertEqual([s['detected'] for s in only], [True])

    def test_operator_feedback_and_export(self):
        self.pair_and_claim()
        scan = self.upload(sample('eggplant'))
        with as_user(OPERATOR):
            dev_id = Device.objects.get().id
            url = f'/api/devices/{dev_id}/scans/{scan["id"]}/feedback/'
            self.assertEqual(self.app.post(url, {'label': 'banana'}, format='json').status_code, 400)
            self.assertEqual(self.app.post(url, {'label': 'eggplant_at-risk'}, format='json').json()['feedback_label'],
                             'eggplant_at-risk')
            ok = self.app.post(url, {'label': 'correct'}, format='json').json()
            self.assertEqual(ok['feedback_label'], f'eggplant_{scan["state"]}')
            self.assertEqual(self.app.post(f'/api/devices/{dev_id}/scans/999999/feedback/', {'label': 'none'},
                                           format='json').status_code, 404)
        out = Path(tempfile.mkdtemp())
        call_command('export_feedback', out=str(out))
        self.assertEqual(len(list((out / f'eggplant_{scan["state"]}').glob('scan*.jpg'))), 1)
        shutil.rmtree(out, ignore_errors=True)

    def test_analyze_freshness_upload_endpoint(self):
        r = APIClient().post('/api/analyze-freshness/', {'image': io.BytesIO(sample('carrot')), 'crop_type': 'CARROT'},
                             format='multipart')
        self.assertEqual(r.status_code, 200, r.content)
        self.assertTrue(r.json()['detected'])
        self.assertEqual(r.json()['crop_type'], 'CARROT')
        self.assertTrue(r.json()['processed_image_base64'].startswith('data:image/jpeg;base64,'))
        r = APIClient().post('/api/analyze-freshness/', {'image': io.BytesIO(sample('tomato')), 'crop_type': 'CARROT'},
                             format='multipart')
        self.assertFalse(r.json()['detected'])
        self.assertEqual(r.json()['freshness_status'], 'UNKNOWN')

    # ── capture windows, discovery, rule engine ────────────────────────────

    def test_capture_schedule_fires_once_per_window(self):
        self.pair_and_claim()
        Device.objects.update(last_seen=timezone.now())
        tz = timezone.get_current_timezone()
        noon = timezone.make_aware(datetime(2026, 10, 27, 12, 1), tz)
        self.assertEqual(background.run_schedule_once(noon), 1)
        self.assertEqual(Device.objects.get().pending_command, 'scan_auto')
        Device.objects.update(pending_command='')
        self.assertEqual(background.run_schedule_once(noon + timedelta(minutes=1)), 0)           # same window
        self.assertEqual(background.run_schedule_once(noon.replace(hour=11, minute=0)), 0)       # not a capture time
        self.assertEqual(background.run_schedule_once(noon.replace(hour=16, minute=0)), 1)       # next window
        Device.objects.update(pending_command='', last_seen=timezone.now() - timedelta(hours=1))
        self.assertEqual(background.run_schedule_once(noon.replace(hour=7, minute=0)), 0)        # camera is offline
        Device.objects.update(auto_scan=False, last_seen=timezone.now())
        self.assertEqual(background.run_schedule_once(noon.replace(day=28, hour=7, minute=0)), 0)  # monitoring off

    def test_discovery_reply_is_signed_with_the_device_token(self):
        self.pair_and_claim()
        token = Device.objects.get().device_token
        query = json.dumps({'nonce': 'abc123', 'tid': token[:8]}).encode()
        with override_settings(DEVICE_SERVER_URL='http://10.0.0.36:8000'):
            reply = json.loads(background.discovery_reply(query, '10.0.0.50'))
        self.assertEqual(reply['server'], 'http://10.0.0.36:8000')
        want = hmac.new(token.encode(), b'abc123http://10.0.0.36:8000', hashlib.sha256).hexdigest()
        self.assertEqual(reply['sig'], want)
        for bad in ({'nonce': 'x', 'tid': 'wrongtid'}, {'nonce': '', 'tid': token[:8]}, {'tid': token[:8]}):
            self.assertIsNone(background.discovery_reply(json.dumps(bad).encode(), '10.0.0.50'))

    def test_rule_engine_ages_the_batch_with_heat(self):
        self.pair_and_claim()
        device = Device.objects.get()
        product = {'id': 5, 'operator_id': device.operator_id, 'crop_type': 'EGGPLANT', 'predicted_shelf_life': 5.0,
                   'freshness_status': 'GREEN'}
        with mock.patch.object(device_services, '_product', return_value=product), \
                mock.patch.object(device_services, '_apply') as apply:
            device_services.apply_environment(device, Decimal('38'), Decimal('50'), Decimal('1'))   # 1 h of hot, dry air
            days_hot = apply.call_args.args[3]
            apply.reset_mock()
            device.eta_start, device.life_lost = None, Decimal('0')
            device_services.apply_environment(device, Decimal('12'), Decimal('92'), Decimal('1'))   # 1 h at optimal storage
            days_cool = apply.call_args.args[3]
        self.assertLess(days_hot, Decimal('4.9'))
        self.assertLess(days_hot, days_cool)

    def test_sustained_heat_queues_an_emergency_snapshot(self):
        self.pair_and_claim()
        device = Device.objects.get()
        now = timezone.now()
        for minutes in (118, 95, 70, 40, 10):      # oldest is just inside the 2 h window
            r = device.readings.create(temperature_c=Decimal('37'), humidity_rh=Decimal('55'), vpd_kpa=Decimal('3'))
            device.readings.filter(pk=r.pk).update(created_at=now - timedelta(minutes=minutes))
        device_services._alerts(device, now, Decimal('37'), Decimal('55'))
        device.refresh_from_db()
        self.assertEqual(device.pending_command, 'scan_auto')
        self.assertIsNotNone(device.last_emergency_at)
