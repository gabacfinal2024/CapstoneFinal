from math import sqrt

from .spoilage_engine import calculate_vpd

HIGH_HEAT_INDEX_C = 42  # PAGASA Danger and Extreme Danger categories.


def heat_index_c(temperature_c, humidity_rh):
    """NWS heat index approximation (Rothfusz regression with humidity adjustments)."""
    t = float(temperature_c) * 9 / 5 + 32
    rh = float(humidity_rh)
    index = (t + 0.5 * (t + 61 + (t - 68) * 1.2 + rh * 0.094)) / 2
    if index >= 80:
        index = (
            -42.379 + 2.04901523 * t + 10.14333127 * rh - 0.22475541 * t * rh
            - 0.00683783 * t**2 - 0.05481717 * rh**2 + 0.00122874 * t**2 * rh
            + 0.00085282 * t * rh**2 - 0.00000199 * t**2 * rh**2
        )
        if rh < 13 and 80 <= t <= 112:
            index -= (13 - rh) / 4 * sqrt((17 - abs(t - 95)) / 17)
        elif rh > 85 and 80 <= t <= 87:
            index += (rh - 85) / 10 * (87 - t) / 5
    return (index - 32) * 5 / 9


def daily_sensor_report(readings, tz, detailed):
    rows = []
    high_hours = set()
    for reading in readings:
        local_time = reading.created_at.astimezone(tz)
        if heat_index_c(reading.temperature_c, reading.humidity_rh) >= HIGH_HEAT_INDEX_C:
            high_hours.add(local_time.strftime('%H:00'))
        row = {'time': local_time.strftime('%H:%M:%S'), 'temperature_c': float(reading.temperature_c)}
        if detailed:
            row['humidity_rh'] = float(reading.humidity_rh)
            vpd = reading.vpd_kpa
            if vpd is None:
                vpd = round(calculate_vpd(reading.temperature_c, reading.humidity_rh), 4)
            row['vpd_kpa'] = float(vpd)
        rows.append(row)
    return {
        'readings': rows,
        'high_heat_index_hours': sorted(high_hours),
        'heat_index_threshold_c': HIGH_HEAT_INDEX_C,
    }
