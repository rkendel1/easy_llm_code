import { createFeltDBProjectMemory } from "../../feltdb-project-memory.js";
import type { Project } from "../../types.js";
export class FeltDBHostedProvider { readonly kind = "hosted" as const; constructor(private readonly endpoint: { url: string; token: string }) {} async open(project: Project) { const memory = createFeltDBProjectMemory({ root: project.root, namespace: `code-agent:${project.id}`, server: this.endpoint }); await memory.initialize(project); return memory; } }
