// Pro cloud sync of a whole deck = the PDF blob (R2 .pdf) + a content JSON (R2 .json) holding
// everything needed to rebuild it WITHOUT re-detecting (name, color, geometry, clozes, bookmarks).
// Upload on import; download + reconstruct on another device from the bookshelf's cloud section.
import {
  deckCards,
  getDeck,
  getDeckPdf,
  importBookmarks,
  importDeck,
  listBookmarks,
  listDecks,
  materializeContent,
  updateDeck,
} from "../db/repo";
import {
  getBlob,
  getContent,
  listBooks,
  putBlob,
  putContent,
  unregisterBook,
  updateBookMeta,
  type AccountBook,
} from "./api";
import {
  activeClozes,
  clozeMapFromCards,
  mergeContent,
  normalizeContent,
  tombstonesOf,
  type ClozeMap,
} from "./contentMerge";
import { deviceLabel } from "./device";
import type { DeckColorConfig, DetectedCloze } from "../types";

interface DeckContent {
  name: string;
  color: DeckColorConfig;
  pageCount: number;
  pageW: number;
  pageH: number;
  /** Legacy whole-set (kept for the GET compat mirror + old-client download). The live, merge-able
   * source is `clozesLww`. */
  clozes: DetectedCloze[];
  /** Masks as an LWW-element-set so concurrent edits merge per-key (P0-2). */
  clozesLww?: ClozeMap;
  bookmarks: { title: string; pageIndex: number }[];
  /** Local edit time of this content (epoch ms), set on upload — drives content last-write-wins. */
  contentAt?: number;
}

/** On logout, release THIS device's book slots that have NO cloud file (size 0 = a Standard
 * slot-only registration) — so a local wipe doesn't leave orphaned slots counting toward the cap.
 * Books WITH a cloud file (uploaded while Pro — incl. a since-downgraded account) are KEPT, since
 * GET is owner-open so they stay downloadable after re-login / on other devices. Best-effort. */
export async function releaseLocalSlotsOnLogout(): Promise<void> {
  let books;
  try {
    books = (await listBooks()).books;
  } catch {
    return; // can't tell which have files → keep everything (never delete a downloadable file)
  }
  const hasFile = new Map(books.map((b) => [b.book_id, b.size > 0]));
  const decks = await listDecks();
  for (const d of decks) {
    if (d.bookId && hasFile.get(d.bookId) === false) await unregisterBook(d.bookId).catch(() => {});
  }
}

/** Pro/admin only: upload any LOCAL book that has no cloud file yet (e.g. imported while Standard,
 * then upgraded to Pro). Idempotent — skips books that already have a cloud file. Best-effort; never
 * throws. Backfills the cloud after an upgrade so the books reach the account's other devices. */
export async function backfillCloudIfPro(): Promise<void> {
  let acct;
  try {
    acct = await listBooks();
  } catch {
    return;
  }
  if (!(acct.tier === "pro" || acct.tier === "admin")) return; // only Pro can upload files
  const size = new Map(acct.books.map((b) => [b.book_id, b.size]));
  const decks = await listDecks();
  for (const d of decks) {
    if (!d.id || !d.bookId) continue; // not registered (registered on import) → skip
    if ((size.get(d.bookId) ?? 0) > 0) continue; // already has a cloud file
    await uploadDeck(d.bookId, d.id).catch(() => {});
  }
}

/** Stamp THIS device's current name on every book it holds locally (in the account registry), so the
 * cloud list shows where a book is NOW — not just who first imported it. Called after the user
 * renames this device; only touches rows whose label differs. Best-effort; never throws. */
export async function applyDeviceNameToLocalBooks(): Promise<void> {
  const me = deviceLabel();
  let acct;
  try {
    acct = await listBooks();
  } catch {
    return;
  }
  const localIds = new Set(
    (await listDecks()).map((d) => d.bookId).filter(Boolean) as string[],
  );
  for (const b of acct.books) {
    if (localIds.has(b.book_id) && b.device !== me)
      await updateBookMeta(b.book_id, { device: me }).catch(() => {});
  }
}

