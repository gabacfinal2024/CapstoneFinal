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
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image
from rest_framework.test import APIClient

from . import background, device_services, device_views
from .models import Device, DeviceScan
from .supabase_auth import SupabaseUser

OPERATOR = SupabaseUser('11111111-1111-1111-1111-111111111111', 'op@example.com', 'STALL_OPERATOR')
BUYER = SupabaseUser('22222222-2222-2222-2222-222222222222', 'buyer@example.com', 'RESCUE_BUYER')
ADMIN = SupabaseUser('99999999-9999-9999-9999-999999999999', 'admin@example.com', 'ADMIN')
MAC = 'AA:BB:CC:DD:EE:01'
ASSETS = Path(__file__).parent / 'test_assets'
MEDIA = tempfile.mkdtemp()


def sample(name):
    return (ASSETS / f'{name}.jpg').read_bytes()


def solid(color=(120, 120, 120)):
    buf = io.BytesIO()
    Image.new('RGB', (320, 240), color).save(buf, 'JPEG')
    return buf.getvalue()


def fake_analysis(detected=True, crop='EGGPLANT', mismatch=False):
    state = 'fresh' if detected else 'none'
    result = {
        'crop_type': crop, 'detected': detected, 'detected_crop': crop if detected else None,
        'crop_mismatch': mismatch,
        'message': 'looks like eggplant, but this camera is set to cucumber.' if mismatch else 'Test result',
        'none_prob': 0.0 if detected else 1.0,
        'state': state, 'freshness_status': 'GREEN' if detected else 'UNKNOWN',
        'freshness_percent': 90 if detected else None, 'days_to_spoil': 3.0 if detected else None,
        'ml_confidence': 0.9, 'probs': {'fresh': 0.9} if detected else None, 'low_confidence': False,
    }
    return result, Image.new('RGB', (16, 16))


def as_user(user):
    return mock.patch('api.supabase_auth.resolve_token', return_value=user)


