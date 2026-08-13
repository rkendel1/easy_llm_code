import type { IDEIntegration } from "@easy-llm/code-ide";
import { CursorIDEAdapter } from "./adapters/cursor.js";
import { VSCodeIDEAdapter } from "./adapters/vscode.js";
import { ZedIDEAdapter } from "./adapters/zed.js";
import { IDEIntegrationError } from "./errors.js";
export class IDERegistry { private readonly adapters = new Map<string, IDEIntegration>(); register(adapter: IDEIntegration): this { if (this.adapters.has(adapter.id)) throw new IDEIntegrationError("IDE_ALREADY_REGISTERED", adapter.id); this.adapters.set(adapter.id, adapter); return this; } get(id: string): IDEIntegration { const adapter = this.adapters.get(id); if (!adapter) throw new IDEIntegrationError("IDE_NOT_REGISTERED", id); return adapter; } list(): IDEIntegration[] { return [...this.adapters.values()].sort((a, b) => a.id.localeCompare(b.id)); } async detect() { return Promise.all(this.list().map(async (adapter) => ({ adapter, detection: await adapter.detect() }))); } }
export const createIDERegistry = () => new IDERegistry().register(new VSCodeIDEAdapter()).register(new CursorIDEAdapter()).register(new ZedIDEAdapter());
