import { db } from "./schema";
import type { BookmarkRow, CardRow, DeckRow, MetaRow } from "../types";

interface PdfExport {
  id?: number;
  deckId: number;
  name: string;
  pageCount: number;
  pageW: number;
  pageH: number;
  blobDataUrl: string;
}

interface BackupFile {
  app: "anki-sheet";
  version: number;
  exportedAt: number;
  decks: DeckRow[];
  pdfs: PdfExport[];
  cards: CardRow[];
  bookmarks: BookmarkRow[];
  meta: MetaRow[];
}

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

async function dataURLToBlob(url: string): Promise<Blob> {
  return (await fetch(url)).blob();
}

/** Serialize the entire DB (incl. PDFs as base64) to a downloadable JSON Blob. */
export async function exportBackup(): Promise<Blob> {
  const [decks, pdfsRaw, cards, bookmarks, meta] = await Promise.all([
    db.decks.toArray(),
    db.pdfs.toArray(),
    db.cards.toArray(),
    db.bookmarks.toArray(),
    db.meta.toArray(),
  ]);
  const pdfs: PdfExport[] = await Promise.all(
    pdfsRaw.map(async (p) => ({
      id: p.id,
      deckId: p.deckId,
      name: p.name,
      pageCount: p.pageCount,
      pageW: p.pageW,
      pageH: p.pageH,
      blobDataUrl: await blobToDataURL(p.blob),
    })),
  );
  const data: BackupFile = {
    app: "anki-sheet",
    version: 2,
    exportedAt: Date.now(),
    decks,
    pdfs,
    cards,
    bookmarks,
    meta,
  };
  return new Blob([JSON.stringify(data)], { type: "application/json" });
}

/** Replace the entire DB from a backup file. */
export async function importBackup(file: File): Promise<void> {
  const data = JSON.parse(await file.text()) as BackupFile;
  if (data.app !== "anki-sheet") throw new Error("Anki-sheetのバックアップではありません");

  // Decode blobs BEFORE the transaction (fetch is not allowed inside a Dexie tx).
  const pdfRows = await Promise.all(
    data.pdfs.map(async (p) => ({
      id: p.id,
      deckId: p.deckId,
      name: p.name,
      pageCount: p.pageCount,
      pageW: p.pageW,
      pageH: p.pageH,
      blob: await dataURLToBlob(p.blobDataUrl),
    })),
  );

  await db.transaction(
    "rw",
    [db.decks, db.pdfs, db.cards, db.bookmarks, db.covers, db.meta],
    async () => {
      await Promise.all([
        db.decks.clear(),
        db.pdfs.clear(),
        db.cards.clear(),
        db.bookmarks.clear(),
        db.covers.clear(), // covers regenerate lazily from the PDFs
        db.meta.clear(),
      ]);
      await db.decks.bulkPut(data.decks);
      await db.pdfs.bulkPut(pdfRows);
      await db.cards.bulkPut(data.cards);
      await db.bookmarks.bulkPut(data.bookmarks ?? []);
      await db.meta.bulkPut(data.meta ?? []);
    },
  );
  await db.meta.put({ key: "lastBackup", value: Date.now() });
}

/** Erase ALL local data (decks / PDFs / covers / bookmarks / sync meta) — used on logout / account
 * deletion so the bookshelf is empty for the next account. Pro books re-download from the cloud. */
export async function clearAllLocalData(): Promise<void> {
  await db.transaction(
    "rw",
    [db.decks, db.pdfs, db.cards, db.bookmarks, db.covers, db.meta],
    async () => {
      await Promise.all([
        db.decks.clear(),
        db.pdfs.clear(),
        db.cards.clear(),
        db.bookmarks.clear(),
        db.covers.clear(),
        db.meta.clear(),
      ]);
    },
  );
}

/** Ask the browser to keep our IndexedDB data (avoid eviction). */
export async function requestPersistentStorage(): Promise<boolean> {
  if (navigator.storage?.persist) {
    try {
      return await navigator.storage.persist();
    } catch {
      return false;
    }
  }
  return false;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
