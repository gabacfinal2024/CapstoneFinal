"""
Smart-home style device API (docs/IOT_DEVICE_API.md).

Operator endpoints  – Bearer <Supabase access token>, STALL_OPERATOR only
Device endpoints    – X-Device-Token (or the pairing code for /claim/)
"""
import json
import re
import socket
import time
import urllib.request
from pathlib import Path
from datetime import timedelta

from django.conf import settings
from django.core.cache import cache
from django.core import signing
from django.db import transaction
from django.http import FileResponse, Http404, HttpResponse, StreamingHttpResponse
from django.utils import timezone
from rest_framework import status
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed, NotFound, PermissionDenied, ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import SAFE_METHODS, AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .device_services import run_scan, save_reading, stall_summary
from .analysis import batch_analysis
from .evidence import reference_payload
from .supabase_client import has_service_key, supabase_select
from django.db.models import Q

from .models import DEVICE_CROP_TYPES, Device, DeviceMonitor, DeviceReading, DeviceScan, PairingCode
from .spoilage_engine import validate_sensor_reading
from .supabase_auth import IsOperatorOrAdminReadOnly, SupabaseAuthentication, SupabaseUser, find_profile
from .views import ImageParser

PAIRING_TTL = timedelta(minutes=20)
LIVE_TTL_S = 600
LIVE_VIEW_LEASE_S = 20
LIVE_FRAME_TTL_S = 10
LIVE_FRAME_MAX_BYTES = 256 * 1024
SIGN_SALT = 'device-live'
CROPS = {c for c, _ in DEVICE_CROP_TYPES}
TIME_RE = re.compile(r'^([01]\d|2[0-3]):[0-5]\d$')
SETUP_AP = {'setup_ap_prefix': 'AgriResQ-', 'setup_ap_password': 'agriresq', 'setup_url': 'http://192.168.4.1'}


# ── serialization ───────────────────────────────────────────────────────────

def media_url(request, rel, scan=None, field='image'):
    if not rel:
        return ''
    if rel.startswith(('http://', 'https://', 'data:')):
        return rel
    if scan is None:
        return ''
    token = signing.dumps({'scan_id': scan.id, 'field': field}, salt='scan-image')
    return request.build_absolute_uri(f'/api/scans/{scan.id}/image/{token}/{field}.jpg')


def scan_json(request, s):
    return {
        'id': s.id, 'device_id': s.device_id, 'created_at': s.created_at, 'source': s.source,
        'detected': s.detected, 'detected_crop': s.detected_crop, 'crop_mismatch': s.crop_mismatch,
        'message': s.message, 'crop_type': s.crop_type, 'state': s.state, 'freshness_status': s.freshness_status,
        'freshness_percent': s.freshness_percent,
        'days_to_spoil': None if s.days_to_spoil is None else float(s.days_to_spoil),
        'ml_confidence': s.ml_confidence, 'probs': s.probs, 'none_prob': s.none_prob,
        'low_confidence': s.low_confidence, 'image_url': media_url(request, s.image, s),
        'product_id': s.product_id, 'feedback_label': s.feedback_label,
    }


def reading_json(r):
    return {
        'id': r.id, 'created_at': r.created_at, 'temperature_c': float(r.temperature_c),
        'humidity_rh': float(r.humidity_rh), 'vpd_kpa': float(r.vpd_kpa) if r.vpd_kpa is not None else None,
    }


# DHT22 data pin choices (the administrator configures them; operators cannot). The ESP32-CAM has few free pins;
# a plain ESP32 DevKit sensor node (kind SENSOR) is wired to GPIO 4 (D4) by default.
CAMERA_DHT_PINS = (2, 12, 13, 14, 15)
SENSOR_DHT_PINS = (4, 5, 13, 14, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33)

MIN_MONITORS = 0           # sharing is optional
MAX_MONITORS = 1           # one additional stall operator per device (the administrator is not counted)


def device_access(user, device):
    """'owner' | 'admin' | 'monitor' | None for this user and device."""
    if not isinstance(user, SupabaseUser):
        return None
    if device.operator_id == user.id:
        return 'owner'
    if user.role == 'ADMIN':
        return 'admin'
    if DeviceMonitor.objects.filter(device=device, user_id=user.id).exists():
        return 'monitor'
    return None


def visible_devices(user):
    """Cameras this user may see: all for an administrator, otherwise their own plus the ones they monitor."""
    if user.role == 'ADMIN':
        return Device.objects.all()
    watching = DeviceMonitor.objects.filter(user_id=user.id).values_list('device_id', flat=True)
    return Device.objects.filter(Q(operator_id=user.id) | Q(pk__in=list(watching)))


