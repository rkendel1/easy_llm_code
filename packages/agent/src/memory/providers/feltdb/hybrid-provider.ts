import { createFeltDBProjectMemory } from "../../feltdb-project-memory.js";
import type { Project } from "../../types.js";
export class FeltDBHybridProvider { readonly kind = "hybrid" as const; constructor(private readonly storagePath: string, private readonly endpoint: { url: string; token: string }) {} async open(project: Project) { const memory = createFeltDBProjectMemory({ root: project.root, namespace: `code-agent:${project.id}`, storagePath: this.storagePath, hybrid: this.endpoint }); await memory.initialize(project); return memory; } }
