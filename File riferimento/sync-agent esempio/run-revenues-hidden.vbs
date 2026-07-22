' Wrapper VBS per lanciare run-revenues.bat senza mostrare la finestra cmd.
' Usato dal Task Scheduler invece di chiamare direttamente il .bat.
Set objShell = CreateObject("WScript.Shell")
Set objFSO = CreateObject("Scripting.FileSystemObject")
strScriptDir = objFSO.GetParentFolderName(WScript.ScriptFullName)
objShell.Run """" & strScriptDir & "\run-revenues.bat""", 0, False
