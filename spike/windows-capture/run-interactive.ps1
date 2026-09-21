param(
  [Parameter(Mandatory = $true)][string]$ElectronPath,
  [Parameter(Mandatory = $true)][string]$ScriptPath,
  [Parameter(Mandatory = $true)][string]$ResultPath,
  [string[]]$ExtraArguments = @(),
  [int]$TimeoutSeconds = 45
)

$ErrorActionPreference = 'Stop'
if ($TimeoutSeconds -lt 1 -or $TimeoutSeconds -gt 300) {
  throw 'TimeoutSeconds must be between 1 and 300.'
}
foreach ($path in @($ElectronPath, $ScriptPath)) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Missing input: $path" }
}
if (Test-Path -LiteralPath $ResultPath) { throw 'Choose a fresh result path for this run.' }
$resultDirectory = Split-Path -Parent $ResultPath
New-Item -ItemType Directory -Path $resultDirectory -Force | Out-Null

function Quote-Argument([string]$Value) {
  if ($Value.Contains('"') -or $Value.EndsWith('\')) {
    throw 'Arguments must not contain quotes or end in a backslash.'
  }
  return '"' + $Value + '"'
}

$taskName = 'DFragonCropper-Spike-' + [Guid]::NewGuid().ToString('N')
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$argumentList = @($ScriptPath, '--output', $ResultPath) + $ExtraArguments
$arguments = ($argumentList | ForEach-Object { Quote-Argument $_ }) -join ' '
$action = New-ScheduledTaskAction -Execute $ElectronPath -Argument $arguments -WorkingDirectory (Split-Path -Parent $ScriptPath)
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Seconds ($TimeoutSeconds + 10)) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$registered = $false
try {
  Register-ScheduledTask -TaskName $taskName -Action $action -Principal $principal -Settings $settings | Out-Null
  $registered = $true
  Start-ScheduledTask -TaskName $taskName
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    Start-Sleep -Milliseconds 250
    $state = (Get-ScheduledTask -TaskName $taskName).State
    if ((Test-Path -LiteralPath $ResultPath) -and $state -ne 'Running') {
      Get-Content -LiteralPath $ResultPath -Raw
      $info = Get-ScheduledTaskInfo -TaskName $taskName
      if ($info.LastTaskResult -ne 0) {
        throw "Interactive probe failed with exit code $($info.LastTaskResult); inspect the result JSON."
      }
      return
    }
  } while ([DateTime]::UtcNow -lt $deadline)
  $info = Get-ScheduledTaskInfo -TaskName $taskName
  throw "Interactive probe timed out; task state=$state, result=$($info.LastTaskResult)."
} finally {
  if ($registered) {
    if ((Get-ScheduledTask -TaskName $taskName).State -eq 'Running') {
      Stop-ScheduledTask -TaskName $taskName
    }
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  }
}
