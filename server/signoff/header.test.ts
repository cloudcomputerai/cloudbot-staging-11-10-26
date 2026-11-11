import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

describe("desktop owner header", () => {
  it("keeps the header name X-OpenMausBot-Desktop-Owner", () => {
    const auth = readFileSync(join(root, "server/request-auth.ts"), "utf8");
    const desktop = readFileSync(join(root, "electron/desktop-server-auth.cjs"), "utf8");
    expect(auth).toContain('const DESKTOP_OWNER_HEADER = "x-openmausbot-desktop-owner"');
    expect(desktop).toContain('const DESKTOP_MUTATION_HEADER = "X-OpenMausBot-Desktop-Owner"');
  });
});
