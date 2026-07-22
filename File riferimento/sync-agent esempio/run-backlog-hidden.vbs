' Wrapper VBS per lanciare run-backlog.bat senza mostrare la finestra cmd.
Set objShell = CreateObject("WScript.Shell")
Set objFSO = CreateObject("Scripting.FileSystemObject")
strScriptDir = objFSO.GetParentFolderName(WScript.ScriptFullName)
objShell.Run """" & strScriptDir & "\run-backlog.bat""", 0, False
