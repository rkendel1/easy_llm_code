# easy_llm_code

## Project memory modes

The agent uses `@feltdb/core` as its only memory provider and works in two modes:

- **Local memory (zero configuration):** process-local, reactive FeltDB state. It is ephemeral and does not survive a CLI restart.
- **Durable FeltDB:** set both `FELTDB_URL` and `FELTDB_TOKEN`. Repository history, tasks, and observations then survive restarts and later CLI sessions.

Durable storage is optional. Running `npx llm-code` without credentials remains the default onboarding experience. Credentials are used for the FeltDB connection and are never printed by diagnostics.

```sh
llm-code doctor

export FELTDB_URL=https://your-feltdb.example
export FELTDB_TOKEN=your-token
llm-code doctor
```

`ProjectMemory.getCapabilities()` lets callers discover whether memory is persistent while keeping context and agent behavior independent of the configured storage mode.

## Task runtime

The CLI exposes the same resumable task runtime used by the programmatic API:

```sh
llm-code ask "Explain authentication"
llm-code plan "Refactor authentication"
llm-code edit "Fix authentication"
llm-code auto "Fix authentication"
llm-code resume <task-id>
llm-code task <task-id>
llm-code tasks
```

`edit` pauses for approval; `auto` and `--yes` continue automatically while retaining mutation, verification, path, conflict, and repair limits. Ctrl+C requests a safe checkpoint and prints the resume command.

Machine consumers can use newline-delimited lifecycle events:

```sh
llm-code --json auto "Fix authentication"
```

Programmatic consumers use `createTaskRunner({ root, memory, ... })`, call `run()` or `resume()`, and subscribe to the same event protocol rendered by the CLI.

PR1 delivers a first vertical slice for `@easy-llm/code-agent`:

repository → discovery → FeltDB project graph → context retrieval → `@easy-llm/llm` → structured response → observation persisted.

## Workspace

- `packages/agent` - `@easy-llm/code-agent`
- `apps/cli` - CLI app placeholder for future split
- `fixtures/sample-project` - certification fixture repo

## Run

```bash
npm install
npm run test
npm run code -- --root=./fixtures/sample-project --mock "Explain how authentication works."
```

`--mock` keeps the loop fully local for validation while the default path uses `@easy-llm/llm`.
