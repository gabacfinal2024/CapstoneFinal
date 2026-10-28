"""High-detail review sheets: each image cropped to the produce (YOLO boxes when the
source has them) so skin wrinkling / dents are visible to the human reviewer.

usage: python tools/detail_sheets.py REVIEW_DIR [YOLO_DATASET_DIR]
"""
import csv, glob, os, sys
from PIL import Image, ImageDraw, ImageOps

rev = sys.argv[1]
boxes = {}
if len(sys.argv) > 2:
    for ann in glob.glob(os.path.join(sys.argv[2], "*", "_annotations.txt")):
        for line in open(ann):
            parts = line.split()
            if len(parts) >= 2:
                bs = [list(map(int, p.split(",")[:4])) for p in parts[1:]]
                # union of all boxes in the image
                boxes[os.path.join(os.path.dirname(ann), parts[0])] = [
                    min(b[0] for b in bs), min(b[1] for b in bs), max(b[2] for b in bs), max(b[3] for b in bs)]

rows = list(csv.DictReader(open(os.path.join(rev, "review.csv"), encoding="utf8")))
T, C, R = 360, 5, 4
per = C * R
for s in range(0, len(rows), per):
    sheet = Image.new("RGB", (C * T, R * T), "white")
    d = ImageDraw.Draw(sheet)
    for k, r in enumerate(rows[s:s + per]):
        im = ImageOps.exif_transpose(Image.open(r["path"])).convert("RGB")
        b = boxes.get(os.path.normpath(r["path"])) or boxes.get(r["path"].replace("/", os.sep))
        if b:
            pad = 0.06 * max(b[2] - b[0], b[3] - b[1])
            im = im.crop((max(0, b[0] - pad), max(0, b[1] - pad), min(im.width, b[2] + pad), min(im.height, b[3] + pad)))
        im.thumbnail((T - 4, T - 18))
        x, y = (k % C) * T, (k // C) * T
        sheet.paste(im, (x + 2, y + 16))
        d.text((x + 3, y + 2), f"#{r['id']}", fill="red")
    sheet.save(os.path.join(rev, f"detail_{s // per:02d}.jpg"), quality=90)
print((len(rows) + per - 1) // per, "detail sheets")
