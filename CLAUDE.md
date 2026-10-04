# CLAUDE.md

`syuilo/ai`(Misskey のBot「藍」)を、自サーバ向けに改修した Fork。
詳しいデプロイ手順は [docs/deploy.md](docs/deploy.md)、バージョンの付け方は [docs/versioning.md](docs/versioning.md)、
形態素解析(MeCab / Sudachi)の切り替えは [docs/morph-analyzer.md](docs/morph-analyzer.md) を参照。
独自機能の一覧は [docs/features.md](docs/features.md)、バージョンごとの変更は [docs/changelog.md](docs/changelog.md)。

## ブランチと本番反映

- `custom` が本番用。`master` は upstream(`syuilo/ai`)と同じ内容で、触らない。
- **`custom` への push は、CI → イメージのビルド → デプロイの順で、自動的に本番へ反映される。** push の前に、本番に出してよい変更か確認する。
- **ドキュメントだけの変更(`docs/`、`CLAUDE.md`、`README.md` など)をコミットするときは、メッセージに `[skip ci]` を付ける。**
  CI もデプロイも動かない。コード、Dockerfile、ワークフロー、`package.json` を含むコミットには付けない(本番に反映されなくなる)。
- upstream の取り込みは `git fetch upstream && git merge upstream/master`(rebase や force push はしない)。
  `package.json` の `_v` が競合したら、upstream の部分だけを書き換える(フォーク側の番号は変えない)。

## 公開範囲(Fork は public)

- 実環境の値は、コード・ドキュメント・コミットメッセージのどこにもコミットしない。
  対象はホスト名、サーバのパス、SSH ユーザー名、メールアドレス、トークン、API キー、内部 IP。
  必要なときは `<スタックの絶対パス>` のようなプレースホルダーで書く。
- Git 管理外のファイル(`.gitignore` 済み): `config.json`、`data/`、`font.ttf`、`.env`、`docker-compose.override.yml`。
  これらを `git add -f` で追加しない。
- 接続先やトークンは GitHub の Secrets(Environment `production`)で管理している。

## ビルドと CI

- ビルドは `npm run build`(`tspc`)、起動は `node ./built`。依存は `npm install`(ロックファイルなし)。
- **型エラーは upstream の時点で多数あり、直さない。** Dockerfile も CI も、終了コードではなく
  `built/index.js` の存在と構文で判定する。型エラーの修正は、頼まれたときだけ行う。
- ただし、自分の改修では新しい型エラーを増やさない。変更前後で `npx tsc --noEmit` のエラー件数を比べ、増えていたら直す。
- `config.json` が無くてもビルドは通る(実行時に必要)。

## 改修の方針

- upstream のファイルへの変更は最小限にする。merge の競合を減らすため、整形・インデント・空行だけの変更はしない。
- 自サーバ固有の値(除外するユーザー ID、カスタム絵文字名、投稿時刻など)は、既存の独自改修と同じ場所に置く。
- コミットは機能ごとに分け、日本語で `type(scope): 内容` の形式にする(例: `feat(reversi): …`、`fix(core): …`、`chore: …`)。
  本文には変更の理由を書く。
- 機能を追加・変更したら、[docs/features.md](docs/features.md) も更新する。

## 学習した語句(キーワード)を使うとき

- 語句を混ぜたアイテム名は `src/utils/gen-item-with-keyword.ts` の `genItemWithKeyword()` で作る。
  `vocabulary.ts` の `genItem()` は upstream のファイルで、引き継ぎコードにも使われるため変更しない。
- おみくじは「同じ人・同じ日なら同じ結果」を保つ。候補の語句は `getLearnedKeywords(ai, その日の0時)` で固定し、
  乱数の消費順も変えない。語句を消す処理(忘却など)は、日付が変わったときにだけ行う。
- 人名は、細分類が「姓」「名」のものだけを学習しない(キャラクター名は覚える)。条件は `src/modules/keyword/index.ts`。
- 不適切語句の自動除外は、いまは入れていない(方針として見送り)。気づいたものはマスターが `/forget 語句` で消す。
  「今日よく見かけた言葉」に毎日出る一般的な語句(日本など)も、同じく `/forget` で除外する運用にしている。
  自動で除くなら `getLearnedKeywords` に条件を足す。
- 外部コマンド(Sudachi など)で大量のテキストを解析するときは、`keyword/mecab.ts` の `cmd()` を使わない。出力が大きい(約16KB以上)と、
  終わらないまま止まる(MeCab は1件ずつ呼ぶので、upstream では起きない)。`keyword/sudachi.ts` の `run()` のように `data` イベントで集める。
- `KeywordModule` は `src/index.ts` で `CoreModule` の次に置いている(マスター用コマンドを、トークなどの反応より先に処理するため)。順番を変えない。

## バージョン

- バージョンは `package.json` の `_v`(`<upstream>-mk<X>.<Y>.<Z>`、例: `2.0.1-mk2.1.0`)。X は破壊的変更、Y は機能追加、Z は不具合修正。
- 機能や修正を入れたときは、同じコミットか別の `chore:` コミットで `_v` を上げ、[docs/changelog.md](docs/changelog.md) に追記する。
  `docs`・`chore`・`ci` では上げない。Git のタグは付けない。
- 破壊的変更の定義や、複数の種類が混ざるときの扱いは [docs/versioning.md](docs/versioning.md) を参照。

## サーバ運用(Dockge)

- Bot は Dockge のスタックで動く。イメージは CI(`deploy.yml` の build ジョブ)でビルドして GHCR(public)に置き、
  サーバは `compose.yaml` の `image:` で pull するだけ。スタックには `compose.yaml`・`config.json`・`data/`・`font.ttf`・`.env` だけを置く。
- イメージは public なので、秘密の値をイメージに入れない(`.dockerignore` で `config.json` などを除外している。Dockerfile で COPY しない)。
- イメージに MeCab は入れていない(ビルド引数 `enable_mecab=0`)。サーバの `config.json` の `"morphAnalyzer": "sudachi"` は消さない。
- `config.json` を変えたら `docker compose up -d --force-recreate` で反映する(`restart` では反映されないことがある)。
- `docker compose` は、スタックのディレクトリで実行する(プロジェクト名がディレクトリ名と一致するため)。
