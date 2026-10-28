"""
Two small background workers started with the Django server (api/apps.py):

1. Capture scheduler – paper Table 9: morning baseline 07:00, peak-heat 12:00, end-of-day 16:00.
   At each capture time every online device in 'schedule' mode is told to take a snapshot
   (heartbeat command `scan_auto`, so scans are labelled AUTO).

2. Discovery responder (UDP 41234) – a camera whose server address changed (new router, laptop on a
   different Wi-Fi) broadcasts "where is the server?"; we answer with our current address, signed
   with the device's own token so nobody else on the network can redirect it.
"""
import hashlib
import hmac
import json
import logging
import socket
import threading
import time
from datetime import datetime, timedelta

from django.conf import settings
from django.db import close_old_connections
from django.utils import timezone

log = logging.getLogger(__name__)
DISCOVERY_PORT = 41234
GRACE_MIN = 3             # a capture time can still fire up to 3 minutes late (busy server, camera briefly offline)
_started = False


def start():
    global _started
    if _started:
        return
    _started = True
    threading.Thread(target=scheduler_loop, name='agriresq-scheduler', daemon=True).start()
    threading.Thread(target=discovery_loop, name='agriresq-discovery', daemon=True).start()


# ── capture scheduler ───────────────────────────────────────────────────────

def due_windows(device, now):
    """Capture times (as 'YYYY-MM-DD HH:MM') that are due now for this device."""
    out = []
    for t in device.times():
        hh, mm = map(int, t.split(':'))
        at = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
        if at <= now < at + timedelta(minutes=GRACE_MIN):
            out.append(f"{at:%Y-%m-%d %H:%M}")
    return out


def run_schedule_once(now=None):
    from .models import Device
    now = timezone.localtime(now or timezone.now())
    queued = 0
    for d in Device.objects.filter(auto_scan=True, scan_mode='schedule'):
        for key in due_windows(d, now):
            # skip a camera that has been silent for a while: it would run the command hours later
            seen_recently = d.last_seen and (timezone.now() - d.last_seen) < timedelta(minutes=GRACE_MIN)
            if d.last_window != key and seen_recently:
                d.pending_command, d.last_window = 'scan_auto', key
                d.save(update_fields=['pending_command', 'last_window'])
                queued += 1
    return queued


AGING_EVERY_S = 300       # time-based aging pass (device_services.age_by_time), every 5 minutes


PRUNE_EVERY_S = 86400    # old analysed pictures are removed once a day (device_services.prune_scans)


def scheduler_loop():
    last_aging = 0.0
    last_prune = 0.0
    while True:
        try:
            close_old_connections()
            run_schedule_once()
            if time.monotonic() - last_aging >= AGING_EVERY_S:
                last_aging = time.monotonic()
                from .device_services import age_by_time
                age_by_time()
            if time.monotonic() - last_prune >= PRUNE_EVERY_S:
                last_prune = time.monotonic()
                from .device_services import prune_scans
                prune_scans()
        except Exception:
            log.exception('scheduler tick failed')
        time.sleep(30)


# ── discovery responder ─────────────────────────────────────────────────────

def server_url_for(peer_ip):
    """Our address as seen from the peer's network (the interface that routes to it)."""
    if settings.DEVICE_SERVER_URL:
        return settings.DEVICE_SERVER_URL.rstrip('/')
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect((peer_ip, 9))
        return f'http://{s.getsockname()[0]}:{settings.DJANGO_PORT}'
    finally:
        s.close()


def discovery_reply(data, peer_ip):
    """Answer one discovery datagram, or None when it is not from a known device."""
    from .models import Device
    q = json.loads(data.decode('utf8', 'ignore'))
    tid, nonce = str(q.get('tid', '')), str(q.get('nonce', ''))
    if len(tid) != 8 or not tid.replace('-', '').replace('_', '').isalnum() or not nonce:
        return None
    device = Device.objects.filter(device_token__startswith=tid).first()
    if not device:
        return None
    server = server_url_for(peer_ip)
    sig = hmac.new(device.device_token.encode(), (nonce + server).encode(), hashlib.sha256).hexdigest()
    return json.dumps({'server': server, 'sig': sig}).encode()


def discovery_loop():
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind(('', DISCOVERY_PORT))
    except OSError as exc:
        log.warning('discovery responder not started: %s', exc)
        return
    log.info('discovery responder listening on UDP %s', DISCOVERY_PORT)
    while True:
        try:
            data, addr = sock.recvfrom(512)
            close_old_connections()
            reply = discovery_reply(data, addr[0])
            if reply:
                sock.sendto(reply, addr)
        except Exception:
            log.exception('discovery failed')
