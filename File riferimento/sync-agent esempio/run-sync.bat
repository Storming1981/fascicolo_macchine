@echo off
REM Lancia il sync agent completo: revenues anno corrente + backlog snapshot oggi.
REM set "PATH=C:\Program Files\nodejs;%PATH%"
cd /d "%~dp0"
call npx tsx src/index.ts >> sync.log 2>&1
