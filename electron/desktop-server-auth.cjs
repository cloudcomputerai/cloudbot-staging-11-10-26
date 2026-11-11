"use strict";

/** The server checks this exact name. A different header makes the desktop window ask for a pairing code. */
const DESKTOP_MUTATION_HEADER = "X-Cloud-Bot-Desktop-Owner";

/** Chromium's webRequest hook cannot see Node fetch, so both paths add the owner capability here. */
function desktopServerHeaders(headers, { packaged, token }) {
  const next = { ...headers };
  if (!packaged) return next;
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new Error("invalid desktop mutation capability");
  }
  next[DESKTOP_MUTATION_HEADER] = token;
  return next;
}

module.exports = { DESKTOP_MUTATION_HEADER, desktopServerHeaders };
