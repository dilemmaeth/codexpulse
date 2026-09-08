Option Explicit

Dim shell, files, root, nodePath, syncPath, pairPath, configPath, pairingFile, exitCode
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")

root = files.GetParentFolderName(WScript.ScriptFullName)
nodePath = "C:\Program Files\nodejs\node.exe"
syncPath = root & "\scripts\codexpulse-sync.mjs"
pairPath = root & "\scripts\codexpulse-pair.mjs"
configPath = root & "\.codexpulse\private\config.json"
pairingFile = root & "\.codexpulse\private\pair.html"

If Not files.FileExists(nodePath) Then
  MsgBox "A Node.js nem található: " & nodePath, vbCritical, "CodexPulse"
  WScript.Quit 1
End If

If Not files.FileExists(configPath) Then
  exitCode = shell.Run(Chr(34) & nodePath & Chr(34) & " " & Chr(34) & syncPath & Chr(34) & " --initialize", 0, True)
  If exitCode <> 0 Then
    MsgBox "A kezdeti adatfeldolgozás nem sikerült.", vbCritical, "CodexPulse"
    WScript.Quit exitCode
  End If
End If

exitCode = shell.Run(Chr(34) & nodePath & Chr(34) & " " & Chr(34) & pairPath & Chr(34), 0, True)
If exitCode <> 0 Or Not files.FileExists(pairingFile) Then
  MsgBox "A párosító nem készíthető el.", vbCritical, "CodexPulse"
  WScript.Quit 1
End If

shell.Run Chr(34) & pairingFile & Chr(34), 1, False
