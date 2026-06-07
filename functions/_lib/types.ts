// Minimal local types for the Pages Functions backend, so we don't need @cloudflare/workers-types
// as a dependency. The runtime objects Cloudflare passes match these shapes; wrangler/esbuild
// strips the types at deploy time. (The app's tsconfig only includes src/, so these never affect
// the web app's typecheck/build.)

export interface D1Result<T> {
  results: T[];
  success: boolean;
}
export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(colName?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<D1Result<unknown>>;
}
export interface D1DB {
  prepare(query: string): D1PreparedStatement;
}

export interface Env {
  DB: D1DB;
  FIREBASE_PROJECT_ID: string;
}

/** The subset of the Pages Functions context we use. `data.uid` is set by the auth middleware. */
export interface FnCtx {
  request: Request;
  env: Env;
  params: Record<string, string>;
  data: { uid?: string };
  next: () => Promise<Response>;
}
export type Fn = (ctx: FnCtx) => Promise<Response> | Response;

/** JSON response helper. */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