def device_json(request, d):
    scan = d.scans.first()
    reading = d.readings.first()
    monitors = list(d.monitors.all())
    watchers = 1 + len(monitors)
    return {
        'my_access': device_access(request.user, d), 'can_operate': device_access(request.user, d) is not None,
        'can_manage': device_access(request.user, d) == 'owner', 'monitor_count': watchers,
        'can_manage_sharing': device_access(request.user, d) == 'owner' or request.user.role == 'ADMIN',
        'shared_with': [
            {'user_id': m.user_id, 'full_name': m.full_name, 'email': m.email}
            for m in monitors
        ],
        'monitors_needed': max(0, MIN_MONITORS - watchers),
        'id': d.id, 'operator_id': d.operator_id, 'kind': d.kind, 'name': d.name, 'stall_location': d.stall_location, 'crop_type': d.crop_type,
        'product_id': d.product_id, 'mac': d.mac, 'ip': d.ip, 'fw_version': d.fw_version,
        'wifi_ssid': d.wifi_ssid, 'rssi': d.rssi, 'online': d.online, 'last_seen': d.last_seen,
        'auto_scan': d.auto_scan, 'scan_mode': d.scan_mode, 'capture_times': d.times(),
        'scan_interval_s': d.scan_interval_s, 'dht_pin': d.dht_pin,
        'flash_on_scan': d.flash_on_scan, 'created_at': d.created_at,
        'latest_scan': scan_json(request, scan) if scan else None,
        'latest_reading': reading_json(reading) if reading and d.kind == 'SENSOR' else None,   # the stall sensors, not the camera
    }


def device_server_url(request):
    """URL the ESP32 should call. Must be the laptop's LAN address, never 127.0.0.1."""
    if settings.DEVICE_SERVER_URL:
        return settings.DEVICE_SERVER_URL.rstrip('/')
    host = request.get_host().split(':')[0]
    if host in ('localhost', '127.0.0.1', '0.0.0.0'):
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(('8.8.8.8', 80))
            host = s.getsockname()[0]
        except OSError:
            pass
        finally:
            s.close()
    return f'http://{host}:{settings.DJANGO_PORT}'


# ── operator endpoints ──────────────────────────────────────────────────────

class OperatorView(APIView):
    authentication_classes = [SupabaseAuthentication]
    permission_classes = [IsAuthenticated, IsOperatorOrAdminReadOnly]

    def get_device(self, request, pk, owner_only=False):
        try:
            device = Device.objects.get(pk=pk)
        except Device.DoesNotExist:
            raise NotFound('Device not found.')
        access = device_access(request.user, device)
        if access is None:
            raise NotFound('Device not found.')
        # The owner, the people the owner shared the device with, and the administrator can all use it
        # (watch live, scan, correct results, change settings). Removing the camera, forgetting its Wi-Fi
        # and choosing who shares it stay with the owner.
        if owner_only and access != 'owner':
            raise PermissionDenied('Only the camera owner can do this.')
        return device


class PairingCreateView(OperatorView):
    def post(self, request):
        if request.user.role not in ('STALL_OPERATOR', 'ADMIN'):
            raise PermissionDenied('Only stall operators and administrators can add a camera or sensor node.')
        kind = str(request.data.get('kind') or 'CAMERA').upper()
        if kind not in dict(Device.KINDS):
            raise ValidationError({'kind': 'Choose CAMERA or SENSOR.'})
        crop = str(request.data.get('crop_type') or 'EGGPLANT').upper()
        if crop not in CROPS:
            raise ValidationError({'crop_type': 'Choose ALL, EGGPLANT, CUCUMBER or CARROT.'})
        operator_id = request.user.id
        stall_location = str(request.data.get('stall_location') or '')[:100]
        if request.user.role == 'ADMIN':
            operator_id = str(request.data.get('operator_id') or '').strip()
            if not operator_id:
                raise ValidationError({'operator_id': 'Choose the stall operator who owns this device.'})
            if not has_service_key():
                return Response({'detail': 'The hub cannot verify the selected stall operator right now.'},
                                status=status.HTTP_503_SERVICE_UNAVAILABLE)
            try:
                profiles = supabase_select(
                    'profiles', {'id': operator_id}, 'id,role,stall_number,is_active',
                )
            except (OSError, ValueError):
                return Response({'detail': 'Could not verify the selected stall operator.'},
                                status=status.HTTP_502_BAD_GATEWAY)
            profile = profiles[0] if profiles else None
            if not profile or profile.get('role') != 'STALL_OPERATOR' or profile.get('is_active') is not True:
                raise ValidationError({'operator_id': 'Choose an active stall operator account.'})
            if not stall_location:
                stall_number = str(profile.get('stall_number') or '').strip()
                if not stall_number:
                    raise ValidationError({'operator_id': 'The selected account does not have a stall number.'})
                stall_location = f'Stall {stall_number}'
        pairing = PairingCode.objects.create(
            code=PairingCode.new_code(),
            operator_id=operator_id,
            name=str(request.data.get('name') or 'Stall Camera')[:100],
            stall_location=stall_location,
            kind=kind,
            crop_type=crop,
            expires_at=timezone.now() + PAIRING_TTL,
        )
        return Response({
            'code': pairing.code, 'expires_at': pairing.expires_at,
            'server_url': device_server_url(request),
            **{
                **SETUP_AP,
                'setup_ap_prefix': 'AgriResQ-SENSOR-' if kind == 'SENSOR' else SETUP_AP['setup_ap_prefix'],
            },
        }, status=status.HTTP_201_CREATED)


