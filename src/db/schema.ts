import Dexie, { type Table } from "dexie";
import type { CardRow, DeckRow, MetaRow, PdfRow, ReviewLogRow } from "../types";

export class AnkiSheetDB extends Dexie {
  decks!: Table<DeckRow, number>;
  pdfs!: Table<PdfRow, number>;
  cards!: Table<CardRow, number>;
  reviewLogs!: Table<ReviewLogRow, number>;
  meta!: Table<MetaRow, string>;

  constructor() {
    super("ankiSheet");
    this.version(1).stores({
      decks: "++id, name, createdAt",
      pdfs: "++id, deckId",
      // [deckId+due] powers the daily due query; [deckId+state] finds New cards.
      cards: "++id, deckId, [deckId+due], due, [deckId+state], pdfId",
      reviewLogs: "++id, cardId, deckId, review, [deckId+review]",
      meta: "key",
    });
    // v2: [deckId+pageIndex] powers the red-sheet page viewer.
    this.version(2).stores({
      cards: "++id, deckId, [deckId+due], due, [deckId+state], pdfId, [deckId+pageIndex]",
    });
  }
}

export const db = new AnkiSheetDB();
