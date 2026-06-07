// Client for the sync backend (/api/sync/*). Same-origin in production (anki-sheet.pages.dev);
// in `npm run dev` the path 404s (no Functions locally) and callers fail open. The Firebase ID
// token authenticates each call; the Worker maps it to the account uid.
import { getIdToken } from "../auth/useAuth";
import { deviceLabel } from "./device";

const BASE = "/api/sync";

async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = await getIdToken();
  if (!token) throw new Error("not_signed_in");
  // Default to JSON, but let callers override Content-Type (e.g. the binary PDF upload).
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}), Authorization: `Bearer ${token}` },
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

// ---- Pro cloud sync of the PDF blob + deck content (R2) ----

/** Upload the PDF (Pro). 403 (standard tier) is a silent no-op. */
export async function putBlob(bookId: string, blob: Blob): Promise<void> {
  const res = await authedFetch(`/books/${encodeURIComponent(bookId)}/blob`, {
    method: "PUT",
    body: blob,
    headers: { "Content-Type": "application/pdf" },
  });
  if (res.status === 403) return;
  if (!res.ok) throw new Error(`putBlob failed: ${res.status}`);
}

export async function getBlob(bookId: string): Promise<Blob> {
  const res = await authedFetch(`/books/${encodeURIComponent(bookId)}/blob`);
  if (!res.ok) throw new Error(`getBlob failed: ${res.status}`);
  return res.blob();
}

/** Upload deck content JSON (name/color/geometry/clozes/bookmarks) (Pro). 403 is a silent no-op. */
export async function putContent(bookId: string, json: string): Promise<void> {
  const res = await authedFetch(`/books/${encodeURIComponent(bookId)}/content`, {
    method: "PUT",
    body: json,
  });
  if (res.status === 403) return;
  if (!res.ok) throw new Error(`putContent failed: ${res.status}`);
}

export async function getContent(bookId: string): Promise<unknown> {
  const res = await authedFetch(`/books/${encodeURIComponent(bookId)}/content`);
  if (!res.ok) throw new Error(`getContent failed: ${res.status}`);
  return res.json();
}

// ---- Pro progress sync (cross-device reading position / mode / red-sheet) ----
// NB: device-independent fields only. `revealed` is card-id based (ids differ per device), so it
// stays local for now — cross-device reveal sync needs stable card keys (a later step).
export interface ProgressData {
  lastPage?: number;
  lastMode?: "scroll" | "paged";
  redMode?: "mask" | "sheet" | "off";
  sheetBand?: { top: number; height: number };
}

export async function getProgress(
  bookId: string,
): Promise<{ data: ProgressData; updatedAt: number } | null> {
  const res = await authedFetch(`/progress/${encodeURIComponent(bookId)}`);
  if (res.status === 404 || res.status === 403) return null;
  if (!res.ok) throw new Error(`getProgress failed: ${res.status}`);
  const row = (await res.json()) as { data: string; updated_at: number };
  try {
    return { data: JSON.parse(row.data) as ProgressData, updatedAt: row.updated_at };
  } catch {
    return null;
  }
}

/** Push progress (Pro). 403 (standard) is a silent no-op. */
export async function putProgress(bookId: string, data: ProgressData): Promise<void> {
  const res = await authedFetch(`/progress/${encodeURIComponent(bookId)}`, {
    method: "PUT",
    body: JSON.stringify({ data }),
  });
  if (res.status === 403) return;
  if (!res.ok) throw new Error(`putProgress failed: ${res.status}`);
}