class PairingStatusView(OperatorView):
    def get(self, request, code):
        pairings = PairingCode.objects.filter(code=code.upper())
        if request.user.role != 'ADMIN':
            pairings = pairings.filter(operator_id=request.user.id)
        pairing = pairings.first()
        if not pairing:
            raise NotFound('Pairing code not found.')
        return Response({
            'status': pairing.status,
            'device': device_json(request, pairing.device) if pairing.device else None,
        })


class DeviceListView(OperatorView):
    def get(self, request):
        devices = visible_devices(request.user).order_by('created_at')
        return Response([device_json(request, d) for d in devices])


class DeviceDetailView(OperatorView):
    EDITABLE = {'name', 'stall_location', 'crop_type', 'product_id', 'auto_scan', 'scan_mode',
                'capture_times', 'scan_interval_s', 'dht_pin', 'flash_on_scan'}

    def get(self, request, pk):
        return Response(device_json(request, self.get_device(request, pk)))

    def patch(self, request, pk):
        device = self.get_device(request, pk)
        data = {k: v for k, v in request.data.items() if k in self.EDITABLE}
        if 'crop_type' in data:
            data['crop_type'] = str(data['crop_type']).upper()
            if data['crop_type'] not in CROPS:
                raise ValidationError({'crop_type': 'Choose ALL, EGGPLANT, CUCUMBER or CARROT.'})
        if 'scan_interval_s' in data:
            data['scan_interval_s'] = max(15, min(86400, int(data['scan_interval_s'])))
        if 'dht_pin' in data:
            try:
                pin = int(data['dht_pin'])
            except (TypeError, ValueError):
                raise ValidationError({'dht_pin': 'Give the GPIO number, or -1 for none.'})
            if pin == device.dht_pin:
                data.pop('dht_pin')            # unchanged (a settings form sends every field): nothing to do
            else:
                if request.user.role != 'ADMIN':
                    raise PermissionDenied('Only the administrator can configure the DHT22 sensor.')
                allowed = SENSOR_DHT_PINS if device.kind == 'SENSOR' else CAMERA_DHT_PINS
                if pin != -1 and pin not in allowed:
                    names = ', '.join(str(p) for p in allowed)
                    raise ValidationError({'dht_pin': f'Use -1 (none) or GPIO {names}.'})
                data['dht_pin'] = pin
        if 'scan_mode' in data and data['scan_mode'] not in ('schedule', 'interval'):
            raise ValidationError({'scan_mode': 'Use "schedule" or "interval".'})
        if 'capture_times' in data:
            times = data['capture_times']
            valid = (isinstance(times, list) and 1 <= len(times) <= 6
                     and all(isinstance(t, str) and TIME_RE.match(t) for t in times))
            if not valid:
                raise ValidationError({'capture_times': 'Give 1 to 6 times as "HH:MM".'})
            data['capture_times'] = sorted(set(times))
        if 'product_id' in data:
            data['product_id'] = int(data['product_id']) if data['product_id'] not in (None, '') else None
            if data['product_id'] != device.product_id:
                device.eta_start, device.life_lost = None, 0      # restart the rule-engine countdown
        for k, v in data.items():
            setattr(device, k, v)
        device.save()
        return Response(device_json(request, device))

    def delete(self, request, pk):
        # Deleting the token makes the camera's next call fail with 401, which sends it
        # back to setup mode, ready for a new owner.
        self.get_device(request, pk, owner_only=True).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class DeviceCommandView(OperatorView):
    def post(self, request, pk):
        device = self.get_device(request, pk)
        command = request.data.get('command')
        if command not in ('scan_now', 'reboot', 'forget_wifi'):
            raise ValidationError({'command': 'Use scan_now, reboot or forget_wifi.'})
        if command == 'forget_wifi':
            self.get_device(request, pk, owner_only=True)
        device.pending_command = command
        device.save(update_fields=['pending_command'])
        return Response({'queued': True})


def fetch_from_device(device, path, timeout=6):
    with urllib.request.urlopen(f'http://{device.ip}{path}', timeout=timeout) as resp:
        return resp.read()


