import type {
  ContextBundle,
  ContextQuery,
  Observation,
  Project,
  ProjectEdge,
  ProjectFile,
  ProjectSymbol
} from "./types.js";

export interface ProjectMemory {
  initialize(project: Project): Promise<void>;
  getProject(): Promise<Project>;
  upsertFile(file: ProjectFile): Promise<void>;
  upsertSymbol(symbol: ProjectSymbol): Promise<void>;
  addRelationship(edge: ProjectEdge): Promise<void>;
  recordObservation(observation: Observation): Promise<void>;
  queryContext(query: ContextQuery): Promise<ContextBundle>;
}
