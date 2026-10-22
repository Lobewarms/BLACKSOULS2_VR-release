@echo off
rem BLACK SOULS II VR community server (world_server.py - coop_server.py beside it): one world everyone shares.
rem Keep this window open while it runs. Its world and settings are kept beside it (world.json, world_server.json, backups).
chcp 65001 >nul
cd /d "%~dp0"
where python >nul 2>nul || (echo Python 3 is needed: https://www.python.org/downloads/ & pause & exit /b 1)
python world_server.py %*
pause
