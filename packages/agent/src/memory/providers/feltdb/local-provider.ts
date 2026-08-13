import { createFeltDBProjectMemory } from "../../feltdb-project-memory.js";
import type { Project } from "../../types.js";
export class FeltDBLocalProvider { readonly kind = "local" as const; constructor(private readonly storagePath: string) {} async open(project: Project) { const memory = createFeltDBProjectMemory({ root: project.root, namespace: `code-agent:${project.id}`, storagePath: this.storagePath }); await memory.initialize(project); return memory; } }
