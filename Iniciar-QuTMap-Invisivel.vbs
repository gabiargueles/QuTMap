Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
baseDir = fso.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = baseDir
WshShell.Run """" & baseDir & "\QuTMap.exe"" --tray", 0, False
WScript.Sleep 900
WshShell.Run "msedge --app=http://127.0.0.1:8765", 1, False
