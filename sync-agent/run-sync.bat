@echo off
setlocal
REM Lancia il sync-agent ERP: legge il gestionale e aggiorna i fascicoli su machines.zatospa.it
REM Nel Task Scheduler va schedulato run-sync-hidden.vbs (non questo .bat).

cd /d "%~dp0"

REM --- Node: percorso inchiodato, NON dipende dal PATH di sistema ---
REM Sul server del gestionale (192.168.1.144) la cartella di Node e' C:\nodejs.
REM Se un domani viene spostata di nuovo, e' QUESTA la riga da correggere.
set "NODE_DIR=C:\nodejs"
if not exist "%NODE_DIR%\node.exe" if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_DIR=%ProgramFiles%\nodejs"

REM Node mancante: fallire in modo RUMOROSO (log + exit code), non in silenzio.
if not exist "%NODE_DIR%\node.exe" (
  echo [%DATE% %TIME%] ERRORE: node.exe non trovato in "%NODE_DIR%" - sync NON eseguito.>> sync.log
  echo [%DATE% %TIME%] Rimedio: correggi NODE_DIR in run-sync.bat con la cartella di Node.>> sync.log
  exit /b 2
)

set "PATH=%NODE_DIR%;%PATH%"

echo [%DATE% %TIME%] --- avvio sync (node in %NODE_DIR%) --->> sync.log
call npx tsx src/index.ts >> sync.log 2>&1
set "RC=%ERRORLEVEL%"
echo [%DATE% %TIME%] --- fine sync (exit %RC%) --->> sync.log
exit /b %RC%
