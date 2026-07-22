@echo off
REM Lancia il sync agent in modalita' "solo backlog" (snapshot = oggi).
REM Pensato per Windows Task Scheduler.
REM set "PATH=C:\Program Files\nodejs;%PATH%"
cd /d "%~dp0"
call npx tsx src/index.ts --backlog >> sync-backlog.log 2>&1
