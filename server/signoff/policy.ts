// Officer sign-off decisions. This file and deploy/signoff/opa/signoff.rego must agree.
// A signature records a decision. It does not certify HIPAA, ISO, or GDPR.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, type Dirent } from "node:fs";
import { hostname as hostName } from "node:os";
import { join } from "node:path";

export const PREDICATE_TYPE = "https://cloudbot.dev/signoff/v1";
export const STATEMENT_TYPE = "https://in-toto.io/Statement/v1";
export const SIGNOFF_DISCLAIMER = "A signature records a decision. It does not certify HIPAA, ISO, or GDPR.";
export const NO_POLICY_MESSAGE = "No sign-off policy: this workspace runs as usual.";
export const POLICY_FILE = "signoff-policy.json";
export const INVALID_POLICY = "Sign-off required: policy file is invalid";
export const NO_ROLES = "Sign-off required: policy file has no required roles";
export const ENGINE_UNAVAILABLE = "Sign-off required: policy engine unavailable";
export const ENGINE_DENIED = "Sign-off required: policy engine denied the request";

const MAX_BYTES = 1_048_576;
const VERIFY_TIMEOUT_MS = 15_000;

export type SignoffAction = "bot_turn" | "full_access" | "model_call";

export interface SignoffPolicy {
  requiredRoles: string[];
  frameworks?: string[];
  server?: string;
  allowedProviders?: string[];
  keycloakUrl?: string;
  /** Absent or empty means every action is enforced. */
  actions?: SignoffAction[];
  /** `trust-local` skips the external verifier. Testing only. */
  verification?: "trust-local" | "required";
}

export interface AttestationPredicate {
  role: string;
  frameworks?: string[];
  server?: string;
  allowedProviders?: string[];
  expiresAt?: string;
  signer?: string;
}

export interface LoadedAttestation {
  verified: boolean;
  predicate: AttestationPredicate;
}

export interface DecisionInput {
  action: SignoffAction;
  server: string;
  modelProvider?: string;
  now: number;
  policy: SignoffPolicy;
  attestations: LoadedAttestation[];
}

export interface Decision {
  allow: boolean;
  reason?: string;
}

export interface RoleStatus {
  role: string;
  status: "valid" | "missing" | "expired";
  expiresAt: string | null;
  reason?: string;
}

export interface SignoffStatus {
  enforced: boolean;
  disclaimer: string;
  message?: string;
  requiredRoles?: string[];
  frameworks?: string[];
  server?: string;
  allowedProviders?: string[];
  keycloakUrl?: string;
  roles?: RoleStatus[];
  /** True only when the policy sets verification to trust-local. */
  testingOnly?: boolean;
}

export function policyPath(dataDir: string): string {
  return join(dataDir, POLICY_FILE);
}

/** One stat. Callers must not cache a miss: a policy can appear later in this process. */
export function policyFileExists(dataDir: string): boolean {
  return existsSync(policyPath(dataDir));
}

const ANTHROPIC = new Set(["claude", "claudeagent", "anthropic"]);
const OPENAI = new Set(["openai", "openai-compat", "openaicompat", "codex"]);
const XAI = new Set(["xai", "grok", "grokagent"]);

export function canonicalProvider(name: string): string {
  const key = name.toLowerCase();
  if (ANTHROPIC.has(key)) return "anthropic";
  if (OPENAI.has(key)) return "openai";
  if (XAI.has(key)) return "xai";
  return key;
}

export function providerAllowed(provider: string | undefined, allow: readonly string[] | undefined): boolean {
  if (!allow || allow.length === 0) return true;
  if (!provider) return false;
  const canon = canonicalProvider(provider);
  return allow.some((entry) => entry.toLowerCase() === provider.toLowerCase() || canonicalProvider(entry) === canon);
}

