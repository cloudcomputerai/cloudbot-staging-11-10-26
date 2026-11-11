import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { guardTurn, isSignoffPromise, signoffAction, signoffFullAccessRefusal, type GuardOptions } from "./guard.ts";

const NOW = Date.parse("2026-11-03T00:00:00Z");
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fresh(): string {
  const dir = mkdtempSync(join(tmpdir(), "signoff-"));
  dirs.push(dir);
  return dir;
}

function writePolicy(dir: string, policy: Record<string, unknown>): void {
  writeFileSync(join(dir, "signoff-policy.json"), JSON.stringify(policy));
}

function writeStatement(dir: string, name: string, predicate: Record<string, unknown>): void {
  const folder = join(dir, "signoff", "attestations");
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, name), JSON.stringify({
    _type: "https://in-toto.io/Statement/v1",
    subject: [{ name: "cloudbot-signoff", digest: { sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" } }],
    predicateType: "https://cloudbot.dev/signoff/v1",
    predicate,
  }));
}

function options(dir: string, extra?: Partial<GuardOptions>): GuardOptions {
  return { dataDir: dir, env: {}, hostname: "dev", now: NOW, provider: "anthropic", approvalMode: "ask", ...extra };
}

const trusted = {
  requiredRoles: ["ciso"],
  verification: "trust-local",
  server: "dev",
  allowedProviders: ["anthropic"],
};

function signed(dir: string, predicate: Record<string, unknown> = {}): void {
  writePolicy(dir, trusted);
  writeStatement(dir, "ciso.json", {
    role: "ciso",
    server: "dev",
    expiresAt: "2027-01-01T00:00:00Z",
    signer: "ciso@example.com",
    ...predicate,
  });
}

describe("guardTurn", () => {
  it("allows a turn when the workspace has no policy file, and the result is not a Promise", () => {
    const dir = fresh();
    const decision = guardTurn(options(dir));
    expect(isSignoffPromise(decision)).toBe(false);
    expect(decision).toEqual({ allow: true });
    expect(signoffFullAccessRefusal(options(dir))).toBeUndefined();
    expect(signoffAction("model_call", options(dir))).toEqual({ allow: true });
  });

  it("does not cache a missing policy file", () => {
    const dir = fresh();
    expect(guardTurn(options(dir))).toEqual({ allow: true });
    writePolicy(dir, trusted);
    const decision = guardTurn(options(dir));
    expect(isSignoffPromise(decision)).toBe(false);
    if (isSignoffPromise(decision)) throw new Error("expected a decision");
    expect(decision.allow).toBe(false);
    expect(decision.reason).toContain("role 'ciso'");
  });

  it("refuses a bot turn when the required signature is missing and names the role", () => {
    const dir = fresh();
    writePolicy(dir, trusted);
    const decision = guardTurn(options(dir));
    expect(isSignoffPromise(decision)).toBe(false);
    expect(decision).toEqual({ allow: false, reason: "Sign-off required: role 'ciso' has no valid signature" });
  });

  it("refuses a bot turn when the signature is expired and names the role and date", () => {
    const dir = fresh();
    signed(dir, { expiresAt: "2026-10-01T00:00:00Z" });
    const decision = guardTurn(options(dir));
    expect(decision).toEqual({
      allow: false,
      reason: "Sign-off required: role 'ciso' has no valid signature (expired 2026-10-01)",
    });
  });

  it("refuses a bot turn when the signature is for a different role and names the missing role", () => {
    const dir = fresh();
    writePolicy(dir, trusted);
    writeStatement(dir, "counsel.json", { role: "counsel", server: "dev", expiresAt: "2027-01-01T00:00:00Z", signer: "counsel@example.com" });
    const decision = guardTurn(options(dir));
    expect(decision).toEqual({ allow: false, reason: "Sign-off required: role 'ciso' has no valid signature" });
  });

  it("refuses a bot turn when the model provider is not allowed and names the role", () => {
    const dir = fresh();
    signed(dir);
    const decision = guardTurn(options(dir, { provider: "openai" }));
    expect(decision).toEqual({
      allow: false,
      reason: "Sign-off required: role 'ciso' has no valid signature (provider 'openai' is not allowed)",
    });
  });

  it("allows a bot turn when every required signature is valid", () => {
    const dir = fresh();
    signed(dir);
    expect(guardTurn(options(dir))).toEqual({ allow: true });
    expect(guardTurn(options(dir, { provider: "claude", approvalMode: "full" }))).toEqual({ allow: true });
  });

  it("fails closed when a policy exists and no verifier is configured", () => {
    const dir = fresh();
    writePolicy(dir, { requiredRoles: ["ciso"], server: "dev" });
    writeStatement(dir, "ciso.json", { role: "ciso", server: "dev", expiresAt: "2027-01-01T00:00:00Z", signer: "ciso@example.com" });
    const decision = guardTurn(options(dir));
    expect(decision).toEqual({ allow: false, reason: "Sign-off required: role 'ciso' has no valid signature (unverified)" });
  });

  it("does not ask OPA when the local decision already denies", () => {
    const dir = fresh();
    writePolicy(dir, trusted);
    const decision = guardTurn(options(dir, { env: { CLOUDBOT_OPA_URL: "http://127.0.0.1:9" } }));
    expect(isSignoffPromise(decision)).toBe(false);
    expect(decision).toMatchObject({ allow: false });
  });

  it("asks OPA only after a local allow, and a dead engine fails closed", async () => {
    const dir = fresh();
    signed(dir);
    const decision = guardTurn(options(dir, { env: { CLOUDBOT_OPA_URL: "http://127.0.0.1:9" } }));
    expect(isSignoffPromise(decision)).toBe(true);
    if (isSignoffPromise(decision)) {
      await expect(decision).resolves.toEqual({ allow: false, reason: "Sign-off required: policy engine unavailable" });
    }
  });

  it("lets Full access ignore the provider allow list", () => {
    const dir = fresh();
    signed(dir);
    expect(signoffAction("full_access", options(dir, { provider: "openai" }))).toEqual({ allow: true });
    expect(signoffFullAccessRefusal(options(dir, { provider: "openai" }))).toBeUndefined();
  });

  it("refuses a model call to a provider the signature does not allow", () => {
    const dir = fresh();
    signed(dir, { allowedProviders: ["anthropic"] });
    writePolicy(dir, { ...trusted, allowedProviders: ["anthropic", "openai"] });
    const decision = signoffAction("model_call", options(dir, { provider: "openai" }));
    expect(decision).toEqual({
      allow: false,
      reason: "Sign-off required: role 'ciso' has no valid signature (provider 'openai' is not allowed)",
    });
  });
});
