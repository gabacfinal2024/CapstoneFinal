import os
import sys
from pathlib import Path
from dotenv import load_dotenv
import dj_database_url

BASE_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BASE_DIR.parent
load_dotenv(PROJECT_ROOT / '.env')
load_dotenv(BASE_DIR / '.env')

SECRET_KEY = os.environ.get(
    'DJANGO_SECRET_KEY',
    'django-insecure-dev-only-change-in-production-!lkn85x2',
)
DEBUG = os.environ.get('DEBUG', 'True').lower() == 'true'
ALLOWED_HOSTS = os.environ.get('ALLOWED_HOSTS', 'localhost,127.0.0.1,0.0.0.0').split(',')

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'rest_framework',
    'rest_framework.authtoken',
    'corsheaders',
    'api',
]

MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

CORS_ALLOWED_ORIGINS = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:5174',
    'http://127.0.0.1:5174',
    'http://localhost',
    'https://localhost',
    'capacitor://localhost',
    'ionic://localhost',
    'https://capstonefinal-o9ek.onrender.com',
]
CORS_ALLOWED_ORIGINS.extend(
    origin.strip()
    for origin in os.environ.get('CORS_ALLOWED_ORIGINS', '').split(',')
    if origin.strip()
)
CORS_ALLOW_CREDENTIALS = True

if DEBUG:
    CORS_ALLOW_ALL_ORIGINS = True

REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'rest_framework.authentication.TokenAuthentication',
    ],
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.IsAuthenticated',
    ],
    'DEFAULT_PAGINATION_CLASS': None,
    'DEFAULT_THROTTLE_CLASSES': [
        'rest_framework.throttling.AnonRateThrottle',
        'rest_framework.throttling.UserRateThrottle',
    ],
    'DEFAULT_THROTTLE_RATES': {
        'anon': '30/minute',
        'user': '120/minute',
    },
}

ROOT_URLCONF = 'agriresq_backend.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'agriresq_backend.wsgi.application'

# Supabase PostgreSQL or SQLite fallback for local dev
DATABASE_URL = os.environ.get('DATABASE_URL')
if DATABASE_URL:
    DATABASES = {
        'default': dj_database_url.parse(
            DATABASE_URL,
            conn_max_age=600,
            ssl_require='supabase' in DATABASE_URL.lower(),
        )
    }
else:
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.sqlite3',
            'NAME': BASE_DIR / 'db.sqlite3',
        }
    }

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator', 'OPTIONS': {'min_length': 8}},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'Asia/Manila'
USE_I18N = True
USE_TZ = True

STATIC_URL = 'static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# Security headers (production)
if not DEBUG:
    SECURE_SSL_REDIRECT = True
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_BROWSER_XSS_FILTER = True
    SECURE_CONTENT_TYPE_NOSNIFF = True
    X_FRAME_OPTIONS = 'DENY'

# Supabase client config (for optional direct realtime from frontend)
SUPABASE_URL = os.environ.get('SUPABASE_URL', 'https://yyrmuaocpnrlkeedwpzx.supabase.co').rstrip('/')
# publishable key (already public in the apps); used to verify user sessions
SUPABASE_ANON_KEY = os.environ.get('SUPABASE_ANON_KEY', 'sb_publishable_vSgs7UPknvfBsjXvrEtk0Q_Nh7m7I1-')
SUPABASE_SERVICE_ROLE_KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '')
if len(sys.argv) > 1 and sys.argv[1] == 'test':
    SUPABASE_SERVICE_ROLE_KEY = ''      # automated tests must never write to the real Supabase project

# IoT alert thresholds
IOT_TEMP_ALERT_THRESHOLD = float(os.environ.get('IOT_TEMP_ALERT_THRESHOLD', '30'))
# Stall conditions assumed for time-based aging when a batch has no recent DHT22 reading (Bulua market)
ASSUMED_STALL_TEMP_C = float(os.environ.get('ASSUMED_STALL_TEMP_C', '29'))
ASSUMED_STALL_RH = float(os.environ.get('ASSUMED_STALL_RH', '80'))

# Analysed pictures are kept while they are among a camera's newest SCAN_KEEP_PER_DEVICE or newer than
# SCAN_KEEP_DAYS days (operator-corrected frames are always kept: they are retraining data).
SCAN_KEEP_PER_DEVICE = int(os.environ.get('SCAN_KEEP_PER_DEVICE', '500'))
SCAN_KEEP_DAYS = int(os.environ.get('SCAN_KEEP_DAYS', '30'))

# Freshness CNN (ML/deploy: agriresq_freshness.onnx + model_config.json + predict.py)
ML_MODEL_DIR = Path(os.environ.get('ML_MODEL_DIR', PROJECT_ROOT / 'ML' / 'deploy'))

# Address the ESP32-CAM uses to reach this server. Empty = auto-detect the laptop's LAN IP.
DEVICE_SERVER_URL = os.environ.get('DEVICE_SERVER_URL', '')
DJANGO_PORT = os.environ.get('DJANGO_PORT', '8000')

# JPEG uploads from the camera
DATA_UPLOAD_MAX_MEMORY_SIZE = 8 * 1024 * 1024


ALLOWED_HOSTS = ['*']
