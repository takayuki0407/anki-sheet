import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  type Card,
  type FSRS,
  type Grade,
} from "ts-fsrs";
import type { FsrsState, ReviewLogRow } from "../types";

/** UI grade buttons map to FSRS Rating values. */
export const UI_RATINGS = [1, 2, 3, 4] as const; // Again | Hard | Good | Easy
export type UiRating = (typeof UI_RATINGS)[number];
export const RATING_LABEL: Record<UiRating, string> = {
  1: "もう一度",
  2: "難しい",
  3: "ふつう",
  4: "簡単",
};

let _f: FSRS = fsrs(generatorParameters({ enable_fuzz: true }));

export function configureFsrs(requestRetention: number): void {
  _f = fsrs(generatorParameters({ request_retention: requestRetention, enable_fuzz: true }));
}

function flatten(c: Card): FsrsState {
  return {
    due: c.due.getTime(),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: c.elapsed_days,
    scheduled_days: c.scheduled_days,
    learning_steps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state as 0 | 1 | 2 | 3,
    last_review: c.last_review ? c.last_review.getTime() : null,
  };
}

function inflate(s: FsrsState): Card {
  return {
    due: new Date(s.due),
    stability: s.stability,
    difficulty: s.difficulty,
    elapsed_days: s.elapsed_days,
    scheduled_days: s.scheduled_days,
    learning_steps: s.learning_steps,
    reps: s.reps,
    lapses: s.lapses,
    state: s.state,
    last_review: s.last_review != null ? new Date(s.last_review) : undefined,
  };
}

export function newCard(now: number): FsrsState {
  return flatten(createEmptyCard(new Date(now)));
}

/** Human-readable interval like "10分" / "3日" / "2ヶ月" / "1.4年". */
export function formatInterval(ms: number): string {
  const min = ms / 60000;
  if (min < 1) return "今すぐ";
  if (min < 60) return `${Math.round(min)}分`;
  const hours = min / 60;
  if (hours < 24) return `${Math.round(hours)}時間`;
  const days = hours / 24;
  if (days < 30) return `${Math.round(days)}日`;
  const months = days / 30;
  if (months < 12) return `${months.toFixed(months < 3 ? 1 : 0)}ヶ月`;
  return `${(days / 365).toFixed(1)}年`;
}

export interface GradeOutcome {
  rating: UiRating;
  state: FsrsState;
  due: number;
  intervalText: string;
}

/** Compute the four possible outcomes for labeling the grade buttons. */
export function preview(s: FsrsState, now: number): Record<UiRating, GradeOutcome> {
  const card = inflate(s);
  const out = {} as Record<UiRating, GradeOutcome>;
  for (const r of UI_RATINGS) {
    const item = _f.next(card, new Date(now), r as Grade);
    out[r] = {
      rating: r,
      state: flatten(item.card),
      due: item.card.due.getTime(),
      intervalText: formatInterval(item.card.due.getTime() - now),
    };
  }
  return out;
}

export interface AppliedGrade {
  state: FsrsState;
  log: Omit<ReviewLogRow, "id" | "cardId" | "deckId">;
}

/** Apply a grade, returning the new flattened state and a review-log row. */
export function applyGrade(s: FsrsState, now: number, rating: UiRating): AppliedGrade {
  const item = _f.next(inflate(s), new Date(now), rating as Grade);
  const lg = item.log;
  return {
    state: flatten(item.card),
    log: {
      rating: lg.rating,
      state: lg.state,
      due: lg.due.getTime(),
      stability: lg.stability,
      difficulty: lg.difficulty,
      elapsed_days: lg.elapsed_days,
      last_elapsed_days: lg.last_elapsed_days,
      scheduled_days: lg.scheduled_days,
      review: lg.review.getTime(),
    },
  };
}
