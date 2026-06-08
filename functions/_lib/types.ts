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
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

// Minimal R2 surface we use. PDFS is optional: it's only bound after R2 is enabled in the
// dashboard + [[r2_buckets]] is uncommented in wrangler.toml. Handlers 503 when it's absent.
export interface R2Object {
  key: string;
  size: number;
}
export interface R2ObjectBody extends R2Object {
  body: ReadableStream;
}
export interface R2Objects {
  objects: R2Object[];
  truncated: boolean;
  cursor?: string;
}
export interface R2Bucket {
  put(key: string, value: ReadableStream | ArrayBuffer | string | null): Promise<R2Object>;
  get(key: string): Promise<R2ObjectBody | null>;
  delete(key: string | string[]): Promise<void>;
  list(options?: { prefix?: string; cursor?: string; limit?: number }): Promise<R2Objects>;
}

export interface Env {
  DB: D1DB;
  PDFS?: R2Bucket;
  FIREBASE_PROJECT_ID: string;
  ADMIN_EMAIL?: string; // this account is treated as 'admin' (unlimited) regardless of users.tier
  RC_WEBHOOK_SECRET?: string; // shared secret for the RevenueCat webhook (Pages secret)
  ANTHROPIC_API_KEY?: string; // server-only secret for AI question generation (never sent to clients)
}

/** The subset of the Pages Functions context we use. `data.uid`/`data.email` are set by auth. */
export interface FnCtx {
  request: Request;
  env: Env;
  params: Record<string, string>;
  data: { uid?: string; email?: string };
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
