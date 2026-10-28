"""
Rule-based spoilage prediction engine for AgriResQ.
Uses VPD, CHU, and PAES 417:2002-inspired thresholds per crop type.
"""
import math
from decimal import Decimal
from typing import Tuple

# Baseline Configurations based on PAES 417:2002 agricultural standards
CROP_CONFIG = {
    'EGGPLANT': {
        'baseline_shelf_life': Decimal('5.0'),
        'optimal_temp': Decimal('12.0'),
        'stress_temp': Decimal('25.0'),
        'optimal_rh': Decimal('92.5'),
        'min_rh': Decimal('85.0'),
        'q10': Decimal('2.5'),
        'chilling_below': Decimal('10.0'),     # chilling injury below ~10 C (UC Davis)
    },
    'CUCUMBER': {
        'baseline_shelf_life': Decimal('4.0'),
        'optimal_temp': Decimal('11.5'),
        'stress_temp': Decimal('25.0'),
        'optimal_rh': Decimal('95.0'),
        'min_rh': Decimal('85.0'),
        'q10': Decimal('2.5'),
        'chilling_below': Decimal('10.0'),
    },
    'CARROT': {
        'baseline_shelf_life': Decimal('7.0'),
        'optimal_temp': Decimal('0.0'),
        'stress_temp': Decimal('25.0'),
        'optimal_rh': Decimal('98.0'),
        'min_rh': Decimal('75.0'),             # relaxed from 90: carrots stayed edible 7-12 days at room temperature (evidence.py E6)
        'q10': Decimal('2.2'),                 # storage organs have lower Q10 than leafy/fruit crops
        'chilling_below': Decimal('-99'),      # carrots are not chilling-sensitive
    },
}

def calculate_svp(temp_c: Decimal) -> Decimal:
    """Calculates Saturated Vapor Pressure (SVP) using the Tetens formula."""
    t = float(temp_c)
    # Tetens equation for saturation vapour pressure in kPa (exact e, not a rounded constant)
    return Decimal(str(0.6108 * math.exp((17.27 * t) / (t + 237.3))))

def calculate_vpd(temp_c: Decimal, rh: Decimal) -> Decimal:
    """Calculates Vapor Pressure Deficit (VPD) in kPa."""
    svp = calculate_svp(temp_c)
    rh = min(max(rh, Decimal('0')), Decimal('100'))
    # Actual Vapor Pressure
    avp = svp * (rh / Decimal('100'))
    # Return the deficit (cannot be negative)
    return max(svp - avp, Decimal('0'))

CHU_PENALTY_DAYS = Decimal('0.00125')   # days of shelf life per degree-hour above the stress temperature
REFERENCE_TEMP_C = Decimal('25')    # baseline_shelf_life applies at this temperature and at or above min_rh
VPD_WATER_LOSS = Decimal('0.63')      # extra ageing per kPa of VPD above the crop's threshold (= 0.02 per % RH at 25 C)
MIN_RATE = Decimal('0.5')           # cool storage slows ageing, but never below half speed (chilling, rots)


def calculate_stress_multiplier(temp_c: Decimal, rh: Decimal, crop_type: str) -> Decimal:
    """How many days of shelf life one real day uses up (1.0 = baseline conditions).

    Heat follows a Q10 law, rate = Q10 ** ((T - 25) / 10), with Q10 about 2-3 for fresh produce
    (respiration and decay roughly double or triple per +10 C). Cool storage slows ageing down to
    half speed, but a chilling-sensitive crop below its chilling threshold gets no benefit.
    Dry air adds water-loss stress (shrivelling). The multiplier is capped at 5x.
    """
    config = CROP_CONFIG.get(crop_type, CROP_CONFIG['EGGPLANT'])
    rate = Decimal(str(float(config['q10']) ** (float(temp_c - REFERENCE_TEMP_C) / 10)))
    if temp_c < REFERENCE_TEMP_C:
        rate = Decimal('1.0') if temp_c < config['chilling_below'] else max(rate, MIN_RATE)

    # Water loss follows the vapour-pressure deficit, not relative humidity alone: the same 80 % RH dries produce
    # far faster at 35 C than at 15 C. The threshold is the VPD of the crop's minimum RH at 25 C, and the slope
    # matches the earlier RH rule at 25 C (0.02 per % RH), so room-temperature behaviour is unchanged.
    vpd = calculate_vpd(temp_c, rh)
    excess = vpd - calculate_vpd(REFERENCE_TEMP_C, config['min_rh'])
    if excess > 0:
        rate += excess * VPD_WATER_LOSS

    return min(rate, Decimal('5.0'))

