import os
import sys

from django.apps import AppConfig


class ApiConfig(AppConfig):
    name = 'api'

    def ready(self):
        # Background workers (capture scheduler + camera discovery) run inside the dev server process
        # only: `runserver` starts a reloader child with RUN_MAIN=true (or pass --noreload). For
        # gunicorn/uwsgi set AGRIRESQ_BACKGROUND=1. Never during migrate / tests / shell.
        serving = 'runserver' in sys.argv and (os.environ.get('RUN_MAIN') == 'true' or '--noreload' in sys.argv)
        if serving or os.environ.get('AGRIRESQ_BACKGROUND') == '1':
            from . import background
            background.start()
