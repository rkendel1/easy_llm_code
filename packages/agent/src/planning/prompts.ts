import type { IntelligentContextBundle } from "../context/types.js";

export const buildPlannerPrompt = (request: string, context: IntelligentContextBundle): string => [
  "You are a read-only repository change planner. Return strict JSON only.",
  "PR4 cannot modify files or execute commands. Represent proposed implementation work as analyze steps; never emit modify or test actions.",
  "Every step, risk, and verification entry must cite one or more evidence IDs from the supplied context.",
  "Schema: {id,taskId,objective,assumptions:string[],steps:[{id,order,action,description,target?,dependencies:string[],evidence:string[]}],risks:[{id,description,severity,evidence:string[]}],expectedFiles:string[],verification:[{id,description,target?,evidence:string[]}]}",
  `Request: ${request}`,
  `Evidence context: ${JSON.stringify(context.items.map((item) => ({ id: item.id, type: item.type, reference: item.reference, content: item.content.slice(0, 4000) })))}`
].join("\n\n");
