import path from "node:path";
import { pathToFileURL } from "node:url";

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

/** Windows hides the native caption, and this page is not the app shell, so it draws the same minimize, restore, and close
 * controls. Close goes through the desktop bridge when the preload is there, and through window.close otherwise. */
const WINDOW_CLOSE_CONTROL = `<div style="position:fixed;top:0;right:0;z-index:40;display:flex;-webkit-app-region:no-drag"><button type="button" aria-label="Minimize" title="Minimize" style="width:44px;height:28px;padding:0;border:0;background:transparent;color:#fcfcfc99;font:14px system-ui;cursor:pointer" onclick="var c=window.ogb&&window.ogb.windowControls;if(c)c.minimize()">&#8722;</button><button type="button" aria-label="Maximize" title="Maximize" style="width:44px;height:28px;padding:0;border:0;background:transparent;color:#fcfcfc99;font:14px system-ui;cursor:pointer" onclick="var c=window.ogb&&window.ogb.windowControls;if(c)c.toggleMaximize()">&#9633;</button><button type="button" aria-label="Close" title="Close" style="width:44px;height:28px;padding:0;border:0;background:transparent;color:#fcfcfc99;font:14px system-ui;cursor:pointer" onclick="var c=window.ogb&&window.ogb.windowControls;if(c)c.close();else window.close()">&#10005;</button></div>`;

/** The page the main window shows when the background server never came up. */
export function buildErrorPage({ allPortsOccupied, logDir }) {
  const serverLogPath = path.join(logDir, "server.log");
  const serverLogHref = pathToFileURL(serverLogPath).href;
  const reason = allPortsOccupied
    ? "Every OpenMausBot port answered health checks from another process — likely a second copy of the app, or another program on ports 8799–28799. Quit that program, then quit and reopen OpenMausBot."
    : "The background server didn't come up in time — this is usually slow startup, not a port conflict. Quit and reopen OpenMausBot.";
  return (
    "data:text/html;charset=utf-8," +
    encodeURIComponent(
      `<body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#121212;color:#fcfcfc;font:15px -apple-system,system-ui">${WINDOW_CLOSE_CONTROL}<div style="text-align:center;max-width:360px"><div style="font-size:40px">🐭</div><h2 style="font-weight:600;margin:12px 0 6px">Couldn't start the bot server</h2><p style="color:#fcfcfc99;line-height:1.5">${escapeHtml(reason)} If it keeps happening, check <a target="_blank" rel="noopener" href="${serverLogHref}" style="color:#fcfcfc">${escapeHtml(serverLogPath)}</a>.</p></div></body>`,
    )
  );
}

/** The page the live-desktop viewer shows when it cannot open. */
export function desktopViewerErrorPage(message, retryUrl) {
  const escape = (value) =>
    String(value)
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  return (
    "data:text/html;charset=utf-8," +
    encodeURIComponent(`<!doctype html><meta name="color-scheme" content="dark"><title>Desktop unavailable</title>
      <body style="margin:0;display:grid;place-items:center;height:100vh;background:#121212;color:#f5f5f5;font:14px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif">
        <main style="max-width:420px;padding:32px;text-align:center"><h2 style="margin:0 0 10px;font-size:18px">Couldn't open the live desktop</h2>
        <p style="margin:0 0 20px;color:#a1a1aa;line-height:1.5">${escape(message)}</p>
        <a href="${escape(retryUrl)}" target="_blank" rel="noreferrer" style="display:inline-block;border-radius:9px;background:#fff;color:#111;padding:9px 14px;text-decoration:none;font-weight:600">Open in browser</a></main>
      </body>`)
  );
}
