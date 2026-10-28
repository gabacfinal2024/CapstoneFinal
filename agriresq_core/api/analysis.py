"""Freshness analysis of one batch: the ESP32-CAM's ML verdicts combined with the rule engine (CHU / VPD).

Two independent sources describe a batch:
  * camera  : the freshness CNN on pictures taken at the stall (several scans, so one odd frame cannot decide);
  * rules   : days left from the DHT22 stall climate (Q10 temperature law, VPD water loss, CHU heat units).
This module turns the recent camera scans into one summary, compares it with the rule engine's status, and says how
much to trust the result. It is shown to the operator and the admin in full, and to buyers without any raw sensor data.
"""
from collections import defaultdict
from datetime import timedelta
from decimal import Decimal

from django.utils import timezone

from .models import DeviceScan
from .spoilage_engine import classify_status

STATE_STATUS = {'fresh': 'GREEN', 'at-risk': 'AMBER', 'rotten': 'RED'}
STATUS_STATE = {v: k for k, v in STATE_STATUS.items()}
WINDOW = timedelta(hours=48)      # scans older than this no longer describe the batch
MAX_SCANS = 10                    # the newest accepted scans that are counted
HIGH_CONFIDENCE = 0.80            # camera confidence needed for a HIGH level
MIN_CONFIDENCE = 0.60
SINGLE_SCAN_OVERRIDE = 0.90       # one scan alone may change a status only at this confidence

# Measured on the held-out test set of the deployed model (ML/results/openset.json, paper Tables 7-8).
MODEL_METRICS = {'accuracy': 0.912, 'macro_f1': 0.844, 'target_accepted': 0.993,
                 'non_target_rejected_seen': 0.992, 'non_target_rejected_unseen': 0.892, 'test_images': 1183}


def accepted_scans(product_id, now=None):
    """Newest-first scans of this batch the model was sure enough about: a real eggplant, cucumber or carrot of the
    expected crop, accepted by the open-set check, and not flagged low confidence."""
    now = now or timezone.now()
    return list(DeviceScan.objects.filter(
        product_id=product_id, detected=True, crop_mismatch=False, low_confidence=False,
        created_at__gte=now - WINDOW).order_by('-created_at', '-pk')[:MAX_SCANS])


def camera_summary(scans):
    """One verdict from several scans: the state with the most confidence-weighted votes; its confidence is the mean
    probability of the scans that agree times the share of scans that agree (so a split camera is not trusted)."""
    if not scans:
        return None
    votes = defaultdict(float)
    for s in scans:
        votes[s.state] += s.ml_confidence
    winner = max(votes, key=votes.get)
    agree = [s for s in scans if s.state == winner]
    mean_conf = sum(s.ml_confidence for s in agree) / len(agree)
    consistency = len(agree) / len(scans)
    return {
        'state': winner, 'status': STATE_STATUS.get(winner), 'scans': len(scans), 'agreeing': len(agree),
        'mean_confidence': round(mean_conf, 3), 'consistency': round(consistency, 3),
        'confidence': round(mean_conf * consistency, 3),
        'last_scan_at': scans[0].created_at, 'last_state': scans[0].state,
    }


def may_override(summary, scan):
    """Should this scan change the batch's status? Only when the camera's overall verdict is the same state, and either
    at least two accepted scans agree or this single scan is very confident. Stops one noisy frame from putting a
    good batch on discount (At-Risk = -30 %)."""
    if not summary or summary['state'] != scan.state:
        return False
    return summary['agreeing'] >= 2 or scan.ml_confidence >= SINGLE_SCAN_OVERRIDE


def trust_level(summary, product_status):
    """(level, agreement). The stored batch status already combines camera and rules (the worse one wins), so compare
    the camera with it: 'agree'; 'rules_stricter' (camera sees good skin, heat has used up days); 'camera_stricter'."""
    if not summary:
        return 'RULES_ONLY', 'no_camera'
    order = {'GREEN': 0, 'AMBER': 1, 'RED': 2}
    cam, prod = summary['status'], product_status
    if cam == prod:
        agreement = 'agree'
    elif order.get(cam, 0) < order.get(prod, 0):
        agreement = 'rules_stricter'
    else:
        agreement = 'camera_stricter'
    if agreement == 'agree' and summary['scans'] >= 2 and summary['confidence'] >= HIGH_CONFIDENCE:
        return 'HIGH', agreement
    if agreement in ('agree', 'rules_stricter') and summary['confidence'] >= MIN_CONFIDENCE:
        return 'MEDIUM', agreement
    return 'LOW', agreement


def batch_analysis(product, climate=None, now=None, full=False):
    """The analysis payload for one product row (Supabase) and its latest paired climate row (or None).
    `full` adds the sensor-derived part (temperature, humidity, VPD, CHU); without it nothing raw is revealed."""
    now = now or timezone.now()
    scans = accepted_scans(product['id'], now)
    cam = camera_summary(scans)
    status = product.get('freshness_status') or 'GREEN'
    level, agreement = trust_level(cam, status)
    days = product.get('predicted_shelf_life')
    out = {
        'product_id': product['id'], 'crop_type': product.get('crop_type'), 'status': status,
        'days_to_spoil': None if days is None else float(days), 'freshness_percent': product.get('freshness_percent'),
        'level': level, 'agreement': agreement, 'camera': cam, 'model': MODEL_METRICS,
        'rules_status': classify_status(Decimal(str(days))) if days is not None else None,
    }
    if full:
        c = climate or {}
        out['climate'] = {
            'temperature_c': c.get('latest_temp_c'), 'humidity_rh': c.get('latest_humidity_rh'),
            'vpd_kpa': c.get('latest_vpd_kpa'), 'chu': c.get('chu_accumulated'),
            'updated_at': c.get('sensor_updated_at'),
        }
    return out
