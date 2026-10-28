"""Published shelf-life measurements that the days-to-spoil engine is checked against.

Each entry is a real study of whole eggplant, cucumber or carrot kept at ambient (room) temperature in a tropical
or hot country. Only numbers that were read in the paper itself (or its abstract) are listed, together with how much
of the paper was available (`access`). `engine_check()` runs the engine at the study's conditions and compares:

    shelf-life days = baseline shelf life at 25 C  /  days of shelf life one real day uses up
                      (Q10 temperature law + vapour-pressure-deficit water loss + heat-unit term)

The same table is served to the apps (GET /api/reference/shelf-life/) and enforced by tests, so the engine cannot
drift away from the evidence unnoticed. Field validation with the system's own spoilage records is still needed:
these studies use different cultivars, handling and end-points ('edible', 'marketable') than a market stall.
"""
from decimal import Decimal as D

from .spoilage_engine import (CHU_PENALTY_DAYS, CROP_CONFIG, REFERENCE_TEMP_C, VPD_WATER_LOSS, calculate_chu_increment,
                              calculate_stress_multiplier, calculate_vpd, predict_spoilage)

EVIDENCE = [
    {
        'id': 'E1', 'crop': 'EGGPLANT', 'country': 'India', 'place': 'Varanasi (IIVR)',
        'citation': 'Singh S, Singh B, Alam T (2019). Evaluation of shelf-life, antioxidant activity and nutritional quality '
                    'attributes in carnauba wax coated eggplant genotypes. J Food Sci Technol 56(11):4826-4833.',
        'url': 'https://pmc.ncbi.nlm.nih.gov/articles/PMC6828886/', 'access': 'full text',
        'conditions': {'temp_c': 23.0, 'rh': 53.0, 'text': '22-24 C, 52-54 % RH (abstract says 20 +/- 2 C)'},
        'kind': 'range', 'observed_days': [3.0, 4.0],
        'observed': 'Untreated (control) fruit lasted 3-4 days at ambient; weight loss of controls 2.9-6.8 % on day 1 and '
                    '10.6-22.3 % by day 4 depending on genotype.',
    },
    {
        'id': 'E2', 'crop': 'EGGPLANT', 'country': 'India', 'place': 'Tamil Nadu (zero-energy cool chamber trial)',
        'citation': 'Ganesan M, Balasubramanian K, Bhavani RV (2004). Effect of water on the shelf-life of brinjal in a '
                    'zero-energy cool chamber. J Indian Inst Sci 84(3&4).',
        'url': 'https://journal.iisc.ac.in/index.php/iisc/article/view/2203', 'access': 'abstract only',
        'conditions': {'temp_c': None, 'rh': None, 'text': 'room temperature (values not given in the abstract)'},
        'kind': 'range', 'observed_days': [2.5, 3.5],
        'observed': 'Shelf life at room temperature was "hardly three days"; 9 days in the chamber with 100 L water/day.',
    },
    {
        'id': 'E3', 'crop': 'EGGPLANT', 'country': 'Philippines', 'place': 'Southern Philippines',
        'citation': "Postharvest quality of two eggplant (Solanum melongena L.) cultivars ('Banate King', 'Senorita') as "
                    'influenced by storage in ambient and evaporative cooling conditions (2021-22).',
        'url': 'https://www.researchgate.net/publication/359864096', 'access': 'abstract only (authors and journal to be '
                                                                           'confirmed from the full paper)',
        'conditions': {'temp_c': 26.4, 'rh': 76.0, 'text': 'ambient about 26.4 C / 76 % RH; evaporative cooler about '
                                                          '25.8 C / 98 % RH'},
        'kind': 'extension', 'cool': {'temp_c': 25.8, 'rh': 98.0}, 'observed_extension_days': [3.1, 3.4],
        'observed': 'Evaporative cooling (higher humidity, similar temperature) extended shelf life by 3.1 days '
                    "('Banate King') and 3.4 days ('Senorita') with less shrivelling and weight loss.",
    },
    {
        'id': 'E4', 'crop': 'CUCUMBER', 'country': 'India', 'place': 'Ludhiana (PAU)',
        'citation': "Dhall RK, Sharma SR, Mahajan BVC (2012). Effect of shrink wrap packaging for maintaining quality of "
                    "cucumber during storage. J Food Sci Technol 49(4):495-499. Variety 'Padmini'.",
        'url': 'https://pmc.ncbi.nlm.nih.gov/articles/PMC3550898/', 'access': 'full text',
        'conditions': {'temp_c': 31.0, 'rh': 67.5, 'text': '29-33 C, 65-70 % RH'},
        'kind': 'range', 'observed_days': [2.0, 2.0],
        'observed': 'Unwrapped fruit: 2 days at ambient (10.5 % weight loss after 4 days; firmness 1305 -> 766 g force); '
                    '9 days unwrapped at 12 C and 90-95 % RH.',
    },
    {
        'id': 'E5', 'crop': 'CUCUMBER', 'country': 'India', 'place': 'Ludhiana',
        'citation': "Manjunatha M, Anurag RK (2014). Effect of modified atmosphere packaging and storage conditions on "
                    "quality characteristics of cucumber. J Food Sci Technol 51(11):3470-3475. Variety 'Pusa Uday'.",
        'url': 'https://pmc.ncbi.nlm.nih.gov/articles/PMC4571236/', 'access': 'full text',
        'conditions': {'temp_c': 24.5, 'rh': 64.5, 'text': '23-26 C, 63-66 % RH'},
        'kind': 'upper_bound', 'observed_days': [None, 6.0],
        'observed': 'Unsealed fruit scored below the marketable limit by day 6 at ambient (about 12.9 % weight loss by '
                    'day 12); perforated MAP packs lasted 6 days at ambient and 12 days at 4 C.',
    },
    {
        'id': 'E6', 'crop': 'CARROT', 'country': 'Bangladesh', 'place': 'Mymensingh (BAU), February-March',
        'citation': 'Anjum N, Rashid MHA, Rabbani MG, Tuz-Zahura MF (2025). Postharvest quality and shelf-life performance of '
                    'nineteen carrot genotypes. Res Agric Livest Fish 12(1):121-135.',
        'url': 'https://www.banglajol.info/index.php/RALF/article/view/81425', 'access': 'full text',
        'conditions': {'temp_c': 25.0, 'rh': 65.0, 'text': 'room temperature in the postharvest laboratory '
                                                           '(temperature and RH not reported; 25 C / 65 % RH assumed here)'},
        'kind': 'range', 'observed_days': [7.08, 12.14],
        'observed': 'Days until the roots were no longer edible: 7.08 (Orange HYV) to 12.14 (Kuroda 35) across 19 '
                    'genotypes; no disease in the first 6 days; weight loss 14.2-42.3 %.',
    },
    {
        'id': 'E7', 'crop': 'CARROT', 'country': 'Pakistan', 'place': 'Tandojam, Sindh',
        'citation': 'Mirani BN, Chattha SH, Soomro SA, et al. (2022). Effect of post-harvest treatments on quality '
                    'characteristics of carrots during storage. RADS J Biol Res Appl Sci 13(2):168-174.',
        'url': 'https://pdfs.semanticscholar.org/01ea/d19181afe279f7e8c1bc4b37fb50a1bbe3b0.pdf', 'access': 'full text',
        'conditions': {'temp_c': 29.45, 'rh': 60.5, 'text': '27.5-32.4 C (mean 29.45 C), 52.4-68.5 % RH'},
        'kind': 'qualitative', 'spoiled_before_days': 15.0,
        'observed': 'Untreated carrots after 15 days at ambient: weight loss 57.4 %, fungal incidence 71.5 % (0 % at the '
                    'start), firmness 4.96 -> 3.41 lb. Day-by-day values are in figures only.',
    },
]

