"""Build the curated AgriResQ freshness dataset (9 classes = crop x state).

* gathers the team's own folders + the public datasets already on this laptop
  (+ BrinjalFruitX eggplant parquet files downloaded from Hugging Face)
* drops unreadable / tiny images and rotated-augmentation copies (black corners)
* removes exact and near duplicates (perceptual hash), team images take priority
* resizes to max 512 px and writes dataset/images/<label>/<source>__<hash>.jpg
* groups near-duplicates and makes a leakage-free stratified train/val/test split
* writes dataset/manifest.csv

usage: .venv/Scripts/python tools/build_dataset.py
"""
import csv, glob, io, os, random, re, sys
from collections import Counter, defaultdict

import imagehash
import numpy as np
import pyarrow.parquet as pq
from PIL import Image, ImageOps

sys.path.insert(0, os.path.dirname(__file__))
from brown_score import brown_fraction

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DL = os.path.expanduser("~/Downloads")
OUT = os.path.join(ROOT, "dataset")
MAX_SIDE = 512
DUP_DIST = 4      # phash hamming distance treated as the same photo (dropped)
GROUP_DIST = 6    # near-duplicates kept but forced into the same split (10 chained whole datasets)
TALONG_BLOCK = 30 # Roboflow talong file numbers grouped per fruit session
TALONG_EDGE = 4   # shots this close to a block edge never go to val/test
SPLIT = {"train": 0.75, "val": 0.125, "test": 0.125}

CUC_GB = f"{DL}/CUCUMBER/CUCUMBER/CUCUMBER"
CAR_GB = f"{DL}/Good and bad classification of Fresh CARROT/Good and bad classification of Fresh CARROT/CARROT"
A1 = f"{DL}/archive (1)/dataset"
F12 = f"{DL}/archive/Fruits_Vegetables_Dataset(12000)/Vegetables"
CDR = f"{DL}/archive/Cucumber Disease Recognition Dataset/Original Image/Original Image"
BRINJAL = os.path.join(ROOT, "_downloads", "brinjalfruitx")
TALONG = os.path.join(ROOT, "_downloads", "talong_labeled")

# Brown-pixel filters for the noisy public CUCUMBER Good/Bad set (see brown_score.py)
only_green_yellow = lambda p: brown_fraction(p) < 0.10
mostly_brown = lambda p: brown_fraction(p) >= 0.20

