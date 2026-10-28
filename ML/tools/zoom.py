"""Show selected review ids at large size. usage: python tools/zoom.py REVIEW_DIR OUT.jpg id [id ...]"""
import csv, os, sys
from PIL import Image, ImageDraw, ImageOps

rev, out, ids = sys.argv[1], sys.argv[2], [int(x) for x in sys.argv[3:]]
rows = {int(r["id"]): r for r in csv.DictReader(open(os.path.join(rev, "review.csv"), encoding="utf8"))}
T, C = 440, 4
sheet = Image.new("RGB", (C * T, ((len(ids) + C - 1) // C) * T), "white")
d = ImageDraw.Draw(sheet)
for k, i in enumerate(ids):
    im = ImageOps.exif_transpose(Image.open(rows[i]["path"])).convert("RGB")
    im.thumbnail((T - 4, T - 18))
    x, y = (k % C) * T, (k // C) * T
    sheet.paste(im, (x + 2, y + 16))
    d.text((x + 3, y + 2), f"#{i}", fill="red")
sheet.save(out, quality=90)