@override_settings(MEDIA_ROOT=Path(MEDIA), SUPABASE_SERVICE_ROLE_KEY='')
class DeviceFlowTests(TestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(MEDIA, ignore_errors=True)

    def setUp(self):
        cache.clear()
        self.app = APIClient()
        self.app.credentials(HTTP_AUTHORIZATION='Bearer test-session')
        self.cam = APIClient()

    def pair_and_claim(self, crop='EGGPLANT', kind='CAMERA'):
        with as_user(OPERATOR):
            r = self.app.post('/api/devices/pairing/', {
                'name': 'Stall 41 Cam', 'crop_type': crop, 'kind': kind,
            }, format='json')
        self.assertEqual(r.status_code, 201, r.content)
        code = r.json()['code']
        self.assertTrue(r.json()['server_url'].startswith('http://'))
        r = self.cam.post('/api/devices/claim/', {
            'code': code, 'mac': MAC, 'fw': '1.1.1', 'wifi_ssid': 'Stall-WiFi',
            'kind': kind,
        },
                          format='json')
        self.assertEqual(r.status_code, 201, r.content)
        self.cam.credentials(HTTP_X_DEVICE_TOKEN=r.json()['device_token'])
        return code, r.json()

    def test_pairing_uses_configured_public_server_url(self):
        with override_settings(DEVICE_SERVER_URL='https://agriresq.onrender.com'):
            with as_user(OPERATOR):
                response = self.app.post('/api/devices/pairing/', {'name': 'Stall camera'}, format='json')

        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()['server_url'], 'https://agriresq.onrender.com')

    def test_sensor_pairing_returns_sensor_setup_hotspot_name(self):
        with as_user(OPERATOR):
            response = self.app.post('/api/devices/pairing/', {'name': 'Stall sensor', 'kind': 'SENSOR'}, format='json')

        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()['setup_ap_prefix'], 'AgriResQ-SENSOR-')
        self.assertEqual(response.json()['setup_ap_password'], 'agriresq')

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
        self.assertFalse(r.json()['live_view'])
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

    def test_sensor_pairing_exposes_live_dht_readings(self):
        _, claim = self.pair_and_claim(kind='SENSOR')
        self.assertEqual(claim['config']['crop_type'], 'ALL')
        response = self.cam.post('/api/devices/reading/', {
            'temperature_c': 24.7, 'humidity_rh': 63.4,
        }, format='json')
        self.assertEqual(response.status_code, 201, response.content)
        with as_user(OPERATOR):
            device = self.app.get('/api/devices/').json()[0]
            history = self.app.get(f'/api/devices/{device["id"]}/readings/').json()
        self.assertEqual(device['kind'], 'SENSOR')
        self.assertEqual(device['latest_reading']['temperature_c'], 24.7)
        self.assertEqual(device['latest_reading']['humidity_rh'], 63.4)
        self.assertEqual(history[0]['temperature_c'], 24.7)
        self.assertEqual(history[0]['humidity_rh'], 63.4)

    def test_pairing_code_rejects_a_claim_from_the_wrong_device_kind(self):
        with as_user(OPERATOR):
            pairing = self.app.post('/api/devices/pairing/', {'kind': 'SENSOR'}, format='json').json()
        response = self.cam.post('/api/devices/claim/', {
            'code': pairing['code'], 'mac': MAC, 'kind': 'CAMERA',
        }, format='json')
        self.assertEqual(response.status_code, 400)
        self.assertIn('for a Sensor node', response.json()['detail'])

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

    def test_live_frames_are_relayed_only_while_an_operator_views_them(self):
        self.pair_and_claim()
        device = Device.objects.get()
        frame = solid()

        with as_user(OPERATOR):
            live = self.app.get(f'/api/devices/{device.id}/live/', HTTP_X_FORWARDED_PROTO='https')
            self.assertIn('snapshot_url', live.json())
            self.assertTrue(live.json()['snapshot_url'].startswith('https://'))

        heartbeat = self.cam.post('/api/devices/heartbeat/', {}, format='json')
        self.assertTrue(heartbeat.json()['live_view'])

        uploaded = self.cam.generic('POST', '/api/devices/live-frame/', frame, content_type='image/jpeg')
        self.assertEqual(uploaded.status_code, 204, uploaded.content)

        snapshot_url = live.json()['snapshot_url']
        snapshot_path = '/' + snapshot_url.split('/', 3)[3]
        snapshot = APIClient().get(snapshot_path)
        self.assertEqual(snapshot.status_code, 200)
        self.assertEqual(snapshot['Content-Type'], 'image/jpeg')
        self.assertEqual(snapshot.content, frame)

        self.assertEqual(self.cam.generic('POST', '/api/devices/live-frame/', b'not a jpeg',
                                          content_type='image/jpeg').status_code, 400)

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

    def test_all_crop_mode_pairs_and_recognizes_each_supported_vegetable(self):
        _, claim = self.pair_and_claim('ALL')
        self.assertEqual(claim['config']['crop_type'], 'ALL')
        for name, crop in (('eggplant', 'EGGPLANT'), ('cucumber', 'CUCUMBER'), ('carrot', 'CARROT')):
            scan = self.upload(sample(name))
            self.assertTrue(scan['detected'], (name, scan))
            self.assertEqual(scan['detected_crop'], crop)
            self.assertFalse(scan['crop_mismatch'])

    def test_all_crop_mode_does_not_update_a_different_linked_batch(self):
        self.pair_and_claim('ALL')
        device = Device.objects.get()
        device.product_id = 7
        scan = DeviceScan.objects.create(
            device=device, source='MANUAL', crop_type='EGGPLANT', detected=True,
            detected_crop='EGGPLANT', state='rotten', freshness_status='RED',
            ml_confidence=0.99, freshness_percent=0, days_to_spoil=Decimal('0'),
        )
        with mock.patch.object(device_services, '_product', return_value={'id': 7, 'crop_type': 'CUCUMBER'}), \
                mock.patch.object(device_services, 'supabase_update') as update:
            device_services.ml_override(device, scan)
        update.assert_not_called()

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
        with mock.patch.object(device_services, 'analyze_image', return_value=fake_analysis(mismatch=True)), \
                mock.patch.object(device_services, 'ml_override') as override:
            Device.objects.update(product_id=7)
            scan = self.upload(sample('eggplant'))            # ... but an eggplant is in front of it
            self.assertTrue(scan['detected'])
            self.assertTrue(scan['crop_mismatch'])
            self.assertEqual(scan['detected_crop'], 'EGGPLANT')
            self.assertTrue(scan['image_url'].endswith('.jpg'))
            self.assertIn('looks like eggplant', scan['message'])
            override.assert_not_called()

    def test_only_detected_vegetable_images_are_stored_and_shown_in_gallery(self):
        self.pair_and_claim()
        with mock.patch.object(device_services, 'analyze_image', side_effect=[
            fake_analysis(detected=False), fake_analysis(detected=False), fake_analysis(),
            fake_analysis(mismatch=True),
        ]):
            empty_auto = self.upload(solid(), 'AUTO')
            empty_manual = self.upload(solid(), 'MANUAL')
            matching = self.upload(sample('eggplant'), 'AUTO')
            mismatch = self.upload(sample('eggplant'), 'MANUAL')
        self.assertEqual(empty_auto['image_url'], '')
        self.assertEqual(empty_manual['image_url'], '')
        self.assertTrue(matching['image_url'].endswith('.jpg'))
        self.assertTrue(mismatch['image_url'].endswith('.jpg'))
        with as_user(OPERATOR):
            dev_id = Device.objects.get().id
            self.assertEqual(len(self.app.get(f'/api/devices/{dev_id}/scans/').json()), 4)
            only = self.app.get(f'/api/devices/{dev_id}/scans/?detected=1').json()
            self.assertEqual(len(only), 2)
            gallery = self.app.get('/api/scans/').json()['results']
            self.assertEqual({s['id'] for s in gallery}, {matching['id'], mismatch['id']})

    def test_removing_camera_keeps_detected_scan_image_available(self):
        self.pair_and_claim()
        with mock.patch.object(device_services, 'analyze_image', return_value=fake_analysis()):
            scan = self.upload(sample('eggplant'))
        device_id = Device.objects.get().id

        with as_user(OPERATOR):
            self.assertEqual(self.app.delete(f'/api/devices/{device_id}/').status_code, 204)
            gallery = self.app.get('/api/scans/').json()['results']

        self.assertEqual([item['id'] for item in gallery], [scan['id']])
        retained = DeviceScan.objects.get(pk=scan['id'])
        self.assertIsNone(retained.device_id)
        image_path = gallery[0]['image_url'].split('testserver', 1)[-1]
        image_response = self.app.get(image_path)
        self.assertEqual(image_response.status_code, 200)
        self.assertEqual(image_response['Content-Type'], 'image/jpeg')
        image_response.close()

    def test_expired_scan_from_removed_camera_is_still_pruned(self):
        from datetime import timedelta
        from django.test import override_settings
        from django.utils import timezone

        self.pair_and_claim()
        with mock.patch.object(device_services, 'analyze_image', return_value=fake_analysis()):
            scan = self.upload(sample('eggplant'))
        device_id = Device.objects.get().id
        image_path = Path(MEDIA) / DeviceScan.objects.get(pk=scan['id']).image

        with as_user(OPERATOR):
            self.assertEqual(self.app.delete(f'/api/devices/{device_id}/').status_code, 204)

        DeviceScan.objects.filter(pk=scan['id']).update(created_at=timezone.now() - timedelta(days=31))
        with override_settings(SCAN_KEEP_PER_DEVICE=0, SCAN_KEEP_DAYS=30):
            removed = device_services.prune_scans()

        self.assertEqual(removed, 1)
        self.assertFalse(DeviceScan.objects.filter(pk=scan['id']).exists())
        self.assertFalse(image_path.exists())

    def test_phone_photo_scan_is_saved_to_the_operator_gallery(self):
        image = SimpleUploadedFile('phone.jpg', solid(), content_type='image/jpeg')
        with as_user(OPERATOR), mock.patch.object(device_services, 'analyze_image', return_value=fake_analysis()):
            response = self.app.post('/api/scans/upload/', {
                'image': image, 'crop_type': 'EGGPLANT', 'source': 'PHONE',
            }, format='multipart')
            self.assertEqual(response.status_code, 201, response.content)
            gallery = self.app.get('/api/scans/').json()['results']

        self.assertEqual(len(gallery), 1)
        self.assertEqual(gallery[0]['source'], 'PHONE')
        self.assertEqual(DeviceScan.objects.get(pk=gallery[0]['id']).operator_id, OPERATOR.id)
        with as_user(ADMIN):
            admin_gallery = self.app.get('/api/scans/').json()['results']
        self.assertEqual([scan['id'] for scan in admin_gallery], [gallery[0]['id']])

    def test_operator_can_link_owned_photo_scan_to_owned_batch(self):
        image = SimpleUploadedFile('phone.jpg', solid(), content_type='image/jpeg')
        with as_user(OPERATOR), mock.patch.object(device_services, 'analyze_image', return_value=fake_analysis()):
            scan = self.app.post('/api/scans/upload/', {
                'image': image, 'crop_type': 'EGGPLANT', 'source': 'PHONE',
            }, format='multipart').json()

        with as_user(OPERATOR), mock.patch.object(device_views, 'has_service_key', return_value=True), \
                mock.patch.object(device_views, 'supabase_select', return_value=[{
                    'id': 42, 'operator_id': OPERATOR.id,
                }]):
            response = self.app.post(f'/api/scans/{scan["id"]}/batch/', {'product_id': 42}, format='json')

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['product_id'], 42)
        self.assertEqual(DeviceScan.objects.get(pk=scan['id']).product_id, 42)

    def test_operator_cannot_link_photo_scan_to_another_operators_batch(self):
        image = SimpleUploadedFile('phone.jpg', solid(), content_type='image/jpeg')
        with as_user(OPERATOR), mock.patch.object(device_services, 'analyze_image', return_value=fake_analysis()):
            scan = self.app.post('/api/scans/upload/', {
                'image': image, 'crop_type': 'EGGPLANT', 'source': 'PHONE',
            }, format='multipart').json()

        with as_user(OPERATOR), mock.patch.object(device_views, 'has_service_key', return_value=True), \
                mock.patch.object(device_views, 'supabase_select', return_value=[{
                    'id': 42, 'operator_id': BUYER.id,
                }]):
            response = self.app.post(f'/api/scans/{scan["id"]}/batch/', {'product_id': 42}, format='json')

        self.assertEqual(response.status_code, 404)
        self.assertIsNone(DeviceScan.objects.get(pk=scan['id']).product_id)

    def test_local_scan_image_is_accessible_outside_debug_media_view(self):
        self.pair_and_claim()
        with mock.patch.object(device_services, 'analyze_image', return_value=fake_analysis()):
            scan = self.upload(sample('eggplant'))
        image_path = scan['image_url'].split('testserver', 1)[-1]
        response = self.app.get(image_path)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Content-Type'], 'image/jpeg')
        self.assertTrue(b''.join(response.streaming_content).startswith(b'\xff\xd8'))

    def test_matching_scan_uses_supabase_storage_when_configured(self):
        self.pair_and_claim()
        with mock.patch.object(device_services, 'analyze_image', return_value=fake_analysis()), \
                mock.patch.object(device_services, 'has_service_key', return_value=True), \
                mock.patch.object(device_services, 'supabase_upload_public_object',
                                  side_effect=[
                                      'https://project.supabase.co/storage/v1/object/public/product-images/scans/1/1.jpg',
                                      'https://project.supabase.co/storage/v1/object/public/product-images/scans/1/1_raw.jpg',
                                  ]) as upload:
            scan = self.upload(sample('eggplant'))
        self.assertIn('/storage/v1/object/public/product-images/', scan['image_url'])
        self.assertEqual(upload.call_count, 2)

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

    def test_high_temperature_alert_links_to_live_device(self):
        self.pair_and_claim(kind='SENSOR')
        device = Device.objects.get()
        previous = device.readings.create(temperature_c=Decimal('35'), humidity_rh=Decimal('55'), vpd_kpa=Decimal('2'))
        with mock.patch.object(device_services, 'has_service_key', return_value=True), \
                mock.patch.object(device_services, 'supabase_insert') as insert:
            device_services._alerts(device, timezone.now(), Decimal('37'), Decimal('55'), previous)

        insert.assert_called_once()
        self.assertEqual(insert.call_args.args[0], 'notifications')
        self.assertEqual(insert.call_args.args[1]['notification_type'], 'IOT_ALERT')
        self.assertEqual(insert.call_args.args[1]['device_id'], device.id)

    def test_stable_or_lower_sensor_values_do_not_alert(self):
        self.pair_and_claim(kind='SENSOR')
        device = Device.objects.get()
        previous = device.readings.create(temperature_c=Decimal('37'), humidity_rh=Decimal('95'), vpd_kpa=Decimal('1'))
        with mock.patch.object(device_services, 'has_service_key', return_value=True), \
                mock.patch.object(device_services, 'supabase_insert') as insert:
            device_services._alerts(device, timezone.now(), Decimal('37'), Decimal('95'), previous)
        insert.assert_not_called()

    def test_sustained_heat_queues_an_emergency_snapshot(self):
        self.pair_and_claim()
        device = Device.objects.get()
        now = timezone.now()
        for minutes in (118, 95, 70, 40, 10):      # oldest is just inside the 2 h window
            r = device.readings.create(temperature_c=Decimal('37'), humidity_rh=Decimal('55'), vpd_kpa=Decimal('3'))
            device.readings.filter(pk=r.pk).update(created_at=now - timedelta(minutes=minutes))
        device_services._alerts(device, now, Decimal('37'), Decimal('55'), device.readings.first())
        device.refresh_from_db()
        self.assertEqual(device.pending_command, 'scan_auto')
        self.assertIsNotNone(device.last_emergency_at)
