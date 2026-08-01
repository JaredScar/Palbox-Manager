
=try { =[Security.Principal.WindowsIdentity]::GetCurrent(); =(New-Object Security.Principal.WindowsPrincipal ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) } catch {}
=New-Object psobject -Property @{ user=[Environment]::UserName; isAdmin=; ps=.PSVersion.ToString() }
[System.IO.File]::WriteAllText('C:\PalboxUpdate\launchtest.json', (|ConvertTo-Json -Compress), [System.Text.Encoding]::UTF8)
