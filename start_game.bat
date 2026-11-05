@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo =======================================================
echo    NGUYEN NGOC CUONG - CHUA BINH AN ONLINE
 echo =======================================================
echo.
echo Mo trinh duyet va truy cap: http://localhost:3000
echo Muon dung may chu, an Ctrl + C.
echo.
start "" "http://localhost:3000"
node server.js
if errorlevel 1 (
 echo.
 echo Chua cai Node.js? Truy cap https://nodejs.org/
 pause
)
