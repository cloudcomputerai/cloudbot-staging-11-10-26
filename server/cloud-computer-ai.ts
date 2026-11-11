import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "./config.ts";
import type { InstanceConfigMap } from "./contracts.ts";
import { addEndpoint } from "./openai-compat-endpoints.ts";
import type { ModelSelection } from "../shared/wire.ts";

export const CLOUD_COMPUTER_AI_URL = "https://app.cloudcomputerai.com/api/local-model/v1";
export const CLOUD_COMPUTER_AI_MODEL = "gemma4:12b";
export const CLOUD_COMPUTER_AI_NAME = "Cloud Computer AI";
export const CLOUD_COMPUTER_AI_REPLY_MINUTES = 5;
export const CLOUD_COMPUTER_AI_TOKEN_FILE = "cloud-computer-ai.token";
/** The rejected localhost tunnel selection. Connect replaces it; disconnect leaves it. */
export const REJECTED_INJECT_MODEL = "ollama::gemma4:12b";
export const GROK_SELECTION: ModelSelection = { instanceId: "grok", model: "grok-4.7" };

const NOT_SET_UP = "Cloud Computer AI is not set up on this computer.";

export function readCloudComputerAiToken(dir = DATA_DIR): string | null {
  try {
    const text = readFileSync(join(dir, CLOUD_COMPUTER_AI_TOKEN_FILE), "utf8").trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

export function cloudComputerAiInstanceId(instances: InstanceConfigMap): string | null {
  for (const [id, entry] of Object.entries(instances)) {
    if (entry?.driver !== "openai-compat") continue;
    const url = (entry.config as { url?: unknown } | undefined)?.url;
    if (typeof url === "string" && url.replace(/\/+$/, "") === CLOUD_COMPUTER_AI_URL) return id;
  }
  return null;
}

export function selectionUsesCloud(selection: ModelSelection | undefined, instanceId: string | null): boolean {
  if (!selection) return false;
  if (selection.model === REJECTED_INJECT_MODEL) return true;
  return Boolean(instanceId && selection.instanceId === instanceId);
}

/** Create or reuse the fixed OpenAI-compatible server. The key stays in the instance config the driver already sends. */
export function ensureCloudEndpoint(instances: InstanceConfigMap, key: string): { instanceId: string } | { error: string } {
  const existing = cloudComputerAiInstanceId(instances);
  const config = {
    key,
    url: CLOUD_COMPUTER_AI_URL,
    managedModels: [CLOUD_COMPUTER_AI_MODEL],
    replyWaitMinutes: CLOUD_COMPUTER_AI_REPLY_MINUTES,
  };
  if (existing) {
    const entry = instances[existing]!;
    instances[existing] = { ...entry, driver: "openai-compat", displayName: CLOUD_COMPUTER_AI_NAME, access: entry.access ?? "api", config: { ...(entry.config as Record<string, unknown>), ...config } };
    return { instanceId: existing };
  }
  const added = addEndpoint(instances, {
    displayName: CLOUD_COMPUTER_AI_NAME,
    url: CLOUD_COMPUTER_AI_URL,
    key,
    models: [CLOUD_COMPUTER_AI_MODEL],
  });
  if ("error" in added) return added;
  const entry = instances[added.instanceId]!;
  entry.config = { ...(entry.config as Record<string, unknown>), replyWaitMinutes: CLOUD_COMPUTER_AI_REPLY_MINUTES };
  return added;
}

export interface CloudBotTarget {
  id: string;
  modelSelection: ModelSelection;
  fallback?: ModelSelection[];
}

export interface CloudBotStore {
  bots: CloudBotTarget[];
  tasks(id: string): ReadonlyArray<{ threadId: string; modelSelection?: ModelSelection }>;
  applyModelDefault(id: string, selection: ModelSelection): unknown;
  followBotModel(id: string, threadIds: readonly string[]): unknown;
}

export function pointEveryBot(store: CloudBotStore, selection: ModelSelection): void {
  for (const id of store.bots.map((bot) => bot.id)) {
    store.applyModelDefault(id, selection);
    const threads = store.tasks(id).map((task) => task.threadId);
    if (threads.length) store.followBotModel(id, threads);
  }
}

/** Move bots and threads off this server, and off the rejected tunnel model, before the server is removed. */
export function restoreBotsOffCloud(store: CloudBotStore, instanceId: string | null): void {
  for (const bot of [...store.bots]) {
    const tasks = store.tasks(bot.id);
    const modelHit = selectionUsesCloud(bot.modelSelection, instanceId);
    const taskHits = tasks.filter((task) => selectionUsesCloud(task.modelSelection, instanceId)).map((task) => task.threadId);
    const fallbackHit = Boolean(instanceId && bot.fallback?.some((item) => item.instanceId === instanceId));
    if (fallbackHit && bot.fallback) {
      const kept = bot.fallback.filter((item) => item.instanceId !== instanceId);
      bot.fallback = kept.length ? kept : undefined;
    }
    if (modelHit) {
      store.applyModelDefault(bot.id, GROK_SELECTION);
      const threads = tasks.map((task) => task.threadId);
      if (threads.length) store.followBotModel(bot.id, threads);
    } else if (fallbackHit) {
      store.applyModelDefault(bot.id, bot.modelSelection);
      if (taskHits.length) store.followBotModel(bot.id, taskHits);
    } else if (taskHits.length) {
      store.followBotModel(bot.id, taskHits);
    }
  }
}

export function cloudSetupError(): string {
  return NOT_SET_UP;
}
