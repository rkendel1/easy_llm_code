# easy-llm-code distribution

The website installer endpoints publish `install.sh` and `install.ps1`. Release automation builds one self-contained executable per supported platform, computes SHA-256 sidecars, substitutes the release-manifest and Homebrew cask templates, and publishes them atomically only after certification.

Supported release targets: macOS arm64/x64, Linux arm64/x64, and Windows x64. The npm package remains the package-manager fallback and exposes both `easy-llm-code` and the temporary `llm-code` compatibility alias.

Uninstallers remove only runtime files by default. User settings and project memory are intentionally preserved.
