// Turn guard. No policy file: one existsSync and a plain allow. That path must not return a Promise,
// because awaiting it yields the event loop and can change turn ordering.
import { homedir, hostname as hostName } from "node:os";
import { join } from "node:path";
import type { Decision, SignoffAction } from "./policy.ts";
import {
  ENGINE_DENIED,
  ENGINE_UNAVAILABLE,
  decideAction,
  decisionContext,
  enforcesAction,
  policyFileExists,
} from "./policy.ts";

export interface GuardOptions {
  /** Workspace data dir. Defaults to OMB_DATA_DIR or ~/.openmausbot, the same formula as server/config.ts. */
  dataDir?: string;
  approvalMode?: string;
  provider?: string;
  hostname?: string;
  now?: number;
  /** When set, this object is the only environment consulted. An empty object hides the process environment. */
  env?: NodeJS.ProcessEnv;
}

/** Same expression as DATA_DIR in server/config.ts, read at call time. */
export function workspaceDataDir(): string {
  return process.env.OMB_DATA_DIR ?? join(homedir(), ".openmausbot");
}

export function isSignoffPromise(value: Decision | Promise<Decision>): value is Promise<Decision> {
  return typeof (value as { then?: unknown }).then === "function";
}

function resolved(opts?: GuardOptions): { dataDir: string; env: NodeJS.ProcessEnv; hostname: string; now: number; provider?: string } {
  return {
    dataDir: opts?.dataDir ?? workspaceDataDir(),
    env: opts?.env ?? process.env,
    hostname: opts?.hostname ?? hostName(),
    now: opts?.now ?? Date.now(),
    ...(opts?.provider !== undefined ? { provider: opts.provider } : {}),
  };
}

function opaUrl(env: NodeJS.ProcessEnv): string | undefined {
  const value = env.CLOUDBOT_OPA_URL;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.replace(/\/+$/, "") : undefined;
}

function actionsForTurn(approvalMode: string | undefined): SignoffAction[] {
  const actions: SignoffAction[] = ["bot_turn"];
  if (approvalMode === "full") actions.push("full_access");
  actions.push("model_call");
  return actions;
}

function localActions(
  dataDir: string,
  actions: SignoffAction[],
  opts: GuardOptions | undefined,
): Decision {
  const settings = resolved(opts);
  const context = decisionContext(dataDir, settings);
  if (!context.ok) return { allow: false, reason: context.reason };
  for (const action of actions) {
    const decision = decideAction(context, action);
    if (!decision.allow) return decision;
  }
  return { allow: true };
}

async function queryOpa(url: string, input: unknown): Promise<Decision> {
  try {
    const response = await fetch(`${url}/v1/data/cloudbot/signoff/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return { allow: false, reason: ENGINE_UNAVAILABLE };
    const body = await response.json() as { result?: { allow?: unknown; reason?: unknown } };
    const result = body?.result;
    if (!result || typeof result !== "object") return { allow: false, reason: ENGINE_UNAVAILABLE };
    if (result.allow === true) return { allow: true };
    if (result.allow === false) {
      const reason = typeof result.reason === "string" && result.reason.trim().length > 0 ? result.reason : ENGINE_DENIED;
      return { allow: false, reason };
    }
    return { allow: false, reason: ENGINE_UNAVAILABLE };
  } catch {
    return { allow: false, reason: ENGINE_UNAVAILABLE };
  }
}

function opaInput(context: Extract<ReturnType<typeof decisionContext>, { ok: true }>, action: SignoffAction) {
  return {
    action,
    server: context.hostname,
    ...(context.provider !== undefined ? { modelProvider: context.provider } : {}),
    now: context.now,
    policy: context.policy,
    attestations: context.attestations.map((attestation) => ({ verified: attestation.verified, predicate: attestation.predicate })),
  };
}

async function confirmWithOpa(dataDir: string, actions: SignoffAction[], opts: GuardOptions, url: string): Promise<Decision> {
  const context = decisionContext(dataDir, resolved(opts));
  if (!context.ok) return { allow: false, reason: context.reason };
  const enforced = actions.filter((action) => enforcesAction(context.policy, action));
  for (const action of enforced) {
    const decision = await queryOpa(url, opaInput(context, action));
    if (!decision.allow) return decision;
  }
  return { allow: true };
}

function afterLocalAllow(dataDir: string, actions: SignoffAction[], opts: GuardOptions | undefined, local: Decision): Decision | Promise<Decision> {
  if (!local.allow) return local;
  const url = opaUrl(resolved(opts).env);
  if (!url) return local;
  const context = decisionContext(dataDir, resolved(opts));
  if (!context.ok) return { allow: false, reason: context.reason };
  if (!actions.some((action) => enforcesAction(context.policy, action))) return local;
  return confirmWithOpa(dataDir, actions, opts ?? {}, url);
}

/**
 * Integration point for a bot turn. Checks bot_turn, then full_access when the bot is in Full access,
 * then model_call. Returns a Promise only when a policy exists, the local decision allows, and
 * CLOUDBOT_OPA_URL is set. The desktop approval channel does not use this; it calls the sync helper.
 */
export function guardTurn(opts?: GuardOptions): Decision | Promise<Decision> {
  const dataDir = opts?.dataDir ?? workspaceDataDir();
  if (!policyFileExists(dataDir)) return { allow: true };
  const actions = actionsForTurn(opts?.approvalMode);
  return afterLocalAllow(dataDir, actions, opts, localActions(dataDir, actions, opts));
}

/** One action. Same sync contract as guardTurn: no policy file returns `{ allow: true }` immediately. */
export function signoffAction(action: SignoffAction, opts?: GuardOptions): Decision | Promise<Decision> {
  const dataDir = opts?.dataDir ?? workspaceDataDir();
  if (!policyFileExists(dataDir)) return { allow: true };
  return afterLocalAllow(dataDir, [action], opts, localActions(dataDir, [action], opts));
}

/** Sync. Undefined when Full access is allowed, including when no policy file exists. Does not call OPA. */
export function signoffFullAccessRefusal(opts?: GuardOptions): string | undefined {
  const dataDir = opts?.dataDir ?? workspaceDataDir();
  if (!policyFileExists(dataDir)) return undefined;
  const decision = localActions(dataDir, ["full_access"], opts);
  return decision.allow ? undefined : (decision.reason ?? "Sign-off required");
}

/** Sync model-call refusal for paths that are not an async turn. Undefined means allow. Does not call OPA. */
export function signoffModelRefusal(provider: string, opts?: GuardOptions): string | undefined {
  const dataDir = opts?.dataDir ?? workspaceDataDir();
  if (!policyFileExists(dataDir)) return undefined;
  const decision = localActions(dataDir, ["model_call"], { ...opts, provider });
  return decision.allow ? undefined : (decision.reason ?? "Sign-off required");
}
