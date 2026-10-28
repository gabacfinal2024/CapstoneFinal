@echo off
REM Starts the AgriResQ backend + web app + mobile app on this PC's network.
REM Phones/cameras must be on the same Wi-Fi. Close the windows to stop.
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
  python -m venv .venv
  .venv\Scripts\python -m pip install -r requirements.txt
)
.venv\Scripts\python agriresq_core\manage.py migrate --noinput
start "AgriResQ backend :8000" cmd /k ".venv\Scripts\python agriresq_core\manage.py runserver 0.0.0.0:8000"
start "AgriResQ web :5173" cmd /k "cd agriresq_web && npx vite --host 0.0.0.0 --port 5173"
start "AgriResQ mobile :5174" cmd /k "cd agriresq_mobile && npx vite --host 0.0.0.0 --port 5174"
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do echo   This PC: %%a
echo Web app:    http://localhost:5173
echo Mobile app: http://^<this PC IP^>:5174  (open on the phone)
