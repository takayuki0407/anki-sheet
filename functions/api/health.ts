// Public health check (no auth) — confirms the Functions backend is deployed and bindings load.
import { json, type Fn } from "../_lib/types";

export const onRequestGet: Fn = (ctx) =>
  json({ ok: true, service: "anki-sheet-api", db: !!ctx.env.DB, r2: !!ctx.env.PDFS });