/** Build the content JSON (everything needed to rebuild the deck except the PDF) from local state. */
async function buildContent(deckId: number): Promise<{ content: DeckContent; blob: Blob } | null> {
  const [deck, pdf, cards, bms] = await Promise.all([
    getDeck(deckId),
    getDeckPdf(deckId),
    deckCards(deckId),
    listBookmarks(deckId),
  ]);
  if (!deck || !pdf) return null;
  // Masks as the LWW-element-set: live cards (t = createdAt) + persisted tombstones (P0-2). Also emit
  // the active clozes[] mirror for the GET shim / old-client download.
  const clozesLww = clozeMapFromCards(
    cards.map((c) => ({
      pageIndex: c.pageIndex,
      rects: c.rects,
      bbox: c.answerRect,
      text: c.text,
      t: c.createdAt,
    })),
    deck.clozeTomb ?? {},
  );
  const content: DeckContent = {
    name: deck.name,
    color: deck.color,
    pageCount: pdf.pageCount,
    pageW: pdf.pageW,
    pageH: pdf.pageH,
    clozes: activeClozes({ clozesLww }).map((e) => ({
      pageIndex: e.pageIndex,
      rects: e.rects,
      bbox: e.bbox,
      text: e.text ?? "",
    })),
    clozesLww,
    bookmarks: bms.map((b) => ({ title: b.title, pageIndex: b.pageIndex })),
  };
  return { content, blob: pdf.blob };
}

/** Upload a local deck's PDF + content to the cloud (Pro). 403 (standard) is a silent no-op. */
export async function uploadDeck(bookId: string, deckId: number): Promise<void> {
  const built = await buildContent(deckId);
  if (!built) return;
  built.content.contentAt = Date.now();
  await putContent(bookId, JSON.stringify(built.content));
  await updateDeck(deckId, { contentAt: built.content.contentAt }); // record our own version
  await putBlob(bookId, built.blob);
}

/** Re-sync ONLY the content JSON (masks/bookmarks/name/color), not the PDF blob. Use after editing
 * masks or re-detecting — the PDF is unchanged, so the heavy blob upload is skipped. The download
 * side rebuilds the whole clozes set, so added AND removed masks both propagate. Stamps contentAt so
 * other devices pull it (and so this device doesn't re-pull its own write). */
export async function uploadContent(bookId: string, deckId: number): Promise<void> {
  const built = await buildContent(deckId);
  if (!built) return;
  built.content.contentAt = Date.now();
  await putContent(bookId, JSON.stringify(built.content));
  await updateDeck(deckId, { contentAt: built.content.contentAt });
}

/** Pull newer content from the cloud and MERGE it into local masks per-key (P0-2 — so a mask added
 * on this device isn't lost when another device's content is pulled). Returns true if it applied a
 * newer version. Best-effort: callers wrap in catch so offline / signed-out keeps local. */
export async function refreshContent(deckId: number): Promise<boolean> {
  const deck = await getDeck(deckId);
  if (!deck?.bookId) return false; // not a synced deck
  const cloud = (await getContent(deck.bookId)) as DeckContent;
  const cloudAt = cloud.contentAt ?? 0;
  if (!cloudAt || cloudAt <= (deck.contentAt ?? 0)) return false; // local already current
  // Merge the (already server-merged) cloud set with our LOCAL set per-key, then materialize cards
  // from the result (preserving each cloze's `t`) and adopt the merged tombstones.
  const cards = await deckCards(deckId);
  const localMap = clozeMapFromCards(
    cards.map((c) => ({
      pageIndex: c.pageIndex,
      rects: c.rects,
      bbox: c.answerRect,
      text: c.text,
      t: c.createdAt,
    })),
    deck.clozeTomb ?? {},
  );
  const merged = mergeContent(
    normalizeContent(
      { clozesLww: localMap, name: deck.name, color: deck.color, contentAt: deck.contentAt ?? 0 },
      1,
    ),
    normalizeContent(cloud, cloudAt),
  );
  const active = activeClozes(merged).map((e) => ({
    pageIndex: e.pageIndex,
    rects: e.rects,
    bbox: e.bbox,
    text: e.text ?? "",
    t: e.t,
  }));
  await materializeContent(
    deckId,
    (merged.color ?? deck.color) as DeckColorConfig,
    active,
    tombstonesOf(merged.clozesLww ?? {}),
  );
  await updateDeck(deckId, { name: merged.name ?? deck.name, contentAt: cloudAt });
  return true;
}

/** Download an account book and reconstruct it locally. Returns the new local deckId. */
export async function downloadDeck(book: AccountBook): Promise<number> {
  const content = (await getContent(book.book_id)) as DeckContent;
  const blob = await getBlob(book.book_id);
  const deckId = await importDeck({
    name: content.name,
    bookId: book.book_id,
    blob,
    pageCount: content.pageCount,
    pageW: content.pageW,
    pageH: content.pageH,
    color: content.color,
    clozes: content.clozes,
  });
  if (content.bookmarks?.length) await importBookmarks(deckId, content.bookmarks);
  // Adopt any cloud tombstones so a mask deleted elsewhere isn't re-added locally later (P0-2).
  await updateDeck(deckId, {
    contentAt: content.contentAt ?? 0, // baseline so we don't re-pull it
    clozeTomb: tombstonesOf(content.clozesLww ?? {}),
    registered: true, // came from the account registry → reconcile may follow an elsewhere-unregister
  });
  return deckId;
}