def calculate_chu_increment(temp_c: Decimal, crop_type: str) -> Decimal:
    """Cumulative Heat Units gained per hour: degree-hours above the crop's stress temperature (C·h)."""
    config = CROP_CONFIG.get(crop_type, CROP_CONFIG['EGGPLANT'])
    if temp_c > config['stress_temp']:
        return temp_c - config['stress_temp']
    return Decimal('0')

def classify_status(days_to_spoil: Decimal) -> str:
    """Maps the remaining shelf life to the UI 'Traffic Light' Dashboard status."""
    if days_to_spoil <= Decimal('0'):
        return 'RED'
    if days_to_spoil < Decimal('3'):
        return 'AMBER'
    return 'GREEN'

def freshness_percent(days_to_spoil: Decimal, baseline: Decimal) -> int:
    """Converts the remaining days into a 0-100% freshness score."""
    if baseline <= 0:
        return 0
    pct = int((days_to_spoil / baseline) * 100)
    return max(0, min(100, pct))

def predict_spoilage(
    crop_type: str,
    current_shelf_life: Decimal,
    temp_c: Decimal,
    rh: Decimal,
    chu_accumulated: Decimal = Decimal('0'),
    hours_elapsed: Decimal = Decimal('1.0'),
) -> Tuple[str, Decimal, Decimal, Decimal]:
    """
    The master function that calculates the new ETA based on the DHT22 readings.
    Returns (status, days_to_spoil, new_chu, vpd).
    """
    config = CROP_CONFIG.get(crop_type, CROP_CONFIG['EGGPLANT'])
    
    # 1. Calculate environmental metrics
    vpd = calculate_vpd(temp_c, rh)
    stress = calculate_stress_multiplier(temp_c, rh, crop_type)
    
    # 2. Update Cumulative Heat Units
    chu_delta = calculate_chu_increment(temp_c, crop_type) * hours_elapsed
    new_chu = chu_accumulated + chu_delta

    # 3. Calculate biological time lost
    life_lost = (hours_elapsed / Decimal('24')) * stress
    # CHU is a small extra penalty for sustained heat; the Q10 multiplier above already carries the main
    # temperature effect, so this term is kept light (0.00125 days per degree-hour above the stress temperature,
    # the same size as the earlier 0.0025 per half-degree-hour unit) to avoid counting heat twice.
    chu_penalty = chu_delta * CHU_PENALTY_DAYS
    
    # 4. Determine new ETA
    days_to_spoil = current_shelf_life - life_lost - chu_penalty
    days_to_spoil = max(days_to_spoil, Decimal('0'))

    # 5. Determine UI Status
    status = classify_status(days_to_spoil)
    
    return status, days_to_spoil, new_chu, vpd

def validate_sensor_reading(temp_c: float, rh: float, ethylene_ppm: float = None) -> bool:
    """
    Rejects physically impossible sensor values to protect the system 
    from hardware glitches or disconnected data lines.
    """
    if not (-10 <= temp_c <= 60):
        return False
    if not (0 <= rh <= 100):
        return False
    if ethylene_ppm is not None and not (0 <= ethylene_ppm <= 100):
        return False
    return True