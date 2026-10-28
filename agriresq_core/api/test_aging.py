"""Time-based aging: a listed batch gets older with the clock, even with no camera and no sensor.

Supabase is mocked; nothing here needs the network or the CNN."""
from datetime import timedelta
from decimal import Decimal
from unittest import mock

from django.test import TestCase, override_settings
from django.utils import timezone

from . import device_services
from .models import BatchClock, Device, DeviceReading


def product(**kw):
    base = {'id': 7, 'operator_id': 'op-1', 'crop_type': 'EGGPLANT', 'freshness_status': 'GREEN',
            'predicted_shelf_life': 4.0, 'is_listed': True, 'base_price_per_kg': 50, 'quantity_kg': 10}
    base.update(kw)
    return base


@override_settings(ASSUMED_STALL_TEMP_C=25, ASSUMED_STALL_RH=95)     # baseline conditions: one day costs one day
class AgeByTimeTests(TestCase):
    def run_aging(self, prod, hours, **kw):
        """Run one aging pass `hours` after the batch's clock was last written."""
        now = timezone.now()
        BatchClock.objects.update_or_create(product_id=prod['id'], defaults={'last_tick': now - timedelta(hours=hours)})
        with mock.patch.object(device_services, 'has_service_key', return_value=True), \
                mock.patch.object(device_services, 'supabase_select', return_value=[prod]), \
                mock.patch.object(device_services, '_apply') as apply:
            written = device_services.age_by_time(now)
        return written, apply

    def test_does_nothing_without_the_service_key(self):
        with mock.patch.object(device_services, 'has_service_key', return_value=False), \
                mock.patch.object(device_services, 'supabase_select') as select:
            self.assertEqual(device_services.age_by_time(), 0)
            select.assert_not_called()

    def test_first_sight_only_starts_the_clock(self):
        with mock.patch.object(device_services, 'has_service_key', return_value=True), \
                mock.patch.object(device_services, 'supabase_select', return_value=[product()]), \
                mock.patch.object(device_services, '_apply') as apply:
            self.assertEqual(device_services.age_by_time(), 0)
        apply.assert_not_called()
        self.assertTrue(BatchClock.objects.filter(product_id=7).exists())

    def test_less_than_an_hour_is_not_written(self):
        written, apply = self.run_aging(product(), 0.5)
        self.assertEqual(written, 0)
        apply.assert_not_called()

    def test_one_day_costs_one_day(self):
        written, apply = self.run_aging(product(predicted_shelf_life=4.0), 24)
        self.assertEqual(written, 1)
        args = apply.call_args.args           # (owner, product, status, days, percent, source)
        self.assertEqual(args[3], Decimal('3.00'))
        self.assertEqual(args[2], 'GREEN')
        self.assertEqual(args[5], 'TIME')
        self.assertEqual(args[0].operator_id, 'op-1')

    def test_crossing_three_days_turns_amber_so_the_price_drops(self):
        written, apply = self.run_aging(product(predicted_shelf_life=3.5), 24)
        self.assertEqual(apply.call_args.args[2], 'AMBER')     # 2.5 days left

    def test_running_out_turns_red(self):
        written, apply = self.run_aging(product(predicted_shelf_life=0.5, freshness_status='AMBER'), 48)
        args = apply.call_args.args
        self.assertEqual((args[2], args[3]), ('RED', Decimal('0.00')))

    def test_rotten_and_unknown_crops_are_skipped(self):
        for p in (product(freshness_status='RED'), product(crop_type='MANGO')):
            written, apply = self.run_aging(p, 24)
            self.assertEqual(written, 0)

    def test_long_outage_is_capped_at_three_days(self):
        written, apply = self.run_aging(product(predicted_shelf_life=6.0), 24 * 10)
        self.assertEqual(apply.call_args.args[3], Decimal('3.00'))

    def test_measured_conditions_replace_the_assumed_ones(self):
        # the setting says a comfortable 25 C, but the stall's DHT22 reads 38 C: the batch ages with the 38 C
        dev = Device.objects.create(operator_id='op-1', name='Sensors', kind='SENSOR', dht_pin=4)
        for _ in range(3):
            DeviceReading.objects.create(device=dev, temperature_c=Decimal('38'), humidity_rh=Decimal('95'))
        _, hot = self.run_aging(product(predicted_shelf_life=4.0), 24)
        self.assertLess(hot.call_args.args[3], Decimal('1.5'))      # 4 days minus about 2.5x a day at 38 C

    def test_a_sensor_node_ages_every_batch_at_the_stall(self):
        dev = Device.objects.create(operator_id='op-1', name='Sensors', kind='SENSOR', dht_pin=4)
        for _ in range(3):
            DeviceReading.objects.create(device=dev, temperature_c=Decimal('34'), humidity_rh=Decimal('70'))
        now = timezone.now()
        eggplant, cucumber = product(id=7), product(id=8, crop_type='CUCUMBER')
        idle = product(id=9, is_listed=False)                     # not listed, no device linked: left alone
        for p in (eggplant, cucumber, idle):
            BatchClock.objects.update_or_create(product_id=p['id'], defaults={'last_tick': now - timedelta(hours=2)})
        with mock.patch.object(device_services, 'has_service_key', return_value=True),                 mock.patch.object(device_services, 'supabase_select', return_value=[eggplant, cucumber, idle]),                 mock.patch.object(device_services, '_apply') as apply:
            written = device_services.age_operator_batches('op-1', now, force=True)
        self.assertEqual(written, 2)
        self.assertEqual({c.args[1]['id'] for c in apply.call_args_list}, {7, 8})
        for c in apply.call_args_list:
            self.assertLess(c.args[3], Decimal(str(c.args[1]['predicted_shelf_life'])))

    def test_a_batch_linked_to_a_camera_ages_even_when_not_listed(self):
        Device.objects.create(operator_id='op-1', name='Sensors', kind='SENSOR', dht_pin=4)
        DeviceReading.objects.create(device=Device.objects.get(), temperature_c=Decimal('34'), humidity_rh=Decimal('70'))
        Device.objects.create(operator_id='op-1', name='Cam', product_id=9, mac='AA:BB:CC:DD:EE:99', device_token='t9')
        now = timezone.now()
        p = product(id=9, is_listed=False)
        BatchClock.objects.update_or_create(product_id=9, defaults={'last_tick': now - timedelta(hours=2)})
        with mock.patch.object(device_services, 'has_service_key', return_value=True),                 mock.patch.object(device_services, 'supabase_select', return_value=[p]),                 mock.patch.object(device_services, '_apply') as apply:
            self.assertEqual(device_services.age_operator_batches('op-1', now, force=True), 1)
        self.assertEqual(apply.call_args.args[5], 'RULE_ENGINE')

    def test_readings_are_throttled_to_one_stall_pass_a_minute(self):
        from django.core.cache import cache
        cache.clear()
        dev = Device.objects.create(operator_id='op-1', name='Sensors', kind='SENSOR', dht_pin=4)
        DeviceReading.objects.create(device=dev, temperature_c=Decimal('34'), humidity_rh=Decimal('70'))
        with mock.patch.object(device_services, 'has_service_key', return_value=True),                 mock.patch.object(device_services, 'supabase_select', return_value=[]) as select:
            device_services.age_operator_batches('op-1')
            device_services.age_operator_batches('op-1')
        self.assertEqual(select.call_count, 1)

    def test_no_recent_reading_means_no_sensor_pass(self):
        with mock.patch.object(device_services, 'has_service_key', return_value=True),                 mock.patch.object(device_services, 'supabase_select') as select:
            self.assertEqual(device_services.age_operator_batches('op-1', force=True), 0)
        select.assert_not_called()

    @override_settings(ASSUMED_STALL_TEMP_C=35, ASSUMED_STALL_RH=95)
    def test_a_hot_stall_ages_faster_than_the_clock(self):
        written, apply = self.run_aging(product(predicted_shelf_life=4.0), 24)
        self.assertLess(apply.call_args.args[3], Decimal('2.0'))      # 35 C is about 2.5x: 4 - ~2.8 days

    @override_settings(ASSUMED_STALL_TEMP_C=15, ASSUMED_STALL_RH=95)
    def test_a_cool_stall_ages_slower_than_the_clock(self):
        written, apply = self.run_aging(product(predicted_shelf_life=4.0), 24)
        self.assertGreater(apply.call_args.args[3], Decimal('3.0'))   # 15 C is about 0.4x: 4 - ~0.4 days