class DeviceScanNowView(OperatorView):
    def post(self, request, pk):
        device = self.get_device(request, pk)
        if device.ip:
            try:
                jpeg = fetch_from_device(device, '/capture?flash=' + ('1' if device.flash_on_scan else '0'), 10)
                return Response(scan_json(request, run_scan(jpeg, device, 'MANUAL')))
            except OSError:
                pass   # not reachable from this server (different network): let the device do it
        device.pending_command = 'scan_now'
        device.save(update_fields=['pending_command'])
        return Response({'queued': True}, status=status.HTTP_202_ACCEPTED)


class DeviceScansView(OperatorView):
    def get(self, request, pk):
        device = self.get_device(request, pk)
        limit = min(int(request.query_params.get('limit', 20)), 200)
        scans = device.scans.all()
        if request.query_params.get('detected') in ('1', 'true'):
            scans = scans.filter(detected=True)
        return Response([scan_json(request, s) for s in scans[:limit]])


FEEDBACK_LABELS = {f'{c}_{s}' for c in ('eggplant', 'cucumber', 'carrot') for s in ('fresh', 'at-risk', 'rotten')} | {'none'}


class ScanFeedbackView(OperatorView):
    """The operator says what the camera should have answered. Used to retrain the model."""

    def post(self, request, pk, scan_id):
        device = self.get_device(request, pk)
        try:
            scan = device.scans.get(pk=scan_id)
        except DeviceScan.DoesNotExist:
            raise NotFound('Scan not found.')
        label = str(request.data.get('label', '')).strip().lower()
        if label == 'correct':
            label = f"{(scan.detected_crop or scan.crop_type).lower()}_{scan.state}" if scan.detected else 'none'
        if label not in FEEDBACK_LABELS:
            raise ValidationError({'label': 'Use "correct", "none" or <crop>_<state> (e.g. eggplant_at-risk).'})
        scan.feedback_label = label
        scan.save(update_fields=['feedback_label'])
        return Response(scan_json(request, scan))


class DeviceReadingsView(OperatorView):
    def get(self, request, pk):
        device = self.get_device(request, pk)
        limit = min(max(int(request.query_params.get('limit', 60)), 1), 3000)
        readings = device.readings.all()
        for key, lookup in (('since', 'created_at__gte'), ('until', 'created_at__lte')):
            value = request.query_params.get(key)
            if value:
                from django.utils.dateparse import parse_datetime
                parsed = parse_datetime(value)
                if parsed is None:
                    raise ValidationError({key: 'Enter a valid ISO-8601 datetime.'})
                readings = readings.filter(**{lookup: parsed})
        return Response([reading_json(r) for r in readings[:limit]])


class DeviceLiveView(OperatorView):
    def get(self, request, pk):
        device = self.get_device(request, pk)
        cache.set(f'device-live-active:{device.id}', True, timeout=LIVE_VIEW_LEASE_S)
        sig = signing.dumps({'d': device.id}, salt=SIGN_SALT)
        base = request.build_absolute_uri(f'/api/devices/{device.id}/')
        return Response({
            'stream_url': f'{base}stream/?sig={sig}',
            'snapshot_url': f'{base}snapshot/?sig={sig}',
            'expires_at': timezone.now() + timedelta(seconds=LIVE_TTL_S),
        })


# ── signed live view (used directly as <img src>, so no auth header) ────────

def _signed_device(request, pk):
    try:
        data = signing.loads(request.GET.get('sig', ''), salt=SIGN_SALT, max_age=LIVE_TTL_S)
    except signing.BadSignature:
        return None
    if data.get('d') != int(pk):
        return None
    return Device.objects.filter(pk=pk).first()


def device_snapshot(request, pk):
    device = _signed_device(request, pk)
    if not device:
        return HttpResponse('Link expired', status=403)
    cache.set(f'device-live-active:{device.id}', True, timeout=LIVE_VIEW_LEASE_S)
    frame = cache.get(f'device-live-frame:{device.id}')
    if not frame:
        return HttpResponse('Waiting for the camera to send a live frame.', status=503)
    _, jpeg = frame
    resp = HttpResponse(jpeg, content_type='image/jpeg')
    resp['Cache-Control'] = 'no-store'
    return resp


def device_stream(request, pk):
    """Proxy the camera's MJPEG stream (port 81) so apps never talk to the camera directly."""
    device = _signed_device(request, pk)
    if not device:
        return HttpResponse('Link expired', status=403)
    if not device.ip:
        return HttpResponse('Camera offline', status=503)
    try:
        upstream = urllib.request.urlopen(f'http://{device.ip}:81/stream', timeout=8)
    except OSError:
        return HttpResponse('Camera not reachable', status=503)

    def chunks():
        try:
            while True:
                block = upstream.read(16384)
                if not block:
                    break
                yield block
        finally:
            upstream.close()

    resp = StreamingHttpResponse(chunks(), content_type=upstream.headers.get('Content-Type'))
    resp['Cache-Control'] = 'no-store'
    return resp


