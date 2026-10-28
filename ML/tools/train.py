"""Train the AgriResQ freshness classifier (9 classes: crop x {fresh, at-risk, rotten}).

Transfer learning from an ImageNet-pretrained CNN (timm). Augmentations imitate the
ESP32-CAM / OV5640 in a market stall: low resolution, heavy JPEG compression,
blur, sensor noise and uneven lighting. Hue is barely jittered on purpose: colour
change (yellowing, browning) is the actual spoilage signal.

usage: .venv/Scripts/python tools/train.py --model efficientnet_b0.ra_in1k --epochs 25
"""
import argparse, csv, io, json, os, random, time
from collections import Counter

import numpy as np
import timm
import torch
import torch.nn as nn
from PIL import Image, ImageFilter
from sklearn.metrics import classification_report, confusion_matrix, f1_score
from torch.utils.data import DataLoader, Dataset, WeightedRandomSampler
from torchvision.transforms import v2 as T

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "dataset")
LABELS = [f"{c}_{s}" for c in ("cucumber", "carrot", "eggplant") for s in ("fresh", "at-risk", "rotten")] + ["none"]
NONE = LABELS.index("none")  # not eggplant / cucumber / carrot
state_of = lambda v: np.where(np.array(v) < NONE, np.array(v) % 3, 3)  # 0 fresh 1 at-risk 2 rotten 3 none
MEAN, STD = (0.485, 0.456, 0.406), (0.229, 0.224, 0.225)


class Esp32CamSim:
    """Degrade a PIL image the way a cheap ESP32-CAM frame looks."""

    def __call__(self, im):
        # camera colour/exposure errors: white-balance gains, exposure, lens vignette. Applied to EVERY
        # class so that "looks like a cheap-camera frame" can never separate none from the vegetables.
        if random.random() < 0.65:
            a = np.asarray(im, np.float32)
            g = np.array([random.uniform(0.82, 1.18), random.uniform(0.9, 1.1), random.uniform(0.82, 1.18)], np.float32)
            roll = random.random()
            if roll < 0.25:
                g *= np.array([1.12, 0.82, 1.12], np.float32)   # magenta cast (this module's failure mode)
            elif roll < 0.35:
                g *= np.array([0.85, 1.15, 0.9], np.float32)    # green cast
            a = a * g * random.uniform(0.7, 1.25)
            if random.random() < 0.4:
                h, w = a.shape[:2]
                yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
                d = np.sqrt(((xx / w) - 0.5) ** 2 + ((yy / h) - 0.5) ** 2)
                a = a * (1.0 - random.uniform(0.2, 0.6) * d)[..., None]
            im = Image.fromarray(a.clip(0, 255).astype(np.uint8))
        if random.random() < 0.5:  # low resolution -> upsampled
            s = random.randint(96, 200)
            w, h = im.size
            k = s / min(w, h)
            im = im.resize((max(1, int(w * k)), max(1, int(h * k))), Image.BILINEAR).resize((w, h), Image.BILINEAR)
        if random.random() < 0.3:
            im = im.filter(ImageFilter.GaussianBlur(random.uniform(0.3, 1.5)))
        if random.random() < 0.3:  # sensor noise
            a = np.asarray(im).astype(np.float32)
            a += np.random.normal(0, random.uniform(2, 10), a.shape)
            im = Image.fromarray(a.clip(0, 255).astype(np.uint8))
        if random.random() < 0.6:  # JPEG artefacts (ESP32-CAM streams JPEG)
            buf = io.BytesIO()
            im.save(buf, "JPEG", quality=random.randint(15, 80))
            im = Image.open(io.BytesIO(buf.getvalue())).convert("RGB")
        return im


def transforms(size, train):
    norm = [T.ToImage(), T.ToDtype(torch.float32, scale=True), T.Normalize(MEAN, STD)]
    if not train:
        return T.Compose([T.Resize(int(size * 1.07)), T.CenterCrop(size)] + norm)
    return T.Compose([
        T.RandomResizedCrop(size, scale=(0.35, 1.0), ratio=(0.6, 1.67)),
        T.RandomHorizontalFlip(), T.RandomVerticalFlip(),
        T.RandomApply([T.RandomRotation(25)], p=0.3),
        T.ColorJitter(brightness=0.35, contrast=0.3, saturation=0.15, hue=0.015),
        T.RandomApply([T.RandomAutocontrast()], p=0.1),
        Esp32CamSim(),
    ] + norm + [T.RandomErasing(p=0.15, scale=(0.02, 0.1))])