@override_settings(ASSUMED_STALL_TEMP_C=25, ASSUMED_STALL_RH=95)
class PairingTests(TestCase):
    def test_heat_units_accumulate_per_batch_and_reach_the_history_row(self):
        now = timezone.now()
        BatchClock.objects.create(product_id=7, last_tick=now - timedelta(hours=2), chu_accumulated=Decimal('12'))
        with mock.patch.object(device_services, '_apply') as apply:
            device_services._age_product(product(), Decimal('35'), Decimal('95'), now, timedelta(minutes=10), 'RULE_ENGINE', 'x')
        self.assertEqual(apply.call_args.kwargs['chu'], Decimal('32.000'))        # 12 + 10 C x 2 h
        self.assertGreater(apply.call_args.kwargs['vpd'], 0)
        self.assertEqual(BatchClock.objects.get(product_id=7).chu_accumulated, Decimal('32.000'))

    def test_every_listing_gets_the_reading_and_a_history_row(self):
        from django.core.cache import cache
        cache.clear()
        now = timezone.now()
        BatchClock.objects.create(product_id=7, last_tick=now, chu_accumulated=Decimal('40'))
        with mock.patch.object(device_services, 'supabase_upsert') as upsert,                 mock.patch.object(device_services, 'supabase_insert') as ins:
            device_services._columns_missing = False
            device_services.pair_readings([product(id=7), product(id=8)], Decimal('31.6'), Decimal('70.6'), now)
            device_services.pair_readings([product(id=7), product(id=8)], Decimal('31.7'), Decimal('70.5'), now)
        first, second = upsert.call_args_list[0], upsert.call_args_list[1]
        self.assertEqual(first.args[0], 'product_climate')                  # not on the buyer-readable products row
        self.assertEqual((first.args[1]['product_id'], second.args[1]['product_id']), (7, 8))
        self.assertEqual(first.kwargs['on_conflict'], 'product_id')
        row = first.args[1]
        self.assertEqual((row['latest_temp_c'], row['latest_humidity_rh'], row['chu_accumulated']), (31.6, 70.6, 40.0))
        self.assertAlmostEqual(row['latest_vpd_kpa'], 1.4, delta=0.1)
        self.assertEqual(ins.call_count, 2)            # history rows are throttled: the second pass added none

    def test_missing_sensor_columns_do_not_break_aging(self):
        import io
        import urllib.error
        err = urllib.error.HTTPError('u', 400, 'Bad Request', {}, io.BytesIO(b'{}'))
        with mock.patch.object(device_services, 'supabase_upsert', side_effect=err) as upd, \
                mock.patch.object(device_services, 'supabase_insert'):
            device_services._columns_missing = False
            device_services.pair_readings([product(id=7)], Decimal('30'), Decimal('70'), timezone.now())
            device_services.pair_readings([product(id=7)], Decimal('30'), Decimal('70'), timezone.now())
            self.assertEqual(upd.call_count, 1)        # remembered: the missing table is not retried every minute
        device_services._columns_missing = False