# ── device endpoints (ESP32 firmware) ───────────────────────────────────────

class DeviceTokenAuthentication(BaseAuthentication):
    def authenticate(self, request):
        token = request.META.get('HTTP_X_DEVICE_TOKEN')
        if not token:
            return None
        device = Device.objects.filter(device_token=token).first()
        if not device:
            raise AuthenticationFailed('Unknown device. Pair it again from the app.')
        return (None, device)

    def authenticate_header(self, request):
        return 'X-Device-Token'


class DeviceView(APIView):
    authentication_classes = [DeviceTokenAuthentication]
    permission_classes = [AllowAny]
    throttle_classes = []

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if not isinstance(request.auth, Device):
            raise AuthenticationFailed('X-Device-Token required.')

    @staticmethod
    def touch(request, device, **fields):
        device.ip = request.META.get('REMOTE_ADDR') or device.ip
        device.last_seen = timezone.now()
        for k, v in fields.items():
            setattr(device, k, v)
        device.save()


class DeviceClaimView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = []
    parser_classes = [JSONParser]

    @transaction.atomic
    def post(self, request):
        code = str(request.data.get('code', '')).strip().upper()
        mac = str(request.data.get('mac', '')).strip().upper()
        pairing = PairingCode.objects.select_for_update().filter(code=code).first()
        if not pairing or pairing.status == 'EXPIRED':
            return Response({'detail': 'Pairing code is invalid or expired. Create a new one in the app.'},
                            status=status.HTTP_400_BAD_REQUEST)
        kind = str(request.data.get('kind') or 'CAMERA').upper()
        if kind not in dict(Device.KINDS):
            return Response({'detail': 'Device kind must be CAMERA or SENSOR.'}, status=status.HTTP_400_BAD_REQUEST)
        if kind != pairing.kind:
            return Response({'detail': f'This pairing code is for a {pairing.get_kind_display()}.'},
                            status=status.HTTP_400_BAD_REQUEST)
        if len(mac) != 17:
            return Response({'detail': 'mac required'}, status=status.HTTP_400_BAD_REQUEST)
        if pairing.device and pairing.device.mac != mac:
            return Response({'detail': 'This code was already used by another device.'},
                            status=status.HTTP_409_CONFLICT)

        # A camera that is re-paired (new owner, or after Forget Wi-Fi) keeps its history
        # only when it stays with the same operator.
        device = Device.objects.filter(mac=mac).first()
        if device and device.operator_id != pairing.operator_id:
            device.delete()
            device = None
        if not device:
            device = Device(mac=mac, operator_id=pairing.operator_id, capture_times=Device.DEFAULT_CAPTURE_TIMES)
        device.name = pairing.name or device.name
        device.kind = kind
        if device.kind == 'SENSOR':          # no camera: it only reports DHT22 readings
            device.auto_scan = False
            try:
                device.dht_pin = int(request.data.get('dht_pin', 4))
            except (TypeError, ValueError):
                device.dht_pin = 4
        device.stall_location = pairing.stall_location or device.stall_location
        device.crop_type = 'ALL' if device.kind == 'SENSOR' else pairing.crop_type
        device.device_token = Device.generate_token()
        device.fw_version = str(request.data.get('fw', ''))[:32]
        device.wifi_ssid = str(request.data.get('wifi_ssid', ''))[:64]
        device.ip = request.META.get('REMOTE_ADDR')
        device.last_seen = timezone.now()
        device.pending_command = ''
        device.save()
        pairing.device = device
        pairing.save(update_fields=['device'])
        return Response({'device_id': device.id, 'device_token': device.device_token, 'config': device.config()},
                        status=status.HTTP_201_CREATED)


class DeviceHeartbeatView(DeviceView):
    parser_classes = [JSONParser]

    def post(self, request):
        device = request.auth
        d = request.data
        command = device.pending_command or None
        self.touch(request, device,
                   rssi=d.get('rssi', device.rssi),
                   fw_version=str(d.get('fw', device.fw_version))[:32],
                   uptime_s=int(d.get('uptime_s', 0) or 0),
                   wifi_ssid=str(d.get('wifi_ssid', device.wifi_ssid))[:64],
                   pending_command='')
        return Response({
            'config': device.config(),
            'command': command,
            'live_view': bool(cache.get(f'device-live-active:{device.id}', False)),
        })


