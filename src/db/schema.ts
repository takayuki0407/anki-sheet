import Dexie, { type Table } from "dexie";
import type { BookmarkRow, CardRow, CoverRow, DeckRow, MetaRow, PdfRow } from "../types";

export class AnkiSheetDB extends Dexie {
  decks!: Table<DeckRow, number>;
  pdfs!: Table<PdfRow, number>;
  cards!: Table<CardRow, number>;
  bookmarks!: Table<BookmarkRow, number>;
  covers!: Table<CoverRow, number>;
  meta!: Table<MetaRow, string>;

  constructor() {
    super("ankiSheet");
    this.version(1).stores({
      decks: "++id, name, createdAt",
      pdfs: "++id, deckId",
      cards: "++id, deckId, [deckId+due], due, [deckId+state], pdfId",
      reviewLogs: "++id, cardId, deckId, review, [deckId+review]",
      meta: "key",
    });
    this.version(2).stores({
      cards: "++id, deckId, [deckId+due], due, [deckId+state], pdfId, [deckId+pageIndex]",
    });
    // v3: study (SRS) removed. Cards are just answers; reviewLogs dropped; bookmarks added.
    this.version(3).stores({
      cards: "++id, deckId, pdfId, [deckId+pageIndex]",
      reviewLogs: null,
      bookmarks: "++id, deckId, [deckId+pageIndex]",
    });
    // v4: cached cover thumbnails (keyed by deckId).
    this.version(4).stores({
      covers: "deckId",
    });
  }
}

export const db = new AnkiSheetDB();
