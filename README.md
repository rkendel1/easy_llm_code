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
