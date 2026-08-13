$ErrorActionPreference = "Stop"
$InstallDir = if ($env:EASY_LLM_CODE_INSTALL_DIR) { $env:EASY_LLM_CODE_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA "easy-llm-code\bin" }
@("easy-llm-code.exe", "llm-code.exe", ".easy-llm-code.previous.exe") | ForEach-Object { Remove-Item (Join-Path $InstallDir $_) -Force -ErrorAction SilentlyContinue }
Write-Host "Removed the easy-llm-code runtime. Project memory and settings were preserved."
