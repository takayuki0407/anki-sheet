// Client for the sync backend (/api/sync/*). Same-origin in production (anki-sheet.pages.dev);
// in `npm run dev` the path 404s (no Functions locally) and callers fail open. The Firebase ID
// token authenticates each call; the Worker maps it to the account uid.
import { getIdToken } from "../auth/useAuth";
import { deviceLabel } from "./device";

const BASE = "/api/sync";

async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = await getIdToken();
  if (!token) throw new Error("not_signed_in");
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
}

export interface RegisterResult {
  ok: boolean;
  limitReached?: boolean;
  count?: number;
  limit?: number;
}

/** Reserve an account-global slot for a book. ok:false + limitReached when the cap is hit. */
export async function registerBook(
  bookId: string,
  name: string,
  pageCount: number,
): Promise<RegisterResult> {
  const res = await authedFetch("/books", {
    method: "POST",
    body: JSON.stringify({ book_id: bookId, name, page_count: pageCount, device: deviceLabel() }),
  });
  if (res.status === 403) {
    const b = (await res.json().catch(() => ({}))) as { count?: number; limit?: number };
    return { ok: false, limitReached: true, count: b.count, limit: b.limit };
  }
  if (!res.ok) throw new Error(`register failed: ${res.status}`);
  return { ok: true };
}

/** Free an account-global slot (idempotent; 404 is fine). */
export async function unregisterBook(bookId: string): Promise<void> {
  const res = await authedFetch(`/books/${encodeURIComponent(bookId)}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new Error(`unregister failed: ${res.status}`);
}

export interface AccountBook {
  book_id: string;
  name: string;
  size: number;
  page_count: number;
  device: string | null;
  updated_at: number;
}

export interface AccountBooks {
  books: AccountBook[];
  count: number;
  limit: number;
  tier: "standard" | "pro" | "admin";
  unlimited: boolean;
}

/** List the account's books (across all devices) with the current count + cap + tier. */
export async function listBooks(): Promise<AccountBooks> {
  const res = await authedFetch("/books");
  if (!res.ok) throw new Error(`list failed: ${res.status}`);
  return res.json();
}
