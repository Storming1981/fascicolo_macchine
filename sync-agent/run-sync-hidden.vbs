' Wrapper VBS: lancia run-sync.bat senza far comparire la finestra cmd.
' Usare QUESTO file nel Windows Task Scheduler (non il .bat).
Set objShell = CreateObject("WScript.Shell")
Set objFSO = CreateObject("Scripting.FileSystemObject")
strScriptDir = objFSO.GetParentFolderName(WScript.ScriptFullName)
objShell.Run """" & strScriptDir & "\run-sync.bat""", 0, False