function isSignoffAction(value: unknown): value is SignoffAction {
  return value === "bot_turn" || value === "full_access" || value === "model_call";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/** Absent or empty actions enforce every action. A non-empty list with no known action is an invalid policy. */
export function enforcesAction(policy: SignoffPolicy, action: SignoffAction): boolean {
  if (!policy.actions || policy.actions.length === 0) return true;
  return policy.actions.includes(action);
}

export function parsePolicy(value: unknown): { ok: true; policy: SignoffPolicy } | { ok: false; reason: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, reason: INVALID_POLICY };
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.requiredRoles)) return { ok: false, reason: INVALID_POLICY };
  if (raw.requiredRoles.length === 0) return { ok: false, reason: NO_ROLES };
  if (!raw.requiredRoles.every((role) => typeof role === "string" && role.length > 0)) return { ok: false, reason: INVALID_POLICY };
  if (raw.frameworks !== undefined && !isStringArray(raw.frameworks)) return { ok: false, reason: INVALID_POLICY };
  if (raw.allowedProviders !== undefined && !isStringArray(raw.allowedProviders)) return { ok: false, reason: INVALID_POLICY };
  if (raw.server !== undefined && typeof raw.server !== "string") return { ok: false, reason: INVALID_POLICY };
  if (raw.keycloakUrl !== undefined && typeof raw.keycloakUrl !== "string") return { ok: false, reason: INVALID_POLICY };
  let actions: SignoffAction[] | undefined;
  if (raw.actions !== undefined) {
    if (!Array.isArray(raw.actions) || raw.actions.some((item) => typeof item !== "string")) return { ok: false, reason: INVALID_POLICY };
    const known = raw.actions.filter(isSignoffAction);
    if (raw.actions.length > 0 && known.length === 0) return { ok: false, reason: INVALID_POLICY };
    actions = known;
  }
  const verification = raw.verification === "trust-local" ? "trust-local" : raw.verification === undefined ? undefined : "required";
  const policy: SignoffPolicy = { requiredRoles: raw.requiredRoles };
  if (raw.frameworks && raw.frameworks.length > 0) policy.frameworks = raw.frameworks;
  if (typeof raw.server === "string" && raw.server.length > 0) policy.server = raw.server;
  if (raw.allowedProviders && raw.allowedProviders.length > 0) policy.allowedProviders = raw.allowedProviders;
  if (typeof raw.keycloakUrl === "string" && raw.keycloakUrl.length > 0) policy.keycloakUrl = raw.keycloakUrl;
  if (actions && actions.length > 0) policy.actions = actions;
  if (verification) policy.verification = verification;
  return { ok: true, policy };
}

export function readPolicy(dataDir: string): { ok: true; policy: SignoffPolicy } | { ok: false; reason: string } {
  const path = policyPath(dataDir);
  let text: string;
  try {
    const info = statSync(path);
    if (!info.isFile() || info.size > MAX_BYTES) return { ok: false, reason: INVALID_POLICY };
    text = readFileSync(path, "utf8");
  } catch {
    return { ok: false, reason: INVALID_POLICY };
  }
  try {
    return parsePolicy(JSON.parse(text) as unknown);
  } catch {
    return { ok: false, reason: INVALID_POLICY };
  }
}

function safeAttestationName(name: string): boolean {
  return name.endsWith(".json") && !name.endsWith(".bundle") && !name.includes("..") && !name.includes("/") && !name.includes("\\");
}

function stringList(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!isStringArray(value)) return undefined;
  return value;
}

function predicateOf(value: unknown): AttestationPredicate | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.role !== "string" || raw.role.length === 0) return undefined;
  if (raw.frameworks !== undefined && !isStringArray(raw.frameworks)) return undefined;
  if (raw.allowedProviders !== undefined && !isStringArray(raw.allowedProviders)) return undefined;
  const predicate: AttestationPredicate = { role: raw.role };
  const frameworks = stringList(raw.frameworks);
  const allowedProviders = stringList(raw.allowedProviders);
  if (frameworks) predicate.frameworks = frameworks;
  if (typeof raw.server === "string" && raw.server.length > 0) predicate.server = raw.server;
  if (allowedProviders) predicate.allowedProviders = allowedProviders;
  if (typeof raw.expiresAt === "string" && raw.expiresAt.length > 0) predicate.expiresAt = raw.expiresAt;
  if (typeof raw.signer === "string" && raw.signer.length > 0) predicate.signer = raw.signer;
  return predicate;
}

