// CORS for every /api/* route (the native iOS app and the web app both call these). Answers
// OPTIONS preflight directly; otherwise runs the route and tags the response with CORS headers.
import type { Fn } from "../_lib/types";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Authorization,Content-Type",
  "Access-Control-Max-Age": "86400",
};

export const onRequest: Fn = async (ctx) => {
  if (ctx.request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const res = await ctx.next();
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(CORS)) out.headers.set(k, v);
  return out;
};
