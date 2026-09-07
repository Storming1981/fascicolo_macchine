' Wrapper VBS: lancia run-sync.bat senza far comparire la finestra cmd.
' Usare QUESTO file nel Windows Task Scheduler (non il .bat).
' Attende la fine del batch e ne restituisce il codice di uscita, cosi' un
' fallimento (es. Node non trovato) si vede nel Task Scheduler come
' "Last Run Result" diverso da 0x0 invece di passare inosservato.
Set objShell = CreateObject("WScript.Shell")
Set objFSO = CreateObject("Scripting.FileSystemObject")
strScriptDir = objFSO.GetParentFolderName(WScript.ScriptFullName)
rc = objShell.Run("""" & strScriptDir & "\run-sync.bat""", 0, True)
WScript.Quit(rc)
