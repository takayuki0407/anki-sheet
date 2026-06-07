// Pro cloud sync of a whole deck = the PDF blob (R2 .pdf) + a content JSON (R2 .json) holding
// everything needed to rebuild it WITHOUT re-detecting (name, color, geometry, clozes, bookmarks).
// Upload on import; download + reconstruct on another device from the bookshelf's cloud section.
import { deckCards, getDeck, getDeckPdf, importBookmarks, importDeck, listBookmarks } from "../db/repo";
import { getBlob, getContent, putBlob, putContent, type AccountBook } from "./api";
import type { DeckColorConfig, DetectedCloze } from "../types";

interface DeckContent {
  name: string;
  color: DeckColorConfig;
  pageCount: number;
  pageW: number;
  pageH: number;
  clozes: DetectedCloze[];
  bookmarks: { title: string; pageIndex: number }[];
}

/** Upload a local deck's PDF + content to the cloud (Pro). 403 (standard) is a silent no-op. */
export async function uploadDeck(bookId: string, deckId: number): Promise<void> {
  const [deck, pdf, cards, bms] = await Promise.all([
    getDeck(deckId),
    getDeckPdf(deckId),
    deckCards(deckId),
    listBookmarks(deckId),
  ]);
  if (!deck || !pdf) return;
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
  await putContent(bookId, JSON.stringify(content));
  await putBlob(bookId, pdf.blob);
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
  return deckId;
}
