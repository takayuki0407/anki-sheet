# Kiokumate（キオクメイト・赤シート暗記アプリ）

> **隠して覚え、解いて確かめる。**（旧称 Anki-sheet。GitHub リポジトリ名・Cloudflare プロジェクト名・
> バンドルID 等のインフラ識別子は `anki-sheet` のまま据え置き、ユーザー向け表記のみ Kiokumate に統一）

赤シート対応のPDF教材（赤・マゼンタなど色付きの語句を赤シートで隠せるタイプ）を取り込むと、
色付きの答えを**自動検出**し、**デジタル赤シート**として通読できる暗記アプリです。
PDFの解析は端末内で完結します（クラウド同期 = Pro を使う場合のみ、ご自身の端末間で共有する
ためにPDFがアカウントへ保存されます）。

- **Web版（このリポジトリ）**: Vite + React + TypeScript + pdf.js + Dexie/IndexedDB。Cloudflare Pages で配信。
- **iOS版（別リポジトリ `anki-sheet-ios`）**: Expo / React Native + expo-sqlite + WebView(pdf.js) エンジン + RevenueCat。
  **同じアカウント・同じ Cloudflare バックエンドを共有**します。

> ⚠️ **公開状況**: Web版は **現在は非公開（「準備中」ページのみ）** です。Web課金が整うまで、
> 本番ビルドは ComingSoon を表示し、フルアプリはプレビュー環境でのみ動作します（[デプロイ](#デプロイcloudflare-pages--workers)参照）。
> 先行リリースは iOS版が対象です。

---

## 主な機能（ビューア / 検出 / 保存）

- **本棚**: 取り込んだ書籍を表紙サムネイル付きで並べ、タップで開く。お気に入り（★）でピン留め、並び替え（新着/名前/最近開いた順）。
- **赤シート・ビューア**: ページをそのまま描画し、隠し方を 2 通りから選べます。
  - **赤マスク**: 答えを個別に隠す。タップで表示／再タップで再び隠す。
  - **赤シート**: 半透明シートを縦読みでスライド。
- **2 つの読み方**: 縦読み（全ページ縦スクロール・既定）／横読み（ページめくり）。前回の読み方を復元。
- **表示**: 全体表示／幅に合わせる、拡大縮小（50〜400%）、全画面。
- **ページ移動**: 前後送り・ページ番号入力・スライダー・画像左右タップ。進捗％表示。**前回の続きのページ・読み方から再開**。
- **目次（しおり）**: 章の先頭などを登録して移動。埋め込み目次の無い教材でも自作可能（✎ で名前編集）。
- **復習（★）**: 答えを★でマークして復習対象に。端末間で同期（Pro）。
- **改行をまたぐ暗記箇所**: 行をまたいで続く答えも 1 つの暗記箇所として扱います。
- **AIで○×問題（解いて確かめる）**: ページの本文と暗記語句から、AIが正誤問題（○×）を自動生成。「覚えたつもり」を解いて確認できます。この機能のみ、選んだページの本文と語句を当アプリのサーバー経由で**外部のAIサービス**に送信します（初回に同意確認）。**生成内容は誤りを含む場合があり**、送信内容は**既定でAIモデルの学習には使われません**。前後ページの文脈も参考に渡し、ページ境界で切れた語句も出題できます。プラン別に月間の生成上限があります。
- **色の自動 / 手動チューニング**: 取り込み時に「自動」または色プリセット（赤/マゼンタ/橙/青）を選択。設定で色相・しきい値・見出し除外をライブプレビューしながら調整し、**このPDFを再検出**。
- **オフライン保存**: デッキ・PDF・暗記箇所はブラウザ内（IndexedDB / Dexie）。
- **バックアップ**: 全データ（PDF含む）を JSON で書き出し / 読み込み（iOS版と互換）。
- **その他**: ダークモード（OS設定追従）、キーボード操作（← → でめくり・Space で赤シート切替・＋/− で拡大）。

> 💾 **ブラウザのキャッシュ/サイトデータを消すとローカルのデータも消えます。** 大事な教材は
> 「バックアップを書き出す」で保存するか、Pro のクラウド同期をご利用ください。

---

## アカウントとプラン（現在の仕様）

- **サインイン必須**（Firebase Auth・メール/パスワード、iOS は Sign in with Apple も）。アプリ画面はログインしないと使えません。
- **プラン**（無料プランあり＝ロックなし。**Premium は初回 7 日間の無料トライアル付き**）:

  | プラン | 月額 | 年額（月額×10） | 取り込み冊数 | AI生成/月 | クラウド同期 |
  |---|---|---|---|---|---|
  | **Free** | ¥0 | — | 1 冊 | 1 回 | なし |
  | **Standard** | ¥300 | ¥3,000 | 10 冊 | 10 回 | なし |
  | **Pro** | ¥600 | ¥6,000 | 無制限 | 30 回 | あり（R2・合計 5GB / 1ファイル 100MB） |
  | **Premium** | ¥980 | ¥9,800 | 無制限 | 100 回 | あり（＋「今日の復習」= SM-2 SRS） |

  - **AI 生成の単位は「回」＝ 1 回の生成API呼び出し（1 ページ × 問題の種類（○× / 4択））**。
    初回生成も再生成（作り直し）も 1 回ずつ消費します。無料なのは**生成済みの再表示**（API を呼ばないキャッシュ返却）だけ。
  - サインインすれば未契約でも **Free（1 冊）** として使え、ペイウォールで強制ロックはしません。
  - 開発者アカウント（管理者メール）は常に無制限。
  - **無料トライアル**: Premium のみ初回 7 日間無料。トライアル中は AI 生成を月 30 回に制限（`TRIAL_GEN_PAGES`）。
- **冊数・AI枠はアカウント全体で数えます（サーバ権威）**: 本の登録は D1（`books`）で一元管理し、上限は
  **アカウント全体（全端末の合計）** で判定します。同期しない Standard でもサーバが総数を数えるため、
  端末を増やしても上限は変わりません。AI 生成枠も同様にサーバで原子的に予約し、失敗時は返金します。
- **クラウド同期（Pro / Premium）**: PDF 実体・デッキ内容（色設定・検出結果・しおり）・進捗（位置・表示済み・
  ★・しおり）を端末間で同期します（**後勝ち = Last-Write-Wins**）。同期は常に **fail-open**（失敗してもローカル動作は止めません）。

### 強制モデル（「プラン超過」を起こさない）

| 操作 | 挙動 |
|---|---|
| 未サインイン | アプリ画面に入れない（サインイン必須） |
| 未契約（Free） | **1 冊までロックなしで利用可**。2 冊目以降の取り込みでアップグレード案内 |
| ログアウト | **ロック＋ローカル保持**（再サインインするまで開けない。データは消さない） |
| 別アカウントでログイン | その端末の **前アカウントのローカルデータを削除** |
| アカウント削除 | クラウド（R2 + D1）と **ローカルを全削除** |
| ダウングレードで上限超過 | **強制トリム画面**で残す本を選び、他はローカル削除。クラウドコピーは**保持**し、再 Pro/Premium で復元可能 |
| 取り込みで上限到達 | 取り込みをブロック（不要な本を削除 or 上位プラン案内） |
| 6 ヶ月リテンション | 非 Pro/Premium が 6 ヶ月続いたアカウントの保持クラウドデータを、日次 cron Worker が削除（`users.downgraded_at` 起点） |
| 体験版の乱用防止 | iOS は Apple（Apple ID ごとの体験版）が担保 |

---

## アーキテクチャ

### フロントエンド（Web・このリポジトリ）

```
src/detect/   色検出（colorBand / pixelSampler / detectPage など）— 純粋関数
src/pdf/      pdf.js 連携（描画・テキスト位置・cMap 設定・全ページ検出）
src/render/   PageOverlay（ページ描画＋赤シートマスクの唯一の実装）/ ジェスチャ
src/db/       Dexie スキーマ＋データアクセス（repo / backup）
src/auth/     Firebase Auth（サインイン・別アカウント検知・アカウント削除）
src/sync/     バックエンド同期クライアント（books 登録 / R2 / 進捗 / エラー文言）
src/components/  DeckList / ImportWizard / PageViewer / Settings / Info /
                Login / DowngradeSelect（強制トリム）/ ComingSoon / マーケ頁
src/store/    画面遷移（zustand）
scripts/      cMap コピー、E2E スモーク
```

### バックエンド（iOS と共有・Cloudflare）

`functions/api/*` は Cloudflare **Pages Functions**。常に `/api/*` で配信されます。

- **D1**（`anki-sheet-db`）: `users`（`tier` / `downgraded_at`）/ `books`（アカウントの本の登録）/ `progress`。
  スキーマは `migrations/`。
- **R2**（`anki-sheet-pdfs`）: Pro の PDF 実体＋内容 JSON（キー `${uid}/${bookId}.pdf` / `.json`）。
- **認証**: Firebase ID トークンを検証し uid を解決（`functions/api/_middleware` 系）。
- **RevenueCat webhook**（`functions/api/webhook/revenuecat.ts`）: 課金イベントで `users.tier`・
  `trial_until`・`downgraded_at`（Pro/Premium で NULL、非 Pro で最初の降格時刻を保持）を更新。
- **AI問題生成**（`functions/api/sync/generate.ts`）: 選択ページの本文＋暗記語句（＋前後ページの参考文脈）を
  受け取り、**Claude Haiku 4.5**（`claude-haiku-4-5-20251001`）で○×問題を生成。月間ページ枠をサーバで
  原子的に予約／失敗時返金（`functions/_lib/tier.ts` の `genPageLimit` / `genLimitDuringTrial`）。
  `ANTHROPIC_API_KEY` 未設定時は 503（`ai_not_configured`）。
- **リテンション Worker**（`worker/retention.ts` + `worker/wrangler.toml`）: Pages は cron 非対応のため
  **別 Worker**。日次 cron（`23 3 * * *`）で「降格 6 ヶ月超かつ非 Pro」のアカウントの R2(`${uid}/`) を削除し、
  `books.size=0 / r2_key=NULL` に。同じ D1 / R2 を bind。

### iOS版（別リポジトリ）

Expo / React Native。検出も表示も **WebView 内の pdf.js エンジン**（`engine-src/` → `assets/engine.zip`）で行い、
保存は **expo-sqlite ＋ファイル**（iOS のデータ退避の影響を受けにくい）、課金は **RevenueCat**。
上の Web と同じアカウント・同じ Cloudflare バックエンドを共有します。

---

## 仕組み（重要メモ）

- **cMaps 必須**: 日本語などの CID フォントを pdf.js で描画・抽出するには `pdfjs-dist/cmaps` と
  `standard_fonts` を静的配信し、`cMapUrl` / `cMapPacked` / `standardFontDataUrl` を渡す必要があります。
  これが無いと**グリフが描画されず** `getTextContent()` も **0 件**になります。
  `scripts/copy-pdfjs-assets.mjs` が `postinstall` / `predev` / `prebuild` で `public/pdfjs/` へ自動コピーします
  （`public/pdfjs` は git 管理外）。
- **色の検出**: pdf.js はテキスト色を直接返さないため、ページを canvas に描画し、各テキストランの位置の
  ピクセル色を HSL バンドで判定します（`src/detect/`）。座標とピクセル色のみを使うので、文字コードが
  化けても問題ありません。読み順グルーピングで改行をまたぐ答えを 1 つに統合し、見出しは高さで除外します。

---

## 開発

```bash
npm install        # 依存をインストール（pdf.js の cMaps も public/ へ自動コピー）
npm run dev        # 開発サーバ（http://localhost:5173）。/api は無いので同期系は fail-open
npm run typecheck  # 型チェック
npm test           # 単体テスト（色バンド判定・読み順・見出し除外・IoU など）
```

実 PDF 統合テスト（任意・Node + @napi-rs/canvas）:

```bash
# Windows (PowerShell)
$env:ANKI_SHEET_TEST_PDF="C:\path\to\redsheet.pdf"; npm test
```

例の財務諸表論 PDF（252 ページ）では約 3,300 個の暗記箇所を検出します（行をまたぐ答えは 1 つにまとめます）。

> 検出ロジックを更新したら、既存デッキは「設定 → このPDFを再検出」（ワンタップ）で作り直してください。

---

## デプロイ（Cloudflare Pages / Workers）

> ⚠️ **Git 連携の自動デプロイは使っていません。** デプロイは必ず `wrangler` で行います
> （`git push` やブランチのマージだけでは反映されません）。フロントの公開可否は **fail-closed** な
> `VITE_PUBLIC` フラグで決まり、既定（`npm run build`）は非公開（ComingSoon）です。

```bash
# 本番（非公開＝準備中ページ）: VITE_PUBLIC 未設定 → ComingSoon
npm run build
wrangler pages deploy dist --project-name=anki-sheet --branch=main

# プレビュー（フルアプリ・テスト用）: .env.public の VITE_PUBLIC=true
npm run build:public
wrangler pages deploy dist --project-name=anki-sheet --branch=preview
#  → https://preview.anki-sheet.pages.dev
#  （--branch は Cloudflare のエイリアス名。git ブランチとは無関係。旧 ios-parity 別名は未使用のまま残存）

# D1 マイグレーション（remote 本番DB）
wrangler d1 migrations apply anki-sheet-db --remote

# リテンション cron Worker
wrangler deploy --config worker/wrangler.toml
```

### バックエンドの主な環境変数 / シークレット（Pages）

- `FIREBASE_PROJECT_ID`（vars）— ID トークン検証用。
- `ADMIN_EMAIL`（vars）— このメールのアカウントを管理者（無制限）として扱う。
- `RC_WEBHOOK_SECRET`（secret）— RevenueCat webhook の共有シークレット。
- `ANTHROPIC_API_KEY`（secret）— AI問題生成（Claude）用。未設定だと生成 API は 503 を返す。
  設定後は反映のため本番を再デプロイすること（`wrangler pages secret put ANTHROPIC_API_KEY --project-name=anki-sheet`）。

---

## ライセンス / 注意

個人開発の私的プロジェクトです。利用者は**自分が権利を持つ／取り込みが許される PDF** のみを取り込んでください。
PDF の解析は端末内で完結し、Pro のクラウド同期を使う場合のみ、ご自身の端末間共有のためにアカウントへ保存されます。