# (folder, label, source tag, team?, optional filter). Team folders come first so
# that when a public image was also copied into a team folder, the team copy wins.
FOLDERS = [
    (f"{ROOT}/ML/fresh_cucumber", "cucumber_fresh", "team", True, None),
    (f"{ROOT}/ML/at-risk_cucumber", "cucumber_at-risk", "team", True, None),
    (f"{ROOT}/ML/rotten_cucumber", "cucumber_rotten", "team", True, None),
    (f"{ROOT}/ML/fresh_carrots", "carrot_fresh", "team", True, None),
    (f"{ROOT}/ML/at-risk_carrots", "carrot_at-risk", "team", True, None),
    (f"{ROOT}/ML/rotten_carrots", "carrot_rotten", "team", True, None),
    (f"{ROOT}/ML/fresh_eggplant", "eggplant_fresh", "team", True, None),
    (f"{ROOT}/ML/at-risk_eggplant", "eggplant_at-risk", "team", True, None),
    (f"{ROOT}/ml_cucumber/fresh_cucumber", "cucumber_fresh", "team", True, None),
    (f"{ROOT}/ml_cucumber/at-risk_cucumber", "cucumber_at-risk", "team", True, None),
    (f"{ROOT}/ml_cucumber/rotten_cucumber", "cucumber_rotten", "team", True, None),
    (f"{ROOT}/new at risk", "cucumber_at-risk", "team", True, None),
    (f"{ROOT}/new rotten", "cucumber_rotten", "team", True, None),
    # long purple talong, hand-labelled 2026-10-26 (see _downloads/review_eggplant/labels_log.txt)
    (f"{TALONG}/team/eggplant_fresh", "eggplant_fresh", "team", True, None),
    (f"{TALONG}/team/eggplant_at-risk", "eggplant_at-risk", "team", True, None),
    (f"{TALONG}/team/eggplant_rotten", "eggplant_rotten", "team", True, None),
    (f"{TALONG}/roboflow/eggplant_fresh", "eggplant_fresh", "talong_rf", False, None),
    (f"{TALONG}/roboflow/eggplant_at-risk", "eggplant_at-risk", "talong_rf", False, None),
    (f"{ROOT}/Fresh Cucumber", "cucumber_fresh", "cdr", False, None),
    (f"{CUC_GB}/GOOD/Good", "cucumber_at-risk", "cuc_goodbad", False, only_green_yellow),
    (f"{CUC_GB}/BAD/Bad", "cucumber_rotten", "cuc_goodbad", False, mostly_brown),
    (f"{CAR_GB}/GOOD", "carrot_fresh", "car_goodbad", False, None),
    (f"{CAR_GB}/BAD", "carrot_at-risk", "car_goodbad", False, None),
    (f"{CDR}/Fresh Cucumber", "cucumber_fresh", "cdr", False, None),
    (f"{CDR}/Pythium Fruit Rot", "cucumber_rotten", "cdr", False, None),
    (f"{CDR}/Belly Rot", "cucumber_rotten", "cdr", False, None),
    (f"{F12}/FreshCucumber", "cucumber_fresh", "fv12000", False, None),
    (f"{F12}/RottenCucumber", "cucumber_rotten", "fv12000", False, None),
    (f"{F12}/FreshCarrot", "carrot_fresh", "fv12000", False, None),
    (f"{F12}/RottenCarrot", "carrot_rotten", "fv12000", False, None),
    (f"{A1}/vegetables/fresh cucumber", "cucumber_fresh", "fv12000", False, None),
    (f"{A1}/vegetables/rotten cucumber", "cucumber_rotten", "fv12000", False, None),
    (f"{A1}/vegetables/fresh carrot", "carrot_fresh", "fv12000", False, None),
    (f"{A1}/vegetables/rotten carrot", "carrot_rotten", "fv12000", False, None),
    (f"{A1}/testings/vegetables/fresh cucumber", "cucumber_fresh", "fv12000", False, None),
    (f"{A1}/testings/vegetables/rotten cucumber", "cucumber_rotten", "fv12000", False, None),
    (f"{A1}/testings/vegetables/fresh carrot", "carrot_fresh", "fv12000", False, None),
    (f"{A1}/testings/vegetables/rotten carrot", "carrot_rotten", "fv12000", False, None),
]
# Extra reviewed images (e.g. new team photos) can be dropped in dataset/extra/<label>/
EXTRA = os.path.join(OUT, "extra")

# BrinjalFruitX label names -> our label (None = not a storage-freshness signal, skipped)
BRINJAL_MAP = {
    "Healty Brinjal": "eggplant_fresh",
    "Brinjal Fruit Creaking": "eggplant_at-risk",
    "Wet Rot": "eggplant_rotten",
    "Phomopsis Bright": "eggplant_rotten",
    "Shoot and Fruit Borer": None,
}
# class-index order of the parquet "label" column (from the dataset README)
BRINJAL_NAMES = ["Brinjal Fruit Creaking", "Healty Brinjal", "Phomopsis Bright", "Shoot and Fruit Borer", "Wet Rot"]

EXT = (".jpg", ".jpeg", ".png", ".webp", ".bmp")


def black_corners(im):
    a = np.asarray(im.convert("L").resize((64, 64)))
    corners = [a[:4, :4], a[:4, -4:], a[-4:, :4], a[-4:, -4:]]
    return sum(c.mean() < 4 for c in corners) >= 2


def iter_items():
    for folder, label, src, team, filt in FOLDERS:
        if not os.path.isdir(folder):
            print("missing", folder)
            continue
        for p in sorted(glob.glob(os.path.join(folder, "**", "*"), recursive=True)):
            if p.lower().endswith(EXT) and (filt is None or filt(p)):
                yield (lambda p=p: Image.open(p)), label, src, team, p
    if os.path.isdir(EXTRA):
        for label in sorted(os.listdir(EXTRA)):
            for p in sorted(glob.glob(os.path.join(EXTRA, label, "*"))):
                if p.lower().endswith(EXT):
                    yield (lambda p=p: Image.open(p)), label, "extra", True, p
    for f in sorted(glob.glob(os.path.join(BRINJAL, "*.parquet"))):
        pf = pq.ParquetFile(f)
        for batch in pf.iter_batches(batch_size=16, columns=["image", "label"]):
            for img, lab in zip(batch.column("image").to_pylist(), batch.column("label").to_pylist()):
                label = BRINJAL_MAP[BRINJAL_NAMES[lab]]
                if label:
                    data = img["bytes"]
                    yield (lambda d=data: Image.open(io.BytesIO(d))), label, "brinjalfruitx", False, f"{os.path.basename(f)}:{lab}"


