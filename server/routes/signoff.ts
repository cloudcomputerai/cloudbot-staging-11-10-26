import { DATA_DIR } from "../config.ts";
import { signoffStatus } from "../signoff/policy.ts";
import { PASS, type RouteHandler } from "./table.ts";

/** Officer sign-off status. No policy file reports that the workspace runs as usual. */
export const signoffRoutes: RouteHandler = async ({ path, method, res, json }) => {
  if (method !== "GET" || path !== "/api/signoff") return PASS;
  res.setHeader("cache-control", "no-store");
  return json(res, 200, signoffStatus(DATA_DIR));
};
