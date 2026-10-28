@echo off
rem LearnHarness fork (claude-cli provider): pull the latest upstream release into this fork.
rem   update-learnharness.cmd            fetch, merge, test, build, smoke-test the Claude login, then update main
rem   update-learnharness.cmd -NoSmoke   skip the real lesson through the Claude subscription
rem   update-learnharness.cmd -NoBuild   skip the production build
rem Nothing changes on main unless every check passes. See scripts\update-from-upstream.ps1.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\update-from-upstream.ps1" %*
pause
