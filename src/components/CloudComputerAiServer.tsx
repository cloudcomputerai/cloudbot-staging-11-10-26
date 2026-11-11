import { useEffect, useState } from "react";
import { t } from "@/lib/i18n";
import { api } from "@/state/api";
import { useStore, type InstanceInfo } from "@/state/store";

type CloudStatus = { connected: boolean; ready: boolean };

export function CloudComputerAiServer() {
  const { dispatch, refreshInstances } = useStore();
  const [status, setStatus] = useState<CloudStatus | null>(null);
  const [busy, setBusy] = useState<"connect" | "disconnect" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void api<CloudStatus>("/api/cloud-computer-ai").then((next) => { if (alive) setStatus(next); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const run = (action: "connect" | "disconnect") => {
    if (busy) return;
    setBusy(action);
    setError(null);
    void api<{ connected: boolean; instances?: InstanceInfo[] }>("/api/cloud-computer-ai", {
      method: "POST",
      body: JSON.stringify({ action }),
    }).then(async (body) => {
      setStatus({ connected: body.connected, ready: true });
      if (Array.isArray(body.instances)) dispatch({ type: "instances", instances: body.instances });
      else await refreshInstances({ reportErrors: true });
    }, (cause: unknown) => {
      setError(cause instanceof Error && cause.message ? cause.message : t("apiInstances.failed"));
    }).finally(() => setBusy(null));
  };

  const connected = status?.connected === true;
  return (
    <div className="flex flex-col gap-2">
      {status?.ready === false && <p className="text-[12px] leading-4 text-ink-secondary">{t("cloudComputerAi.missing")}</p>}
      {connected && <p className="text-[12px] leading-4 text-ink-secondary">{t("cloudComputerAi.connected")}</p>}
      {connected ? (
        <button type="button" className="ui-button self-start" disabled={busy !== null} onClick={() => run("disconnect")}>
          {busy === "disconnect" ? t("cloudComputerAi.disconnecting") : t("cloudComputerAi.disconnect")}
        </button>
      ) : (
        <button type="button" className="ui-button self-start" disabled={busy !== null || status?.ready === false} onClick={() => run("connect")}>
          {busy === "connect" ? t("cloudComputerAi.connecting") : t("cloudComputerAi.connect")}
        </button>
      )}
      {error && <div className="text-[12px] text-danger">{error}</div>}
    </div>
  );
}
