import Dexie, { type Table } from "dexie";
import type {
  BookmarkRow,
  CardRow,
  CoverRow,
  DeckRow,
  MetaRow,
  PdfRow,
  QuestionRow,
  ReviewRow,
} from "../types";

export class AnkiSheetDB extends Dexie {
  decks!: Table<DeckRow, number>;
  pdfs!: Table<PdfRow, number>;
  cards!: Table<CardRow, number>;
  bookmarks!: Table<BookmarkRow, number>;
  covers!: Table<CoverRow, number>;
  meta!: Table<MetaRow, string>;
  questions!: Table<QuestionRow, string>;
  reviews!: Table<ReviewRow, string>;

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
    // v5: AI-generated ○× questions (keyed by uuid; looked up by book + page).
    this.version(5).stores({
      questions: "id, bookId, [bookId+pageIndex]",
    });
    // v6 (機能拡張 4択とSRS): questions carry qtype('tf'|'mc4') + choices (mc4); per-question SM-2
    // review records (all plans record locally; Premium syncs). Existing question rows become 'tf'.
    this.version(6)
      .stores({
        questions: "id, bookId, [bookId+pageIndex]",
        reviews: "questionId, bookId, dueAt",
      })
      .upgrade((tx) =>
        tx
          .table("questions")
          .toCollection()
          .modify((q: { qtype?: string; choices?: unknown }) => {
            if (!q.qtype) q.qtype = "tf";
            if (q.choices === undefined) q.choices = null;
          }),
      );
  }
}

export const db = new AnkiSheetDB();
