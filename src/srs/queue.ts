import { dueReviewCards, newCards, newIntroducedToday } from "../db/repo";
import type { CardRow, DeckRow } from "../types";

export function startOfDay(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Evenly interleave new cards among due reviews. */
function interleave(due: CardRow[], news: CardRow[]): CardRow[] {
  if (news.length === 0) return due;
  if (due.length === 0) return news;
  const out: CardRow[] = [];
  const step = Math.max(1, Math.round(due.length / (news.length + 1)) || 1);
  let di = 0;
  let ni = 0;
  while (di < due.length || ni < news.length) {
    for (let k = 0; k < step && di < due.length; k++) out.push(due[di++]);
    if (ni < news.length) out.push(news[ni++]);
  }
  return out;
}

/** Today's review queue for a deck, honoring daily new/review limits. */
export async function buildQueue(deck: DeckRow, now: number): Promise<CardRow[]> {
  const deckId = deck.id!;
  const due = await dueReviewCards(deckId, now, deck.dailyReviewLimit);
  const introduced = await newIntroducedToday(deckId, startOfDay(now));
  const newAllow = Math.max(0, deck.dailyNewLimit - introduced);
  const news = newAllow > 0 ? await newCards(deckId, newAllow) : [];
  return interleave(due, news);
}
