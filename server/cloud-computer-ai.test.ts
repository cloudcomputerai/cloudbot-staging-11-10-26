import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { AppConfig } from "./config.ts";
import type { InstanceConfigMap } from "./contracts.ts";
import {
  CLOUD_COMPUTER_AI_MODEL, CLOUD_COMPUTER_AI_NAME, CLOUD_COMPUTER_AI_REPLY_MINUTES, CLOUD_COMPUTER_AI_URL,
  GROK_SELECTION, REJECTED_INJECT_MODEL, cloudComputerAiInstanceId, ensureCloudEndpoint, restoreBotsOffCloud,
} from "./cloud-computer-ai.ts";
import { json, readBody } from "./harness/http.ts";
import { createInstanceRoutes, type InstanceRouteDeps } from "./routes/instances.ts";
import { dispatchRoutes } from "./routes/table.ts";
import type { ModelSelection } from "../shared/wire.ts";

const TOKEN = "desktop-token-test";
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
});

type Task = { threadId: string; modelSelection?: ModelSelection };
type Bot = { id: string; busy: boolean; modelSelection: ModelSelection; fallback?: ModelSelection[]; tasks: Task[] };

function serve(bots: Bot[]) {
  const cfg = { instances: { grok: { driver: "grok", displayName: "Grok" } }, defaultModelSelection: { instanceId: "grok", model: REJECTED_INJECT_MODEL } } as unknown as AppConfig;
  let busy = false;
  const saved: ModelSelection[] = [];
  const store = {
    bots,
    tasks: (id: string) => bots.find((bot) => bot.id === id)?.tasks ?? [],
    applyModelDefault(id: string, selection: ModelSelection) {
      const bot = bots.find((candidate) => candidate.id === id);
      if (!bot) return null;
      bot.modelSelection = { ...selection };
      return bot;
    },
    followBotModel(id: string, threadIds: readonly string[]) {
      const listed = new Set(threadIds);
      const bot = bots.find((candidate) => candidate.id === id);
      const moved: string[] = [];
      for (const task of bot?.tasks ?? []) {
        if (!listed.has(task.threadId) || !task.modelSelection) continue;
        task.modelSelection = undefined;
        moved.push(task.threadId);
      }
      return moved;
    },
  };
  const deps = {
    store, cfg, hostedModels: false,
    providerConfigBusy: { get: () => busy, set: (value: boolean) => { busy = value; } },
    providerInstancesChanging: new Set<string>(),
    describeInstances: async () => Object.entries(cfg.instances ?? {}).map(([instanceId, entry]) => ({
      instanceId, driverKind: entry.driver, displayName: entry.displayName ?? entry.driver,
    })),
    persistProviderInstance: async (_id: string, instances: InstanceConfigMap) => { cfg.instances = instances; },
    threadBusy: () => false,
    botForThread: () => null,
    activeGroupTurnForBot: () => null,
    readCloudToken: () => TOKEN,
    saveModelDefault: (selection: ModelSelection) => { cfg.defaultModelSelection = selection; saved.push(selection); },
    broadcast: () => {},
    configStatus: () => ({ ok: true }),
  } as unknown as InstanceRouteDeps;
  const routes = [createInstanceRoutes(deps)];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const handled = await dispatchRoutes(routes, {
      req, res, url, path: url.pathname, method: req.method ?? "GET",
      auth: { kind: "loopback", scopes: ["admin"] }, json, readBody,
    });
    if (!handled) json(res, 404, { error: "missing" });
  });
  servers.push(server);
  return new Promise<{ call: (method: string, path: string, body?: unknown) => Promise<{ status: number; text: string; body: any }>; cfg: AppConfig; saved: ModelSelection[] }>((ready) => {
    server.listen(0, "127.0.0.1", () => {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const call = async (method: string, path: string, body?: unknown) => {
        const response = await fetch(`${base}${path}`, {
          method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
        });
        const text = await response.text();
        return { status: response.status, text, body: JSON.parse(text) as any };
      };
      ready({ call, cfg, saved });
    });
  });
}

