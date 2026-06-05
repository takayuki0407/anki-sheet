import Dexie from "dexie";
import { db } from "./schema";
import type { BookmarkRow, CardRow, DeckColorConfig, DeckRow, DetectedCloze, PdfRow } from "../types";

export interface ImportParams {
  name: string;
  blob: Blob;
  pageCount: number;
  pageW: number;
  pageH: number;
  color: DeckColorConfig;
  clozes: DetectedCloze[];
}

function clozesToCards(
  clozes: DetectedCloze[],
  deckId: number,
  pdfId: number,
  now: number,
): CardRow[] {
  return clozes.map((cz) => ({
    deckId,
    pdfId,
    pageIndex: cz.pageIndex,
    rects: cz.rects,
    answerRect: cz.bbox,
    text: cz.text,
    createdAt: now,
  }));
}

export async function importDeck(p: ImportParams): Promise<number> {
  const now = Date.now();
  return db.transaction("rw", db.decks, db.pdfs, db.cards, async () => {
    const deckId = (await db.decks.add({
      name: p.name,
      createdAt: now,
      color: p.color,
    })) as number;
    const pdfId = (await db.pdfs.add({
      deckId,
      name: p.name,
      blob: p.blob,
      pageCount: p.pageCount,
      pageW: p.pageW,
      pageH: p.pageH,
    })) as number;
    const cards = clozesToCards(p.clozes, deckId, pdfId, now);
    for (let i = 0; i < cards.length; i += 500) {
      await db.cards.bulkAdd(cards.slice(i, i + 500));
    }
    return deckId;
  });
}

export function listDecks(): Promise<DeckRow[]> {
  return db.decks.orderBy("createdAt").reverse().toArray();
}

export function getDeck(deckId: number): Promise<DeckRow | undefined> {
  return db.decks.get(deckId);
}

export function getDeckPdf(deckId: number): Promise<PdfRow | undefined> {
  return db.pdfs.where("deckId").equals(deckId).first();
}

export function answerCount(deckId: number): Promise<number> {
  return db.cards.where("deckId").equals(deckId).count();
}

export async function updateDeck(deckId: number, patch: Partial<DeckRow>): Promise<void> {
  await db.decks.update(deckId, patch);
}

/** Re-run detection for a deck under a new color config: replace all its answers. */
export async function redetectDeck(
  deckId: number,
  color: DeckColorConfig,
  clozes: DetectedCloze[],
): Promise<number> {
  const now = Date.now();
  return db.transaction("rw", db.decks, db.pdfs, db.cards, async () => {
    await db.decks.update(deckId, { color });
    const pdf = await db.pdfs.where("deckId").equals(deckId).first();
    if (!pdf?.id) throw new Error("PDFが見つかりません");
    await db.cards.where("deckId").equals(deckId).delete();
    const cards = clozesToCards(clozes, deckId, pdf.id, now);
    for (let i = 0; i < cards.length; i += 500) {
      await db.cards.bulkAdd(cards.slice(i, i + 500));
    }
    return cards.length;
  });
}

/** Lowest page index that has any answer (so the viewer/preview opens usefully). */
export async function firstAnswerPage(deckId: number): Promise<number> {
  const c = await db.cards
    .where("[deckId+pageIndex]")
    .between([deckId, Dexie.minKey], [deckId, Dexie.maxKey], true, true)
    .first();
  return c?.pageIndex ?? 0;
}

/** All answers on a given page (for the red-sheet viewer). */
export function cardsOnPage(deckId: number, pageIndex: number): Promise<CardRow[]> {
  return db.cards
    .where("[deckId+pageIndex]")
    .between([deckId, pageIndex], [deckId, pageIndex], true, true)
    .toArray();
}

export async function deleteDeck(deckId: number): Promise<void> {
  await db.transaction("rw", db.decks, db.pdfs, db.cards, db.bookmarks, async () => {
    await db.cards.where("deckId").equals(deckId).delete();
    await db.bookmarks.where("deckId").equals(deckId).delete();
    await db.pdfs.where("deckId").equals(deckId).delete();
    await db.decks.delete(deckId);
  });
}

// ---- bookmarks (the user-built 目次) ----

export async function addBookmark(deckId: number, pageIndex: number, title: string): Promise<void> {
  await db.bookmarks.add({ deckId, pageIndex, title, createdAt: Date.now() });
}

export function listBookmarks(deckId: number): Promise<BookmarkRow[]> {
  return db.bookmarks
    .where("[deckId+pageIndex]")
    .between([deckId, Dexie.minKey], [deckId, Dexie.maxKey], true, true)
    .toArray();
}

export async function renameBookmark(id: number, title: string): Promise<void> {
  await db.bookmarks.update(id, { title });
}

export async function deleteBookmark(id: number): Promise<void> {
  await db.bookmarks.delete(id);
}
