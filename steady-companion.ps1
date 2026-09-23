# Steady Windows focus companion. Process names and focus sessions stay on this PC.
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class SteadyNative {
  [StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO info);
  [DllImport("kernel32.dll")] public static extern ulong GetTickCount64();
  [DllImport("kernel32.dll")] public static extern uint GetTickCount();
  public static double IdleSeconds() {
    LASTINPUTINFO info = new LASTINPUTINFO(); info.cbSize = (uint)Marshal.SizeOf(info);
    if (!GetLastInputInfo(ref info)) return 0;
    return unchecked((uint)(GetTickCount() - info.dwTime)) / 1000.0;
  }
}
'@

$ErrorActionPreference = 'Stop'
$dataDir = Join-Path $env:LOCALAPPDATA 'SteadyCompanion'
$settingsPath = Join-Path $dataDir 'settings.json'
New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
$saved = @{}
if (Test-Path $settingsPath) { try { $saved = Get-Content $settingsPath -Raw | ConvertFrom-Json } catch {} }

$form = New-Object Windows.Forms.Form
$form.Text = 'Steady Focus Companion'
$form.StartPosition = 'CenterScreen'
$form.Size = New-Object Drawing.Size(460, 390)
$form.MinimumSize = New-Object Drawing.Size(460, 390)
$form.Font = New-Object Drawing.Font('Segoe UI', 9)
$form.BackColor = [Drawing.Color]::FromArgb(247,247,244)
$form.MaximizeBox = $false

$title = New-Object Windows.Forms.Label
$title.Text = 'Focus alongside your practice'
$title.Font = New-Object Drawing.Font('Segoe UI Semibold', 16)
$title.Location = New-Object Drawing.Point(20, 17)
$title.Size = New-Object Drawing.Size(400, 30)
$form.Controls.Add($title)

function Add-Field([string]$labelText, [string]$value, [int]$y, [int]$width=390, [int]$x=22) {
  $label = New-Object Windows.Forms.Label
  $label.Text = $labelText; $label.Location = New-Object Drawing.Point($x,$y); $label.Size = New-Object Drawing.Size($width,18)
  $form.Controls.Add($label)
  $box = New-Object Windows.Forms.TextBox
  $box.Text = $value; $box.Location = New-Object Drawing.Point($x,($y+20)); $box.Size = New-Object Drawing.Size($width,25)
  $form.Controls.Add($box)
  return $box
}

$taskBox = Add-Field 'Practice' ([string]$saved.Task) 58
$appBox = Add-Field 'Allowed app process names (comma-separated, e.g. CapCut)' ([string]$saved.Apps) 108
$minutesBox = Add-Field 'Focus minutes' $(if ($saved.Minutes) { [string]$saved.Minutes } else { '25' }) 158 100 22
$idleBox = Add-Field 'Pause after idle minutes' $(if ($saved.IdleMinutes) { [string]$saved.IdleMinutes } else { '2' }) 158 130 140

$status = New-Object Windows.Forms.Label
$status.Text = 'Ready. Add a practice and the app you want to use.'
$status.Location = New-Object Drawing.Point(22,215); $status.Size = New-Object Drawing.Size(400,35)
$status.ForeColor = [Drawing.Color]::FromArgb(82,117,83)
$form.Controls.Add($status)

$activeLabel = New-Object Windows.Forms.Label
$activeLabel.Text = 'Current app: checking…'
$activeLabel.Location = New-Object Drawing.Point(22,251); $activeLabel.Size = New-Object Drawing.Size(400,20)
$activeLabel.ForeColor = [Drawing.Color]::DimGray
$form.Controls.Add($activeLabel)

$countdown = New-Object Windows.Forms.Label
$countdown.Text = '25:00'; $countdown.Font = New-Object Drawing.Font('Segoe UI Semibold', 24)
$countdown.Location = New-Object Drawing.Point(22,276); $countdown.Size = New-Object Drawing.Size(140,42)
$form.Controls.Add($countdown)

$startButton = New-Object Windows.Forms.Button
$startButton.Text = 'Start focus'; $startButton.Location = New-Object Drawing.Point(204,282); $startButton.Size = New-Object Drawing.Size(102,34)
$form.Controls.Add($startButton)
$stopButton = New-Object Windows.Forms.Button
$stopButton.Text = 'End'; $stopButton.Location = New-Object Drawing.Point(314,282); $stopButton.Size = New-Object Drawing.Size(75,34); $stopButton.Enabled = $false
$form.Controls.Add($stopButton)

$trayMenu = New-Object Windows.Forms.ContextMenuStrip
$showItem = $trayMenu.Items.Add('Open Steady Focus Companion')
$exitItem = $trayMenu.Items.Add('Exit')
$tray = New-Object Windows.Forms.NotifyIcon
$tray.Text = 'Steady Focus Companion'; $tray.Icon = [Drawing.SystemIcons]::Information; $tray.ContextMenuStrip = $trayMenu; $tray.Visible = $true
$showItem.Add_Click({ $form.Show(); $form.WindowState = 'Normal'; $form.Activate() })
$exitItem.Add_Click({ $tray.Visible = $false; $form.Close() })
$tray.Add_DoubleClick({ $form.Show(); $form.WindowState = 'Normal'; $form.Activate() })
$form.Add_Resize({ if ($form.WindowState -eq 'Minimized') { $form.Hide() } })
$form.Add_FormClosing({ $tray.Visible = $false })

