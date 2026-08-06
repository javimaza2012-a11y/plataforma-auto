@echo off
title PlataformaAUTO - DKV & SAP
echo ===================================================
echo   Iniciando PlataformaAUTO (DKV & SAP Automation)
echo ===================================================
echo.
cd /d "%~dp0"
start http://localhost:3000
npm start
pause
