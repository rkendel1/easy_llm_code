$ErrorActionPreference = "Stop"
$RepositoryUrl = if ($env:EASY_LLM_CODE_RELEASE_URL) { $env:EASY_LLM_CODE_RELEASE_URL } else { "https://github.com/rkendel1/easy_llm_code" }
$Version = if ($env:EASY_LLM_CODE_VERSION) { $env:EASY_LLM_CODE_VERSION } else { "latest" }
$InstallDir = if ($env:EASY_LLM_CODE_INSTALL_DIR) { $env:EASY_LLM_CODE_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA "easy-llm-code\bin" }
if ($env:PROCESSOR_ARCHITECTURE -notin @("AMD64", "x86_64")) { throw "Windows x64 is currently required." }
$Artifact = "easy-llm-code-win32-x64.exe"
$ReleaseUrl = if ($Version -eq "latest") { "$RepositoryUrl/releases/latest/download" } else { $Tag = if ($Version.StartsWith("v")) { $Version } else { "v$Version" }; "$RepositoryUrl/releases/download/$Tag" }
$Temporary = Join-Path ([System.IO.Path]::GetTempPath()) ("easy-llm-code-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $Temporary | Out-Null
try {
  Invoke-WebRequest "$ReleaseUrl/$Artifact" -OutFile (Join-Path $Temporary "easy-llm-code.exe")
  Invoke-WebRequest "$ReleaseUrl/$Artifact.sha256" -OutFile (Join-Path $Temporary "easy-llm-code.sha256")
  $Expected = ((Get-Content (Join-Path $Temporary "easy-llm-code.sha256")) -split "\s+")[0].ToLower()
  $Actual = (Get-FileHash (Join-Path $Temporary "easy-llm-code.exe") -Algorithm SHA256).Hash.ToLower()
  if ($Expected -ne $Actual) { throw "Integrity verification failed." }
  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  $Target = Join-Path $InstallDir "easy-llm-code.exe"
  if (Test-Path $Target) { Copy-Item $Target (Join-Path $InstallDir ".easy-llm-code.previous.exe") -Force }
  Move-Item (Join-Path $Temporary "easy-llm-code.exe") $Target -Force
  Copy-Item $Target (Join-Path $InstallDir "llm-code.exe") -Force
  $UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
  if (($UserPath -split ";") -notcontains $InstallDir) { [Environment]::SetEnvironmentVariable("Path", ($UserPath.TrimEnd(";") + ";" + $InstallDir), "User") }
  Write-Host "Installed easy-llm-code. Open a new terminal, enter a project, and run: easy-llm-code"
} finally { Remove-Item $Temporary -Recurse -Force -ErrorAction SilentlyContinue }
