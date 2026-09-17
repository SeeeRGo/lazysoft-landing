@echo off
cd /d "%~dp0"
chcp 65001 >nul
title Установка сайта в Cloudflare
where node >nul 2>nul
if errorlevel 1 (
  echo Сначала установите Node.js LTS с сайта https://nodejs.org/
  pause
  exit /b 1
)
call npm install
if errorlevel 1 goto error
call npm run deploy
if errorlevel 1 goto error
echo.
echo Установка завершена.
pause
exit /b 0
:error
echo.
echo Установка остановилась с ошибкой. Сфотографируйте это окно и передайте разработчику.
pause
exit /b 1
