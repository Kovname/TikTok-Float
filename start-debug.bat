@echo off
rem Запуск с консолью — удобно, если нужно посмотреть ошибки.
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo Electron не установлен. Выполни: npm install
  pause
  exit /b 1
)
"node_modules\electron\dist\electron.exe" "%~dp0"
