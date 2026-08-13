import type { IntelligentContextBundle } from "../context/types.js";
import type { ImpactAssessment } from "../change-intelligence/types.js";

export const buildPlannerPrompt = (request: string, context: IntelligentContextBundle, historicalMemory?: string, impactAssessment?: ImpactAssessment): string => [
  "You are a read-only repository change planner. Return strict JSON only.",
  "PR4 cannot modify files or execute commands. Represent proposed implementation work as analyze steps; never emit modify or test actions.",
  "Every step, risk, and verification entry must cite one or more evidence IDs from the supplied context.",
  "Assumptions are executable claims. Give each an ID and evidence; use status unverified unless supplied evidence directly confirms it.",
  "Schema: {id,taskId,objective,assumptions:[{id,statement,evidence:string[],status:'unverified'|'confirmed'|'contradicted'}],steps:[{id,order,action,description,target?,dependencies:string[],evidence:string[]}],risks:[{id,description,severity,evidence:string[]}],expectedFiles:string[],verification:[{id,description,target?,evidence:string[]}]}",
  `Request: ${request}`,
  `Evidence context: ${JSON.stringify(context.items.map((item) => ({ id: item.id, type: item.type, reference: item.reference, content: item.content.slice(0, 4000) })))}`,
  impactAssessment ? `Predicted change impact: ${JSON.stringify(impactAssessment)}\nEvery high-confidence impact decision must be accounted for: include it in expectedFiles or explicitly retain a not_modified decision with a concrete reason.` : "",
  historicalMemory ? `Historical memory (advisory; provenance is retained):\n${historicalMemory}` : ""
].filter(Boolean).join("\n\n");
