import { createFeltDB } from "@feltdb/core";
import type { ProjectMemory } from "./project-memory.js";
import type {
  ContextBundle,
  ContextFile,
  ContextQuery,
  ContextSymbol,
  Observation,
  Project,
  ProjectEdge,
  ProjectFile,
  ProjectSymbol
} from "./types.js";

interface StoredObservation extends Observation {
  id: string;
  projectId: string;
}

interface MemoryOptions {
  root: string;
  namespace?: string;
}

const tokenize = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^a-z0-9_./-]+/)
    .filter(Boolean);

const stringScore = (text: string, queryText: string, tokens: string[]): number => {
  const lower = text.toLowerCase();
  let score = lower.includes(queryText) ? 4 : 0;
  for (const token of tokens) {
    if (lower.includes(token)) {
      score += 1;
      continue;
    }
    if (token.length >= 4) {
      const fragment = token.slice(0, 4);
      if (lower.includes(fragment)) {
        score += 1;
      }
    }
  }
  return score;
};

const firstReason = (reasons: string[]): string => reasons[0] ?? "graph expansion";

export const createFeltDBProjectMemory = (options: MemoryOptions): ProjectMemory => {
  const db = createFeltDB({
    namespace: options.namespace ?? `code-agent:${options.root}`,
    memory: true
  });

  const projects = db.collection<Project & { id: string }>("projects");
  const files = db.collection<ProjectFile & { projectId: string }>("files");
  const symbols = db.collection<ProjectSymbol & { projectId: string }>("symbols");
  const edges = db.collection<ProjectEdge & { projectId: string }>("edges");
  const observations = db.collection<StoredObservation>("observations");

  let currentProjectId: string | undefined;

  const upsertById = async <T extends { id: string }>(collection: {
    find(query: Record<string, unknown>): Promise<T[]>;
    insert(item: T): Promise<string>;
    update(id: string, updates: Partial<T>): Promise<void>;
  }, item: T): Promise<void> => {
    const existing = await collection.find({ id: item.id });
    if (existing.length > 0) {
      await collection.update(item.id, item);
      return;
    }
    await collection.insert(item);
  };

  const ensureProjectId = (): string => {
    if (!currentProjectId) {
      throw new Error("Project memory not initialized");
    }
    return currentProjectId;
  };

  return {
    async initialize(project) {
      currentProjectId = project.id;
      await upsertById(projects as never, project);
    },

    async getProject() {
      const projectId = ensureProjectId();
      const match = await projects.find({ id: projectId });
      if (match.length === 0) {
        throw new Error(`Project ${projectId} not found`);
      }
      return match[0];
    },

    async upsertFile(file) {
      const projectId = ensureProjectId();
      await upsertById(files as never, { ...file, projectId });
    },

    async upsertSymbol(symbol) {
      const projectId = ensureProjectId();
      await upsertById(symbols as never, { ...symbol, projectId });
    },

    async addRelationship(edge) {
      const projectId = ensureProjectId();
      await upsertById(edges as never, { ...edge, projectId });
    },

    async recordObservation(observation) {
      const projectId = ensureProjectId();
      const id = `${observation.type}:${observation.taskId}:${observation.timestamp}`;
      await upsertById(observations as never, {
        ...observation,
        id,
        projectId
      });
    },

    async queryContext(query: ContextQuery): Promise<ContextBundle> {
      const projectId = ensureProjectId();
      const queryText = query.text.toLowerCase();
      const tokens = tokenize(query.text);
      const [projectFiles, projectSymbols, projectEdges, projectObservations] = await Promise.all([
        files.find({ projectId }),
        symbols.find({ projectId }),
        edges.find({ projectId }),
        observations.find({ projectId })
      ]);

      const scoreByFile = new Map<string, { score: number; reasons: string[] }>();
      const scoreBySymbol = new Map<string, { score: number; reasons: string[] }>();

      for (const file of projectFiles) {
        const pathScore = stringScore(file.path, queryText, tokens);
        if (pathScore > 0) {
          scoreByFile.set(file.id, {
            score: pathScore,
            reasons: ["path match"]
          });
        }
      }

      for (const symbol of projectSymbols) {
        const symbolScore = stringScore(symbol.name, queryText, tokens);
        if (symbolScore > 0) {
          scoreBySymbol.set(symbol.id, {
            score: symbolScore,
            reasons: ["symbol match"]
          });
          const fileScore = scoreByFile.get(symbol.fileId) ?? { score: 0, reasons: [] };
          fileScore.score += symbolScore;
          fileScore.reasons.push("symbol in file match");
          scoreByFile.set(symbol.fileId, fileScore);
        }
      }

      for (const observation of projectObservations) {
        const text = JSON.stringify(observation.content).toLowerCase();
        const obsScore = stringScore(text, queryText, tokens);
        if (obsScore <= 0) {
          continue;
        }
        for (const file of projectFiles) {
          if (text.includes(file.path.toLowerCase()) || tokens.some((token) => file.path.toLowerCase().includes(token))) {
            const prior = scoreByFile.get(file.id) ?? { score: 0, reasons: [] };
            prior.score += obsScore + 1;
            prior.reasons.push("observation memory match");
            scoreByFile.set(file.id, prior);
          }
        }
      }

      const selectedIds = new Set<string>();
      const limit = query.limit ?? 12;

      const topFileIds = [...scoreByFile.entries()]
        .sort((a, b) => b[1].score - a[1].score)
        .slice(0, limit)
        .map(([id]) => id);

      for (const id of topFileIds) {
        selectedIds.add(id);
      }

      for (const edge of projectEdges) {
        if (selectedIds.has(edge.from) || selectedIds.has(edge.to)) {
          selectedIds.add(edge.from);
          selectedIds.add(edge.to);
          if (edge.relation === "TESTS") {
            selectedIds.add(edge.from);
            selectedIds.add(edge.to);
          }
        }
      }

      const contextFiles: ContextFile[] = projectFiles
        .filter((file) => selectedIds.has(file.id))
        .map((file) => {
          const scored = scoreByFile.get(file.id);
          return {
            ...file,
            score: scored?.score ?? 1,
            reason: firstReason(scored?.reasons ?? [])
          };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      const contextSymbols: ContextSymbol[] = projectSymbols
        .filter((symbol) => selectedIds.has(symbol.id) || selectedIds.has(symbol.fileId))
        .map((symbol) => {
          const scored = scoreBySymbol.get(symbol.id);
          return {
            ...symbol,
            score: scored?.score ?? 1,
            reason: firstReason(scored?.reasons ?? ["symbol attached to relevant file"])
          };
        })
        .slice(0, limit * 3);

      const relationships = projectEdges.filter(
        (edge) => selectedIds.has(edge.from) || selectedIds.has(edge.to)
      );

      return {
        files: contextFiles,
        symbols: contextSymbols,
        relationships
      };
    }
  };
};
