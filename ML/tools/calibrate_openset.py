"""Choose the "is it one of our vegetables?" thresholds on VALIDATION data, then report on TEST.

A frame is a detection when  P(none) < t_none  and  P(best crop) >= t_crop.
Priority: do not accept things that are not eggplant/cucumber/carrot. So we take the most
permissive thresholds that still reject >= --reject (default 98 %) of validation negatives,
and only then report what happens on the untouched test set:
  * negatives of categories seen in training (new images)
  * negatives of categories NEVER seen (okra, mango, strawberry, corn, cauliflower, chilli)
  * target vegetables accepted / correctly classified

usage: .venv/Scripts/python tools/calibrate_openset.py runs/<run_dir> [--reject 0.98]
Writes <run>/thresholds.json and <run>/openset.json
"""
import argparse, csv, json, os, sys

import numpy as np
import timm
import torch
from sklearn.metrics import roc_auc_score
from torch.utils.data import DataLoader

sys.path.insert(0, os.path.dirname(__file__))
from train import DATA, LABELS, NONE, Freshness, evaluate, transforms

ap = argparse.ArgumentParser()
ap.add_argument("run")
ap.add_argument("--reject", type=float, default=0.98)
a = ap.parse_args()

m = json.load(open(os.path.join(a.run, "metrics.json")))
device = "cuda" if torch.cuda.is_available() else "cpu"
model = timm.create_model(m["model"], pretrained=False, num_classes=len(LABELS)).to(device)
model.load_state_dict(torch.load(os.path.join(a.run, "best.pt"), map_location=device))
rows = list(csv.DictReader(open(os.path.join(DATA, "manifest.csv"), encoding="utf8")))


def probs(split):
    rs = [r for r in rows if r["split"] == split]
    p, y = evaluate(model, DataLoader(Freshness(rs, transforms(m["size"], False)), 64), device)
    return rs, p, y


def detect(p, t_none, t_crop):
    mass = p[:, :9].reshape(-1, 3, 3).sum(2).max(1)
    return (p[:, NONE] < t_none) & (mass >= t_crop)


grid = [(tn, tc) for tn in np.arange(0.10, 0.96, 0.05) for tc in np.arange(0.30, 0.91, 0.05)]
vr, vp, vy = probs("val")
neg, pos = vy == NONE, vy != NONE
best = None
for tn, tc in grid:
    d = detect(vp, tn, tc)
    rej, acc = float((~d[neg]).mean()), float(d[pos].mean())
    if rej >= a.reject and (best is None or acc > best[2] or (acc == best[2] and rej > best[3])):
        best = (float(tn), float(tc), acc, rej)
if best is None:  # cannot reach the target: take the best balanced point instead
    best = max(((float(tn), float(tc), float(detect(vp, tn, tc)[pos].mean()), float((~detect(vp, tn, tc)[neg]).mean()))
                for tn, tc in grid), key=lambda t: t[2] + t[3])
t_none, t_crop = round(best[0], 2), round(best[1], 2)
print(f"chosen on validation: t_none={t_none} t_crop={t_crop}  accept targets {best[2]:.3f}  reject negatives {best[3]:.3f}")

tr, tp, ty = probs("test")
d = detect(tp, t_none, t_crop)
cat = np.array([r["category"] for r in tr])
held = {r["category"] for r in tr if r["label"] == "none"} - {r["category"] for r in rows if r["split"] == "train" and r["label"] == "none"}
is_held = np.array([c in held for c in cat])
tneg, tpos = ty == NONE, ty != NONE
# classification of the accepted targets (closed set over the 9 classes) + end-to-end
acc9 = float((tp[tpos][:, :9].argmax(1) == ty[tpos]).mean())
e2e = float(((np.where(d, tp[:, :9].argmax(1), NONE)) == ty).mean())
res = {
    "t_none": t_none, "t_crop": t_crop, "val_accept_targets": best[2], "val_reject_negatives": best[3],
    "test_accept_targets": float(d[tpos].mean()),
    "test_reject_seen_negatives": float((~d[tneg & ~is_held]).mean()), "n_seen_negatives": int((tneg & ~is_held).sum()),
    "test_reject_unseen_negatives": float((~d[tneg & is_held]).mean()), "n_unseen_negatives": int((tneg & is_held).sum()),
    "test_closed_set_9class_acc": acc9, "test_end_to_end_10class_acc": e2e,
    "test_auroc_none_vs_target": float(roc_auc_score(tneg, tp[:, NONE])),
    "test_reject_by_category": {c: {"n": int((cat == c).sum()), "rejected": float((~d[(cat == c) & tneg]).mean()),
                                    "unseen": c in held} for c in sorted(set(cat[tneg]))},
    "test_accept_by_class": {LABELS[i]: float(d[ty == i].mean()) for i in range(9)},
}
print(json.dumps({k: v for k, v in res.items() if not isinstance(v, dict)}, indent=1))
print("rejection by category (test):")
for c, v in res["test_reject_by_category"].items():
    print(f"  {c:20s} n={v['n']:3d} rejected {v['rejected']:.3f}{'   <- never seen in training' if v['unseen'] else ''}")
print("target acceptance by class (test):", {k: round(v, 2) for k, v in res["test_accept_by_class"].items()})
json.dump({"none_prob": t_none, "crop_prob": t_crop, "crop_ambiguity": 0.5}, open(os.path.join(a.run, "thresholds.json"), "w"))
json.dump(res, open(os.path.join(a.run, "openset.json"), "w"), indent=2)
np.save(os.path.join(a.run, "test_probs10.npy"), tp)
np.save(os.path.join(a.run, "test_labels10.npy"), ty)
