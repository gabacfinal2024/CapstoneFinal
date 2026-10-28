# Basis of days-to-spoil, VPD and CHU

How the system turns a DHT22 reading into "days left", and the published measurements it is checked against.
The same tables are served by `GET /api/reference/shelf-life/` (web page *Days-to-Spoil Basis*, mobile *How days-to-spoil
is calculated*) and enforced by `agriresq_core/api/test_engine.py` (`EvidenceTests`). Source of truth:
`agriresq_core/api/evidence.py` and `agriresq_core/api/spoilage_engine.py`.

## The calculation

For every batch, every few minutes, the stall's DHT22 average (all sensor nodes and cameras of that operator) is applied
for the hours that passed since the batch was last updated:

```
rate        = Q10 ^ ((T - 25) / 10)                 cool air: never below 0.5x, no benefit under the chilling limit
            + 0.63 * max(0, VPD - VPD_threshold)     water loss, per kPa of vapour-pressure deficit
            (capped at 5x)
VPD (kPa)   = 0.6108 * exp(17.27 T / (T + 237.3)) * (1 - RH/100)          Tetens equation
CHU         = degree-hours above 25 C, accumulated per batch
days left  -= hours/24 * rate  +  0.00125 * CHU gained in those hours
```

`VPD_threshold` is the VPD of the crop's minimum humidity at 25 C, so at 25 C the water-loss term equals the earlier
0.02-per-% RH rule. Status: Fresh at 3 days or more, At-Risk below 3 days (price -30 %), Rotten at 0.
Without a DHT22 reading in the last 3 hours the assumed market climate (29 C, 80 % RH) is used.

| Crop | Baseline at 25 C | Q10 | Minimum RH | Chilling limit |
|---|---|---|---|---|
| Eggplant | 5 days | 2.5 | 85 % | 10 C |
| Cucumber | 4 days | 2.5 | 85 % | 10 C |
| Carrot | 7 days | 2.2 | 75 % (was 90 %) | none |

## Published ambient measurements (whole produce, hot countries)

| # | Crop | Where | Conditions | Observed | Engine | Source (access) |
|---|---|---|---|---|---|---|
| E1 | Eggplant | India (Varanasi) | 22-24 C, 52-54 % RH | 3-4 days | 3.7 days | Singh, Singh & Alam 2019, J Food Sci Technol 56(11):4826-4833 ([PMC6828886](https://pmc.ncbi.nlm.nih.gov/articles/PMC6828886/)), full text |
| E2 | Eggplant | India (Tamil Nadu) | room temperature, not stated | "hardly three days" | n/a | Ganesan et al. 2004, J Indian Inst Sci 84(3&4) ([link](https://journal.iisc.ac.in/index.php/iisc/article/view/2203)), abstract only |
| E3 | Eggplant | Philippines | ambient 26.4 C / 76 % vs evaporative cooler 25.8 C / 98 % | cooler adds 3.1-3.4 days | adds 1.0 day | 'Banate King' and 'Senorita' trial ([ResearchGate](https://www.researchgate.net/publication/359864096)), abstract only; authors/journal to confirm |
| E4 | Cucumber | India (Ludhiana) | 29-33 C, 65-70 % RH | 2 days unwrapped (9 days at 12 C) | 1.6 days | Dhall, Sharma & Mahajan 2012, J Food Sci Technol 49(4):495-499 ([PMC3550898](https://pmc.ncbi.nlm.nih.gov/articles/PMC3550898/)), full text |
| E5 | Cucumber | India (Ludhiana) | 23-26 C, 63-66 % RH | below marketable by day 6 | 3.0 days | Manjunatha & Anurag 2014, J Food Sci Technol 51(11):3470-3475 ([PMC4571236](https://pmc.ncbi.nlm.nih.gov/articles/PMC4571236/)), full text |
| E6 | Carrot | Bangladesh (Mymensingh) | room temperature (not reported; 25 C / 65 % assumed) | 7.08-12.14 days edible | 5.8 days | Anjum et al. 2025, Res Agric Livest Fish 12(1):121-135 ([BanglaJOL](https://www.banglajol.info/index.php/RALF/article/view/81425)), full text |
| E7 | Carrot | Pakistan (Sindh) | 27.5-32.4 C (mean 29.45), 52-69 % RH | 57 % weight loss and 72 % fungal incidence by day 15 | 3.4 days | Mirani et al. 2022, RADS J Biol Res Appl Sci 13(2):168-174, full text |

## What this does and does not show

* Eggplant (E1, E2) and cucumber (E4, E5) are reproduced within the observed ranges.
* The Philippine trial (E3) agrees on direction: humid air lengthens shelf life. The engine's gain (1.0 day) is smaller than
  the reported 3.1-3.4 days, partly because evaporative cooling also lowers the fruit's own temperature.
* Carrot is **conservative**: the engine predicts 5.8 days against 7.1-12.1 observed. It warns operators earlier than the
  data requires. The dryness threshold was relaxed from 90 % to 75 % because of E6; more carrot data would allow tuning.
* The studies use different cultivars, handling and end-points ("edible", "marketable", "shelf life") than a market stall,
  none measured a Philippine stall directly, and the Q10 values are typical rather than measured for these cultivars (one
  secondary citation gives cucumber Q10 4.4 between 10-20 C and 1.9 between 20-30 C; not verified against the original).
* Next step: log when stall batches actually spoil (the system already stores status changes with temperature, humidity,
  VPD and CHU) and refit baselines and Q10 from those records.