class DeviceLiveFrameView(DeviceView):
    parser_classes = [ImageParser]

    def post(self, request):
        frame = request.data
        if not isinstance(frame, bytes) or len(frame) < 4 or len(frame) > LIVE_FRAME_MAX_BYTES:
            raise ValidationError({'frame': 'A JPEG frame between 4 bytes and 256 KB is required.'})
        if not frame.startswith(b'\xff\xd8') or not frame.endswith(b'\xff\xd9'):
            raise ValidationError({'frame': 'The live frame is not a valid JPEG.'})
        device = request.auth
        cache.set(
            f'device-live-frame:{device.id}',
            (time.time(), frame),
            timeout=LIVE_FRAME_TTL_S,
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


class DeviceUploadScanView(DeviceView):
    parser_classes = [ImageParser]

    def post(self, request):
        device = request.auth
        if not request.data:
            return Response({'detail': 'JPEG body required.'}, status=status.HTTP_400_BAD_REQUEST)
        source = request.META.get('HTTP_X_SCAN_SOURCE', 'AUTO').upper()
        self.touch(request, device)
        scan = run_scan(request.data, device, source if source in ('AUTO', 'MANUAL') else 'AUTO')
        return Response(scan_json(request, scan), status=status.HTTP_201_CREATED)


class DeviceReadingView(DeviceView):
    parser_classes = [JSONParser]

    def post(self, request):
        device = request.auth
        try:
            t = float(request.data['temperature_c'])
            rh = float(request.data['humidity_rh'])
        except (KeyError, TypeError, ValueError):
            raise ValidationError('temperature_c and humidity_rh required.')
        if not validate_sensor_reading(t, rh):
            raise ValidationError('Sensor reading out of physical range (check the DHT22 wiring).')
        self.touch(request, device)
        return Response(reading_json(save_reading(device, t, rh)), status=status.HTTP_201_CREATED)


# ── second monitor per stall camera ─────────────────────────────────────────

def monitors_payload(request, device):
    token = request.META.get('HTTP_AUTHORIZATION', '')[7:].strip()
    mons = []
    for monitor in device.monitors.all():
        person = find_profile(token, id=monitor.user_id) if token else None
        mons.append({
            'user_id': monitor.user_id,
            'full_name': monitor.full_name or (person or {}).get('full_name', ''),
            'email': monitor.email or (person or {}).get('email', ''),
            'stall_number': (person or {}).get('stall_number'),
            'added_at': monitor.added_at,
        })
    owner = {'user_id': device.operator_id, 'full_name': '', 'email': '', 'stall_number': None}
    if request.user.id == device.operator_id:
        owner.update(full_name=request.user.full_name, email=request.user.email)
    else:
        found = find_profile(token, id=device.operator_id) if token else None
        if found:
            owner.update(
                full_name=found.get('full_name') or '', email=found.get('email') or '',
                stall_number=found.get('stall_number'),
            )
    count = 1 + len(mons)
    return {'owner': owner, 'monitors': mons, 'count': count, 'minimum': MIN_MONITORS, 'maximum': 1 + MAX_MONITORS,
            'ok': count >= MIN_MONITORS, 'my_access': device_access(request.user, device)}


class DeviceMonitorsView(OperatorView):
    def get(self, request, pk):
        return Response(monitors_payload(request, self.get_device(request, pk)))

    def post(self, request, pk):
        device = self.get_device(request, pk)
        if device.operator_id != request.user.id and request.user.role != 'ADMIN':
            raise PermissionDenied('Only the device owner or an administrator can give access.')
        email = str(request.data.get('email', '')).strip().lower()
        if not email or '@' not in email:
            raise ValidationError({'email': 'Enter the email address of the stall operator to share with.'})
        if device.monitors.count() >= MAX_MONITORS:
            raise ValidationError({'email': 'This device can be shared with only one other stall operator. Remove the current access first to choose someone else.'})
        token = request.META.get('HTTP_AUTHORIZATION', '')[7:].strip()
        person = find_profile(token, email=email)
        if not person:
            raise ValidationError({'email': 'No AgriResQ account uses that email. They need to register first.'})
        if person['id'] == device.operator_id:
            raise ValidationError({'email': 'That operator already owns this device.'})
        if person.get('role') != 'STALL_OPERATOR' or person.get('is_active') is False:
            raise ValidationError({'email': 'Only active stall operators can use a shared device.'})
        DeviceMonitor.objects.get_or_create(
            device=device, user_id=person['id'],
            defaults={'full_name': person.get('full_name') or '', 'email': person.get('email') or email})
        return Response(monitors_payload(request, device), status=status.HTTP_201_CREATED)


class DeviceMonitorDetailView(OperatorView):
    def delete(self, request, pk, user_id):
        device = self.get_device(request, pk)
        if user_id != request.user.id and device.operator_id != request.user.id and request.user.role != 'ADMIN':
            raise PermissionDenied('Only the device owner or an administrator can remove someone else.')
        DeviceMonitor.objects.filter(device=device, user_id=user_id).delete()
        return Response(monitors_payload(request, device))


# ── analysed pictures: gallery for every camera the user may see, and per batch ──

def gallery_json(request, s):
    out = scan_json(request, s)
    out['device_name'] = s.device.name if s.device else ''
    out['device_ip'] = s.device.ip if s.device else None
    out['raw_image_url'] = media_url(request, s.raw_image, s, 'raw')
    return out


def scan_image(request, scan_id, token, field):
    try:
        payload = signing.loads(token, salt='scan-image', max_age=7 * 24 * 60 * 60)
    except signing.BadSignature as exc:
        raise Http404 from exc
    if payload != {'scan_id': scan_id, 'field': field} or field not in ('image', 'raw'):
        raise Http404
    try:
        scan = DeviceScan.objects.only('image', 'raw_image').get(pk=scan_id)
    except DeviceScan.DoesNotExist as exc:
        raise Http404 from exc
    rel = scan.raw_image if field == 'raw' else scan.image
    if not rel or rel.startswith(('http://', 'https://', 'data:')):
        raise Http404
    root = Path(settings.MEDIA_ROOT).resolve()
    image_path = (root / rel).resolve()
    if root not in image_path.parents or not image_path.is_file():
        raise Http404
    return FileResponse(open(image_path, 'rb'), content_type='image/jpeg')


class ScanGalleryView(APIView):
    """Recent analysed pictures. ?device=<id> &detected=1|0 &state=fresh &since=<ISO> &before=<scan id> &limit=<=100"""
    authentication_classes = [SupabaseAuthentication]
    permission_classes = [IsAuthenticated, IsOperatorOrAdminReadOnly]

    def get(self, request):
        q = request.query_params
        scans = DeviceScan.objects.filter(
            Q(device__in=visible_devices(request.user)) |
            Q(operator_id=request.user.id) if request.user.role != 'ADMIN' else Q()
        ).filter(detected=True, image__gt='').select_related('device')
        if q.get('device'):
            scans = scans.filter(device_id=q['device'])
        if q.get('source') == 'CAMERA':
            scans = scans.filter(source__in=('AUTO', 'MANUAL'))
        elif q.get('source') == 'PHOTO':
            scans = scans.filter(source__in=('PHONE', 'UPLOAD'))
        elif q.get('source'):
            raise ValidationError({'source': 'Choose CAMERA or PHOTO.'})
        if q.get('detected') in ('1', 'true'):
            scans = scans.filter(detected=True)
        elif q.get('detected') in ('0', 'false'):
            scans = scans.filter(detected=False)
        if q.get('state'):
            scans = scans.filter(state=q['state'])
        if q.get('since'):
            from django.utils.dateparse import parse_datetime
            since = parse_datetime(q['since'])
            if since:
                scans = scans.filter(created_at__gte=since)
        if q.get('before'):
            scans = scans.filter(pk__lt=int(q['before']))
        if q.get('until'):
            from django.utils.dateparse import parse_datetime
            until = parse_datetime(q['until'])
            if until:
                scans = scans.filter(created_at__lte=until)
        limit = min(int(q.get('limit', 60)), 100)
        page = list(scans.order_by('-pk')[:limit + 1])
        more = len(page) > limit
        page = page[:limit]
        return Response({'results': [gallery_json(request, s) for s in page],
                         'next_before': page[-1].pk if more and page else None})


class ScanBatchLinkView(APIView):
    authentication_classes = [SupabaseAuthentication]
    permission_classes = [IsAuthenticated, IsOperatorOrAdminReadOnly]
    parser_classes = [JSONParser]

    def post(self, request, scan_id):
        if request.user.role != 'STALL_OPERATOR':
            raise PermissionDenied('Only a stall operator can link a photo scan to a batch.')
        scan = DeviceScan.objects.filter(pk=scan_id, operator_id=request.user.id).first()
        if not scan:
            raise NotFound('Photo scan not found.')
        if scan.product_id is not None:
            raise ValidationError({'scan_id': 'This photo is already linked to a batch.'})
        try:
            product_id = int(request.data.get('product_id'))
        except (TypeError, ValueError):
            raise ValidationError({'product_id': 'A valid batch is required.'})
        if not has_service_key():
            return Response({'detail': 'The hub cannot verify batch ownership right now.'},
                            status=status.HTTP_503_SERVICE_UNAVAILABLE)
        try:
            products = supabase_select('products', {'id': product_id})
        except Exception:
            return Response({'detail': 'Could not verify the batch.'}, status=status.HTTP_502_BAD_GATEWAY)
        if not products or products[0].get('operator_id') != request.user.id:
            raise NotFound('Batch not found.')
        scan.product_id = product_id
        scan.save(update_fields=['product_id'])
        return Response(gallery_json(request, scan))


class OperatorPhotoAnalyzeView(APIView):
    """Analyze and retain a stall operator's phone or uploaded photo in their scan gallery."""
    authentication_classes = [SupabaseAuthentication]
    permission_classes = [IsAuthenticated, IsOperatorOrAdminReadOnly]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        if request.user.role != 'STALL_OPERATOR':
            raise PermissionDenied('Only a stall operator can save a photo scan.')
        image = request.FILES.get('image')
        if not image:
            raise ValidationError({'image': 'Choose a photo to analyze.'})
        if image.size > 10 * 1024 * 1024:
            raise ValidationError({'image': 'Choose a photo smaller than 10 MB.'})

        crop = str(request.data.get('crop_type') or 'EGGPLANT').upper()
        if crop not in CROPS:
            raise ValidationError({'crop_type': 'Choose eggplant, cucumber or carrot.'})
        source = str(request.data.get('source') or 'UPLOAD').upper()
        if source not in ('PHONE', 'UPLOAD', 'MANUAL'):
            raise ValidationError({'source': 'Choose PHONE, UPLOAD or MANUAL.'})

        device = None
        device_id = request.data.get('device_id')
        if device_id:
            device = visible_devices(request.user).filter(pk=device_id).first()
            if not device or device.kind != 'CAMERA':
                raise NotFound('Camera not found.')
        product_id = request.data.get('product_id')
        if product_id not in (None, ''):
            if not has_service_key():
                return Response({'detail': 'The hub cannot verify batch ownership right now.'},
                                status=status.HTTP_503_SERVICE_UNAVAILABLE)
            try:
                product_id = int(product_id)
                products = supabase_select('products', {'id': product_id})
            except (TypeError, ValueError):
                raise ValidationError({'product_id': 'Invalid batch.'})
            if not products or products[0].get('operator_id') != request.user.id:
                raise NotFound('Batch not found.')

        scan = run_scan(image.read(), device, source, crop, request.user.id, product_id)
        return Response(gallery_json(request, scan), status=status.HTTP_201_CREATED)


class BatchPhotosView(APIView):
    """The pictures the camera took of one batch (product), newest first, with timestamps."""
    authentication_classes = [SupabaseAuthentication]
    permission_classes = [IsAuthenticated, IsOperatorOrAdminReadOnly]

    def get(self, request, product_id):
        scopes = Q() if request.user.role == 'ADMIN' else (
            Q(device__in=visible_devices(request.user)) | Q(operator_id=request.user.id)
        )
        scans = (DeviceScan.objects.filter(scopes)
                 .filter(Q(product_id=product_id) | Q(device__product_id=product_id))
                 .filter(detected=True, crop_mismatch=False, image__gt='')
                 .select_related('device').order_by('-pk')[:200])
        return Response([gallery_json(request, s) for s in scans])


class StallConditionsView(APIView):
    """GET /api/stall/conditions/  the stall climate from the DHT22s and what it does to each crop's shelf life.
    An operator gets their own stall (and the stalls whose devices they share); the administrator gets every stall."""
    authentication_classes = [SupabaseAuthentication]
    permission_classes = [IsAuthenticated, IsOperatorOrAdminReadOnly]

    def get(self, request):
        owners = set(visible_devices(request.user).values_list('operator_id', flat=True))
        if request.user.role == 'STALL_OPERATOR':
            owners.add(request.user.id)
        return Response({'stalls': [stall_summary(op) for op in sorted(owners)]})


class ShelfLifeReferenceView(APIView):
    """GET /api/reference/shelf-life/  the published measurements the days-to-spoil engine is checked against, what the
    engine predicts at each study's conditions, and the basis of every engine parameter. Any signed-in user."""
    authentication_classes = [SupabaseAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(reference_payload())


class BatchAnalysisView(APIView):
    """GET /api/batches/<id>/analysis/  freshness analysis of one batch: the camera's ML verdicts over several scans,
    how far to trust them next to the rule engine, and the calculated days to spoil.
    The operator who owns the batch and the administrator also get the sensor part (temperature, humidity, VPD, CHU).
    Buyers get the calculated days and the camera confidence for LISTED batches only, never raw sensor readings."""
    authentication_classes = [SupabaseAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request, product_id):
        if not has_service_key():
            return Response({'detail': 'The hub has no Supabase service key, so batches cannot be read.'},
                            status=status.HTTP_503_SERVICE_UNAVAILABLE)
        try:
            rows = supabase_select('products', {'id': product_id})
        except Exception:
            return Response({'detail': 'Could not read the batch.'}, status=status.HTTP_502_BAD_GATEWAY)
        if not rows:
            raise NotFound('Batch not found.')
        product = rows[0]
        user = request.user
        full = user.role == 'ADMIN' or (user.role == 'STALL_OPERATOR' and product.get('operator_id') == user.id)
        if not full and not product.get('is_listed'):
            raise NotFound('Batch not found.')
        climate = None
        if full:
            try:
                found = supabase_select('product_climate', {'product_id': product_id})
                climate = found[0] if found else None
            except Exception:
                climate = None                                  # table not created yet (supabase/010)
        return Response(batch_analysis(product, climate, full=full))
