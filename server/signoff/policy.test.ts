import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NO_POLICY_MESSAGE, SIGNOFF_DISCLAIMER, decide, serverReason, signoffStatus } from "./policy.ts";

const NOW = Date.parse("2026-11-03T00:00:00Z");
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("decide", () => {
  it("names the first required role when this server is not the policy server", () => {
    expect(decide({
      action: "bot_turn",
      server: "dev",
      modelProvider: "anthropic",
      now: NOW,
      policy: { requiredRoles: ["ciso"], server: "prod", verification: "trust-local" },
      attestations: [],
    })).toEqual({ allow: false, reason: serverReason("ciso", "prod", undefined, "dev") });
    expect(serverReason("ciso", "prod", undefined, "dev")).toBe(
      "Sign-off required: role 'ciso' has no valid signature (server mismatch: policy is for \"prod\", this server is \"dev\")",
    );
  });

  it("skips an action the policy does not list", () => {
    expect(decide({
      action: "bot_turn",
      server: "dev",
      now: NOW,
      policy: { requiredRoles: ["ciso"], actions: ["model_call"] },
      attestations: [],
    })).toEqual({ allow: true });
  });
});

describe("signoffStatus", () => {
  it("says the workspace runs as usual when no policy file exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "signoff-status-"));
    dirs.push(dir);
    expect(signoffStatus(dir, { env: {}, hostname: "dev", now: NOW })).toEqual({
      enforced: false,
      message: NO_POLICY_MESSAGE,
      disclaimer: SIGNOFF_DISCLAIMER,
    });
    expect(NO_POLICY_MESSAGE).toBe("No sign-off policy: this workspace runs as usual.");
    expect(SIGNOFF_DISCLAIMER).toBe("A signature records a decision. It does not certify HIPAA, ISO, or GDPR.");
  });

  it("reports a valid role and an expired role without treating the label as a certification", () => {
    const dir = mkdtempSync(join(tmpdir(), "signoff-status-"));
    dirs.push(dir);
    writeFileSync(join(dir, "signoff-policy.json"), JSON.stringify({
      requiredRoles: ["ciso", "counsel"],
      verification: "trust-local",
      server: "dev",
      keycloakUrl: "https://keycloak.example/realms/cloudbot",
      frameworks: ["HIPAA"],
    }));
    const folder = join(dir, "signoff", "attestations");
    mkdirSync(folder, { recursive: true });
    const statement = (predicate: Record<string, unknown>) => JSON.stringify({
      _type: "https://in-toto.io/Statement/v1",
      subject: [{ name: "cloudbot-signoff", digest: { sha256: "abc" } }],
      predicateType: "https://cloudbot.dev/signoff/v1",
      predicate,
    });
    writeFileSync(join(folder, "ciso.json"), statement({
      role: "ciso", server: "dev", frameworks: ["HIPAA"], expiresAt: "2027-06-01T00:00:00Z", signer: "ciso@example.com",
    }));
    writeFileSync(join(folder, "counsel.json"), statement({
      role: "counsel", server: "dev", frameworks: ["HIPAA"], expiresAt: "2026-10-01T00:00:00Z", signer: "counsel@example.com",
    }));
    const status = signoffStatus(dir, { env: {}, hostname: "dev", now: NOW });
    expect(status.enforced).toBe(true);
    expect(status.testingOnly).toBe(true);
    expect(status.disclaimer).toBe(SIGNOFF_DISCLAIMER);
    expect(status.keycloakUrl).toBe("https://keycloak.example/realms/cloudbot");
    expect(status.roles).toEqual([
      { role: "ciso", status: "valid", expiresAt: "2027-06-01T00:00:00Z" },
      {
        role: "counsel",
        status: "expired",
        expiresAt: "2026-10-01T00:00:00Z",
        reason: "Sign-off required: role 'counsel' has no valid signature (expired 2026-10-01)",
      },
    ]);
  });
});
