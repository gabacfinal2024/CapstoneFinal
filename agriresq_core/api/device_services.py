"""
Business logic for ESP32-CAM devices: store scans/readings and push them into the
Supabase tables the web and mobile apps read (products, spoilage_predictions,
sensor_logs, notifications, marketplace_listings).

Hybrid engine (paper 3.10):
  * rule engine  : every DHT22 reading ages the linked batch (VPD / CHU stress multiplier on a
                   moving-average-filtered temperature + humidity)  -> save_reading()
  * ML override  : a camera verdict of at-risk / rotten drops the ETA to the critical window
                   and sets the status; a "fresh" verdict never raises it -> run_scan()

Supabase sync needs SUPABASE_SERVICE_ROLE_KEY in the backend .env. Without it everything still
works inside Django (device pages, live view, scans); the app tables just don't change.
"""
import logging
import urllib.error
from datetime import timedelta
from decimal import Decimal
from types import SimpleNamespace

from django.conf import settings
from django.utils import timezone

from .models import BatchClock, Device, DeviceReading, DeviceScan
from .spoilage_engine import (CROP_CONFIG, calculate_chu_increment, calculate_stress_multiplier, calculate_vpd,
                               classify_status, freshness_percent, predict_spoilage)
from .supabase_client import has_service_key, supabase_insert, supabase_select, supabase_update, supabase_upsert
from .analysis import accepted_scans, camera_summary, may_override
from .vision import analyze_image

log = logging.getLogger(__name__)

# same rule as agriresq_mobile/src/api/pricing.js
DISCOUNT_RULES = {'GREEN': 0, 'AMBER': 30, 'RED': 100}
STATUS_LABEL = {'GREEN': 'Fresh', 'AMBER': 'At-Risk', 'RED': 'Rotten'}
ALERT_TEMP_C = Decimal(str(settings.IOT_TEMP_ALERT_THRESHOLD))
ALERT_COOLDOWN = timedelta(hours=1)
FILTER_WINDOW = 5                       # moving-average filter over the last N readings (paper 3.16.1)
EMERGENCY_TEMP_C = Decimal('35')        # paper 3.17.2: sustained > 35 C for 2 h -> out-of-schedule snapshot
EMERGENCY_HOURS = 2
EMERGENCY_COOLDOWN = timedelta(hours=6)
MAX_STEP_HOURS = Decimal('2')           # never age a batch by more than 2 h from one reading


def _save_image(path, data=None, image=None):
    path.parent.mkdir(parents=True, exist_ok=True)
    if image is not None:
        image.save(path, 'JPEG', quality=85)
    else:
        path.write_bytes(data)


def run_scan(image_bytes, device=None, source='AUTO', crop_type=None):
    """Analyse an image, save it as a DeviceScan and (for real detections) update the linked batch."""
    crop = crop_type or (device.crop_type if device else 'EGGPLANT')
    result, annotated = analyze_image(image_bytes, crop)

    scan = DeviceScan.objects.create(
        device=device, source=source,
        crop_type=result['crop_type'], detected=result['detected'], detected_crop=result['detected_crop'],
        crop_mismatch=result['crop_mismatch'], message=result['message'][:200], none_prob=result['none_prob'],
        state=result['state'], freshness_status=result['freshness_status'],
        freshness_percent=result['freshness_percent'],
        days_to_spoil=None if result['days_to_spoil'] is None else Decimal(str(result['days_to_spoil'])),
        ml_confidence=result['ml_confidence'], probs=result['probs'], low_confidence=result['low_confidence'],
        product_id=device.product_id if device else None,
    )
    # Privacy: automatic captures of "nothing relevant in view" are not stored. A market camera
    # can see people walking past, and there is nothing to learn from an empty frame anyway.
    if result['detected'] or source != 'AUTO':
        folder = f"scans/{device.id if device else 'upload'}"
        _save_image(settings.MEDIA_ROOT / folder / f"{scan.id}.jpg", image=annotated)
        _save_image(settings.MEDIA_ROOT / folder / f"{scan.id}_raw.jpg", data=image_bytes)
        scan.image, scan.raw_image = f"{folder}/{scan.id}.jpg", f"{folder}/{scan.id}_raw.jpg"
        scan.save(update_fields=['image', 'raw_image'])

    if device and device.product_id and result['detected'] and not result['crop_mismatch'] \
            and not result['low_confidence']:
        try:
            ml_override(device, scan)
        except Exception as exc:   # never fail the device upload because Supabase is unreachable
            log.warning('Supabase product sync failed: %s', exc)
    return scan


