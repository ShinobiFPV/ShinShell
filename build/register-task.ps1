param([Parameter(Mandatory=$true)][string]$ExePath)
$action = New-ScheduledTaskAction -Execute $ExePath
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -RunLevel Highest -LogonType Interactive
Register-ScheduledTask -TaskName "ShinShell" -Action $action -Principal $principal -Force | Out-Null
