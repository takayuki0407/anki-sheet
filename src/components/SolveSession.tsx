// One quiz run-through (○× and 4択), shared by the per-book 演習 tab and the cross-book
// 今日の復習 screen. EVERY answer is recorded locally via recordAnswer() (SM-2 + lastOk —
// drives 間違いのみ復習 / 今日の復習); Premium accounts also sync the records (debounced).
import { useEffect, useState } from "react";
import { flushReviewPushes, recordAnswer } from "../sync/reviews";
import type { QuestionRow } from "../types";

export function SolveSession({
  questions,
  onExit,
  onAnswered,
}: {
  questions: QuestionRow[];
  onExit: () => void;
  /** Fired after each recorded answer (lets the parent refresh due/wrong counts). */
  onAnswered?: (questionId: string, ok: boolean) => void;
}) {
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [correct, setCorrect] = useState(0);

  // Push any queued review records when the session unmounts (exit / finish).
  useEffect(() => flushReviewPushes, []);

  const q = questions[i];
  const done = i >= questions.length;

  if (done)
    return (
      <div className="solve-done">
        <h3>おつかれさまでした</h3>
        <p>
          正解 <strong>{correct}</strong> / {questions.length}
        </p>
        <div className="solve-done-actions">
          <button
            className="btn primary"
            onClick={() => {
              setI(0);
              setPicked(null);
              setCorrect(0);
            }}
          >
            もう一度
          </button>
          <button className="btn ghost" onClick={onExit}>
            一覧へ戻る
          </button>
        </div>
      </div>
    );

  const pick = (a: string) => {
    if (picked) return;
    setPicked(a);
    const ok = a === q.answer;
    if (ok) setCorrect((c) => c + 1);
    void recordAnswer(q, ok).then(() => onAnswered?.(q.id, ok));
  };
  const next = () => {
    setPicked(null);
    setI((n) => n + 1);
  };
  const isRight = picked === q.answer;

  return (
    <div className="solve-session">
      <div className="solve-progress muted small">
        {i + 1} / {questions.length}（P.{q.pageIndex + 1}・{q.qtype === "mc4" ? "4択" : "○×"}）
        <button className="linklike" onClick={onExit}>
          中断
        </button>
      </div>
      <p className="solve-statement">{q.statement}</p>
      {!picked ? (
        q.qtype === "mc4" && q.choices ? (
          <div className="solve-mc4">
            {q.choices.map((c, idx) => (
              <button key={idx} className="btn mc4-choice" onClick={() => pick(c)}>
                <span className="mc4-no">{idx + 1}</span>
                {c}
              </button>
            ))}
          </div>
        ) : (
          <div className="solve-choices">
            <button className="btn maru" onClick={() => pick("正")}>
              ○ 正しい
            </button>
            <button className="btn batsu" onClick={() => pick("誤")}>
              × 誤り
            </button>
          </div>
        )
      ) : (
        <div className="solve-reveal">
          <p className={`solve-verdict ${isRight ? "right" : "wrong"}`}>
            {isRight ? "正解！" : "不正解"} —{" "}
            {q.qtype === "mc4" ? `正解は「${q.answer}」` : `この文は「${q.answer}」`}
          </p>
          {q.qtype === "mc4" && !isRight ? (
            <p className="muted small">あなたの解答：{picked}</p>
          ) : null}
          {q.explanation ? <p className="solve-explain">{q.explanation}</p> : null}
          {q.source ? <p className="muted small">根拠：{q.source}</p> : null}
          <button className="btn primary" onClick={next}>
            次へ
          </button>
        </div>
      )}
    </div>
  );
}
