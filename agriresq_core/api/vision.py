"""
Freshness analysis with the AgriResQ CNN (EfficientNet-B0, ONNX; see ML/README.md).

The network is open-set: besides the 9 crop-states it has a `none` output for anything that is
not eggplant, cucumber or carrot (empty scene, hands, other produce, backgrounds). A frame is only
reported as a detection when the thresholds in ML/deploy/model_config.json are met.

The response keeps the fields the web/mobile apps already read (freshness_status,
freshness_percent, days_to_spoil, ml_confidence, crop_type, processed_image_base64) and adds
detected / state / detected_crop / crop_mismatch / message / probs / none_prob / low_confidence.
"""
import base64
import importlib.util
import io
import threading
from decimal import Decimal

from django.conf import settings
from PIL import Image, ImageDraw, ImageFont, ImageOps

from .spoilage_engine import CROP_CONFIG

STATE_TO_STATUS = {'fresh': 'GREEN', 'at-risk': 'AMBER', 'rotten': 'RED', 'none': 'UNKNOWN'}
STATUS_COLOR = {'GREEN': (42, 157, 92), 'AMBER': (230, 150, 20), 'RED': (210, 50, 50), 'UNKNOWN': (130, 130, 130)}
STATUS_LABEL = {'GREEN': 'FRESH', 'AMBER': 'AT-RISK', 'RED': 'ROTTEN', 'UNKNOWN': 'NO VEGETABLE'}
# Confidence of the freshness verdict (3-way softmax inside the crop, 1/3 = chance) below which the
# UI is told to ask for a re-scan and nothing is written to the batch.
LOW_CONFIDENCE = 0.55
# Paper 3.10.1: when the camera sees spoilage, the ETA drops to a critical 1-2 day window.
AT_RISK_ETA_DAYS = (1.0, 2.0)

_model = None
_lock = threading.Lock()


def get_model():
    """Load ML/deploy/predict.py's FreshnessModel once per process."""
    global _model
    if _model is None:
        with _lock:
            if _model is None:
                model_dir = settings.ML_MODEL_DIR
                spec = importlib.util.spec_from_file_location('agriresq_predict', model_dir / 'predict.py')
                module = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(module)
                _model = module.FreshnessModel(str(model_dir))
    return _model


def _annotate(image, status, text):
    image = image.copy()
    image.thumbnail((640, 640))
    draw = ImageDraw.Draw(image)
    color = STATUS_COLOR[status]
    w, h = image.size
    draw.rectangle([0, 0, w - 1, h - 1], outline=color, width=max(3, w // 160))
    try:
        font = ImageFont.load_default(size=max(14, w // 28))
    except TypeError:                     # Pillow < 10.1
        font = ImageFont.load_default()
    box = draw.textbbox((0, 0), text, font=font)
    pad = 6
    draw.rectangle([0, 0, box[2] + 2 * pad, box[3] + 2 * pad], fill=color)
    draw.text((pad, pad), text, fill=(255, 255, 255), font=font)
    return image


def eta_days(state, confidence, crop, freshness_pct):
    """Days to spoil for a camera verdict (ML override of the rule-based countdown, paper 3.10.1)."""
    if state == 'rotten':
        return Decimal('0')
    if state == 'at-risk':
        lo, hi = AT_RISK_ETA_DAYS
        return Decimal(str(lo if confidence >= 0.85 else hi))
    baseline = CROP_CONFIG[crop]['baseline_shelf_life']
    return (baseline * Decimal(str(freshness_pct)) / 100).quantize(Decimal('0.1'))


def analyze_image(image_bytes: bytes, crop_type: str | None = 'EGGPLANT') -> tuple[dict, Image.Image]:
    """Run the CNN. Returns (result dict, annotated PIL image)."""
    image = ImageOps.exif_transpose(Image.open(io.BytesIO(image_bytes))).convert('RGB')
    crop_type = {'CARROTS': 'CARROT'}.get((crop_type or '').upper(), (crop_type or '').upper())
    hint = crop_type.lower() if crop_type in CROP_CONFIG else None
    pred = get_model().predict(image, crop=hint)

    registered = crop_type if crop_type in CROP_CONFIG else 'EGGPLANT'
    probs = pred['probs']
    base = {
        'detected': pred['detected'],
        'state': pred['state'],
        'freshness_status': STATE_TO_STATUS[pred['state']],
        'detected_crop': pred['detected_crop'].upper() if pred['detected_crop'] else None,
        'crop_mismatch': pred['crop_mismatch'],
        'message': pred['message'],
        'ml_confidence': round(pred['confidence'], 4),
        'none_prob': pred['none_prob'],
        'probs': probs,
        'analysis_method': 'CNN_EFFICIENTNET_B0_OPENSET',
    }
    if not pred['detected']:
        result = {**base, 'crop_type': registered, 'freshness_percent': None, 'days_to_spoil': None,
                  'low_confidence': False}
        return result, _annotate(image, 'UNKNOWN', 'NO VEGETABLE')

    crop = pred['crop'].upper()
    pct = pred['freshness_pct']
    days = eta_days(pred['state'], pred['confidence'], crop, pct)
    result = {**base, 'crop_type': crop, 'freshness_percent': int(round(pct)), 'days_to_spoil': float(days),
              'low_confidence': pred['confidence'] < LOW_CONFIDENCE}
    status = base['freshness_status']
    label = f"{STATUS_LABEL[status]}  {crop.title()}  {pred['confidence'] * 100:.0f}%"
    if pred['crop_mismatch']:
        label = f"LOOKS LIKE {crop.title()}"
    return result, _annotate(image, 'AMBER' if pred['crop_mismatch'] else status, label)


def analyze_crop_image(image_bytes: bytes, crop_type: str = 'EGGPLANT') -> dict:
    """Backwards-compatible entry point used by /api/analyze-freshness/."""
    result, annotated = analyze_image(image_bytes, crop_type)
    buf = io.BytesIO()
    annotated.save(buf, 'JPEG', quality=85)
    result['model_prediction'] = f"{(result['detected_crop'] or 'none').lower()}_{result['state']}"
    result['processed_image_base64'] = 'data:image/jpeg;base64,' + base64.b64encode(buf.getvalue()).decode()
    return result
