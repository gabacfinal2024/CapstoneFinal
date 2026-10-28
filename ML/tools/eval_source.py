"""Accuracy of a trained run per image source on one split (model selection uses val).

usage: .venv/Scripts/python tools/eval_source.py runs/<run_dir> [--split val]
"""
import argparse, csv, json, os
from collections import Counter

import numpy as np
import timm
import torch
from torch.utils.data import DataLoader

from train import DATA, LABELS, Freshness, evaluate, transforms

ap = argparse.ArgumentParser()
ap.add_argument("run")
ap.add_argument("--split", default="val")
a = ap.parse_args()

m = json.load(open(os.path.join(a.run, "metrics.json")))
device = "cuda" if torch.cuda.is_available() else "cpu"
model = timm.create_model(m["model"], pretrained=False, num_classes=len(LABELS)).to(device)
model.load_state_dict(torch.load(os.path.join(a.run, "best.pt"), map_location=device))
rows = [r for r in csv.DictReader(open(os.path.join(DATA, "manifest.csv"), encoding="utf8")) if r["split"] == a.split]
p, y = evaluate(model, DataLoader(Freshness(rows, transforms(m["size"], False)), 64), device)
pred = p.argmax(1)
src = np.array([r["source"] for r in rows])
print(f"{a.run}  {a.split}: all {(pred == y).mean():.3f} (n={len(y)})")
for s in sorted(set(src)):
    k = src == s
    print(f"  {s:14s} n={k.sum():4d} acc={(pred[k] == y[k]).mean():.3f}")
k = src == "talong_rf"
print("  talong confusions:", Counter((LABELS[t], LABELS[q]) for t, q in zip(y[k], pred[k]) if t != q))