class Freshness(Dataset):
    def __init__(self, rows, tf):
        self.rows, self.tf = rows, tf

    def __len__(self):
        return len(self.rows)

    def __getitem__(self, i):
        r = self.rows[i]
        im = Image.open(os.path.join(DATA, r["file"])).convert("RGB")
        return self.tf(im), LABELS.index(r["label"])


def evaluate(model, loader, device):
    model.eval()
    ps, ys = [], []
    with torch.no_grad(), torch.autocast("cuda", enabled=device == "cuda"):
        for x, y in loader:
            ps.append(model(x.to(device)).float().softmax(1).cpu())
            ys.append(y)
    return torch.cat(ps).numpy(), torch.cat(ys).numpy()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="efficientnet_b0.ra_in1k")
    ap.add_argument("--size", type=int, default=224)
    ap.add_argument("--epochs", type=int, default=25)
    ap.add_argument("--bs", type=int, default=48)
    ap.add_argument("--lr", type=float, default=6e-4)
    ap.add_argument("--team-weight", type=float, default=2.0, help="sampling boost for team photos")
    ap.add_argument("--none-weight", type=float, default=2.5, help="share of the `none` class vs 1.0 per vegetable class")
    ap.add_argument("--init", default="", help="warm start from an earlier best.pt (head is extended to the new classes)")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--out", default=os.path.join(ROOT, "runs"))
    a = ap.parse_args()

    torch.manual_seed(0); random.seed(0); np.random.seed(0)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    rows = list(csv.DictReader(open(os.path.join(DATA, "manifest.csv"), encoding="utf8")))
    split = {s: [r for r in rows if r["split"] == s] for s in ("train", "val", "test")}
    run = os.path.join(a.out, f"{a.model.split('.')[0]}_{a.size}_{time.strftime('%m%d-%H%M')}")
    os.makedirs(run, exist_ok=True)
    print(run, {k: len(v) for k, v in split.items()}, device)

    # balance the 9 vegetable classes; give team photos (closest to the deployment camera) extra weight.
    # Within a class, long talong and round brinjal get equal share: otherwise fruit shape
    # predicts the label (fresh was mostly round, at-risk mostly talong).
    pos = [r for r in split["train"] if r["label"] != "none"]
    domain = lambda r: "talong" if r["source"] == "talong_rf" or (r["team"] == "1" and r["crop"] == "eggplant") else "other"
    groups = Counter((r["label"], domain(r)) for r in pos)
    key = lambda r: (r["label"], domain(r)) if min(groups[r["label"], d] for d in ("talong", "other")) >= 50 else (r["label"], "all")
    gcount = Counter(key(r) for r in pos)
    ngroups = {l: len({g for g in gcount if g[0] == l}) for l in LABELS[:NONE]}
    # `none` is a heap of very different things: every category (tomato, wall, leaf, ...) gets an equal share
    ncat = Counter(r["category"] for r in split["train"] if r["label"] == "none")
    w = []
    for r in split["train"]:
        if r["label"] == "none":
            w.append(a.none_weight / (len(ncat) * ncat[r["category"]]) * (a.team_weight if r["team"] == "1" else 1.0))
        else:
            w.append((1.0 / (gcount[key(r)] * ngroups[r["label"]])) * (a.team_weight if r["team"] == "1" else 1.0))
    print("sampling groups:", dict(gcount), "| none categories:", len(ncat))
    sampler = WeightedRandomSampler(w, num_samples=len(w), replacement=True)
    dl = dict(num_workers=a.workers, persistent_workers=a.workers > 0, pin_memory=True)
    train_dl = DataLoader(Freshness(split["train"], transforms(a.size, True)), a.bs, sampler=sampler, drop_last=True, **dl)
    # eval loaders run in the main process: extra worker processes exhaust RAM on an 8 GB laptop
    val_dl = DataLoader(Freshness(split["val"], transforms(a.size, False)), a.bs * 2)
    test_dl = DataLoader(Freshness(split["test"], transforms(a.size, False)), a.bs * 2)

    model = timm.create_model(a.model, pretrained=True, num_classes=len(LABELS), drop_rate=0.3).to(device)
    if a.init:
        old = torch.load(a.init, map_location="cpu")
        cur = model.state_dict()
        for k, v in old.items():
            if k in cur and cur[k].shape == v.shape:
                cur[k] = v
            elif k in cur and v.dim() >= 1 and cur[k].shape[1:] == v.shape[1:]:
                cur[k][: v.shape[0]] = v          # old classes keep their weights, new rows start fresh
        model.load_state_dict(cur)
        print("warm start from", a.init)
    opt = torch.optim.AdamW(model.parameters(), lr=a.lr, weight_decay=0.05)
    steps = a.epochs * len(train_dl)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=a.lr, total_steps=steps, pct_start=0.1)
    scaler = torch.amp.GradScaler(enabled=device == "cuda")
    crit = nn.CrossEntropyLoss(label_smoothing=0.1)

    best, history = -1.0, []
    for ep in range(a.epochs):
        model.train()
        t0, tot, n = time.time(), 0.0, 0
        for x, y in train_dl:
            x, y = x.to(device, non_blocking=True), y.to(device, non_blocking=True)
            with torch.autocast("cuda", enabled=device == "cuda"):
                loss = crit(model(x), y)
            opt.zero_grad(set_to_none=True)
            scaler.scale(loss).backward()
            scaler.step(opt)
            scaler.update()
            sched.step()
            tot += loss.item() * len(y); n += len(y)
        p, y = evaluate(model, val_dl, device)
        f1 = f1_score(y, p.argmax(1), average="macro")
        acc = (p.argmax(1) == y).mean()
        history.append({"epoch": ep + 1, "loss": tot / n, "val_acc": float(acc), "val_macro_f1": float(f1)})
        print(f"ep {ep + 1:2d} loss {tot / n:.4f} val_acc {acc:.4f} val_macroF1 {f1:.4f} ({time.time() - t0:.0f}s)", flush=True)
        if f1 > best:
            best = f1
            torch.save(model.state_dict(), os.path.join(run, "best.pt"))

    model.load_state_dict(torch.load(os.path.join(run, "best.pt"), map_location=device))
    p, y = evaluate(model, test_dl, device)
    pred = p.argmax(1)
    team = np.array([r["team"] == "1" for r in split["test"]])
    state = state_of  # collapse crop -> freshness state (+ none)
    report = {
        "model": a.model, "size": a.size, "labels": LABELS, "history": history,
        "test_n": int(len(y)), "test_acc": float((pred == y).mean()),
        "test_macro_f1": float(f1_score(y, pred, average="macro")),
        "test_state_acc": float((state(pred) == state(y)).mean()),
        "test_state_macro_f1": float(f1_score(state(y), state(pred), average="macro")),
        "test_team_n": int(team.sum()),
        "test_team_acc": float((pred[team] == y[team]).mean()) if team.any() else None,
        "test_by_source": {s: {"n": int(m.sum()), "acc": float((pred[m] == y[m]).mean())}
                           for s in sorted({r["source"] for r in split["test"]})
                           for m in [np.array([r["source"] == s for r in split["test"]])]},
        "test_by_category": {c: {"n": int(m.sum()), "acc": float((pred[m] == y[m]).mean())}
                             for c in sorted({r["category"] for r in split["test"] if r["label"] == "none"})
                             for m in [np.array([r["category"] == c for r in split["test"]])]},
        "confusion": confusion_matrix(y, pred, labels=range(len(LABELS))).tolist(),
        "report": classification_report(y, pred, labels=range(len(LABELS)), target_names=LABELS, output_dict=True, zero_division=0),
    }
    print(classification_report(y, pred, labels=range(len(LABELS)), target_names=LABELS, digits=3, zero_division=0))
    print({k: v for k, v in report.items() if k.startswith("test_")})
    json.dump(report, open(os.path.join(run, "metrics.json"), "w"), indent=2)
    np.save(os.path.join(run, "test_probs.npy"), p)
    print("saved", run)


if __name__ == "__main__":
    main()
