# easy_llm_code

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