# ── Supabase product updates ────────────────────────────────────────────────

def _product(device):
    if not (device.product_id and has_service_key()):
        return None
    rows = supabase_select('products', {'id': device.product_id})
    if not rows or rows[0]['operator_id'] != device.operator_id:
        return None
    return rows[0]


def _apply(device, product, status, days, percent, source, ml_confidence=None, detail='', chu=None, vpd=None):
    """Write status / ETA / dynamic price to the batch; notify + (un)list when the status changes."""
    BatchClock.objects.update_or_create(product_id=product['id'], defaults={'last_tick': timezone.now()})
    old = product.get('freshness_status')
    base = Decimal(str(product.get('base_price_per_kg') or 0))
    qty = Decimal(str(product.get('quantity_kg') or 0))
    discount = DISCOUNT_RULES[status] if product.get('auto_discount_enabled', True) else 0
    current = (base * (100 - discount) / 100).quantize(Decimal('0.01'))

    patch = {'freshness_status': status, 'freshness_percent': percent,
             'predicted_shelf_life': float(days), 'current_price_per_kg': float(current), 'discount_percent': discount}
    if ml_confidence is not None:
        patch['ml_confidence'] = round(ml_confidence, 2)
    if status == 'RED':
        patch['is_listed'] = False
    supabase_update('products', {'id': product['id']}, patch)
    if old == status:
        return

    supabase_insert('spoilage_predictions', {
        'product_id': product['id'], 'predicted_status': status, 'days_to_spoil': float(days),
        'freshness_percent': percent, 'source': source,
        **({'chu_accumulated': float(chu)} if chu is not None else {}), **({'vpd_value': float(vpd)} if vpd is not None else {}),
    })
    crop = product['crop_type'].title()
    supabase_insert('notifications', {
        'user_id': device.operator_id, 'product_id': product['id'], 'notification_type': 'STATUS_CHANGE',
        'title': f'Batch Status: {STATUS_LABEL[status]}',
        'message': (f'Your {crop} batch #{product["id"]}: {STATUS_LABEL.get(old, old)} → {STATUS_LABEL[status]}. '
                    f'About {days} days left. {detail}').strip(),
    })
    if status == 'AMBER':
        supabase_upsert('marketplace_listings', {
            'product_id': product['id'], 'operator_id': device.operator_id,
            'listed_price': float(current * qty), 'original_price': float(base * qty), 'discount_percent': discount,
            'listing_status': 'ACTIVE', 'expires_at': (timezone.now() + timedelta(days=2)).isoformat(),
        }, on_conflict='product_id')
        supabase_update('products', {'id': product['id']}, {'is_listed': True})
        supabase_insert('notifications', {
            'user_id': device.operator_id, 'product_id': product['id'], 'notification_type': 'MARKETPLACE',
            'title': 'Auto-listed in Rescue Marketplace',
            'message': f'{crop} batch #{product["id"]} is At-Risk and was listed at {discount}% off.',
        })
    elif status == 'RED':
        supabase_update('marketplace_listings', {'product_id': product['id']}, {'listing_status': 'CANCELLED'})