describe("Cloud Computer AI connection", () => {
  it("keeps one fixed server and a five minute reply wait", () => {
    const instances: InstanceConfigMap = {};
    const first = ensureCloudEndpoint(instances, TOKEN);
    const second = ensureCloudEndpoint(instances, TOKEN);
    expect(first).toEqual(second);
    expect("instanceId" in first).toBe(true);
    if (!("instanceId" in first)) return;
    expect(instances[first.instanceId]).toMatchObject({
      driver: "openai-compat", displayName: CLOUD_COMPUTER_AI_NAME,
      config: { url: CLOUD_COMPUTER_AI_URL, managedModels: [CLOUD_COMPUTER_AI_MODEL], replyWaitMinutes: CLOUD_COMPUTER_AI_REPLY_MINUTES },
    });
    expect(cloudComputerAiInstanceId(instances)).toBe(first.instanceId);
  });

  it("connect points every bot at Gemma and disconnect puts the tunnel selection back on Grok", async () => {
    const salem = { id: "salem", busy: false, modelSelection: { instanceId: "grok", model: REJECTED_INJECT_MODEL }, tasks: [{ threadId: "t1", modelSelection: { instanceId: "grok", model: REJECTED_INJECT_MODEL } }] };
    const other = { id: "other", busy: false, modelSelection: { instanceId: "claude", model: "opus" }, tasks: [{ threadId: "t2" }] };
    const { call, cfg, saved } = await serve([salem, other]);
    const connected = await call("POST", "/api/cloud-computer-ai", { action: "connect" });
    expect(connected.status, connected.text).toBe(200);
    expect(connected.text).not.toContain(TOKEN);
    expect(connected.body.connected).toBe(true);
    expect(salem.modelSelection).toEqual({ instanceId: connected.body.instances.find((row: { displayName?: string }) => row.displayName === CLOUD_COMPUTER_AI_NAME).instanceId, model: CLOUD_COMPUTER_AI_MODEL });
    expect(salem.tasks[0]?.modelSelection).toBeUndefined();
    expect(other.modelSelection.model).toBe(CLOUD_COMPUTER_AI_MODEL);
    expect(cfg.defaultModelSelection?.model).toBe(CLOUD_COMPUTER_AI_MODEL);
    const id = cloudComputerAiInstanceId(cfg.instances ?? {});
    expect(cfg.instances?.[id!]?.config).toMatchObject({ url: CLOUD_COMPUTER_AI_URL, replyWaitMinutes: CLOUD_COMPUTER_AI_REPLY_MINUTES });
    const again = await call("POST", "/api/cloud-computer-ai", { action: "connect" });
    expect(again.body.instances.filter((row: { displayName?: string }) => row.displayName === CLOUD_COMPUTER_AI_NAME)).toHaveLength(1);

    other.modelSelection = { instanceId: "claude", model: "opus" };
    const off = await call("POST", "/api/cloud-computer-ai", { action: "disconnect" });
    expect(off.status, off.text).toBe(200);
    expect(off.body.connected).toBe(false);
    expect(salem.modelSelection).toEqual(GROK_SELECTION);
    expect(other.modelSelection).toEqual({ instanceId: "claude", model: "opus" });
    expect(cfg.defaultModelSelection).toEqual(GROK_SELECTION);
    expect(cloudComputerAiInstanceId(cfg.instances ?? {})).toBeNull();
    expect(saved.at(-1)).toEqual(GROK_SELECTION);
  });

  it("refuses to connect when this computer has no token", async () => {
    const cfg = { instances: {} } as unknown as AppConfig;
    const deps = {
      store: { bots: [], tasks: () => [], applyModelDefault: () => null, followBotModel: () => [] },
      cfg, hostedModels: false,
      providerConfigBusy: { get: () => false, set: () => {} },
      providerInstancesChanging: new Set<string>(),
      describeInstances: async () => [],
      persistProviderInstance: async () => {},
      threadBusy: () => false, botForThread: () => null, activeGroupTurnForBot: () => null,
      readCloudToken: () => null,
      broadcast: () => {}, configStatus: () => ({}),
    } as unknown as InstanceRouteDeps;
    const routes = [createInstanceRoutes(deps)];
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth: { kind: "loopback", scopes: ["admin"] }, json, readBody });
    });
    servers.push(server);
    await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/cloud-computer-ai`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "connect" }),
    });
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("not set up");
  });

  it("leaves a bot on its own model when only a thread used the tunnel", () => {
    const tasks: Task[] = [{ threadId: "t", modelSelection: { instanceId: "grok", model: REJECTED_INJECT_MODEL } }];
    const bot = { id: "kept", modelSelection: { instanceId: "claude", model: "opus" }, tasks };
    const store = {
      bots: [bot],
      tasks: () => bot.tasks,
      applyModelDefault: () => { throw new Error("bot default stays"); },
      followBotModel: (_id: string, ids: readonly string[]) => { for (const task of bot.tasks) if (ids.includes(task.threadId)) task.modelSelection = undefined; return [...ids]; },
    };
    restoreBotsOffCloud(store, null);
    expect(bot.modelSelection).toEqual({ instanceId: "claude", model: "opus" });
    expect(bot.tasks[0]?.modelSelection).toBeUndefined();
  });
});
