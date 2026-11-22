@echo off
rem Opens the agent office: starts the local reader and the browser.
rem Keep this window open while you watch the office; close it to stop.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1"
if errorlevel 1 pause
