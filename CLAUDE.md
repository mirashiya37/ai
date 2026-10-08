# CLAUDE.md

`syuilo/ai`(Misskey のBot「藍」)を、自サーバ向けに改修した Fork。
バージョンの付け方は [docs/versioning.md](docs/versioning.md)、
形態素解析(MeCab / Sudachi)の切り替えは [docs/morph-analyzer.md](docs/morph-analyzer.md) を参照。
`config.json` の項目は [docs/config.md](docs/config.md)(**項目を足したら、ここも更新する**)。
独自機能の一覧は [docs/features.md](docs/features.md)(あだ名は [docs/nickname.md](docs/nickname.md))、バージョンごとの変更は [docs/changelog.md](docs/changelog.md)、
テストは [docs/testing.md](docs/testing.md)。

## ブランチと本番反映

- `custom` が本番用。`master` は upstream(`syuilo/ai`)と同じ内容で、触らない。
- **`custom` への push は、CI → イメージのビルド → デプロイの順で、自動的に本番へ反映される。** push の前に、本番に出してよい変更か確認する。
- **ドキュメントだけの変更(`docs/`、`CLAUDE.md`、`README.md` など)をコミットするときは、メッセージに `[skip ci]` を付ける。**
  CI もデプロイも動かない。コード、Dockerfile、ワークフロー、`package.json` を含むコミットには付けない(本番に反映されなくなる)。
  **コミットメッセージのどこかにこの文字列があるだけで効く**(本文で「付けない」と説明するときも同じ。実際に起きた)。
  コードと一緒に push するコミットのメッセージには、この文字列を書かない。誤って動かなかったときは、
  `gh workflow run deploy.yml --ref custom`(または Actions の Run workflow)で手動実行する。
- upstream の取り込みは `git fetch upstream && git merge upstream/master`(rebase や force push はしない)。
  `package.json` の `_v` が競合したら、upstream の部分だけを書き換える(フォーク側の番号は変えない)。

## 公開範囲(Fork は public)

- 実環境の値は、コード・ドキュメント・コミットメッセージのどこにもコミットしない。
  対象は、接続先、パス、ユーザー名、メールアドレス、認証情報など。
  必要なときは `<スタックの絶対パス>` のようなプレースホルダーで書く。
- Git 管理外のファイル(`.gitignore` 済み): `config.json`、`data/`、`font.ttf`、`.env`、`docker-compose.override.yml`。
  これらを `git add -f` で追加しない。

## ビルドと CI

- ビルドは `npm run build`(`tspc`)、起動は `node ./built`。依存は `package-lock.json` で固定していて、CI と Dockerfile は `npm ci` で入れる。
- **`package.json` の依存を変えたら、ロックファイルも同じコミットで更新する。** 手元の npm と本番(`node:lts`)の npm は版が違うことがあるので、
  `node_modules` の無い `ai` ディレクトリに `package.json` と `.npmrc` だけを置き、`node:lts` のコンテナで `npm install --package-lock-only` して作る
  (`node_modules` があるディレクトリで作ると、`integrity` が欠ける)。upstream の取り込みで依存が変わったときも同じ。
- ベースイメージ(`Dockerfile` の `FROM`)は、ダイジェストで固定している。サードパーティの Actions は、
  タグでなくコミットの SHA で固定していて、コメントに版を書いている。更新するときは、新しい版を調べて SHA を差し替える(勝手には上がらない)。
- `canvas` のインストールスクリプトは、`package.json` の `allowScripts` で許可している(npm 12 以降は、許可がないと実行されず、`canvas` が動かない)。
- **型エラーは upstream の時点で多数あり、直さない。** Dockerfile も CI も、終了コードではなく
  `built/index.js` の存在と構文で判定する。型エラーの修正は、頼まれたときだけ行う。
- ただし、自分の改修では新しい型エラーを増やさない。変更前後で `npx tsc --noEmit` のエラー件数を比べ、増えていたら直す。
- `config.json` が無くてもビルドは通る(実行時に必要)。

## テスト

- 単体テストは `test/`(`node:test`)。`npm run build && node --test 'test/*.test.mjs'` で実行する。詳しくは [docs/testing.md](docs/testing.md)。
- 機能を追加・変更したら、テストも足すか直す。コミットの前に実行して、全部通ることを確かめる。
- 単体テストのあとは、試験した内容を抜粋して、**実際の Misskey と藍を Docker のコンテナで動かして**確かめる(本番と同じ Dockerfile のイメージ、本番と同じ版・設定の Misskey)。
  コンテナを使わないほうがよい場合は、理由を示して承認を得る。
- Sudachi・MeCab などの外部コマンドは、偽物を作って代用しない。手元に無ければ、入れるかを先に確認する。方針の詳細は [docs/testing.md](docs/testing.md) の「方針」。
- `@bindThis` のメソッドに代入しない(クラス共通の関数が書き換わる)。テストで差し替えるときは `Object.defineProperty` を使う。

## 改修の方針

- upstream のファイルへの変更は最小限にする。merge の競合を減らすため、整形・インデント・空行だけの変更はしない。
- 自サーバ固有の値(除外するユーザー ID、カスタム絵文字名、投稿時刻など)は、既存の独自改修と同じ場所に置く。
- コミットは機能ごとに分け、日本語で `type(scope): 内容` の形式にする(例: `feat(reversi): …`、`fix(core): …`、`refactor(talk): …`、`test(keyword): …`、`chore: …`)。
  挙動を変える修正(`fix`)と、変えない整理(`refactor`)は、同じコミットに混ぜない。
  本文には変更の理由を書く。