function statementPredicate(value: unknown): AttestationPredicate | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw._type === "string" && raw._type !== STATEMENT_TYPE) return undefined;
  if (raw._type !== STATEMENT_TYPE) return undefined;
  if (raw.predicateType !== PREDICATE_TYPE) return undefined;
  return predicateOf(raw.predicate);
}

function bundleFor(file: string): string | undefined {
  const sidecar = `${file}.bundle`;
  if (existsSync(sidecar)) return sidecar;
  if (file.endsWith(".json")) {
    const alternate = file.slice(0, -".json".length) + ".bundle";
    if (existsSync(alternate)) return alternate;
  }
  return undefined;
}

function verifyBundle(command: string, statement: string, bundle: string): boolean {
  const mentionsStatement = command.includes("{statement}");
  const mentionsBundle = command.includes("{bundle}");
  let tokens = command.trim().split(/\s+/).filter((token) => token.length > 0);
  if (mentionsStatement || mentionsBundle) {
    tokens = tokens.map((token) => token.replaceAll("{statement}", statement).replaceAll("{bundle}", bundle));
  } else {
    tokens = [...tokens, statement, bundle];
  }
  const [bin, ...args] = tokens;
  if (!bin) return false;
  try {
    const result = spawnSync(bin, args, { timeout: VERIFY_TIMEOUT_MS, shell: false, encoding: "utf8", windowsHide: true });
    return result.status === 0;
  } catch {
    return false;
  }
}

function envValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Trust-local marks every well-formed statement verified. Otherwise a missing verifier fails closed. */
export function loadAttestations(dataDir: string, policy: SignoffPolicy, env: NodeJS.ProcessEnv): LoadedAttestation[] {
  const dir = join(dataDir, "signoff", "attestations");
  if (!existsSync(dir)) return [];
  const trustLocal = policy.verification === "trust-local";
  const command = trustLocal ? undefined : envValue(env, "CLOUDBOT_SIGNOFF_VERIFY_CMD");
  const loaded: LoadedAttestation[] = [];
  let entries: Dirent<string>[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const entry of entries) {
    if (!entry.isFile() || !safeAttestationName(entry.name)) continue;
    const file = join(dir, entry.name);
    let text: string;
    try {
      const info = statSync(file);
      if (!info.isFile() || info.size > MAX_BYTES) continue;
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    let predicate: AttestationPredicate | undefined;
    try {
      predicate = statementPredicate(JSON.parse(text) as unknown);
    } catch {
      continue;
    }
    if (!predicate) continue;
    let verified = false;
    if (trustLocal) verified = true;
    else if (command) {
      const bundle = bundleFor(file) ?? file + ".bundle";
      verified = verifyBundle(command, file, bundle);
    }
    loaded.push({ verified, predicate });
  }
  return loaded;
}

function expiryMillis(expiresAt: string | undefined): number | undefined {
  if (!expiresAt) return undefined;
  const parsed = Date.parse(expiresAt);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export function expiryDay(expiresAt: string): string | undefined {
  if (/^\d{4}-\d{2}-\d{2}/.test(expiresAt)) return expiresAt.slice(0, 10);
  const parsed = expiryMillis(expiresAt);
  if (parsed === undefined) return undefined;
  return new Date(parsed).toISOString().slice(0, 10);
}

function needsProvider(action: SignoffAction): boolean {
  return action !== "full_access";
}

function serverOk(policy: SignoffPolicy, predicate: AttestationPredicate, hostname: string): boolean {
  if (policy.server) return predicate.server === policy.server;
  if (predicate.server) return predicate.server === hostname;
  return true;
}

function frameworksOk(policy: SignoffPolicy, predicate: AttestationPredicate): boolean {
  if (!policy.frameworks || policy.frameworks.length === 0) return true;
  const have = new Set((predicate.frameworks ?? []).map((name) => name.toLowerCase()));
  return policy.frameworks.every((name) => have.has(name.toLowerCase()));
}

function missingRole(role: string): string {
  return `Sign-off required: role '${role}' has no valid signature`;
}

function expiredReason(role: string, expiresAt: string): string {
  return `Sign-off required: role '${role}' has no valid signature (expired ${expiryDay(expiresAt) ?? expiresAt})`;
}

function unverifiedReason(role: string): string {
  return `Sign-off required: role '${role}' has no valid signature (unverified)`;
}

export function providerReason(role: string, provider: string | undefined): string {
  return `Sign-off required: role '${role}' has no valid signature (provider '${provider ?? ""}' is not allowed)`;
}

export function serverReason(role: string, policyServer: string | undefined, signatureServer: string | undefined, hostname: string): string {
  if (policyServer && policyServer !== hostname) {
    return `Sign-off required: role '${role}' has no valid signature (server mismatch: policy is for "${policyServer}", this server is "${hostname}")`;
  }
  return `Sign-off required: role '${role}' has no valid signature (server mismatch: signature is for "${signatureServer ?? ""}", this server is "${hostname}")`;
}

type FailureKind = "ok" | "expired" | "server" | "provider" | "unverified" | "other";

function classify(
  attestation: LoadedAttestation,
  input: DecisionInput,
  ignoreProvider: boolean,
): FailureKind {
  if (!attestation.verified) return "unverified";
  const when = expiryMillis(attestation.predicate.expiresAt);
  if (when === undefined) return "other";
  if (when <= input.now) return "expired";
  if (!serverOk(input.policy, attestation.predicate, input.server)) return "server";
  if (!frameworksOk(input.policy, attestation.predicate)) return "other";
  if (!ignoreProvider && needsProvider(input.action) && !providerAllowed(input.modelProvider, attestation.predicate.allowedProviders)) return "provider";
  return "ok";
}

function reasonForRole(role: string, input: DecisionInput, ignoreProvider: boolean): string | undefined {
  const mine = input.attestations.filter((attestation) => attestation.predicate.role === role);
  const kinds = mine.map((attestation) => ({ attestation, kind: classify(attestation, input, ignoreProvider) }));
  if (kinds.some((item) => item.kind === "ok")) return undefined;
  const expired = kinds.filter((item) => item.kind === "expired" && item.attestation.predicate.expiresAt);
  if (expired.length > 0) {
    const latest = expired
      .map((item) => item.attestation.predicate.expiresAt!)
      .sort((left, right) => (expiryMillis(left) ?? 0) - (expiryMillis(right) ?? 0))
      .at(-1)!;
    return expiredReason(role, latest);
  }
  const server = kinds.find((item) => item.kind === "server");
  if (server) return serverReason(role, input.policy.server, server.attestation.predicate.server, input.server);
  const provider = kinds.find((item) => item.kind === "provider");
  if (provider) return providerReason(role, input.modelProvider);
  if (mine.length > 0 && mine.every((attestation) => !attestation.verified)) return unverifiedReason(role);
  return missingRole(role);
}

/** Same decision as deploy/signoff/opa/signoff.rego. Pure: it does not read the disk. */
export function decide(input: DecisionInput): Decision {
  if (!Number.isFinite(input.now)) return { allow: false, reason: INVALID_POLICY };
  const parsed = parsePolicy(input.policy);
  if (!parsed.ok) return { allow: false, reason: parsed.reason };
  const policy = parsed.policy;
  if (!enforcesAction(policy, input.action)) return { allow: true };
  const role = policy.requiredRoles[0]!;
  if (policy.server && policy.server !== input.server) return { allow: false, reason: serverReason(role, policy.server, undefined, input.server) };
  if (needsProvider(input.action) && policy.allowedProviders && policy.allowedProviders.length > 0 && !providerAllowed(input.modelProvider, policy.allowedProviders)) {
    return { allow: false, reason: providerReason(role, input.modelProvider) };
  }
  for (const required of policy.requiredRoles) {
    const reason = reasonForRole(required, { ...input, policy }, false);
    if (reason) return { allow: false, reason };
  }
  return { allow: true };
}

function httpUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    return value;
  } catch {
    return undefined;
  }
}