# Parameters of the engine and where each comes from (honest about what is measured and what is assumed).
PARAMETER_BASIS = [
    {'parameter': 'Baseline shelf life at 25 C (eggplant 5 d, cucumber 4 d, carrot 7 d)',
     'basis': 'Chosen to sit at or just above the ambient measurements E1-E6 after correcting them to 25 C and good humidity; '
              'carrot sits at the low end of the Bangladesh range (7.08-12.14 d), so it warns early.'},
    {'parameter': 'Temperature law: rate = Q10 ^ ((T - 25) / 10), Q10 2.5 eggplant and cucumber, 2.2 carrot',
     'basis': 'Typical fresh-produce range 2-3. A secondary citation reports cucumber Q10 4.4 between 10 and 20 C and 1.9 between '
              '20 and 30 C (not verified against the original). Not measured for these cultivars.'},
    {'parameter': 'Water loss follows VPD above the crop threshold (0.63 per kPa; threshold = VPD at 25 C and the crop minimum RH)',
     'basis': 'Water loss is driven by vapour-pressure deficit. At 25 C it equals the earlier 0.02-per-%-RH rule. Fitted so the '
              'engine reproduces the dry-room results E1 and E4.'},
    {'parameter': 'CHU = degree-hours above 25 C; 0.00125 days of shelf life per degree-hour',
     'basis': 'A small extra heat penalty; the Q10 term carries most of the temperature effect. Heat accumulates per batch.'},
    {'parameter': 'Carrot minimum RH 75 % (was 90 %)',
     'basis': 'E6: carrots stayed edible 7-12 days at room temperature despite 14-42 % weight loss, so a 90 % threshold was too '
              'strict for roots. Remains conservative (see the check below).'},
    {'parameter': 'Status: At-Risk below 3 days left, Rotten at 0',
     'basis': 'System design (pricing steps), not from a study.'},
]