def ml_override(device, scan):
    """Paper 3.10.1 step 3: visible spoilage overrides the mathematical countdown. A fresh verdict
    does not extend the countdown (it only records the confidence)."""
    product = _product(device)
    if not product:
        return
    product_crop = str(product.get('crop_type') or '').upper()
    if product_crop == 'CARROTS':
        product_crop = 'CARROT'
    if product_crop != scan.crop_type:
        log.info('scan %s detected %s; linked batch %s is %s, so its status was not updated',
                 scan.id, scan.crop_type, device.product_id, product_crop)
        return
    # Accuracy: judge the batch on its recent accepted scans together, not on one frame. The stored ML confidence is
    # that combined figure (mean probability of the agreeing scans x the share that agree).
    summary = camera_summary(accepted_scans(product['id']))
    supabase_update('products', {'id': product['id']}, {
        'ml_confidence': round(summary['confidence'] if summary else scan.ml_confidence, 2)})
    if scan.state == 'fresh':
        return
    if not may_override(summary, scan):
        log.info('scan %s says %s but is not yet confirmed by a second scan; status unchanged', scan.id, scan.state)
        return
    status, days = scan.freshness_status, scan.days_to_spoil
    # never lengthen a countdown that the environment already shortened below the camera's window
    current_days = Decimal(str(product.get('predicted_shelf_life') or days))
    if status == 'AMBER' and product.get('freshness_status') in ('AMBER', 'RED'):
        days = min(days, current_days)
    _apply(device, product, status, days, scan.freshness_percent, 'VISION_ML', summary['confidence'],
           detail=f'{device.name} sees {scan.state} skin ({scan.ml_confidence * 100:.0f}% confidence).')
    device.eta_start, device.life_lost = days, Decimal('0')      # the rule engine continues from here
    device.save(update_fields=['eta_start', 'life_lost'])


# ── DHT22 readings: moving-average filter, rule engine, alerts ───────────────

def save_reading(device, temperature_c, humidity_rh):
    now = timezone.now()
    t, rh = Decimal(str(temperature_c)), Decimal(str(humidity_rh))
    vpd = calculate_vpd(t, rh).quantize(Decimal('0.0001'))
    reading = DeviceReading.objects.create(device=device, temperature_c=t, humidity_rh=rh, vpd_kpa=vpd)
    recent = list(device.readings.all()[:FILTER_WINDOW])
    t_f = sum(r.temperature_c for r in recent) / len(recent)      # moving average: ignores one-off spikes
    rh_f = sum(r.humidity_rh for r in recent) / len(recent)
    hours = Decimal('0')
    if device.last_reading_at:
        hours = min(Decimal(str((now - device.last_reading_at).total_seconds() / 3600)), MAX_STEP_HOURS)
    device.last_reading_at = now
    device.save(update_fields=['last_reading_at'])

    if has_service_key():
        try:
            age_operator_batches(device.operator_id, now)
        except Exception as exc:
            log.warning('Supabase sensor sync failed: %s', exc)
    _alerts(device, now, t_f, rh_f)
    return reading


def apply_environment(device, t_f, rh_f, hours):
    """Age the batch linked to this device by the heat/dryness stress over `hours` (kept for one device;
    the live path uses age_operator_batches, which ages every batch at the stall)."""
    if hours <= 0:
        return
    product = _product(device)
    if not product or product['freshness_status'] == 'RED':
        return
    crop = product['crop_type']
    current = Decimal(str(product.get('predicted_shelf_life') or CROP_CONFIG[crop]['baseline_shelf_life']))
    status, days, _chu, _vpd = predict_spoilage(crop, current, t_f, rh_f, hours_elapsed=hours)
    days = days.quantize(Decimal('0.01'))
    if abs(current - days) < Decimal('0.01') and status == product['freshness_status']:
        return                                                    # nothing visible changed
    _apply(device, product, status, days, freshness_percent(days, CROP_CONFIG[crop]['baseline_shelf_life']),
           'RULE_ENGINE', detail=f'Stall conditions: {t_f:.1f}°C, {rh_f:.0f}% RH.')


