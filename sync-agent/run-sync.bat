@echo off
REM Lancia il sync-agent ERP: legge il gestionale e aggiorna i fascicoli su machines.zatospa.it
REM Se node non è nel PATH di sistema, decommenta e correggi la riga seguente:
REM set "PATH=C:\Program Files\nodejs;%PATH%"
cd /d "%~dp0"
call npx tsx src/index.ts >> sync.log 2>&1
