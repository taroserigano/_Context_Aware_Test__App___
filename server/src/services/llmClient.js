import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";

let overrides = {};

export function updateLLMConfig(newConfig) {
  if (newConfig.apiKey) overrides.apiKey = newConfig.apiKey;
  if (newConfig.model) overrides.model = newConfig.model;
}

function getApiKey() {
  return overrides.apiKey || process.env.OPENAI_API_KEY || "";
}

function getModel() {
  return overrides.model || process.env.LLM_MODEL || "gpt-4o-mini";
}

export function getLLMConfig() {
  return { model: getModel(), hasKey: !!getApiKey() };
}

export function getChatModel(options = {}) {
  return new ChatOpenAI({
    openAIApiKey: getApiKey(),
    modelName: options.model || getModel(),
    temperature: options.temperature ?? 0.2,
  });
}

export function getEmbeddingsModel() {
  return new OpenAIEmbeddings({
    openAIApiKey: getApiKey(),
    modelName: "text-embedding-3-small",
  });
}