def _alerts(device, now, t_f, rh_f):
    where = device.stall_location or 'your stall'
    if t_f > ALERT_TEMP_C and (not device.last_alert_at or now - device.last_alert_at > ALERT_COOLDOWN) \
            and has_service_key():
        try:
            supabase_insert('notifications', {
                'user_id': device.operator_id, 'product_id': device.product_id, 'notification_type': 'IOT_ALERT',
                'title': 'High Temperature Alert',
                'message': f'{device.name}: {t_f:.1f}°C, {rh_f:.0f}% RH at {where}. Produce will spoil faster; '
                           f'move it to shade or cool storage.'})
            device.last_alert_at = now
            device.save(update_fields=['last_alert_at'])
        except Exception as exc:
            log.warning('alert failed: %s', exc)
    # sustained extreme heat -> emergency snapshot (paper 3.17.2): is the heat showing on the produce?
    since = now - timedelta(hours=EMERGENCY_HOURS)
    window = list(device.readings.filter(created_at__gte=since))
    if len(window) >= 5 and min(r.temperature_c for r in window) > EMERGENCY_TEMP_C \
            and (now - window[-1].created_at) >= timedelta(minutes=EMERGENCY_HOURS * 60 - 10) \
            and (not device.last_emergency_at or now - device.last_emergency_at > EMERGENCY_COOLDOWN):
        device.pending_command = 'scan_auto'
        device.last_emergency_at = now
        device.save(update_fields=['pending_command', 'last_emergency_at'])
        log.info('emergency snapshot queued for device %s', device.id)


# ── time-based aging: a batch gets older even with no camera and no sensor ─────

TIME_APPLY_AFTER = timedelta(hours=1)    # time-only pass: write at most about once an hour per batch
TIME_MAX_STEP = timedelta(hours=72)      # after a long outage, catch up at most three days at once
SENSOR_MIN_STEP = timedelta(minutes=10)  # with live DHT22 data, a batch is updated at most every 10 minutes
SENSOR_WINDOW = timedelta(hours=3)       # readings older than this no longer describe the stall
THROTTLE_S = 60                          # a sensor reading triggers at most one stall-wide pass per minute


def stall_conditions(operator_id, now):
    """(temperature, humidity, measured) for a stall, from the stall's sensor nodes (plain ESP32 + DHT22): the
    average of each node's last readings (moving-average filter, paper 3.16.1), then the mean of the nodes. The
    cameras do not contribute. `measured` is False when nothing reported in the last 3 hours, in which case the
    assumed market conditions (settings.ASSUMED_STALL_TEMP_C / _RH) are returned."""
    means = []
    for device in Device.objects.filter(operator_id=operator_id, kind='SENSOR'):
        recent = list(device.readings.filter(created_at__gte=now - SENSOR_WINDOW)[:FILTER_WINDOW])
        if recent:
            means.append((sum(r.temperature_c for r in recent) / len(recent),
                          sum(r.humidity_rh for r in recent) / len(recent)))
    if means:
        return (sum(m[0] for m in means) / len(means), sum(m[1] for m in means) / len(means), True)
    return Decimal(str(settings.ASSUMED_STALL_TEMP_C)), Decimal(str(settings.ASSUMED_STALL_RH)), False


