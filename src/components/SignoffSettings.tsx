import { useEffect, useState } from "react";
import { t } from "@/lib/i18n";
import { api } from "@/state/store";
import { Card } from "./SettingsPrimitives";

export interface SignoffRoleStatus {
  role: string;
  status: "valid" | "missing" | "expired";
  expiresAt: string | null;
  reason?: string;
}

export interface SignoffStatusResponse {
  enforced: boolean;
  message?: string;
  disclaimer: string;
  requiredRoles?: string[];
  frameworks?: string[];
  server?: string;
  allowedProviders?: string[];
  keycloakUrl?: string;
  roles?: SignoffRoleStatus[];
  testingOnly?: boolean;
}

function keycloakHref(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    return value;
  } catch {
    return undefined;
  }
}

function day(value: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : value;
}

export function SignoffSettingsView({ status }: { status: SignoffStatusResponse }) {
  const href = keycloakHref(status.keycloakUrl);
  return (
    <Card title={t("settings.signoff.title")} subtitle={t("settings.signoff.disclaimer")}>
      {!status.enforced && <p>{t("settings.signoff.none")}</p>}
      {status.enforced && status.testingOnly && <p>{t("settings.signoff.trustLocal")}</p>}
      {status.enforced && (status.frameworks?.length ?? 0) > 0 && <p>{t("settings.signoff.frameworks")}</p>}
      {status.enforced && (status.roles?.length ?? 0) === 0 && status.message && <p>{status.message}</p>}
      {status.enforced && status.roles && status.roles.length > 0 && (
        <>
          <p>{t("settings.signoff.required")}</p>
          <ul>
            {status.roles.map((role) => (
              <li key={role.role} data-signoff-role={role.role} data-signoff-state={role.status}>
                <span>{role.role}</span>
                <span>
                  {role.status === "valid" ? t("settings.signoff.valid") : role.status === "expired" ? t("settings.signoff.expired") : t("settings.signoff.missing")}
                </span>
                {role.expiresAt && role.status === "valid" && <span>{t("settings.signoff.expires", { date: day(role.expiresAt) })}</span>}
                {role.expiresAt && role.status === "expired" && <span>{t("settings.signoff.expiredOn", { date: day(role.expiresAt) })}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
      {href && <a href={href}>{t("settings.signoff.keycloak")}</a>}
    </Card>
  );
}

export function SignoffSettings() {
  const [status, setStatus] = useState<SignoffStatusResponse | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let live = true;
    Promise.resolve(api<SignoffStatusResponse>("/api/signoff")).then(
      (next) => {
        if (live && next) setStatus(next);
      },
      () => {
        if (live) setError(true);
      },
    );
    return () => {
      live = false;
    };
  }, []);

  if (error) {
    return (
      <Card title={t("settings.signoff.title")} subtitle={t("settings.signoff.disclaimer")}>
        <p>{t("settings.signoff.error")}</p>
      </Card>
    );
  }
  if (!status) {
    return (
      <Card title={t("settings.signoff.title")} subtitle={t("settings.signoff.disclaimer")}>
        <p>{t("settings.signoff.loading")}</p>
      </Card>
    );
  }
  return <SignoffSettingsView status={status} />;
}