$clock = New-Object Windows.Forms.Timer
$clock.Interval = 1000
$sessionEnds = 0L
$sessionRemaining = 0L
$graceUntil = 0L
$currentAllowed = @()
$hasPausedNotice = $false

function Get-ForegroundApp {
  $hwnd = [SteadyNative]::GetForegroundWindow()
  [uint32]$processId = 0
  [void][SteadyNative]::GetWindowThreadProcessId($hwnd, [ref]$processId)
  if ($processId -eq 0) { return 'unknown' }
  try { return (Get-Process -Id $processId -ErrorAction Stop).ProcessName.ToLowerInvariant() } catch { return 'unknown' }
}
function Get-IdleSeconds {
  return [SteadyNative]::IdleSeconds()
}
function Show-Notice([string]$heading, [string]$message) {
  $tray.BalloonTipTitle = $heading; $tray.BalloonTipText = $message
  $tray.ShowBalloonTip(6000)
  [System.Media.SystemSounds]::Asterisk.Play()
}
function Pause-Session([string]$why) {
  if ($script:sessionEnds -eq 0) { return }
  $script:sessionRemaining = [Math]::Max(0, [Math]::Ceiling(($script:sessionEnds - [SteadyNative]::GetTickCount64()) / 1000))
  $script:sessionEnds = 0L
  $status.Text = "Paused — $why. Return to the practice app and press Start focus to resume."
  $status.ForeColor = [Drawing.Color]::FromArgb(190,112,61)
  $startButton.Text = 'Resume'; $startButton.Enabled = $true; $stopButton.Enabled = $true
  if (-not $script:hasPausedNotice) { Show-Notice 'Focus timer paused' $why; $script:hasPausedNotice = $true }
}

$clock.Add_Tick({
  $appName = Get-ForegroundApp
  $activeLabel.Text = "Current app: $appName"
  if ($script:sessionEnds -eq 0) { return }
  $now = [SteadyNative]::GetTickCount64()
  if ($now -lt $script:graceUntil) { return }
  $self = (Get-Process -Id $PID).ProcessName.ToLowerInvariant()
  if ($appName -ne $self -and $appName -notin $script:currentAllowed) {
    Pause-Session "Switched to $appName instead of the selected practice app."
    return
  }
  $idleMinutes = [Math]::Max(1, [int]$idleBox.Text)
  if ((Get-IdleSeconds) -ge ($idleMinutes * 60)) {
    Pause-Session "No keyboard or mouse activity for $idleMinutes minute(s)."
    return
  }
  $remaining = [Math]::Max(0, [Math]::Ceiling(($script:sessionEnds - $now) / 1000))
  $countdown.Text = ('{0:00}:{1:00}' -f [Math]::Floor($remaining / 60), ($remaining % 60))
  if ($remaining -le 0) {
    $script:sessionEnds = 0L; $script:sessionRemaining = 0L; $startButton.Text = 'Start focus'; $startButton.Enabled = $true; $stopButton.Enabled = $false
    $status.Text = "Session complete: $($taskBox.Text). Log the result in Steady when you’re ready."
    $status.ForeColor = [Drawing.Color]::FromArgb(82,117,83)
    Show-Notice 'Focus session complete' "Nice work showing up for $($taskBox.Text)."
  }
})

$startButton.Add_Click({
  $task = $taskBox.Text.Trim()
  $names = @($appBox.Text -split ',' | ForEach-Object { ($_ -replace '\.exe$','').Trim().ToLowerInvariant() } | Where-Object { $_ })
  if (-not $task -or -not $names.Count) { [Windows.Forms.MessageBox]::Show('Enter a practice and at least one allowed app process name.','Steady Focus Companion') | Out-Null; return }
  $minutes = [Math]::Max(1,[Math]::Min(240,[int]$minutesBox.Text))
  $idle = [Math]::Max(1,[Math]::Min(60,[int]$idleBox.Text))
  $script:currentAllowed = $names
  @{ Task=$task; Apps=($appBox.Text.Trim()); Minutes=$minutes; IdleMinutes=$idle } | ConvertTo-Json | Set-Content -LiteralPath $settingsPath -Encoding UTF8
  if ($script:sessionRemaining -le 0) { $script:sessionRemaining = [int64]$minutes * 60 }
  $script:sessionEnds = [SteadyNative]::GetTickCount64() + ($script:sessionRemaining * 1000)
  $script:graceUntil = [SteadyNative]::GetTickCount64() + 7000
  $script:hasPausedNotice = $false
  $status.Text = "Focusing on $task in $($names -join ', '). Switching apps or going idle pauses the timer."
  $status.ForeColor = [Drawing.Color]::FromArgb(82,117,83)
  $startButton.Text = 'Resume'; $startButton.Enabled = $false; $stopButton.Enabled = $true
  $clock.Start()
})
$stopButton.Add_Click({
  $clock.Stop(); $script:sessionEnds = 0L; $script:sessionRemaining = 0L; $startButton.Text = 'Start focus'; $startButton.Enabled = $true; $stopButton.Enabled = $false
  $countdown.Text = ('{0:00}:00' -f [Math]::Max(1,[int]$minutesBox.Text))
  $status.Text = 'Ready for the next practice session.'; $status.ForeColor = [Drawing.Color]::FromArgb(82,117,83)
})
$form.Add_Shown({ $clock.Start() })
[void][Windows.Forms.Application]::Run($form)
