// 情報・ヘルプ画面 — usage help, account/data notes, support + legal links, about.
// Reachable from the topbar "情報" link.
import { useEffect, useState } from "react";
import { useApp } from "../store/session";
import { deleteAccount, signOutUser, useAuth } from "../auth/useAuth";
import { listBooks, type AccountBooks } from "../sync/api";
import { clearAllLocalData } from "../db/backup";

const SUPPORT_EMAIL = "zabieru.0407@gmail.com";

const FAQ = [
  {
    q: "Anki-sheetとは？",
    a: "色付きの答え（赤・マゼンタなど）が印刷されたPDFを取り込むと、答えの部分を自動で検出して隠せます。タップで答えを確認しながら暗記でき、隠し方は『赤マスク』（答えを個別に隠す）と『赤シート』（半透明のシートをスライド）から選べます。PDFの解析は端末内で完結します（解析のために送信されることはありません）。クラウド同期（Pro）を使う場合のみ、ご自身の端末間で共有するためにPDFがアカウントに保存されます。",
  },
  {
    q: "PDFの取り込み方",
    a: "本棚の「＋ PDFを取り込む」からファイルを選び、答えの色（赤／マゼンタ／橙／青）を選んで検出します。検出には少し時間がかかります（中止可）。",
  },
  {
    q: "検出がうまくいかない時",
    a: "本の「設定」から、答えの色プリセットや詳細（色相・許容幅・彩度の下限・見出し除外など）を調整して『このPDFを再検出』してください。1ページのプレビューで結果を見ながら追い込めます。",
  },
  {
    q: "ビューアの操作",
    a: "答えをタップで表示／もう一度タップで再び隠す。隠し方は『赤マスク』（答えを個別に隠す）と『赤シート』（縦読みで半透明シートをスライド）から選べます。倍率は ± と数値入力、「100%」ボタンで等倍に戻せます。『縦読み／横読み』『目次（しおり）』にも対応。しおりは目次の ✎ で名前を編集できます。",
  },
];

function Faq({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="faq">
      <button className="faq-q" onClick={() => setOpen((v) => !v)}>
        <span>{q}</span>
        <span aria-hidden>{open ? "−" : "＋"}</span>
      </button>
      {open && <p className="faq-a">{a}</p>}
    </div>
  );
}

function planLabel(tier?: string): string {
  return tier === "pro"
    ? "Pro"
    : tier === "admin"
      ? "管理者（無制限）"
      : tier === "standard"
        ? "Standard"
        : "—";
}

