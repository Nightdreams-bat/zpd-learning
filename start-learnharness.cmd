@echo off
rem LearnHarness fork (claude-cli provider). Production server on http://localhost:3000
rem   start-learnharness.cmd           run (builds first if there is no build yet)
rem   start-learnharness.cmd rebuild   rebuild after code changes, then run
cd /d "%~dp0"
if /i "%~1"=="rebuild" if exist .next rmdir /s /q .next
if not exist .next\BUILD_ID call npx next build
start "" http://localhost:3000/
call npx next start -p 3000
