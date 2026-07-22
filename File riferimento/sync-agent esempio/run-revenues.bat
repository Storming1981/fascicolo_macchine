@echo off
REM Lancia il sync agent in modalita' "solo revenues" (anno corrente).
REM Pensato per Windows Task Scheduler.
REM Se Node.js non e' nel PATH di sistema, decommenta la riga seguente e correggi:
REM set "PATH=C:\Program Files\nodejs;%PATH%"
cd /d "%~dp0"
call npx tsx src/index.ts --revenues >> sync-revenues.log 2>&1
