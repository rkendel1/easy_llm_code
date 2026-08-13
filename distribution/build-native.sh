#!/bin/sh
set -eu
root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
output="${EASY_LLM_CODE_RELEASE_OUTPUT:-$root/release}"
temporary="$(mktemp -d "${TMPDIR:-/tmp}/easy-llm-code-build.XXXXXX")"
trap 'rm -rf "$temporary"' EXIT INT TERM
mkdir -p "$output"
case "$(uname -s)" in Darwin) platform=darwin ;; Linux) platform=linux ;; MINGW*|MSYS*|CYGWIN*) platform=win32 ;; *) echo "Unsupported build OS" >&2; exit 1 ;; esac
case "$(uname -m)" in arm64|aarch64) arch=arm64 ;; x86_64|amd64) arch=x64 ;; *) echo "Unsupported build architecture" >&2; exit 1 ;; esac
[ "$platform-$arch" != "win32-arm64" ] || { echo "Windows arm64 is not a release target." >&2; exit 1; }
extension=""; [ "$platform" != win32 ] || extension=.exe
artifact="$output/easy-llm-code-$platform-$arch$extension"
npx --yes esbuild@0.25.9 "$root/packages/agent/src/cli/main.ts" --bundle --platform=node --format=cjs --target=node20 --define:import.meta.url=__filename --outfile="$temporary/bundle.cjs"
sea_main="$temporary/bundle.cjs"; sea_blob="$temporary/sea-prep.blob"
if [ "$platform" = win32 ]; then sea_main="$(cygpath -m "$sea_main")"; sea_blob="$(cygpath -m "$sea_blob")"; fi
printf '{"main":"%s","output":"%s","disableExperimentalSEAWarning":true,"useSnapshot":false,"useCodeCache":false}\n' "$sea_main" "$sea_blob" > "$temporary/sea-config.json"
node --experimental-sea-config "$temporary/sea-config.json"
rm -f "$artifact" "$artifact.sha256"
cp "$(command -v node)" "$artifact"
chmod u+w "$artifact"
if [ "$platform" = darwin ]; then codesign --remove-signature "$artifact"; fi
npx --yes postject@1.0.0-alpha.6 "$artifact" NODE_SEA_BLOB "$temporary/sea-prep.blob" --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 --macho-segment-name NODE_SEA
if [ "$platform" = darwin ]; then codesign --sign - "$artifact"; fi
chmod 755 "$artifact"
if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$artifact" > "$artifact.sha256"; else sha256sum "$artifact" > "$artifact.sha256"; fi
echo "Built $artifact"
