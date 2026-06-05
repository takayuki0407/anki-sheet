import Dexie from "dexie";
import { db } from "./schema";
import type { CardRow, DeckColorConfig, DeckRow, DetectedCloze, PdfRow } from "../types";
import { newCard, type AppliedGrade } from "../srs/scheduler";
import { iou } from "../util/rect";

export interface ImportParams {
  name: string;
  blob: Blob;
  pageCount: number;
  pageW: number;
  pageH: number;
  color: DeckColorConfig;
  clozes: DetectedCloze[];
  dailyNewLimit?: number;
  dailyReviewLimit?: number;
  requestRetention?: number;
}

export async function importDeck(p: ImportParams): Promise<number> {
  const now = Date.now();
  return db.transaction("rw", db.decks, db.pdfs, db.cards, async () => {
    const deckId = (await db.decks.add({
      name: p.name,
      createdAt: now,
      color: p.color,
      dailyNewLimit: p.dailyNewLimit ?? 20,
      dailyReviewLimit: p.dailyReviewLimit ?? 200,
      requestRetention: p.requestRetention ?? 0.9,
    })) as number;

    const pdfId = (await db.pdfs.add({
      deckId,
      name: p.name,
      blob: p.blob,
      pageCount: p.pageCount,
      pageW: p.pageW,
      pageH: p.pageH,
    })) as number;

    const cards: CardRow[] = p.clozes.map((cz) => ({
      deckId,
      pdfId,
      pageIndex: cz.pageIndex,
      rects: cz.rects,
      answerRect: cz.bbox,
      text: cz.text,
      createdAt: now,
      ...newCard(now),
    }));

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

export async function getDeckPdf(deckId: number): Promise<PdfRow | undefined> {
  return db.pdfs.where("deckId").equals(deckId).first();
}

const lower = (deckId: number) => [deckId, Dexie.minKey] as [number, unknown];

/** Review cards (not New) that are due at or before `now`, soonest first. */
export async function dueReviewCards(
  deckId: number,
  now: number,
  limit?: number,
): Promise<CardRow[]> {
  const arr = await db.cards
    .where("[deckId+due]")
    .between(lower(deckId), [deckId, now], true, true)
    .toArray();
  const due = arr.filter((c) => c.state !== 0).sort((a, b) => a.due - b.due);
  return limit != null ? due.slice(0, limit) : due;
}

/** New (unseen) cards, in reading order (page, then position). */
export async function newCards(deckId: number, limit?: number): Promise<CardRow[]> {
  const arr = await db.cards
    .where("[deckId+state]")
    .between([deckId, 0], [deckId, 0], true, true)
    .toArray();
  arr.sort((a, b) => a.pageIndex - b.pageIndex || (a.id ?? 0) - (b.id ?? 0));
  return limit != null ? arr.slice(0, limit) : arr;
}

export interface DeckCounts {
  total: number;
  due: number;
  newTotal: number;
}

export async function deckCounts(deckId: number, now: number): Promise<DeckCounts> {
  const total = await db.cards.where("deckId").equals(deckId).count();
  const due = (await dueReviewCards(deckId, now)).length;
  const newTotal = await db.cards
    .where("[deckId+state]")
    .between([deckId, 0], [deckId, 0], true, true)
    .count();
  return { total, due, newTotal };
}

/** Count of New cards introduced (first reviewed) today, to honor the daily new limit. */
export async function newIntroducedToday(deckId: number, dayStart: number): Promise<number> {
  return db.reviewLogs
    .where("[deckId+review]")
    .between([deckId, dayStart], [deckId, Dexie.maxKey], true, true)
    .filter((l) => l.state === 0)
    .count();
}

export async function recordReview(
  card: CardRow,
  applied: AppliedGrade,
  reviewAt: number,
): Promise<void> {
  await db.transaction("rw", db.cards, db.reviewLogs, async () => {
    await db.cards.update(card.id!, { ...applied.state });
    await db.reviewLogs.add({
      cardId: card.id!,
      deckId: card.deckId,
      ...applied.log,
      review: reviewAt,
    });
  });
}

export async function updateDeck(deckId: number, patch: Partial<DeckRow>): Promise<void> {
  await db.decks.update(deckId, patch);
}

export interface RedetectResult {
  kept: number;
  added: number;
  removed: number;
}

/**
 * Re-run detection for a deck under a new color config, PRESERVING SRS state for
 * answers whose rect still overlaps an existing card (rect IoU match). New answers
 * become New cards; answers no longer detected are removed (with their logs).
 */
export async function redetectDeck(
  deckId: number,
  color: DeckColorConfig,
  clozes: DetectedCloze[],
): Promise<RedetectResult> {
  const now = Date.now();
  return db.transaction("rw", db.decks, db.pdfs, db.cards, db.reviewLogs, async () => {
    await db.decks.update(deckId, { color });
    const pdf = await db.pdfs.where("deckId").equals(deckId).first();
    if (!pdf?.id) throw new Error("PDFが見つかりません");
    const pdfId = pdf.id;

    const existing = await db.cards.where("deckId").equals(deckId).toArray();
    const byPage = new Map<number, CardRow[]>();
    for (const c of existing) {
      const arr = byPage.get(c.pageIndex) ?? [];
      arr.push(c);
      byPage.set(c.pageIndex, arr);
    }

    const matched = new Set<number>();
    const toAdd: CardRow[] = [];
    let kept = 0;
    for (const cz of clozes) {
      const cands = byPage.get(cz.pageIndex) ?? [];
      let best: CardRow | undefined;
      let bestIoU = 0.4;
      for (const c of cands) {
        if (matched.has(c.id!)) continue;
        const v = iou(cz.bbox, c.answerRect);
        if (v > bestIoU) {
          bestIoU = v;
          best = c;
        }
      }
      if (best) {
        matched.add(best.id!);
        kept++;
        await db.cards.update(best.id!, {
          rects: cz.rects,
          answerRect: cz.bbox,
          text: cz.text,
        });
      } else {
        toAdd.push({
          deckId,
          pdfId,
          pageIndex: cz.pageIndex,
          rects: cz.rects,
          answerRect: cz.bbox,
          text: cz.text,
          createdAt: now,
          ...newCard(now),
        });
      }
    }

    const removeIds = existing.filter((c) => !matched.has(c.id!)).map((c) => c.id!);
    if (removeIds.length) {
      await db.cards.bulkDelete(removeIds);
      await db.reviewLogs.where("cardId").anyOf(removeIds).delete();
    }
    for (let i = 0; i < toAdd.length; i += 500) {
      await db.cards.bulkAdd(toAdd.slice(i, i + 500));
    }
    return { kept, added: toAdd.length, removed: removeIds.length };
  });
}

/** Lowest page index that has any answer (so previews open on a useful page). */
export async function firstAnswerPage(deckId: number): Promise<number> {
  const c = await db.cards
    .where("[deckId+pageIndex]")
    .between([deckId, Dexie.minKey], [deckId, Dexie.maxKey], true, true)
    .first();
  return c?.pageIndex ?? 0;
}

/** All cards whose answer sits on a given page (for the red-sheet viewer). */
export async function cardsOnPage(deckId: number, pageIndex: number): Promise<CardRow[]> {
  return db.cards
    .where("[deckId+pageIndex]")
    .between([deckId, pageIndex], [deckId, pageIndex], true, true)
    .toArray();
}

export async function deleteDeck(deckId: number): Promise<void> {
  await db.transaction("rw", db.decks, db.pdfs, db.cards, db.reviewLogs, async () => {
    await db.cards.where("deckId").equals(deckId).delete();
    await db.reviewLogs.where("deckId").equals(deckId).delete();
    await db.pdfs.where("deckId").equals(deckId).delete();
    await db.decks.delete(deckId);
  });
}
