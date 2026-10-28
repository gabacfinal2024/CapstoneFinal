"""The spoilage engine's temperature law: Q10-style ageing (about 2-3x per +10 C), not a steeper made-up slope."""
from decimal import Decimal as D

from django.test import SimpleTestCase

from .spoilage_engine import calculate_stress_multiplier, predict_spoilage


def rate(crop, t, rh=95):
    return float(calculate_stress_multiplier(D(str(t)), D(str(rh)), crop))


class StressMultiplierTests(SimpleTestCase):
    def test_baseline_at_25c(self):
        for crop in ('EGGPLANT', 'CUCUMBER', 'CARROT'):
            self.assertAlmostEqual(rate(crop, 25), 1.0, places=2)

    def test_heat_follows_q10(self):
        self.assertAlmostEqual(rate('EGGPLANT', 35), 2.5, delta=0.05)     # Q10 2.5
        self.assertAlmostEqual(rate('CARROT', 35), 2.2, delta=0.05)       # Q10 2.2 (storage organ)
        self.assertAlmostEqual(rate('CUCUMBER', 30), 2.5 ** 0.5, delta=0.05)

    def test_never_steeper_than_q10_three(self):
        for t in range(26, 41):
            self.assertLessEqual(rate('EGGPLANT', t), 3.0 ** ((t - 25) / 10) + 0.01)

    def test_cool_storage_slows_ageing_but_not_below_half(self):
        self.assertAlmostEqual(rate('EGGPLANT', 20), 2.5 ** -0.5, delta=0.05)
        self.assertGreaterEqual(rate('CARROT', 2), 0.5)

    def test_chilling_sensitive_crops_get_no_benefit_from_the_cold(self):
        self.assertEqual(rate('EGGPLANT', 5), 1.0)
        self.assertEqual(rate('CUCUMBER', 8), 1.0)
        self.assertLess(rate('CARROT', 5), 1.0)

    def test_dry_air_adds_water_loss_stress(self):
        self.assertGreater(rate('EGGPLANT', 25, rh=70), rate('EGGPLANT', 25, rh=95))

    def test_capped_at_5x(self):
        self.assertEqual(rate('EGGPLANT', 60, rh=10), 5.0)


class PredictSpoilageTests(SimpleTestCase):
    def test_one_day_at_baseline_costs_one_day(self):
        status, days, _chu, _vpd = predict_spoilage('EGGPLANT', D('5'), D('25'), D('95'), hours_elapsed=D('24'))
        self.assertEqual(days, D('4.0'))

    def test_a_hot_day_costs_about_q10_days(self):
        _status, days, *_ = predict_spoilage('EGGPLANT', D('5'), D('35'), D('95'), hours_elapsed=D('24'))
        lost = 5 - float(days)
        self.assertGreater(lost, 2.4)
        self.assertLess(lost, 3.2)          # Q10 2.5 gives 2.5; the small CHU term adds a little

    def test_chu_is_not_counted_again_when_passed_in(self):
        a = predict_spoilage('EGGPLANT', D('5'), D('35'), D('95'), chu_accumulated=D('0'), hours_elapsed=D('1'))[1]
        b = predict_spoilage('EGGPLANT', D('5'), D('35'), D('95'), chu_accumulated=D('500'), hours_elapsed=D('1'))[1]
        self.assertEqual(a, b)


class VpdAndChuTests(SimpleTestCase):
    def test_vpd_matches_the_textbook_values(self):
        from .spoilage_engine import calculate_vpd
        self.assertAlmostEqual(float(calculate_vpd(D('25'), D('60'))), 1.267, delta=0.01)    # 25 C, 60 % RH
        self.assertAlmostEqual(float(calculate_vpd(D('35'), D('50'))), 2.81, delta=0.02)
        self.assertEqual(calculate_vpd(D('30'), D('100')), D('0'))
        self.assertEqual(calculate_vpd(D('30'), D('120')), D('0'))        # humidity is clamped to 100 %

    def test_dryness_is_judged_by_vpd_so_the_same_rh_is_worse_when_hot(self):
        self.assertAlmostEqual(rate('EGGPLANT', 25, rh=75), 1.2, delta=0.02)       # same as the old 0.02 per % RH at 25 C
        hot = rate('EGGPLANT', 25, rh=80) - 1.0
        very_hot_extra = rate('EGGPLANT', 35, rh=80) / (2.5 ** 1.0)               # Q10 part removed
        self.assertGreater(very_hot_extra, 1.0)                                    # extra water loss on top of heat
        self.assertGreater(rate('EGGPLANT', 25, rh=80), 1.0)
        cool = rate('EGGPLANT', 15, rh=80)
        self.assertLess(cool, rate('EGGPLANT', 25, rh=80))                         # cool air at 80 % RH barely dries produce
        self.assertEqual(hot > 0, True)

    def test_chu_is_degree_hours_above_the_stress_temperature(self):
        from .spoilage_engine import calculate_chu_increment
        self.assertEqual(calculate_chu_increment(D('35'), 'EGGPLANT'), D('10'))      # 10 C above 25 C for one hour
        self.assertEqual(calculate_chu_increment(D('25'), 'EGGPLANT'), D('0'))
        self.assertEqual(calculate_chu_increment(D('18'), 'CARROT'), D('0'))
        chu = predict_spoilage('EGGPLANT', D('5'), D('35'), D('95'), chu_accumulated=D('20'), hours_elapsed=D('3'))[2]
        self.assertEqual(chu, D('50'))                                               # 20 + 10 C × 3 h


class EvidenceTests(SimpleTestCase):
    """The engine is held to the published ambient shelf-life measurements (evidence.py)."""

    def check(self, eid):
        from .evidence import EVIDENCE, engine_check
        return engine_check(next(e for e in EVIDENCE if e['id'] == eid))

    def test_eggplant_in_a_dry_room_matches_the_indian_trial(self):
        r = self.check('E1')                                  # 22-24 C, 52-54 % RH: 3-4 days observed
        self.assertTrue(3.0 <= r['predicted_days'] <= 4.0, r)

    def test_cucumber_at_29_33c_matches_the_two_day_observation(self):
        r = self.check('E4')                                  # 29-33 C, 65-70 % RH: 2 days observed
        self.assertAlmostEqual(r['predicted_days'], 2.0, delta=0.7)

    def test_cucumber_at_24c_is_not_more_optimistic_than_the_marketable_limit(self):
        self.assertLessEqual(self.check('E5')['predicted_days'], 6.0)

    def test_carrot_is_within_a_quarter_of_the_shortest_observed_shelf_life(self):
        r = self.check('E6')                                  # 7.08-12.14 days observed at room temperature
        self.assertGreaterEqual(r['predicted_days'], 7.08 * 0.75)
        self.assertLessEqual(r['predicted_days'], 12.14)

    def test_humid_air_extends_shelf_life_in_the_direction_the_philippine_study_reports(self):
        r = self.check('E3')
        self.assertGreater(r['predicted_extension_days'], 0.5)    # smaller than the reported 3.1-3.4 days, same direction

    def test_no_study_finds_the_engine_optimistic(self):
        from .evidence import EVIDENCE, engine_check
        for e in EVIDENCE:
            self.assertNotIn('optimistic', engine_check(e)['verdict'], e['id'])
