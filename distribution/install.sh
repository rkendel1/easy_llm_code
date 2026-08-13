#!/bin/sh
set -eu

repository_url="${EASY_LLM_CODE_RELEASE_URL:-https://github.com/rkendel1/easy_llm_code}"
install_dir="${EASY_LLM_CODE_INSTALL_DIR:-${HOME}/.local/bin}"
version="${EASY_LLM_CODE_VERSION:-latest}"
os="$(uname -s)"
arch="$(uname -m)"
case "$os" in Darwin) os=darwin ;; Linux) os=linux ;; *) echo "Unsupported operating system: $os" >&2; exit 1 ;; esac
case "$arch" in arm64|aarch64) arch=arm64 ;; x86_64|amd64) arch=x64 ;; *) echo "Unsupported architecture: $arch" >&2; exit 1 ;; esac
artifact="easy-llm-code-${os}-${arch}"
if [ "$version" = latest ]; then release_url="$repository_url/releases/latest/download"; else case "$version" in v*) tag="$version" ;; *) tag="v$version" ;; esac; release_url="$repository_url/releases/download/$tag"; fi
temporary="$(mktemp -d "${TMPDIR:-/tmp}/easy-llm-code.XXXXXX")"
trap 'rm -rf "$temporary"' EXIT INT TERM
curl -fL --retry 3 "$release_url/$artifact" -o "$temporary/easy-llm-code"
curl -fL --retry 3 "$release_url/$artifact.sha256" -o "$temporary/easy-llm-code.sha256"
expected="$(awk '{print $1}' "$temporary/easy-llm-code.sha256")"
if command -v shasum >/dev/null 2>&1; then actual="$(shasum -a 256 "$temporary/easy-llm-code" | awk '{print $1}')"; else actual="$(sha256sum "$temporary/easy-llm-code" | awk '{print $1}')"; fi
[ "$expected" = "$actual" ] || { echo "Integrity verification failed." >&2; exit 1; }
chmod 755 "$temporary/easy-llm-code"
mkdir -p "$install_dir"
if [ -f "$install_dir/easy-llm-code" ]; then cp "$install_dir/easy-llm-code" "$install_dir/.easy-llm-code.previous"; fi
mv "$temporary/easy-llm-code" "$install_dir/easy-llm-code"
ln -sf easy-llm-code "$install_dir/llm-code"
printf '\nInstalled easy-llm-code in %s\n\nOpen a project and run:\n  easy-llm-code\n' "$install_dir"
case ":$PATH:" in *":$install_dir:"*) ;; *) printf '\nAdd %s to PATH if the command is not found.\n' "$install_dir" ;; esac
