// Client for the AI ○× question generator. All generation happens server-side (/api/sync/generate);
// this just gathers the page's text + marked terms, calls the endpoint, and persists the result
// locally (Dexie). Pro+ also has the questions in D1 (restoreCloudQuestions pulls them on a new
// device). Quota is enforced server-side — a 402 surfaces as QuotaError for the upgrade prompt.
import { authedFetch } from "../sync/api";
import { putBookQuestions, savePageQuestions } from "../db/repo";
import type { QuestionRow } from "../types";

export type Density = "auto" | "few" | "normal" | "many";

export interface GenUsage {
  tier: string;
  count: number;
  limit: number;
  remaining: number;
  unlimited: boolean;
}

/** Thrown on 402: the monthly page budget is used up. */
export class QuotaError extends Error {
  constructor(
    public count: number,
    public limit: number,
  ) {
    super("quota_exceeded");
    this.name = "QuotaError";
  }
}
/** Thrown on 503: ANTHROPIC_API_KEY not configured on the server yet. */
export class AiUnavailableError extends Error {
  constructor() {
    super("ai_not_configured");
    this.name = "AiUnavailableError";
  }
}

interface ServerQ {
  id: string;
  statement: string;
  answer: "正" | "誤";
  explanation?: string;
  source?: string;
}

/** This account's current-month generation quota (for the "残り枠" UI). */
export async function getGenUsage(): Promise<GenUsage> {
  const res = await authedFetch("/generate");
  if (!res.ok) throw new Error(`usage_failed_${res.status}`);
  return res.json();
}

/** Generate (or fetch cached) questions for one page, then persist them locally. */
export async function generatePage(opts: {
  bookId: string;
  pageIndex: number;
  pageText: string;
  markedTerms: string[];
  density: Density;
  subjectHint?: string;
  regenerate?: boolean;
}): Promise<{ questions: QuestionRow[]; remaining?: number; cached?: boolean }> {
  const res = await authedFetch("/generate", {
    method: "POST",
    body: JSON.stringify({
      bookId: opts.bookId,
      pageIndex: opts.pageIndex,
      pageText: opts.pageText,
      markedTerms: opts.markedTerms,
      density: opts.density,
      subjectHint: opts.subjectHint ?? "",
      regenerate: !!opts.regenerate,
    }),
  });
  if (res.status === 402) {
    const b = (await res.json().catch(() => ({}))) as { count?: number; limit?: number };
    throw new QuotaError(b.count ?? 0, b.limit ?? 0);
  }
  if (res.status === 503) throw new AiUnavailableError();
  if (!res.ok) throw new Error(`generate_failed_${res.status}`);
  const data = (await res.json()) as {
    questions: ServerQ[];
    remaining?: number;
    cached?: boolean;
  };
  const now = Date.now();
  // The client knows pageIndex/bookId from the request; the response may name them either way, so we
  // take them from opts and only read the per-question fields (consistent for fresh + cached).
  const rows: QuestionRow[] = (data.questions ?? []).map((q) => ({
    id: q.id,
    bookId: opts.bookId,
    pageIndex: opts.pageIndex,
    statement: q.statement,
    answer: q.answer,
    explanation: q.explanation ?? "",
    source: q.source ?? "",
    createdAt: now,
  }));
  await savePageQuestions(opts.bookId, opts.pageIndex, rows);
  return { questions: rows, remaining: data.remaining, cached: data.cached };
}

/** Pro+ restore: pull a book's whole question set from D1 onto this device. Best-effort. */
export async function restoreCloudQuestions(bookId: string): Promise<void> {
  let res: Response;
  try {
    res = await authedFetch(`/questions?bookId=${encodeURIComponent(bookId)}`);
  } catch {
    return;
  }
  if (!res.ok) return;
  const data = (await res.json().catch(() => ({ questions: [] }))) as {
    questions: {
      id: string;
      page_index: number;
      statement: string;
      answer: string;
      explanation?: string;
      source?: string;
      created_at?: number;
    }[];
  };
  if (!data.questions?.length) return;
  const rows: QuestionRow[] = data.questions.map((q) => ({
    id: q.id,
    bookId,
    pageIndex: q.page_index,
    statement: q.statement,
    answer: q.answer === "誤" ? "誤" : "正",
    explanation: q.explanation ?? "",
    source: q.source ?? "",
    createdAt: q.created_at ?? Date.now(),
  }));
  await putBookQuestions(bookId, rows);
}
