"""Sources of the `none` class: images that are NOT eggplant, cucumber or carrot.

The classifier used to be closed-set (9 classes), so a ceiling or a tomato still got a
freshness verdict. `none` teaches it to say "no target vegetable here".

Categories flagged HOLDOUT are never used for training or validation: they form the
"unseen object" part of the test set (how well the model rejects things it has never seen).
Look-alikes (bitter gourd, bottle gourd, beetroot ...) are deliberately NOT held out.
"""
import colorsys, glob, os, random, zlib

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DL = os.path.expanduser("~/Downloads")
DOCS = os.path.expanduser("~/Documents")
A = f"{DL}/archive"
F12 = f"{A}/Fruits_Vegetables_Dataset(12000)"
CDR = f"{A}/Cucumber Disease Recognition Dataset/Original Image/Original Image"
NEG = os.path.join(ROOT, "_downloads", "negatives")
EXT = (".jpg", ".jpeg", ".png", ".webp", ".bmp")

# (category, [folders], max images, holdout)
SOURCES = [
    # other fruit & vegetables (fresh AND rotten both count as "not a target crop")
    ("apple", [f"{A}/dataset/Train/freshapples", f"{A}/dataset/Train/rottenapples"], 120, False),
    ("banana", [f"{A}/dataset/Train/freshbanana", f"{A}/dataset/Train/rottenbanana"], 120, False),
    ("orange", [f"{A}/dataset/Train/freshoranges", f"{A}/dataset/Train/rottenoranges"], 120, False),
    ("tomato", [f"{A}/dataset/Train/freshtomato", f"{A}/dataset/Train/rottentomato"], 120, False),
    ("potato", [f"{A}/dataset/Train/freshpotato", f"{A}/dataset/Train/rottenpotato"], 120, False),
    ("capsicum", [f"{A}/dataset/Train/freshcapsicum", f"{A}/dataset/Train/rottencapsicum",
                  f"{F12}/Vegetables/FreshBellpepper", f"{F12}/Vegetables/RottenBellpepper",
                  f"{NEG}/guydegnol/capsicum"], 140, False),
    ("bitter_gourd", [f"{A}/dataset/Train/freshbittergroud", f"{A}/dataset/Train/rottenbittergroud",
                      f"{NEG}/guydegnol/bitter_gourd"], 140, False),            # cucumber look-alike
    ("bottle_gourd", [f"{NEG}/guydegnol/bottle_gourd"], 100, False),            # cucumber look-alike
    ("beetroot", [f"{NEG}/jeffbrian/beetroot"], 90, False),                     # eggplant / carrot look-alike
    ("bean", [f"{NEG}/guydegnol/bean"], 100, False),
    ("broccoli", [f"{NEG}/guydegnol/broccoli"], 100, False),
    ("cabbage", [f"{NEG}/guydegnol/cabbage", f"{NEG}/jeffbrian/cabbage"], 140, False),
    # never trained on: unseen-object test
    ("okra", [f"{A}/dataset/Train/freshokra", f"{A}/dataset/Train/rottenokra"], 100, True),
    ("mango", [f"{F12}/Fruits/FreshMango", f"{F12}/Fruits/RottenMango"], 100, True),
    ("strawberry", [f"{F12}/Fruits/FreshStrawberry", f"{F12}/Fruits/RottenStrawberry"], 100, True),
    ("corn", [f"{NEG}/jeffbrian/corn"], 80, True),
    ("cauliflower", [f"{NEG}/guydegnol/cauliflower", f"{NEG}/jeffbrian/cauliflower"], 100, True),
    ("chilli_pepper", [f"{NEG}/jeffbrian/chilli_pepper"], 80, True),
    # plants, objects, surfaces
    ("cucumber_leaf", [f"{CDR}/Fresh Leaf", f"{CDR}/Anthracnose", f"{CDR}/Bacterial Wilt",
                       f"{CDR}/Downy Mildew", f"{CDR}/Gummy Stem Blight"], 150, False),
    ("object3d", [f"{DOCS}/Twinmotion2023.1/SketchfabCloudLibrary/CloudLibrary/thumbnails"], 150, False),
    ("object3d", [f"{DOCS}/Twinmotion2023.1/TwinmotionCloudLibrary/CloudLibrary/thumbnails"], 80, False),
    ("texture", [f"{DL}/x64/IX/PF/CF/AdShared/IX/Tex/srf"], 60, False),
    # the deployment camera itself (empty scene, ceiling, wall) – raw frames only
    ("esp32_scene", [os.path.join(ROOT, "_downloads", "esp32_frames", "none")], None, False),
]


def list_images(folders):
    out = []
    for f in folders:
        out += [p for p in glob.glob(os.path.join(f, "**", "*"), recursive=True)
                if p.lower().endswith(EXT) and "_Popup" not in p]
    return sorted(out)


