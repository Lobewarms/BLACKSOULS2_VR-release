@echo off
rem BLACK SOULS II VR community server - keep this window open while playing together
chcp 65001 >nul
cd /d "%~dp0"
where python >nul 2>nul || (echo Python 3 is needed: https://www.python.org/downloads/ & pause & exit /b 1)
python world_server.py %*
pause