def _age_product(product, temp, rh, now, min_elapsed, source, note):
    """Take `product` forward in time by the hours since its BatchClock last moved, at this temperature and
    humidity. Writes status, days left, price and notifications through _apply. False when nothing was
    written (not due yet, rotten, unknown crop, or no visible change yet: the time keeps accumulating)."""
    status = product.get('freshness_status')
    if status == 'RED' or product.get('crop_type') not in CROP_CONFIG:
        return False
    clock, created = BatchClock.objects.get_or_create(product_id=product['id'], defaults={'last_tick': now})
    if created:
        return False                                       # first time we see it: start counting from now
    elapsed = now - clock.last_tick
    if elapsed < min_elapsed:
        return False
    hours = Decimal(str(min(elapsed, TIME_MAX_STEP).total_seconds() / 3600))
    current = Decimal(str(product.get('predicted_shelf_life') or 0))
    new_status, days, new_chu, vpd = predict_spoilage(product['crop_type'], current, temp, rh,
                                                      chu_accumulated=clock.chu_accumulated, hours_elapsed=hours)
    days = days.quantize(Decimal('0.01'))
    if new_status == 'GREEN' and status == 'AMBER':
        new_status = 'AMBER'                               # time never makes a batch fresher
    if abs(current - days) < Decimal('0.01') and new_status == status:
        return False
    owner = SimpleNamespace(operator_id=product['operator_id'], name='Stall sensors' if source == 'RULE_ENGINE'
                            else 'Automatic monitoring')
    _apply(owner, product, new_status, days,
           freshness_percent(days, CROP_CONFIG[product['crop_type']]['baseline_shelf_life']), source,
           detail=f'About {days} days left ({note}).', chu=new_chu, vpd=vpd)
    BatchClock.objects.filter(product_id=product['id']).update(chu_accumulated=new_chu.quantize(Decimal('0.001')))
    return True


def age_operator_batches(operator_id, now=None, force=False):
    """A DHT22 reported: age every active batch at this stall by the real conditions (rule engine, paper 3.10).
    All the operator's devices count (a sensor node and the camera share one stall climate), and every batch
    that is listed or linked to a device is aged, not just one. Throttled to once a minute per operator.
    Returns the number of batches written. Needs the Supabase service key."""
    if not has_service_key():
        return 0
    from django.core.cache import cache
    if not force and not cache.add(f'age-stall-{operator_id}', 1, THROTTLE_S):
        return 0
    now = now or timezone.now()
    temp, rh, measured = stall_conditions(operator_id, now)
    if not measured:
        return 0
    try:
        products = supabase_select('products', {'operator_id': operator_id})
    except Exception as exc:
        log.warning('stall aging: cannot read products: %s', exc)
        return 0
    linked = set(Device.objects.filter(operator_id=operator_id, product_id__isnull=False).values_list('product_id', flat=True))
    written = 0
    paired = []
    for product in products:
        if not (product.get('is_listed') or product['id'] in linked):
            continue
        paired.append(product)
        try:
            if _age_product(product, temp, rh, now, SENSOR_MIN_STEP, 'RULE_ENGINE', f'{temp:.1f}°C, {rh:.0f}% RH at the stall'):
                written += 1
        except Exception as exc:
            log.warning('stall aging: batch %s not updated: %s', product.get('id'), exc)
    pair_readings(paired, temp, rh, now)
    return written


LOG_EVERY_S = 300                        # each paired batch gets a sensor_logs history row about every 5 minutes
_columns_missing = False                 # set when Supabase has no product_climate table yet (supabase/010 not run)


def pair_readings(products, temp, rh, now):
    """Pair the stall's DHT22 reading with every listing: the latest temperature, humidity, VPD and accumulated
    heat units go into product_climate (readable only by the batch's operator and the administrator, never by
    buyers) and a sensor_logs row is added every few minutes for the history chart. Never raises: aging must not
    depend on this."""
    global _columns_missing
    from django.core.cache import cache
    vpd = calculate_vpd(temp, rh).quantize(Decimal('0.0001'))
    for product in products:
        pid = product['id']
        clock = BatchClock.objects.filter(product_id=pid).first()
        chu = clock.chu_accumulated if clock else Decimal('0')
        try:
            if not _columns_missing:
                supabase_upsert('product_climate', {
                    'product_id': pid, 'latest_temp_c': float(round(temp, 2)), 'latest_humidity_rh': float(round(rh, 2)),
                    'latest_vpd_kpa': float(vpd), 'chu_accumulated': float(chu), 'sensor_updated_at': now.isoformat()},
                    on_conflict='product_id')
        except urllib.error.HTTPError as exc:
            if exc.code in (400, 404):              # PostgREST: the table does not exist yet
                _columns_missing = True
                log.warning('product_climate does not exist yet: run supabase/010_sensor_columns.sql')
            else:
                log.warning('pairing batch %s failed: %s', pid, exc)
        except Exception as exc:
            log.warning('pairing batch %s failed: %s', pid, exc)
        try:
            if cache.add(f'sensor-log-{pid}', 1, LOG_EVERY_S):
                supabase_insert('sensor_logs', {'product_id': pid, 'temperature_c': float(round(temp, 2)),
                                                'humidity_rh': float(round(rh, 2)), 'vpd_value': float(vpd)})
        except Exception as exc:
            log.warning('sensor log for batch %s failed: %s', pid, exc)


