import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProjectMemory } from "../memory/project-memory.js";
import { lexicalRelevance } from "./query.js";
import { emptyReason, type ContextItem } from "./types.js";

const ageScore = (timestamp: string, newestTimestamp: number): number =>
  Math.max(0, 1 - (newestTimestamp - Date.parse(timestamp)) / (365 * 86400000));
const safeRead = async (root: string, path: string): Promise<string> => { try { return await readFile(join(root, path), "utf8"); } catch { return ""; } };

export const generateContextCandidates = async ({ request, memory }: { request: string; memory: ProjectMemory }): Promise<ContextItem[]> => {
  const project = await memory.getProject();
  const [current, history] = await Promise.all([
    memory.queryContext({ text: request, limit: 50 }),
    memory.getRelatedChanges({ text: request, limit: 20 })
  ]);
  const candidates = new Map<string, ContextItem>();
  const projectPaths = current.files.map((file) => file.path);
  const newestCommitTimestamp = Math.max(0, ...history.map((record) => Date.parse(record.commit.timestamp)));
  const put = (item: ContextItem): void => {
    const prior = candidates.get(item.id);
    if (!prior) { candidates.set(item.id, item); return; }
    for (const key of Object.keys(item.reason) as (keyof ContextItem["reason"])[]) prior.reason[key] = Math.max(prior.reason[key], item.reason[key]);
  };

  await Promise.all(current.files.map(async (file) => {
    const content = await safeRead(project.root, file.path);
    const reason = emptyReason(); reason.lexical = lexicalRelevance(`${file.path}\n${content}`, request);
    if (file.reason.includes("co-changed")) reason.coChange = Math.min(1, file.score);
    if (/dependency|imports|tests|contains/i.test(file.reason)) reason.structural = Math.min(1, file.score);
    put({ id: file.id, type: /(^|\/)test|\.test\./i.test(file.path) ? "test" : "file", reference: file.path,
      score: 0, reason, content, metadata: { path: file.path, language: file.language, sourceReason: file.reason } });
  }));
  for (const symbol of current.symbols) {
    const reason = emptyReason(); reason.lexical = lexicalRelevance(symbol.name, request); reason.structural = 0.4;
    put({ id: symbol.id, type: "symbol", reference: symbol.name, score: 0, reason, content: `${symbol.kind} ${symbol.name}`,
      metadata: { fileId: symbol.fileId, kind: symbol.kind } });
  }
  for (const edge of current.relationships) {
    const reason = emptyReason(); reason.structural = edge.confidence * (edge.relation === "CONTAINS" ? 0.2 : edge.relation === "EXPORTS" ? 0.4 : 1);
    if (edge.relation === "CO_CHANGED") reason.coChange = edge.confidence;
    if (["CHANGED", "REVERTED_BY", "PARENT_OF"].includes(edge.relation)) reason.historical = edge.confidence;
    put({ id: edge.id, type: "relationship", reference: `${edge.from} ${edge.relation} ${edge.to}`, score: 0, reason,
      content: `${edge.from} --${edge.relation}--> ${edge.to}`, metadata: { from: edge.from, to: edge.to, relation: edge.relation } });
    for (const endpoint of [edge.from, edge.to]) {
      if (!endpoint.startsWith("file:") || candidates.has(endpoint)) continue;
      const path = endpoint.slice("file:".length);
      const content = await safeRead(project.root, path);
      const endpointReason = emptyReason(); endpointReason.structural = edge.confidence;
      put({ id: endpoint, type: /(^|\/)test|\.test\./i.test(path) ? "test" : "file", reference: path,
        score: 0, reason: endpointReason, content, metadata: { path, sourceReason: edge.relation } });
    }
  }
  for (const record of history) {
    const relevantChanges = record.files.filter((change) => {
      const path = change.newPath ?? change.oldPath ?? change.fileId.replace(/^file:/, "");
      return lexicalRelevance(path, request) > 0 || projectPaths.some((projectPath) => path === projectPath || path.endsWith(`/${projectPath}`));
    });
    const commitLexical = lexicalRelevance(record.commit.message, request);
    if (commitLexical === 0 && relevantChanges.length === 0) continue;
    const reason = emptyReason(); reason.lexical = commitLexical; reason.historical = record.revertedBy ? 1 : 0.7; reason.recency = ageScore(record.commit.timestamp, newestCommitTimestamp);
    put({ id: record.commit.id, type: "commit", reference: `commit ${record.commit.sha.slice(0, 8)}`, score: 0, reason,
      content: `${record.commit.sha}\n${record.commit.message}`, metadata: { sha: record.commit.sha, timestamp: record.commit.timestamp, revertedBy: record.revertedBy } });
    for (const change of relevantChanges) {
      const path = change.newPath ?? change.oldPath ?? change.fileId.replace(/^file:/, "");
      const changeReason = { ...reason, lexical: lexicalRelevance(path, request), historical: 0.8 };
      put({ id: change.id, type: "change", reference: change.newPath ?? change.oldPath ?? change.fileId, score: 0,
        reason: changeReason, content: `${change.changeType} ${change.oldPath ?? ""} ${change.newPath ?? ""} +${change.additions} -${change.deletions}`,
        metadata: { commitId: change.commitId, fileId: change.fileId } });
    }
  }
  for (const observation of current.observations ?? []) {
    const content = JSON.stringify(observation.content);
    const reason = emptyReason(); reason.lexical = lexicalRelevance(content, request); reason.memory = 1;
    put({ id: `observation:${observation.id ?? `${observation.taskId}:${observation.timestamp}`}`, type: "observation",
      reference: `${observation.type} ${observation.taskId}`, score: 0, reason, content,
      metadata: { taskId: observation.taskId, timestamp: observation.timestamp } });
  }
  return [...candidates.values()];
};
