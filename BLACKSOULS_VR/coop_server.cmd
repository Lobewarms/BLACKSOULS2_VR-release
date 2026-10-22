@echo off
rem BLACK SOULS II VR co-op server (coop_server.py) - keep this window open while playing together
chcp 65001 >nul
cd /d "%~dp0"
where python >nul 2>nul || (echo Python 3 is needed: https://www.python.org/downloads/ & pause & exit /b 1)
python coop_server.py %*
pause