function roleRow(role: string, input: DecisionInput): RoleStatus {
  const ignored: DecisionInput = { ...input, action: "full_access" };
  const mine = input.attestations.filter((attestation) => attestation.predicate.role === role);
  const valid = mine.filter((attestation) => classify(attestation, ignored, true) === "ok");
  if (valid.length > 0) {
    const soonest = valid
      .map((attestation) => attestation.predicate.expiresAt!)
      .sort((left, right) => (expiryMillis(left) ?? 0) - (expiryMillis(right) ?? 0))[0]!;
    return { role, status: "valid", expiresAt: soonest };
  }
  const expired = mine.filter((attestation) => classify(attestation, ignored, true) === "expired" && attestation.predicate.expiresAt);
  if (expired.length > 0) {
    const latest = expired
      .map((attestation) => attestation.predicate.expiresAt!)
      .sort((left, right) => (expiryMillis(left) ?? 0) - (expiryMillis(right) ?? 0))
      .at(-1)!;
    return { role, status: "expired", expiresAt: latest, reason: expiredReason(role, latest) };
  }
  const reason = reasonForRole(role, ignored, true);
  return { role, status: "missing", expiresAt: null, ...(reason ? { reason } : {}) };
}

export function signoffStatus(
  dataDir: string,
  opts?: { env?: NodeJS.ProcessEnv; hostname?: string; now?: number },
): SignoffStatus {
  if (!policyFileExists(dataDir)) {
    return { enforced: false, message: NO_POLICY_MESSAGE, disclaimer: SIGNOFF_DISCLAIMER };
  }
  const parsed = readPolicy(dataDir);
  if (!parsed.ok) return { enforced: true, disclaimer: SIGNOFF_DISCLAIMER, message: parsed.reason, requiredRoles: [], roles: [] };
  const env = opts?.env ?? process.env;
  const attestations = loadAttestations(dataDir, parsed.policy, env);
  const input: DecisionInput = {
    action: "bot_turn",
    server: opts?.hostname ?? hostName(),
    now: opts?.now ?? Date.now(),
    policy: parsed.policy,
    attestations,
  };
  const roles = parsed.policy.requiredRoles.map((role) => roleRow(role, input));
  return {
    enforced: true,
    disclaimer: SIGNOFF_DISCLAIMER,
    requiredRoles: parsed.policy.requiredRoles,
    ...(parsed.policy.frameworks ? { frameworks: parsed.policy.frameworks } : {}),
    ...(parsed.policy.server ? { server: parsed.policy.server } : {}),
    ...(parsed.policy.allowedProviders ? { allowedProviders: parsed.policy.allowedProviders } : {}),
    ...(httpUrl(parsed.policy.keycloakUrl) ? { keycloakUrl: httpUrl(parsed.policy.keycloakUrl) } : {}),
    roles,
    ...(parsed.policy.verification === "trust-local" ? { testingOnly: true } : {}),
  };
}

export function decisionContext(
  dataDir: string,
  opts: { env: NodeJS.ProcessEnv; hostname: string; now: number; provider?: string },
): { ok: true; policy: SignoffPolicy; attestations: LoadedAttestation[]; hostname: string; now: number; provider?: string } | { ok: false; reason: string } {
  const parsed = readPolicy(dataDir);
  if (!parsed.ok) return parsed;
  return {
    ok: true,
    policy: parsed.policy,
    attestations: loadAttestations(dataDir, parsed.policy, opts.env),
    hostname: opts.hostname,
    now: opts.now,
    ...(opts.provider !== undefined ? { provider: opts.provider } : {}),
  };
}

export function decideAction(
  context: Extract<ReturnType<typeof decisionContext>, { ok: true }>,
  action: SignoffAction,
): Decision {
  if (!enforcesAction(context.policy, action)) return { allow: true };
  return decide({
    action,
    server: context.hostname,
    ...(context.provider !== undefined ? { modelProvider: context.provider } : {}),
    now: context.now,
    policy: context.policy,
    attestations: context.attestations,
  });
}
