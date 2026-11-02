@echo off
chcp 65001 >nul
title TruckMap GPS Nativo — ETS2 RBR & ATS (Porta 8765)
cd /d "%~dp0"

:: Verifica se a porta 8765 ja esta liberada no Firewall; se nao estiver, solicita liberacao via UAC
netsh advfirewall firewall show rule name="TruckMap GPS (Porta 8765)" >nul 2>&1
if %errorlevel% neq 0 (
  echo Liberando a porta 8765 no Firewall do Windows para acesso no Tablet...
  powershell -NoProfile -Command "Start-Process netsh -ArgumentList 'advfirewall firewall add rule name=\"TruckMap GPS (Porta 8765)\" dir=in action=allow protocol=TCP localport=8765' -Verb RunAs -WindowStyle Hidden -Wait"
)

if exist "%~dp0TruckMap.exe" (
  start "" "%~dp0TruckMap.exe"
  exit /b 0
)

start "" cmd /c "timeout /t 1 /nobreak >nul & start msedge --app=http://127.0.0.1:8765"
node "%~dp0server.mjs"
pause
