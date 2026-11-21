import os
import sys
from pathlib import Path

from django.apps import AppConfig


class ApiConfig(AppConfig):
    name = 'api'

    def ready(self):
        # Background workers (capture scheduler + camera discovery) run inside the dev server process
        # only: `runserver` starts a reloader child with RUN_MAIN=true (or pass --noreload). For
        # gunicorn/uwsgi set AGRIRESQ_BACKGROUND=1. Never during migrate / tests / shell.
        serving = 'runserver' in sys.argv and (os.environ.get('RUN_MAIN') == 'true' or '--noreload' in sys.argv)
        production = os.environ.get('AGRIRESQ_BACKGROUND') == '1' and Path(sys.argv[0]).name != 'manage.py'
        if serving or production:
            from . import background
            background.start()
