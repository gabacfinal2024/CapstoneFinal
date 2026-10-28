"""Stage 2 of the dataset build: add the `none` class (not eggplant / cucumber / carrot).

Run after tools/build_dataset.py. Positive images and their splits are left untouched, so
earlier results stay comparable.  Re-running is safe: previous `none` rows are replaced.

Splits for `none`:
  * HOLDOUT categories (okra, mango, strawberry, corn, cauliflower, chilli) -> test only,
    never seen in training: measures rejection of unknown objects.
  * everything else -> grouped near-duplicate split ~75/12.5/12.5 (train/val/test)
  * synthetic scene frames -> by index, same ratios

usage: .venv/Scripts/python tools/add_negatives.py
"""
import csv, os, random, shutil, sys
from collections import Counter, defaultdict

import imagehash
import numpy as np
from PIL import ImageOps

sys.path.insert(0, os.path.dirname(__file__))
from negatives import iter_negatives

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "dataset")
MAX_SIDE, DUP_DIST, GROUP_DIST = 512, 4, 6


def main():
    rows = list(csv.DictReader(open(os.path.join(OUT, "manifest.csv"), encoding="utf8")))
    rows = [r for r in rows if r["label"] != "none"]
    shutil.rmtree(os.path.join(OUT, "images", "none"), ignore_errors=True)
    os.makedirs(os.path.join(OUT, "images", "none"), exist_ok=True)
    for r in rows:
        r.setdefault("category", r["label"])
        r["category"] = r.get("category") or r["label"]
    hashes = [int(r["phash"], 16) for r in rows]
    n_pos = len(rows)
    stats = Counter()
    new = []

    for opener, category, origin, holdout, nodedup in iter_negatives():
        try:
            im = ImageOps.exif_transpose(opener()).convert("RGB")
        except Exception:
            stats["unreadable"] += 1
            continue
        if min(im.size) < 48:
            stats["too_small"] += 1
            continue
        h = imagehash.phash(im)
        hv = int(str(h), 16)
        if not nodedup:
            dist = np.bitwise_count(np.array(hashes, dtype=np.uint64) ^ np.uint64(hv))
            j = int(dist.argmin())
            if dist[j] <= DUP_DIST:
                stats["duplicate_of_positive" if j < n_pos else "duplicate"] += 1
                continue
        im.thumbnail((MAX_SIDE, MAX_SIDE))
        name = f"{category}__{len(new):05d}_{h}.jpg"
        im.save(os.path.join(OUT, "images", "none", name), quality=92)
        row = {"file": f"images/none/{name}", "label": "none", "crop": "none", "state": "none", "source": category,
               "team": int(category == "esp32_scene"), "phash": str(h), "origin": origin, "category": category,
               "split": "", "_holdout": holdout, "_nodedup": nodedup}
        rows.append(row)
        new.append(row)
        hashes.append(hv)
        stats["kept"] += 1

    # ── splits ──
    rng = random.Random(7)
    pool = [r for r in new if not r["_holdout"] and not r["_nodedup"]]
    arr = np.array([int(r["phash"], 16) for r in pool], dtype=np.uint64)
    parent = list(range(len(pool)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i in range(len(pool)):
        for j in np.nonzero(np.bitwise_count(arr[i + 1:] ^ arr[i]) <= GROUP_DIST)[0] + i + 1:
            if pool[i]["category"] == pool[int(j)]["category"]:     # group only within a category
                parent[find(int(j))] = find(i)
    groups = defaultdict(list)
    for i in range(len(pool)):
        groups[find(i)].append(i)
    gl = list(groups.values())
    rng.shuffle(gl)
    acc = 0
    for g in gl:
        frac = acc / len(pool)
        split = "train" if frac < 0.75 else "val" if frac < 0.875 else "test"
        for i in g:
            pool[i]["split"] = split
        acc += len(g)
    for r in new:
        if r["_holdout"]:
            r["split"] = "test"
    synth = [r for r in new if r["_nodedup"]]
    rng.shuffle(synth)
    for k, r in enumerate(synth):
        r["split"] = "train" if k < 0.75 * len(synth) else "val" if k < 0.875 * len(synth) else "test"

    fields = ["file", "label", "crop", "state", "source", "team", "phash", "origin", "split", "category"]
    with open(os.path.join(OUT, "manifest.csv"), "w", newline="", encoding="utf8") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)

    print(dict(stats))
    tab = Counter((r["category"], r["split"]) for r in new)
    print(f"{'category':26s} train   val  test")
    for c in sorted({r["category"] for r in new}):
        mark = "  (held out)" if any(r["category"] == c and r["_holdout"] for r in new) else ""
        print(f"{c:26s} {tab[c, 'train']:5d} {tab[c, 'val']:5d} {tab[c, 'test']:5d}{mark}")
    t = Counter(r["split"] for r in new)
    print(f"{'none total':26s} {t['train']:5d} {t['val']:5d} {t['test']:5d}")


if __name__ == "__main__":
    main()
