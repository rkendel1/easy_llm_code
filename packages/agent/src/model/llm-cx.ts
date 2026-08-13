import { llm, type LLMCallOptions, type LLMInput, type LLMResponse, type ModelDefinition, type RoutingExplanation } from "@easy-llm/llm";
import { CredentialStore } from "@easy-llm/llm/secrets";

const credentialEnvironment: Record<string, string> = { openai: "OPENAI_API_KEY", anthropic: "ANTHROPIC_API_KEY", google: "GOOGLE_API_KEY", openrouter: "OPENROUTER_API_KEY" };
let initialized = false;
export interface ModelCXStatus { ready: boolean; mode: "automatic"; providers: string[]; credentialSources: Array<{ provider: string; source: "environment" | "vault" }>; vaultConfigured: boolean; models: Array<{ id: string; name: string; provider: string; reasoning: ModelDefinition["capabilities"]["reasoning"]; vision: ModelDefinition["capabilities"]["vision"] }> }

export const initializeModelCX = async (): Promise<ModelCXStatus> => {
  const vault = new CredentialStore(), vaultConfigured = vault.vaultExists();
  if (!initialized) { await llm.initializeDefaultProviders({ openaiApiKey: process.env.OPENAI_API_KEY, anthropicApiKey: process.env.ANTHROPIC_API_KEY, googleApiKey: process.env.GOOGLE_API_KEY, openrouterApiKey: process.env.OPENROUTER_API_KEY }); initialized = true; }
  await llm.loadModelRegistryCache().catch(() => undefined); const catalog = llm.queryModels().all() as ModelDefinition[];
  const providers = llm.listProviders().map((provider) => provider.id), credentialSources = providers.filter((provider) => provider in credentialEnvironment).map((provider) => ({ provider, source: process.env[credentialEnvironment[provider]] ? "environment" as const : "vault" as const }));
  return { ready: providers.length > 0, mode: "automatic", providers, credentialSources, vaultConfigured, models: catalog.map((model) => ({ id: model.id, name: model.name ?? model.id, provider: model.provider, reasoning: model.capabilities.reasoning ?? false, vision: model.capabilities.vision ?? false })) };
};

export const invokeModel = async <T = unknown>(input: LLMInput<T>, options?: LLMCallOptions<T>): Promise<LLMResponse<T>> => { await initializeModelCX(); return typeof input === "string" && options ? llm<T>(input, options) : llm<T>(input); };
export const explainModelRoute = async (input: LLMInput): Promise<RoutingExplanation> => { await initializeModelCX(); return llm.explain(input); };
