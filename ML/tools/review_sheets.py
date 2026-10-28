"""Prepare unlabelled images for human freshness labelling.

Deduplicates the given folders, pre-sorts them with the current model (crop hint),
and writes numbered contact sheets + review.csv. A reviewer then fills in the
labels (see tools/apply_review.py).

usage: .venv/Scripts/python tools/review_sheets.py OUT_DIR --crop eggplant FOLDER [FOLDER ...]
"""
import argparse, csv, glob, os, sys

import imagehash
import numpy as np
from PIL import Image, ImageDraw, ImageOps

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "deploy"))
from predict import FreshnessModel

EXT = (".jpg", ".jpeg", ".png", ".webp")
TILE, COLS, ROWS = 220, 8, 5

ap = argparse.ArgumentParser()
ap.add_argument("out")
ap.add_argument("folders", nargs="+")
ap.add_argument("--crop", required=True)
a = ap.parse_args()
os.makedirs(a.out, exist_ok=True)

model = FreshnessModel()
items, hashes = [], []
for folder in a.folders:
    for p in sorted(glob.glob(os.path.join(folder, "**", "*"), recursive=True)):
        if not p.lower().endswith(EXT):
            continue
        im = ImageOps.exif_transpose(Image.open(p)).convert("RGB")
        h = int(str(imagehash.phash(im)), 16)
        if hashes and np.bitwise_count(np.array(hashes, np.uint64) ^ np.uint64(h)).min() <= 4:
            continue
        hashes.append(h)
        r = model.predict(im, crop=a.crop)
        items.append({"path": p, "pred": r["state"], "p_fresh": r["probs"]["fresh"],
                      "p_atrisk": r["probs"]["at-risk"], "p_rotten": r["probs"]["rotten"]})
print(len(items), "unique images")

# freshest first, so the sheets go from fresh -> at-risk -> rotten
items.sort(key=lambda r: -(r["p_fresh"] + 0.5 * r["p_atrisk"]))
for i, r in enumerate(items):
    r["id"] = i
    r["label"] = ""

per = COLS * ROWS
for s in range(0, len(items), per):
    sheet = Image.new("RGB", (COLS * TILE, ROWS * TILE), "white")
    d = ImageDraw.Draw(sheet)
    for k, r in enumerate(items[s:s + per]):
        im = ImageOps.exif_transpose(Image.open(r["path"])).convert("RGB")
        im.thumbnail((TILE - 4, TILE - 18))
        x, y = (k % COLS) * TILE, (k // COLS) * TILE
        sheet.paste(im, (x + 2, y + 16))
        d.text((x + 3, y + 2), f"#{r['id']}  {r['pred']} {r['p_fresh']:.2f}", fill="red")
    sheet.save(os.path.join(a.out, f"sheet_{s // per:02d}.jpg"), quality=88)

with open(os.path.join(a.out, "review.csv"), "w", newline="", encoding="utf8") as f:
    w = csv.DictWriter(f, fieldnames=["id", "label", "pred", "p_fresh", "p_atrisk", "p_rotten", "path"])
    w.writeheader()
    w.writerows(items)
print("sheets:", (len(items) + per - 1) // per)