def iter_negatives(seed=0):
    """Yield (opener, category, origin, holdout, nodedup)."""
    rng = random.Random(seed)
    for category, folders, cap, holdout in SOURCES:
        files = list_images(folders)
        if cap and len(files) > cap:
            files = sorted(rng.sample(files, cap))
        if not files:
            print("no images for", category)
        for p in files:
            # real camera frames of the same empty scene are near-identical by design: keep them all
            yield (lambda p=p: Image.open(p)), category, p, holdout, category == "esp32_scene"
    wall = sorted(glob.glob(f"{DL}/*wallpaper*.jpg") + glob.glob(f"{DL}/*splash*.jpg") + glob.glob(f"{DL}/*desktop-wallpaper*.jpg"))
    for p in wall[:16]:
        yield (lambda p=p: Image.open(p)), "wallpaper", p, False, False
    for kind, n in SYNTH_KINDS:
        for i in range(n):
            yield (lambda k=kind, i=i: synth(k, i)), "synthetic_" + kind, f"synthetic:{kind}:{i}", False, True


# ───────────────────────── synthetic scene frames ─────────────────────────
# Blank walls, ceilings, glare, dark/overexposed frames, cardboard, flat colour fields and
# clutter, in any hue (purple, green, orange included): a colour alone must never mean
# "eggplant", "cucumber" or "carrot".
SYNTH_KINDS = [("wall", 80), ("light", 36), ("dark", 18), ("bright", 18), ("solid", 40),
               ("clutter", 36), ("cardboard", 24), ("blob", 24)]
W, H = 320, 240


def _color(r, sat=(0.0, 0.6), val=(0.25, 0.95)):
    return np.array(colorsys.hsv_to_rgb(r.random(), r.uniform(*sat), r.uniform(*val)), np.float32)


def _lowfreq(r, shape_small=(5, 7)):
    small = (r.random((*shape_small, 3)) * 255).astype(np.uint8)
    return np.asarray(Image.fromarray(small).resize((W, H), Image.BICUBIC), np.float32) / 255.0


def synth(kind, i):
    r = np.random.default_rng(zlib.crc32(kind.encode()) * 1000 + i)   # reproducible (str hash() is not)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    xx /= W
    yy /= H
    ang = r.uniform(0, 2 * np.pi)
    grad = np.cos(ang) * xx + np.sin(ang) * yy
    base = _color(r, sat=(0.0, 0.9 if kind == "solid" else 0.5))
    img = base[None, None, :] * (0.75 + 0.5 * grad[..., None] * r.uniform(0.0, 0.8))

    if kind == "wall":
        img = img * (0.85 + 0.3 * _lowfreq(r))
        d = np.sqrt((xx - r.uniform(.3, .7)) ** 2 + (yy - r.uniform(.3, .7)) ** 2)
        img *= (1.1 - r.uniform(0.2, 0.7) * d)[..., None]                       # vignette
    elif kind == "light":
        cx, cy, s = r.uniform(.15, .85), r.uniform(.15, .85), r.uniform(.04, .16)
        blob = np.exp(-(((xx - cx) ** 2 + (yy - cy) ** 2) / (2 * s * s)))[..., None]
        img = img * 0.55 + blob * r.uniform(0.7, 1.4) * _color(r, (0, .25), (.9, 1.0))
    elif kind == "dark":
        img = img * r.uniform(0.04, 0.22)
    elif kind == "bright":
        img = 0.78 + 0.22 * img
    elif kind == "solid":
        img = np.broadcast_to(base * r.uniform(0.6, 1.05), (H, W, 3)).copy()
        img *= (0.97 + 0.06 * _lowfreq(r, (3, 4)))
    elif kind == "cardboard":
        tone = np.array([0.58, 0.44, 0.29], np.float32) * r.uniform(0.75, 1.15) * (0.9 + 0.2 * r.random(3))
        img = tone[None, None, :] * (0.9 + 0.2 * _lowfreq(r, (4, 6)))
        img *= (0.93 + 0.07 * np.sin(yy * r.uniform(60, 180))[..., None])
    elif kind in ("clutter", "blob"):
        img = np.broadcast_to(_color(r, (0, .3), (.4, .95)), (H, W, 3)).copy() * (0.85 + 0.3 * _lowfreq(r))
        pil = Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8))
        d = ImageDraw.Draw(pil)
        for _ in range(int(r.integers(6, 16)) if kind == "clutter" else int(r.integers(1, 3))):
            x0, y0 = r.integers(0, W - 30), r.integers(0, H - 30)
            x1, y1 = x0 + r.integers(25, 150), y0 + r.integers(25, 130)
            col = tuple(int(c * 255) for c in _color(r, (0, 1 if kind == "blob" else .7), (.2, .95)))
            if kind == "blob":
                d.ellipse([x0, y0, x1, y1], fill=col)                         # flat coloured shape, no texture
            elif r.random() < 0.5:
                d.rectangle([x0, y0, x1, y1], fill=col)
            else:
                d.line([x0, y0, x1, y1], fill=col, width=int(r.integers(2, 12)))
        img = np.asarray(pil, np.float32) / 255.0
    img = img + r.normal(0, r.uniform(0.005, 0.04), img.shape)
    out = Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8))
    if r.random() < 0.4:
        out = out.filter(ImageFilter.GaussianBlur(r.uniform(0.5, 2.5)))
    return out
