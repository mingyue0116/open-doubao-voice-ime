@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ========================================
echo  开源豆包语音输入法 - Quick Start
echo ========================================
echo.

if not exist "dist\index.html" (
    echo Building frontend...
    call npm run build
    if errorlevel 1 (
        echo Frontend build failed!
        pause
        exit /b 1
    )
)

echo Starting using npx tauri dev...
echo (Starts Vite + Tauri together)
echo Press Ctrl+C to stop.
echo.

npx tauri dev
if errorlevel 1 (
    echo.
    echo Launch failed.
    pause
)