def shelf_life_days(crop, temp_c, rh):
    """Days from fresh until a batch is spoiled at constant conditions, from the engine itself."""
    base = CROP_CONFIG[crop]['baseline_shelf_life']
    days_left = predict_spoilage(crop, base, D(str(temp_c)), D(str(rh)), hours_elapsed=D('24'))[1]
    lost_per_day = base - days_left
    return float(base / lost_per_day) if lost_per_day > 0 else float('inf')


def engine_check(entry):
    """Compare the engine with one study. Returns the entry plus predicted days and a verdict."""
    out = dict(entry)
    c = entry['conditions']
    crop = entry['crop']
    if c.get('temp_c') is None:
        out.update(predicted_days=None, verdict='no conditions reported')
        return out
    p = shelf_life_days(crop, c['temp_c'], c['rh'])
    out['predicted_days'] = round(p, 2)
    kind = entry['kind']
    if kind == 'range':
        lo, hi = entry['observed_days']
        if lo * 0.75 <= p <= hi * 1.25:
            out['verdict'] = 'consistent'
        elif p < lo * 0.75:
            out['verdict'] = 'conservative (engine warns earlier than observed)'
        else:
            out['verdict'] = 'optimistic (engine lasts longer than observed)'
    elif kind == 'upper_bound':
        out['verdict'] = 'consistent' if p <= entry['observed_days'][1] else 'optimistic (engine lasts longer than observed)'
    elif kind == 'qualitative':
        out['verdict'] = ('consistent' if p < entry['spoiled_before_days']
                          else 'optimistic (engine lasts longer than observed)')
    elif kind == 'extension':
        cool = shelf_life_days(crop, entry['cool']['temp_c'], entry['cool']['rh'])
        out['predicted_extension_days'] = round(cool - p, 2)
        lo, hi = entry['observed_extension_days']
        out['verdict'] = ('consistent' if cool - p >= lo * 0.75 else
                          'right direction, smaller than observed (cooling also lowers fruit temperature)')
    return out


def engine_parameters():
    cfg = {}
    for crop, c in CROP_CONFIG.items():
        cfg[crop] = {'baseline_days_at_25c': float(c['baseline_shelf_life']), 'q10': float(c['q10']),
                     'min_rh': float(c['min_rh']), 'chilling_below_c': float(c['chilling_below']),
                     'vpd_threshold_kpa': float(round(calculate_vpd(REFERENCE_TEMP_C, c['min_rh']), 3))}
    return {'crops': cfg, 'vpd_water_loss_per_kpa': float(VPD_WATER_LOSS), 'chu_penalty_days_per_degree_hour': float(CHU_PENALTY_DAYS),
            'reference_temp_c': float(REFERENCE_TEMP_C), 'max_rate': 5.0, 'min_rate': 0.5}


def reference_payload():
    return {'studies': [engine_check(e) for e in EVIDENCE], 'parameters': PARAMETER_BASIS, 'engine': engine_parameters(),
            'limits': 'Studies use different cultivars, handling and end-points than a market stall and none measured a '
                      'Philippine stall directly. Validate with the system\'s own spoilage records.'}
