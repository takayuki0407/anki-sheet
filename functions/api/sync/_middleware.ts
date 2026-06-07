// Auth gate for every /api/sync/* route: require a valid Firebase ID token and expose the uid
// to handlers via ctx.data.uid. Unauthenticated requests get 401.
import { verifyFirebaseToken } from "../../_lib/auth";
import { json, type Fn } from "../../_lib/types";

export const onRequest: Fn = async (ctx) => {
  const header = ctx.request.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const uid = token ? await verifyFirebaseToken(token, ctx.env) : null;
  if (!uid) return json({ error: "unauthorized" }, 401);
  ctx.data.uid = uid;
  return ctx.next();
};
