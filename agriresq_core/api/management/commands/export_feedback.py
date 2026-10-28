"""Export operator-corrected camera frames as labelled training images.

    python manage.py export_feedback [--out ../ML/feedback_export]

Writes <out>/<label>/scan<ID>.jpg using the untouched camera frame (not the annotated one) for every scan
the operator marked Correct / Wrong in the app. Copy the folders into the ML project's dataset/extra/<label>/
and retrain (ML/README.md). Labels: <crop>_<state> (eggplant_at-risk ...) or none.
"""
import shutil
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand

from api.models import DeviceScan


class Command(BaseCommand):
    help = 'Copy operator-labelled camera frames into <out>/<label>/ for retraining.'

    def add_arguments(self, parser):
        parser.add_argument('--out', default=str(settings.BASE_DIR.parent / 'ML' / 'feedback_export'))

    def handle(self, *args, **opts):
        out, n, skipped = Path(opts['out']), 0, 0
        for scan in DeviceScan.objects.exclude(feedback_label__isnull=True).exclude(feedback_label=''):
            src = settings.MEDIA_ROOT / scan.raw_image if scan.raw_image else None
            if not src or not src.exists():
                skipped += 1               # automatic "nothing in view" frames are never stored (privacy)
                continue
            dest = out / scan.feedback_label
            dest.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dest / f'scan{scan.id}.jpg')
            n += 1
        self.stdout.write(self.style.SUCCESS(f'{n} labelled frames exported to {out} ({skipped} without a stored image)'))