- upstream のコードの不具合は、直すかを確認したうえで、`fix` のコミットで直してよい(独自の修正として扱い、`_v` を上げる)。
  不具合ではない upstream のコードは、同じ処理があっても共通にしない(upstream の挨拶・リバーシなどの「1日1回」の処理など)。
- 独自の処理で同じことを書くときは、すでにある共通の関数を使う。
  - `src/utils/`: `choose-pool.ts`(割合でどちらの候補から選ぶか)、`is-master.ts`(マスターの判定)、`inc-love-once-a-day.ts`(親愛度を1日1回上げる)
  - `src/utils/neutralize-mfm.ts`: 利用者が書いた文字列を藍の投稿に入れるときは、これを通す(メンション・MFM・リンクにならないようにする)
  - `src/modules/talk/`: `by-love.ts`(親愛度でセリフを選ぶ。境目の既定は 5 / -3)、`nickname.ts`(あだ名を考える・呼び名にできるか・誰のあだ名か)
  - `src/modules/keyword/`: `morph.ts`(形態素解析の切り替え)、`token-filter.ts`(覚える語の判定と分類)
- 機能を追加・変更したら、[docs/features.md](docs/features.md) も更新する。

## 学習した語句(キーワード)を使うとき

- 語句を混ぜたアイテム名は `src/utils/gen-item-with-keyword.ts` の `genItemWithKeyword()` で作る。
  `vocabulary.ts` の `genItem()` は upstream のファイルで、引き継ぎコードにも使われるため変更しない。
- おみくじは「同じ人・同じ日なら同じ結果」を保つ。候補の語句は `getLearnedKeywords(ai, その日の0時)` で固定し、
  乱数の消費順も変えない。語句を消す処理(忘却など)は、日付が変わったときにだけ行う。
- 人名は、細分類が「姓」「名」のものだけを学習しない(キャラクター名は覚える)。条件は `src/modules/keyword/token-filter.ts` の `isLearnableToken`。
- 普通名詞は、細分類が「一般」・3文字以上・英数字だけでもひらがなだけでもない語に限って覚える(`src/modules/keyword/token-filter.ts`)。
  固有名詞の語を埋もれさせないため。条件を緩める(1〜2文字、サ変可能など)と、「天気」「発見」のような語が大量に混ざる。
- 覚える語は、まず固有名詞と普通名詞のどちらから選ぶかを、`config.json` の `keywordProperRate`(既定 0.6=固有名詞 60%)で決める(`src/modules/keyword/pick-candidate.ts`)。
  割合を変えるときはこの値を変える。普通名詞の条件(token-filter.ts)を緩めても、割合は変わらないが、普通名詞の候補が増える。
- 不適切語句の自動除外は、いまは入れていない(方針として見送り)。気づいたものはマスターが `/forget 語句` で消す。
  「今日よく見かけた言葉」に毎日出る一般的な語句(日本など)も、同じく `/forget` で除外する運用にしている。
  自動で除くなら `getLearnedKeywords` に条件を足す。
- 外部コマンド(Sudachi など)で大量のテキストを解析するときは、`keyword/mecab.ts` の `cmd()` を使わない。出力が大きい(約16KB以上)と、
  終わらないまま止まる(MeCab は1件ずつ呼ぶので、upstream では起きない)。`keyword/sudachi.ts` の `run()` のように `data` イベントで集める。
- `KeywordModule` は `src/index.ts` で `CoreModule` の次に置いている(マスター用コマンドを、トークなどの反応より先に処理するため)。順番を変えない。

## バージョン

- バージョンは `package.json` の `_v`(`<upstream>-mk<X>.<Y>.<Z>`、例: `2.0.1-mk2.1.0`)。X は破壊的変更、Y は機能追加、Z は不具合修正。
- 機能や修正を入れたときは、`_v` を上げ、[docs/changelog.md](docs/changelog.md) に追記する。**push していない変更は1つのバージョンにまとめる**
  (機能ごとのコミットでは上げず、push の直前に、前回 push した版から1回だけ、`chore:` コミットで上げる)。
  `docs`・`chore`・`ci` では上げない。Git のタグは付けない。
- 破壊的変更の定義や、複数の種類が混ざるときの扱いは [docs/versioning.md](docs/versioning.md) を参照。

## 実行環境

- イメージは public なので、秘密の値をイメージに入れない(`.dockerignore` で `config.json` などを除外している。Dockerfile で COPY しない)。
- コンテナの Bot は一般ユーザー(`node`)で動く。書き込めるのは `data/` だけ。ほかの場所にファイルを書く処理を足さない。
- イメージに MeCab は入れていない(ビルド引数 `enable_mecab=0`)。サーバの `config.json` の `"morphAnalyzer": "sudachi"` は消さない。
- コンテナは `TZ=Asia/Tokyo` で動かす。コード中の時刻(定期投稿の `getHours()` など)は日本時間で書き、
  UTC から逆算した数字にしない。TZ を外すと日付の区切りと定期投稿が9時間ずれる。
