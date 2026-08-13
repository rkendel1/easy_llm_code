# easy-llm-code

Your project-aware coding agent. Install it, open a project, and run one command:

```sh
easy-llm-code
```

The first launch detects the repository, Git history, available AI providers, local persistent project memory, sandbox support, and Cursor, VS Code, or Zed. Sensible local and restricted defaults are applied automatically; an easy-llm account is not required.

## Install

macOS and Linux:

```sh
curl -fsSL https://easy-llm.dev/install.sh | sh
```

Windows PowerShell:

```powershell
irm https://easy-llm.dev/install.ps1 | iex
```

Other installation methods:

```sh
brew install --cask easy-llm-code
npm install -g @easy-llm/code-agent
```

`easy-llm-code` is the canonical command. `llm-code` remains temporarily available as a compatibility alias.

## Useful commands

```sh
easy-llm-code --version
easy-llm-code doctor
easy-llm-code update
easy-llm-code ide install cursor
easy-llm-code settings
```

Project memory is persistent and local by default under `~/.easy-llm/projects`; database files and credentials are never stored in the repository. `@easy-llm/llm` owns provider discovery, credentials, model selection, and routing.

## Development

```sh
npm install
npm run build
npm test
npm run code -- --root=./fixtures/sample-project --mock "Explain how authentication works."
```

Distribution sources, installers, release templates, and the native build contract live in `distribution/`.
