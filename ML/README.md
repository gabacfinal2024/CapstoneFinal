# AgriResQ – ML Freshness Classifier

> **In this repo:** the backend loads `ML/deploy/` (ONNX model + `predict.py`). Figures for the paper are in `ML/results/`.
> The training dataset (7,116 images) and training runs live outside the repo in `Desktop/Dominic's_Files/ml/` (`dataset/`, `runs/`, `.venv`); run the `tools/` scripts from there.

A CNN that classifies an ESP32-CAM snapshot into 10 outputs: {cucumber, carrot, eggplant} × {fresh, at-risk, rotten} **plus `none`**
("not one of our vegetables"). The model runs in the Django backend (ONNX). The ESP32-CAM only captures the image and POSTs it.

## Current model (v3 open-set, 2026-10-27)
Why: the v2 nine-class model gave a verdict for 100% of non-vegetable images (85.3% with confidence ≥ 0.5), so the camera "always read something".
v3 adds the `none` class (2,427 images: other vegetables/fruit, leaves, objects, textures, walls, synthetic empty scenes, real empty ESP32-CAM frames)
and a decision rule: detected when P(none) < 0.20 and the crop probability ≥ 0.30 (thresholds chosen on validation only, in `deploy/model_config.json`).

| Test split (n = 1,183: 564 vegetables, 619 non-vegetables) | |
|---|---|
| Target vegetables accepted | **99.3%** |
| Non-vegetables rejected, categories seen in training (n = 258) | **99.2%** |
| Non-vegetables rejected, categories never seen: mango, strawberry, cauliflower, okra, corn, chilli (n = 361) | **89.2%** (mango 80%, strawberry 81%) |
| AUROC none vs vegetable | 0.997 |
| End-to-end 10-class accuracy with thresholds | 93.2% (arg-max only: 91.2%) |
| Nine-class accuracy on the vegetables | 93.4% |
| Freshness-state accuracy / macro-F1 (arg-max, 4 states) | 91.3% / 0.894 |

Figures: `results/` (`confusion_9class.png`, `confusion_state.png`, `training_curve.png`, `per_class_f1.csv`, `openset.json`).
Previous models: `deploy_v2_closed_set/` (95.7% on 9 classes, no rejection) and `deploy_v1_backup/` outside the repo.
Rebuild: `train.py --init <best.pt>` → `calibrate_openset.py runs/<run>` → `export_onnx.py runs/<run>` → copy `deploy/` here.
Training data tools: `negatives.py`, `add_negatives.py`.

**Limits:** carrot at-risk has only 4 test images; no real ESP32-CAM images of vegetables yet (only empty scenes), so camera accuracy is untested.
Collect real frames with `tools/cam_serial.py collect` or the ✖ Wrong feedback (`manage.py export_feedback`) and retrain.

## Previous model (v2, 2026-10-26) – kept for reference
| | |
|---|---|
| Architecture | EfficientNet-B0 (ImageNet-pretrained, fine-tuned), input 288×288 |
| Dataset | 4,764 unique images (deduplicated). Split 75/12.5/12.5 with near-duplicates and same-fruit shots kept in one split |
| Test accuracy (9 classes) | **95.7%** (n = 564) |
| Test macro-F1 (9 classes) | **0.930** |
| Freshness-state accuracy (fresh/at-risk/rotten) | **95.9%** |
| Long purple talong, test | **91.7%** (n = 109). v1 model on the same photos: 59.6% |
| Team-photo subset of test | 89.3% (n = 28) |

Model selection used validation data only (224 px: 88.2% val talong; 288 px: 89.2%). The test set was evaluated once.
Figures for the paper: `runs/efficientnet_b0_288_1026-1857/` (`confusion_9class.png`, `confusion_state.png`, `per_class_f1.csv`, `training_curve.png`).
The previous model is kept in `deploy_v1_backup/`.

