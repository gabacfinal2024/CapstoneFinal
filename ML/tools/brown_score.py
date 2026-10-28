"""Fraction of 'brown/decayed' pixels among the produce pixels of an image.

Used only to clean the noisy public CUCUMBER Good/Bad set: a 'Bad' image that
is mostly yellow-green looks like an at-risk cucumber, not a rotten one, and
would confuse the classes.
"""
from PIL import Image, ImageOps


def brown_fraction(path):
    im = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    im.thumbnail((96, 96))
    obj = brown = 0
    for h, s, v in im.convert("HSV").getdata():
        # skip the dark/grey background and specular highlights
        if s < 60 or v < 50:
            continue
        obj += 1
        hue = h * 360 / 255
        # brown/dark-orange decay: low hue with lowered brightness
        if hue < 38 and v < 170:
            brown += 1
    return brown / obj if obj else 0.0


if __name__ == "__main__":
    import os, sys
    for d in sys.argv[1:]:
        for f in sorted(os.listdir(d)):
            print(f"{brown_fraction(os.path.join(d, f)):.3f}\t{os.path.join(d, f)}")