def stall_summary(operator_id, now=None):
    """What the stall's DHT22s say right now, and what that does to each crop's shelf life."""
    now = now or timezone.now()
    temp, rh, measured = stall_conditions(operator_id, now)
    last = DeviceReading.objects.filter(device__operator_id=operator_id, device__kind='SENSOR').order_by('-created_at').first()
    return {
        'operator_id': operator_id, 'measured': measured,
        'temperature_c': float(round(temp, 2)), 'humidity_rh': float(round(rh, 2)),
        'vpd_kpa': float(calculate_vpd(temp, rh).quantize(Decimal('0.001'))),
        'updated_at': last.created_at if last else None,
        'devices': list(Device.objects.filter(operator_id=operator_id, kind='SENSOR', last_reading_at__isnull=False).values_list('id', flat=True)),
        # shelf-life days used up by one real day here (1.0 = the 25 C baseline), and heat units gained per hour
        'aging': {crop: {'days_used_per_day': float(round(calculate_stress_multiplier(temp, rh, crop), 2)),
                         'chu_per_hour': float(round(calculate_chu_increment(temp, crop), 2))}
                  for crop in CROP_CONFIG},
    }


def age_by_time(now=None):
    """Age every listed batch by the real time that passed, even with no camera scan and no sensor reading: at
    the stall's measured conditions when a DHT22 reported in the last 3 hours, otherwise the assumed market
    conditions. Shares each batch's BatchClock with age_operator_batches, so nothing is aged twice. A status
    change updates the price (At-Risk -30 %, Rotten unlisted), notifies the operator and (un)lists the batch,
    exactly like a camera verdict does. Returns the number of batches written. Needs the service key."""
    if not has_service_key():
        return 0
    now = now or timezone.now()
    try:
        products = supabase_select('products', {'is_listed': 'true'})
    except Exception as exc:
        log.warning('time aging: cannot read products: %s', exc)
        return 0
    conditions = {}
    written = 0
    for product in products:
        op = product['operator_id']
        if op not in conditions:
            conditions[op] = stall_conditions(op, now)
        temp, rh, measured = conditions[op]
        note = f'{temp:.0f}°C, {rh:.0f}% RH' + ('' if measured else ', assumed')
        try:
            if _age_product(product, temp, rh, now, TIME_APPLY_AFTER, 'TIME', note):
                written += 1
        except Exception as exc:
            log.warning('time aging: batch %s not updated: %s', product.get('id'), exc)
    return written


def prune_scans(now=None):
    """Delete old analysed pictures (rows and files). Returns how many scans were removed."""
    from datetime import timedelta

    from django.conf import settings
    from django.utils import timezone

    from .models import Device, DeviceScan
    cutoff = (now or timezone.now()) - timedelta(days=settings.SCAN_KEEP_DAYS)
    removed = 0
    for device in Device.objects.all():
        keep = set(device.scans.order_by('-created_at', '-pk').values_list('pk', flat=True)[:settings.SCAN_KEEP_PER_DEVICE])
        old = (device.scans.filter(created_at__lt=cutoff, feedback_label__isnull=True)
               .exclude(pk__in=keep).only('id', 'image', 'raw_image'))
        for scan in old:
            for rel in (scan.image, scan.raw_image):
                if rel:
                    try:
                        (settings.MEDIA_ROOT / rel).unlink()
                    except OSError:
                        pass
            scan.delete()
            removed += 1
    return removed
