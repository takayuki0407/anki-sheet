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
  redetectDeck,
  updateDeck,
} from "../db/repo";
import {
  getBlob,
  getContent,
  listBooks,
  putBlob,
  putContent,
  unregisterBook,
  type AccountBook,
} from "./api";
import type { DeckColorConfig, DetectedCloze } from "../types";

interface DeckContent {
  name: string;
  color: DeckColorConfig;
  pageCount: number;
  pageW: number;
  pageH: number;
  clozes: DetectedCloze[];
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

/** Build the content JSON (everything needed to rebuild the deck except the PDF) from local state. */
async function buildContent(deckId: number): Promise<{ content: DeckContent; blob: Blob } | null> {
  const [deck, pdf, cards, bms] = await Promise.all([
    getDeck(deckId),
    getDeckPdf(deckId),
    deckCards(deckId),
    listBookmarks(deckId),
  ]);
  if (!deck || !pdf) return null;
  const content: DeckContent = {
    name: deck.name,
    color: deck.color,
    pageCount: pdf.pageCount,
    pageW: pdf.pageW,
    pageH: pdf.pageH,
    clozes: cards.map((c) => ({
      pageIndex: c.pageIndex,
      rects: c.rects,
      bbox: c.answerRect,
      text: c.text,
    })),
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

/** Pull newer content from the cloud and replace local masks (last-write-wins). Returns true if it
 * applied a newer version. Best-effort: callers wrap in catch so offline / signed-out keeps local. */
export async function refreshContent(deckId: number): Promise<boolean> {
  const deck = await getDeck(deckId);
  if (!deck?.bookId) return false; // not a synced deck
  const content = (await getContent(deck.bookId)) as DeckContent;
  const cloudAt = content.contentAt ?? 0;
  if (!cloudAt || cloudAt <= (deck.contentAt ?? 0)) return false; // local already current
  await redetectDeck(deckId, content.color, content.clozes); // replace cards (+ color), transactional
  await updateDeck(deckId, { name: content.name, contentAt: cloudAt });
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
  await updateDeck(deckId, { contentAt: content.contentAt ?? 0 }); // baseline so we don't re-pull it
  return deckId;
}