export function Info() {
  const setView = useApp((s) => s.setView);
  const user = useAuth((s) => s.user);
  const [usage, setUsage] = useState<AccountBooks | null>(null);
  const [delOpen, setDelOpen] = useState(false);
  const [delPw, setDelPw] = useState("");
  const [delBusy, setDelBusy] = useState(false);
  const [delMsg, setDelMsg] = useState("");

  const onSignOut = async () => {
    if (
      !window.confirm(
        "ログアウトすると、この端末に保存されている本はすべて削除されます（Proでクラウドに保存済みの本は再ログインで取得できます）。よろしいですか？",
      )
    )
      return;
    await signOutUser();
    await clearAllLocalData();
    setView({ name: "decks" }); // empty bookshelf, signed out
  };

  const onDeleteAccount = async () => {
    if (
      !window.confirm(
        "本当にアカウントを削除しますか？\nクラウドのPDF・検出結果・進捗、そしてこの端末内のデータもすべて削除され、元に戻せません。",
      )
    )
      return;
    setDelBusy(true);
    setDelMsg("");
    try {
      await deleteAccount(delPw);
      await clearAllLocalData();
      alert("アカウントとデータをすべて削除しました。");
      setView({ name: "home" });
    } catch (e) {
      const code = e && typeof e === "object" && "code" in e ? String((e as { code: string }).code) : "";
      setDelMsg(
        /wrong-password|invalid-credential|invalid-login/.test(code)
          ? "パスワードが正しくありません。"
          : "削除に失敗しました：" + (e instanceof Error ? e.message : String(e)),
      );
    } finally {
      setDelBusy(false);
    }
  };
  useEffect(() => {
    if (!user) {
      setUsage(null);
      return;
    }
    let live = true;
    void listBooks()
      .then((u) => live && setUsage(u))
      .catch(() => live && setUsage(null));
    return () => {
      live = false;
    };
  }, [user]);
  return (
    <div className="panel info-page">
      <div className="panel-head">
        <button className="btn ghost" onClick={() => setView({ name: "decks" })}>
          ← 本棚
        </button>
        <h2>情報・ヘルプ</h2>
      </div>

      <section className="info-section">
        <h3 className="section">使い方</h3>
        {FAQ.map((f) => (
          <Faq key={f.q} q={f.q} a={f.a} />
        ))}
      </section>

      <section className="info-section">
        <h3 className="section">アカウント</h3>
        <div className="info-card">
          {user ? (
            <>
              <p>
                ログイン中：<strong>{user.email ?? "（メール未設定）"}</strong>
              </p>
              {usage ? (
                <p className="usage-line">
                  {usage.unlimited ? (
                    <>
                      取り込み：<strong>{usage.count} 冊</strong>（
                      {usage.tier === "admin" ? "管理者" : "Pro"}・無制限）
                    </>
                  ) : (
                    <>
                      取り込み：
                      <strong>
                        {usage.count} / {usage.limit} 冊
                      </strong>
                      （あと {Math.max(0, usage.limit - usage.count)} 冊）
                    </>
                  )}
                </p>
              ) : null}
              <p className="muted small">
                同じアカウントで iOSアプリ にもログインできます。Proでは端末・プラットフォーム間で
                クラウド同期されます。
              </p>
              <button className="btn ghost sm" onClick={() => void onSignOut()}>
                ログアウト
              </button>
              <div className="danger-zone">
                {!delOpen ? (
                  <button
                    className="linklike danger-link"
                    onClick={() => {
                      setDelOpen(true);
                      setDelMsg("");
                      setDelPw("");
                    }}
                  >
                    アカウントを削除
                  </button>
                ) : (
                  <div className="delete-account">
                    <p className="small">
                      アカウントを削除すると、
                      <strong>クラウドに保存されたPDF・検出結果・進捗もすべて削除</strong>され、元に
                      戻せません。確認のためパスワードを入力してください（この端末内のデータは残ります）。
                    </p>
                    <input
                      type="password"
                      className="del-pw"
                      placeholder="パスワード"
                      value={delPw}
                      autoComplete="current-password"
                      onChange={(e) => setDelPw(e.target.value)}
                    />
                    {delMsg && <p className="auth-msg">{delMsg}</p>}
                    <div className="del-actions">
                      <button
                        className="btn ghost sm"
                        disabled={delBusy}
                        onClick={() => {
                          setDelOpen(false);
                          setDelPw("");
                          setDelMsg("");
                        }}
                      >
                        キャンセル
                      </button>
                      <button
                        className="btn danger sm"
                        disabled={delBusy || !delPw}
                        onClick={onDeleteAccount}
                      >
                        {delBusy ? "削除中…" : "削除する"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <p>
                <strong>アカウント</strong>を作成すると、iOSアプリと同じアカウントで利用でき、
                Proでは端末・プラットフォーム間でクラウド同期できます。
              </p>
              <p className="muted small">
                ログインしない場合も、データ（取り込んだPDF・検出結果・しおり）は
                <strong>このブラウザ内だけ</strong>に保存され、引き続き無料で使えます。
              </p>
              <button className="btn primary sm" onClick={() => setView({ name: "login" })}>
                ログイン / アカウント作成
              </button>
            </>
          )}
        </div>
      </section>

      <section className="info-section">
        <h3 className="section">プラン</h3>
        <div className="info-card">
          {!user ? (
            <p className="muted small">
              プランの確認・変更には{" "}
              <button className="linklike" onClick={() => setView({ name: "login" })}>
                ログイン
              </button>
              してください。
            </p>
          ) : (
            <>
              <p>
                現在のプラン：<strong>{planLabel(usage?.tier)}</strong>
              </p>
              <div className="plan-compare">
                <div className={`plan-col ${usage?.tier === "standard" ? "current" : ""}`}>
                  <h4>Standard</h4>
                  <p className="plan-price">
                    ¥300<span className="muted small"> /月</span>
                    <br />
                    <span className="muted small">¥2,500 /年</span>
                  </p>
                  <ul>
                    <li>本を10冊まで取り込み</li>
                  </ul>
                </div>
                <div className={`plan-col pro ${usage?.tier === "pro" ? "current" : ""}`}>
                  <h4>Pro</h4>
                  <p className="plan-price">
                    ¥600<span className="muted small"> /月</span>
                    <br />
                    <span className="muted small">¥5,000 /年</span>
                  </p>
                  <ul>
                    <li>本を無制限に取り込み</li>
                    <li>クラウドストレージ 5GB</li>
                    <li>全ての端末・プラットフォームで進捗同期</li>
                  </ul>
                </div>
              </div>
              {usage?.tier === "admin" ? (
                <p className="muted small">
                  管理者アカウントのため、すべての機能を無制限でご利用いただけます。
                </p>
              ) : usage?.tier === "pro" ? (
                <button
                  className="btn ghost sm"
                  onClick={() =>
                    alert(
                      "プランの変更・解約は現在 iOSアプリ から行えます（Web版の課金は準備中です）。",
                    )
                  }
                >
                  プランを変更
                </button>
              ) : (
                <button
                  className="btn primary sm"
                  onClick={() =>
                    alert(
                      "Proへのアップグレードは現在 iOSアプリ から行えます（Web版の課金は準備中です）。",
                    )
                  }
                >
                  Pro にアップグレード
                </button>
              )}
            </>
          )}
        </div>
      </section>

      <section className="info-section">
        <h3 className="section">データ・バックアップ</h3>
        <div className="info-card">
          <p className="muted small">
            本棚画面の「バックアップを書き出す」で全データをJSONとして保存、「読み込む」で復元できます
            （iOS版とも互換）。ブラウザのデータ消去で消えるため、定期的な書き出しをおすすめします。
          </p>
          <button className="btn sm" onClick={() => setView({ name: "decks" })}>
            本棚を開く
          </button>
        </div>
      </section>

      <section className="info-section">
        <h3 className="section">サポート・規約</h3>
        <ul className="info-links">
          <li>
            <a href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Anki-sheet お問い合わせ")}`}>
              お問い合わせ
            </a>
          </li>
          <li>
            <a href="/privacy.html" target="_blank" rel="noopener noreferrer">
              プライバシーポリシー
            </a>
          </li>
          <li>
            <a href="/terms.html" target="_blank" rel="noopener noreferrer">
              利用規約
            </a>
          </li>
        </ul>
      </section>

      <section className="info-section">
        <h3 className="section">このアプリについて</h3>
        <div className="info-card">
          <p className="small">Anki-sheet</p>
          <p className="small">
            <button className="linklike" onClick={() => setView({ name: "home" })}>
              製品紹介・料金プランページ →
            </button>
          </p>
          <p className="muted small">build {__BUILD_ID__}</p>
          <p className="muted small">
            pdf.js — Apache-2.0 (© Mozilla) ／ React — MIT ／ Dexie・zustand・colord — MIT
          </p>
        </div>
      </section>
    </div>
  );
}
