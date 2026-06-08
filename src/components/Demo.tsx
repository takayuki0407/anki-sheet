// Interactive landing demo: a sample 一問一答 "page" where the answers are hidden under red
// masks. Tap a mask to reveal that answer (tap again to hide); the toolbar toggle reveals/hides
// all at once — exactly the red-sheet loop the real viewer gives an imported PDF. No PDF or
// detection needed: it's a self-contained widget so visitors can try the core interaction instantly.
import { useState } from "react";

const ITEMS: { q: string; a: string }[] = [
  { q: "細胞でエネルギーを生み出す器官は", a: "ミトコンドリア" },
  { q: "日本国憲法の三大原則のうち、戦争を放棄する原則は", a: "平和主義" },
  { q: "1492年に西インド諸島へ到達した人物は", a: "コロンブス" },
  { q: "水の電気分解で陰極から発生する気体は", a: "水素" },
];

export function Demo() {
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [allOn, setAllOn] = useState(false); // 赤シートをめくって全表示した状態

  const toggle = (i: number) =>
    setRevealed((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });
  const isOn = (i: number) => allOn || revealed.has(i);

  return (
    <div className="demo">
      <div className="demo-toolbar">
        <span className="demo-hint">赤い部分をタップ → 答えを確認</span>
        <button
          className="btn ghost sm"
          onClick={() => {
            setAllOn((v) => !v);
            setRevealed(new Set());
          }}
        >
          {allOn ? "赤シートをかける" : "すべて表示"}
        </button>
      </div>
      <div className="demo-page">
        {ITEMS.map((it, i) => (
          <p className="demo-line" key={i}>
            {it.q}
            <span
              className={`demo-mask ${isOn(i) ? "on" : ""}`}
              role="button"
              tabIndex={0}
              onClick={() => !allOn && toggle(i)}
              onKeyDown={(e) => {
                if (!allOn && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  toggle(i);
                }
              }}
            >
              {it.a}
            </span>
            。
          </p>
        ))}
      </div>
    </div>
  );
}
