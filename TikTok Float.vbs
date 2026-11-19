' TikTok Float — запуск без консольного окна.
' Просто дважды щёлкни по этому файлу.

Option Explicit

Dim fso, shell, baseDir, electronExe
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

baseDir = fso.GetParentFolderName(WScript.ScriptFullName)
electronExe = baseDir & "\node_modules\electron\dist\electron.exe"

If Not fso.FileExists(electronExe) Then
  MsgBox "Не найден Electron." & vbCrLf & vbCrLf & _
         "Открой папку TikTokFloat и выполни в ней:" & vbCrLf & _
         "npm install" & vbCrLf & vbCrLf & _
         "Либо просто переустанови приложение.", _
         vbExclamation, "TikTok Float"
  WScript.Quit 1
End If

shell.CurrentDirectory = baseDir
' 1 = обычное окно. С 0 Electron может унаследовать скрытое состояние
' и окно приложения не появится на экране.
shell.Run """" & electronExe & """ """ & baseDir & """", 1, False
