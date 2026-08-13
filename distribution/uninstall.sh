#!/bin/sh
set -eu
install_dir="${EASY_LLM_CODE_INSTALL_DIR:-${HOME}/.local/bin}"
rm -f "$install_dir/easy-llm-code" "$install_dir/llm-code" "$install_dir/.easy-llm-code.previous"
echo "Removed the easy-llm-code runtime. Project memory and settings were preserved."
echo "To remove local data too, delete ~/.easy-llm and ~/.config/easy-llm-code."