def main():
    img_dir = os.path.join(OUT, "images")
    os.makedirs(img_dir, exist_ok=True)
    rows, hashes = [], []
    stats = Counter()
    for opener, label, src, team, origin in iter_items():
        try:
            im = ImageOps.exif_transpose(opener()).convert("RGB")
        except Exception:
            stats["unreadable"] += 1
            continue
        if min(im.size) < 64:
            stats["too_small"] += 1
            continue
        if black_corners(im):
            stats["rotated_aug"] += 1
            continue
        h = imagehash.phash(im)
        hv = int(str(h), 16)
        if hashes:
            arr = np.array(hashes, dtype=np.uint64)
            dist = np.bitwise_count(arr ^ np.uint64(hv))
            j = int(dist.argmin())
            if dist[j] <= DUP_DIST:
                if rows[j]["label"] != label:
                    stats["dup_conflicting_label"] += 1
                stats["duplicate"] += 1
                continue
        im.thumbnail((MAX_SIDE, MAX_SIDE))
        name = f"{src}__{h}.jpg"
        os.makedirs(os.path.join(img_dir, label), exist_ok=True)
        im.save(os.path.join(img_dir, label, name), quality=92)
        rows.append({"file": f"images/{label}/{name}", "label": label, "crop": label.split("_")[0],
                     "state": label.split("_")[1], "source": src, "team": int(team), "phash": str(h), "origin": origin})
        hashes.append(hv)
        stats["kept"] += 1
        if stats["kept"] % 500 == 0:
            print(stats, flush=True)

    # group near-duplicates (union-find) so they never straddle splits
    arr = np.array(hashes, dtype=np.uint64)
    parent = list(range(len(rows)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i in range(len(rows)):
        close = np.nonzero(np.bitwise_count(arr[i + 1:] ^ arr[i]) <= GROUP_DIST)[0] + i + 1
        for j in close:
            # same white-paper backdrop makes talong hashes chain into one component;
            # those are grouped by file-number block below instead
            if rows[i]["source"] == rows[j]["source"] == "talong_rf":
                continue
            parent[find(int(j))] = find(i)

    # the Roboflow talong set photographs each fruit several times under nearby
    # file numbers (talong929/talong930 ...): keep each block of numbers together
    block_first = {}
    for i, r in enumerate(rows):
        m = re.search(r"talong(\d+)_", r["origin"])
        if r["source"] == "talong_rf" and m:
            b = int(m.group(1)) // TALONG_BLOCK
            if b in block_first:
                parent[find(i)] = find(block_first[b])
            else:
                block_first[b] = i

    # stratified group split per label; a group spanning labels keeps one split
    rng = random.Random(42)
    by_label = defaultdict(lambda: defaultdict(list))
    for i, r in enumerate(rows):
        by_label[r["label"]][find(i)].append(i)
    group_split = {}
    for label, groups in sorted(by_label.items()):
        gl = list(groups.items())
        rng.shuffle(gl)
        n = sum(len(g) for _, g in gl)
        acc = 0
        for root, g in gl:
            frac = acc / n
            split = group_split.setdefault(
                root, "train" if frac < SPLIT["train"] else "val" if frac < SPLIT["train"] + SPLIT["val"] else "test")
            for i in g:
                rows[i]["split"] = split
            acc += len(g)

    # a fruit can straddle two talong blocks: keep block-edge shots out of val/test
    for r in rows:
        m = re.search(r"talong(\d+)_", r["origin"])
        if r["source"] == "talong_rf" and m and r["split"] != "train":
            k = int(m.group(1)) % TALONG_BLOCK
            if k < TALONG_EDGE or k >= TALONG_BLOCK - TALONG_EDGE:
                r["split"] = "excluded"

    with open(os.path.join(OUT, "manifest.csv"), "w", newline="", encoding="utf8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)

    print("\n", dict(stats))
    tab = Counter((r["label"], r["split"]) for r in rows)
    print(f"{'label':20s} train   val  test  (team)")
    for label in sorted({r['label'] for r in rows}):
        team = sum(1 for r in rows if r["label"] == label and r["team"])
        print(f"{label:20s} {tab[label, 'train']:5d} {tab[label, 'val']:5d} {tab[label, 'test']:5d}  ({team})")


if __name__ == "__main__":
    main()