### How the talong data was labelled
* 1,027 photos from the Roboflow "talong" set (CC BY 4.0, https://universe.roboflow.com/olrnd/talong) plus 50 team photos were each reviewed by eye. Labels: fresh (glossy, taut skin); at-risk (fine wrinkling, dull or matte skin, dents); rotten (sunken decayed lesions); skip (unclear). Log: `_downloads/review_eggplant/labels_log.txt`.
* The Roboflow set has about 180 fruits, each photographed 4–9 times (consecutive file numbers). Per-shot labels disagreed for 25% of consecutive shots, so each photo's final label is the majority over its 7 neighbouring shots (ties → at-risk). See `talong_smoothed_labels.csv`.
* Splits keep blocks of 30 file numbers together, and shots within 4 numbers of a block edge are excluded from val/test. This stops the same fruit appearing in both training and testing.
* Training samples talong and round eggplant equally within each class. Otherwise "long shape" predicted "at-risk".

### Known limitations (read before reporting results)
* **Fresh vs at-risk talong is a visual judgement.** It is not based on known storage days. The labels are one reviewer's call on borderline fruit, so 91.7% measures agreement with that judgement. For the paper, validate against the team's physical audits (firmness, days since delivery).
* **Rotten talong is scarce:** only 6 team photos. Rotten eggplant is otherwise round BrinjalFruitX fruit. Photograph rotting talong at the stall.
* **Single fruit on a plain background works best.** Almost all talong training photos are one fruit on white paper. A market pile was classified as eggplant, but with low confidence (0.43). Mount the ESP32-CAM over a plain tray or surface if possible.
* **Carrot "at-risk" has only 33 unique images.** Its test score is based on just 4 images (2 correct).
* No images come from the actual ESP32-CAM yet. Augmentation simulates its blur, noise, and JPEG artefacts, but real captures are needed.

**The fix for all of these:** add your own photos (see below) and retrain.

## Labels used for public data
| Source | Mapped to |
|---|---|
| Team folders (`ML/`, `ml_cucumber/`, `new at risk/`, `new rotten/`) | as named |
| CUCUMBER GOOD (yellowing, over-mature; brown < 10%) | cucumber_at-risk |
| CUCUMBER BAD (only images ≥ 20% brown) | cucumber_rotten |
| Carrot GOOD / BAD (cracked, shrivelled) | carrot_fresh / carrot_at-risk |
| Fruits_Vegetables_Dataset(12000) + archive (1) | fresh / rotten |
| Cucumber Disease: Fresh Cucumber / Pythium Fruit Rot / Belly Rot | fresh / rotten / rotten |
| BrinjalFruitX: Healthy / Fruit Cracking / Wet Rot + Phomopsis | eggplant fresh / at-risk / rotten (Shoot & Fruit Borer skipped) |
| Roboflow talong + team talong photos (Downloads, 2026-10-26) | hand-labelled, see above (`_downloads/talong_labeled/`) |

## Add your own photos and retrain
1. Put reviewed images in `dataset/extra/<label>/` (e.g. `dataset/extra/eggplant_at-risk/`). Labels: `cucumber_fresh`, `cucumber_at-risk`, `cucumber_rotten`, `carrot_…`, `eggplant_…`.
   Best source: ESP32-CAM captures from Stall 41, labelled during the daily physical audits (Section 3.17.1). Aim for ≥ 100 per class, especially eggplant (all 3 states) and carrot at-risk.
2. Rebuild and train (about 50 min on the RTX 3050; close Steam/Epic/Chrome first, since the laptop runs out of RAM):
   ```
   .venv\Scripts\python tools\build_dataset.py
   set PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True
   .venv\Scripts\python tools\train.py --size 288 --bs 24 --workers 2
   cd tools && ..\.venv\Scripts\python eval_source.py ..\runs\<new_run> --split val && cd ..
   .venv\Scripts\python tools\plot_results.py runs\<new_run>
   cd tools && ..\.venv\Scripts\python export_onnx.py ..\runs\<new_run>
   ```

## Using it in Django
Copy the `deploy/` folder to the backend. `pip install onnxruntime numpy pillow`.
```python
from predict import FreshnessModel
model = FreshnessModel()                     # once, at startup
r = model.predict(image_bytes, crop=batch.crop_type)   # "cucumber" | "carrot" | "eggplant"
# r = {"crop","state","confidence","freshness_pct","probs"}
```
`freshness_pct = 100·P(fresh) + 50·P(at-risk)` gives a single "ML Freshness %" value for the ERD and dashboard.
For the ML override in Section 3.10.1, trigger when `state != "fresh"` and `confidence ≥ 0.8`, then tune that threshold during field validation.
Inference takes about 50 ms per image on the laptop CPU, including JPEG decoding; the model file is 16 MB.

## Files
* `tools/build_dataset.py` – gather, clean, deduplicate, and split → `dataset/manifest.csv`, `dataset/images/`
* `tools/train.py` – training plus test evaluation → `runs/<run>/metrics.json`
* `tools/plot_results.py`, `tools/export_onnx.py`, `tools/brown_score.py`, `tools/web_collect.py` (web collection was not used)
* `deploy/` – `agriresq_freshness.onnx`, `model_config.json`, `predict.py`
