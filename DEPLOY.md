# デプロイ手順(GitHub + Vercel 連携)

Web 版 EconoLens を無料の Vercel にデプロイし、以後は GitHub への push で
自動デプロイされるようにする手順です。コードはすでに git コミット済み
(ブランチ `main`)で、ローカル動作確認も完了しています。

> なぜ手動か: この環境には GitHub の認証(トークン / `gh` CLI / 有効な SSH 鍵)が
> 無いため、リポジトリ作成と push はあなたの操作が必要です。
> (補足: `~/.ssh/config` が存在しない鍵パス `id_e25519` を指しているため
> GitHub への SSH 接続が失敗しています。下記 HTTPS 手順なら影響を受けません。)

---

## 手順 A: GitHub にリポジトリを作って push(推奨)

### 1. GitHub で空のリポジトリを作成
https://github.com/new で、例えば `econolens` という名前のリポジトリを作成
(README やライセンスは追加しない=空のまま)。

### 2. リモートを追加して push
このディレクトリ(`stock_price_forecast`)で実行:

```bash
# HTTPS の場合(ブラウザ or トークン認証):
git remote add origin https://github.com/<あなたのユーザー名>/econolens.git
git push -u origin main

# SSH を使う場合(鍵を GitHub に登録済みなら):
# git remote add origin git@github.com:<あなたのユーザー名>/econolens.git
# git push -u origin main
```

### 3. Vercel に Git リポジトリを連携
1. https://vercel.com/new を開く(GitHub アカウントでログイン)
2. 「Import Git Repository」で先ほどの `econolens` を選択
3. 設定はそのままで OK(リポジトリ直下の `vercel.json` を Vercel が自動検出。
   `public/` を静的配信、`api/prices.js` をサーバーレス関数として認識します)
4. 「Deploy」を押す → 1〜2 分で公開 URL(`https://econolens-xxxx.vercel.app`)が発行されます

以後、`git push` するたびに Vercel が自動で再デプロイします。

---

## 手順 B: 私(Claude)に push まで任せる場合

GitHub の Personal Access Token(`repo` スコープ)を発行して渡していただければ、
私が GitHub API でリポジトリを作成し、HTTPS で push まで実行できます。
そのうえで手順 A の「3. Vercel 連携」だけをあなたが行う形になります。
(トークンはチャットに貼る形になる点だけご了承ください)

---

## 分析機能は API キー不要(Deep Research ブリッジ)

「今のおすすめ」「イベント分析」は **LLM の API を呼びません**。質的な調査は利用者の
サブスク **Deep Research**(ChatGPT / Gemini / Claude 等)が行い、アプリはその結果(末尾の
JSON ブロック)を貼り込んで定量化します。したがって **`ANTHROPIC_API_KEY` などの設定は不要**で、
追加課金も発生しません(価格取得の Yahoo プロキシもキー不要)。

使い方(アプリ内):
1. 「① 調査プロンプトを生成」を押してプロンプトをコピー
2. お使いの Deep Research に貼って実行
3. 出力(末尾の ```json ブロックを含む)をアプリの貼り付け欄に貼り、「③ 取り込んで分析」
4. 必要なら「追加で深掘りする調査プロンプト(2巡目)」で精度を上げる

---

## デプロイ後の確認

```bash
# 公開 URL を YOUR_URL に置き換えて(価格取得はキー不要):
curl -s "https://YOUR_URL/api/prices?code=AAPL" | head -c 200
```

ブラウザで公開 URL を開き、銘柄(例 `7203.T`)を入れて「予測する」を押すと、
分位点テーブルとファンチャートが表示されれば成功です。「今のおすすめ」「イベント分析」は
プロンプトを生成 → Deep Research の結果を貼り付け → 買い/売りランキングが出れば成功です。

---

## ローカルでの動作確認(デプロイ不要)

```bash
npm run dev    # http://localhost:3000
```

`dev-server.mjs` が `public/` の静的配信と `/api/prices` を Vercel と同等に提供します。
