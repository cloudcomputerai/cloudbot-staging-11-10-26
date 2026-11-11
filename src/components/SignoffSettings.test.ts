import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SignoffSettings, SignoffSettingsView, type SignoffStatusResponse } from "./SignoffSettings";

const disclaimer = "A signature records a decision. It does not certify HIPAA, ISO, or GDPR.";

describe("SignoffSettings", () => {
  it("shows that a workspace with no policy runs as usual", () => {
    const status: SignoffStatusResponse = {
      enforced: false,
      message: "No sign-off policy: this workspace runs as usual.",
      disclaimer,
    };
    const html = renderToStaticMarkup(createElement(SignoffSettingsView, { status }));
    expect(html).toContain("No sign-off policy: this workspace runs as usual.");
    expect(html).toContain(disclaimer);
    expect(html).not.toContain("javascript:");
  });

  it("shows each role, its expiry, and the Keycloak link", () => {
    const status: SignoffStatusResponse = {
      enforced: true,
      disclaimer,
      keycloakUrl: "https://keycloak.example/realms/cloudbot",
      frameworks: ["HIPAA"],
      roles: [
        { role: "ciso", status: "valid", expiresAt: "2027-06-01T00:00:00Z" },
        { role: "counsel", status: "expired", expiresAt: "2026-10-01T00:00:00Z" },
        { role: "dpo", status: "missing", expiresAt: null },
      ],
    };
    const html = renderToStaticMarkup(createElement(SignoffSettingsView, { status }));
    expect(html).toContain('data-signoff-role="ciso" data-signoff-state="valid"');
    expect(html).toContain("Expires 2027-06-01");
    expect(html).toContain('data-signoff-role="counsel" data-signoff-state="expired"');
    expect(html).toContain("Expired 2026-10-01");
    expect(html).toContain('data-signoff-role="dpo" data-signoff-state="missing"');
    expect(html).toContain('href="https://keycloak.example/realms/cloudbot"');
    expect(html).toContain("Sign in to Keycloak to sign");
    expect(html).toContain("not a certification");
  });

  it("drops a Keycloak URL that is not http or https", () => {
    const html = renderToStaticMarkup(createElement(SignoffSettingsView, {
      status: { enforced: false, disclaimer, keycloakUrl: "javascript:alert(1)" },
    }));
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("Sign in to Keycloak");
  });

  it("renders the loading line before a request is made", () => {
    const html = renderToStaticMarkup(createElement(SignoffSettings));
    expect(html).toContain("Loading officer sign-off");
    expect(html).toContain(disclaimer);
  });
});
