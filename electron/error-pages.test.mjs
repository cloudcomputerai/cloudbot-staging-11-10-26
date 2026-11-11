import { describe, expect, it } from "vitest";

import { buildErrorPage, desktopViewerErrorPage } from "./error-pages.mjs";

function pageHtml(url) {
  return decodeURIComponent(url.slice("data:text/html;charset=utf-8,".length));
}

describe("error pages", () => {
  it("the couldn't-start page draws a close control", () => {
    const page = pageHtml(buildErrorPage({ allPortsOccupied: true, logDir: "C:\\logs" }));
    expect(page).toContain('aria-label="Close"');
    expect(page).toContain("window.ogb.windowControls");
    expect(page).toContain("else window.close()");
    expect(page).toContain("Couldn't start the bot server");
  });

  it("the live-desktop error page keeps the viewer's own window frame", () => {
    const page = pageHtml(desktopViewerErrorPage("nope", "https://example.test/vnc"));
    expect(page).not.toContain('aria-label="Close"');
    expect(page).toContain("Couldn't open the live desktop");
  });
});
