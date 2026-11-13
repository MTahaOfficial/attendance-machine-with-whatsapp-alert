@echo off
REM Meridian - one-click start for the exhibition laptop (Windows).
REM Opens two windows: the PostgreSQL database and the app. Close both windows to stop.
cd /d "%~dp0"

if not exist node_modules (
  echo Installing packages ^(first run only, needs internet^)...
  call npm install
)
if not exist dist (
  echo Building the web app...
  call npm run build
)

start "Meridian - database" cmd /k npm run db:embedded
echo Waiting for the database to start...
timeout /t 10 /nobreak >nul
start "Meridian - app" cmd /k npm start

echo.
echo Meridian is starting. Open http://localhost:4000 on this laptop.
echo The app window prints the https://192.168.x.x:4443 address for the tablet.
timeout /t 6 >nul
start http://localhost:4000
