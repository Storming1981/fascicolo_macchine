' Wrapper VBS per lanciare run-sync.bat (revenues + backlog) senza finestra cmd.
Set objShell = CreateObject("WScript.Shell")
Set objFSO = CreateObject("Scripting.FileSystemObject")
strScriptDir = objFSO.GetParentFolderName(WScript.ScriptFullName)
objShell.Run """" & strScriptDir & "\run-sync.bat""", 0, False
