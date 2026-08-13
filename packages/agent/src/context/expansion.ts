import { emptyReason, type ContextItem, type ExpansionPolicy } from "./types.js";

export const DEFAULT_EXPANSION: ExpansionPolicy = { maxDepth: 2, maxNodes: 50 };
const EXPANDABLE_RELATIONS = new Set(["IMPORTS", "DEPENDS_ON", "TESTS", "CALLS", "IMPLEMENTS", "EXTENDS", "CO_CHANGED", "CHANGED", "REVERTED_BY"]);

export const expandContextGraph = (input: ContextItem[], policy: ExpansionPolicy = DEFAULT_EXPANSION): ContextItem[] => {
  const items = new Map(input.map((item) => [item.id, { ...item, reason: { ...item.reason } }]));
  const relationships = input.filter((item) => item.type === "relationship" && EXPANDABLE_RELATIONS.has(String(item.metadata?.relation)));
  const seedIds = input.filter((item) => item.reason.lexical > 0).sort((a, b) => b.reason.lexical - a.reason.lexical || a.id.localeCompare(b.id)).map((item) => item.id);
  let frontier = seedIds.slice(0, policy.maxNodes);
  const visited = new Set(frontier);
  for (let depth = 1; depth <= policy.maxDepth && frontier.length && visited.size < policy.maxNodes; depth++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const relationship of relationships) {
        const from = String(relationship.metadata?.from ?? ""), to = String(relationship.metadata?.to ?? "");
        const other = from === id ? to : to === id ? from : undefined;
        if (!other || visited.has(other) || visited.size >= policy.maxNodes) continue;
        const existing = items.get(other);
        if (existing) existing.reason.structural = Math.max(existing.reason.structural, 1 / depth);
        else items.set(other, { id: other, type: "file", reference: other.replace(/^file:/, ""), score: 0,
          reason: { ...emptyReason(), structural: 1 / depth }, content: other, metadata: { expanded: true } });
        relationship.reason.structural = Math.max(relationship.reason.structural, 1 / depth);
        visited.add(other); next.push(other);
      }
    }
    frontier = next.sort();
  }
  return [...items.values()];
};
