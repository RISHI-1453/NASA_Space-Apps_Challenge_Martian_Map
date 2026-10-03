@echo off
cd /d "%~dp0backend"
"%~dp0.venv\Scripts\python.exe" -m uvicorn app:app --reload --port 8002
