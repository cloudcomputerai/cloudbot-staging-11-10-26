import { describe, expect, it } from "vitest";

import { t } from "./i18n";
import { colorSwatch, MAUS_COLOR_LABEL, MAUS_COLOR_NAMES, MAUS_COLORS, stateForBot } from "./mascot";

describe("stateForBot", () => {
  it("still alerts on a failed tool call when a digest receipt follows it", () => {
    expect(stateForBot({
      name: "Atlas",
      messages: [
        { kind: "activity", tool: { ok: false } },
        { kind: "digest" },
      ],
    })).toBe("alerting");
  });

  it("keeps reading a pending card as curious behind a receipt", () => {
    expect(stateForBot({ name: "Atlas", messages: [{ kind: "options" }, { kind: "digest" }] })).toBe("curious");
  });

  it("still alerts on a failed tool call when a live call's record follows it", () => {
    expect(stateForBot({
      name: "Atlas",
      messages: [
        { kind: "activity", tool: { ok: false } },
        { kind: "call" },
      ],
    })).toBe("alerting");
    expect(stateForBot({
      name: "Atlas",
      messages: [
        { kind: "activity", tool: { ok: false } },
        { kind: "digest" },
        { kind: "call" },
      ],
    })).toBe("alerting");
  });

  it("keeps reading a pending card as curious behind a live call's record", () => {
    expect(stateForBot({ name: "Atlas", messages: [{ kind: "options" }, { kind: "call" }] })).toBe("curious");
  });
});

describe("silver", () => {
  it("is a colour every picker offers, drawn at #959595 and named Silver", () => {
    expect(MAUS_COLOR_NAMES).toContain("silver");
    expect(MAUS_COLORS.silver).toBe("#959595");
    expect(t(MAUS_COLOR_LABEL.silver)).toBe("Silver");
  });
});

describe("chrome", () => {
  it("is a colour every picker offers, named Chrome, drawn as the same flat gray", () => {
    expect(MAUS_COLOR_NAMES).toContain("chrome");
    expect(t(MAUS_COLOR_LABEL.chrome)).toBe("Chrome");
    expect(colorSwatch("chrome")).toBe("#959595");
    expect(colorSwatch("blue")).toBe(MAUS_COLORS.blue);
  });
});
