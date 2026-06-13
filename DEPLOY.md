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

## イベント分析(Phase 2)を有効化する — `ANTHROPIC_API_KEY`

「イベント分析」(出来事 → 因果連鎖 → 買い/売りランキング)は Claude を使うため、
Vercel に API キーを設定する必要があります。**未設定でも価格予測(forecast)は動きます**が、
分析ボタンを押すと「ANTHROPIC_API_KEY が設定されていません」というエラーになります。

1. https://platform.claude.com/ で API キー(`sk-ant-...`)を発行
2. Vercel のプロジェクト → **Settings → Environment Variables** で追加:
   - Name: `ANTHROPIC_API_KEY`
   - Value: 発行したキー
   - Environments: Production(必要なら Preview も)
3. **Deployments → 最新デプロイ → Redeploy**(環境変数は再デプロイで反映)

> コスト: 1 回の分析で `claude-opus-4-8` を呼びます(目安 数〜数十円/回)。
> キーはサーバー側の環境変数にのみ置かれ、ブラウザには露出しません。

ローカルで分析まで試す場合は、`ANTHROPIC_API_KEY=sk-ant-... npm run dev` で起動します。

---

## デプロイ後の確認

```bash
# 公開 URL を YOUR_URL に置き換えて:
curl -s "https://YOUR_URL/api/prices?code=AAPL" | head -c 200

# イベント分析(ANTHROPIC_API_KEY 設定後):
curl -s -X POST "https://YOUR_URL/api/analyze" \
  -H "Content-Type: application/json" \
  -d '{"event":"TSMCが熊本に第3工場を建設する","market":"jp"}' | head -c 300
```

ブラウザで公開 URL を開き、銘柄(例 `7203.T`)を入れて「予測する」を押すと、
分位点テーブルとファンチャートが表示されれば成功です。イベント分析は出来事を入れて
「分析する」を押し、因果連鎖と買い/売りランキングが出れば成功です。

---

## ローカルでの動作確認(デプロイ不要)

```bash
npm run dev    # http://localhost:3000
```

`dev-server.mjs` が `public/` の静的配信と `/api/prices` を Vercel と同等に提供します。
