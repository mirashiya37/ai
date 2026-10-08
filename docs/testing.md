# テスト

このフォークで追加した処理の単体テストは `test/` にある。Node 標準の `node:test` で書いていて、追加の依存はない。
ビルドした `built/` を読み込んで確かめる(パスの別名 `@/` を、ビルドで解決するため)。

## 方針

1. **単体テスト**(`test/`)で、変えた処理を確かめる。
2. **機能試験**: 変えた機能ごとに、実際の Misskey と藍を動かして確かめる。単体テストを書いた機能も、試験した内容を抜粋して、必ず実際に動くかを確かめる。
   - 環境は Docker のコンテナで、本番に近い形で作る。藍は本番と同じ `Dockerfile`(同じビルド引数)でビルドしたイメージ、Misskey は本番と同じ版・設定にする。
     そうしないほうがよい場合は、理由を示して、承認を得てから行う。
   - 待ち時間(数十分〜1日)は、コードを変えずに縮める。藍の記憶の時刻を過去にずらす、タイマーの間隔を縮める細工を読み込む(`NODE_OPTIONS=--require`)、タイムゾーンをずらす、など。
3. **偽物を作らない。** 形態素解析(Sudachi・MeCab)のような外部コマンドは、決まった出力を返す偽物で代用せず、本物を使う。
   入っていない環境では、そのテストは skip する(入れるかは、その都度決める)。
   ライブラリのエラーなど、どうしても形を真似る場合は、実物と同じ形にする(例: got のエラーは、ステータスを `err.response.statusCode` に持つ。
   `err.statusCode` で真似たテストは通っても、本番では動いていなかった)。
4. 機能試験で分かったことは、テストに足す(実物と違う前提で書かれたテストを直す)。

## 実行

```sh
npm run build
node --test 'test/*.test.mjs'
```

- 引数はファイルのパターンで渡す(`node --test test/` とディレクトリを渡すと、正しく動かない)。
- `config.json` が無い環境では、モジュール全体を動かすテスト(下の表の「要 config.json」)は飛ばされる(`# config.json がない`)。
  モジュールが読み込み時に `config.json` を読むため。
- `package.json` の `test`(`jest`)は upstream のもので、使っていない。
- `test/` は `.dockerignore` で除外しているので、イメージには入らない。CI ではまだ実行していない。
- 形態素解析のテスト(`keyword-morph.test.mjs`)は、本物の `sudachipy`(本番のイメージと同じ版・full 辞書)が `PATH` に要る。
  無ければ skip する。手元に入れるなら、venv に `pip install sudachipy==<版> sudachidict_full==<版>`(版は `Dockerfile` の `sudachipy_version`・`sudachidict_version`)。

## テストの一覧

| ファイル | 対象 | 内容 |
|---|---|---|
| `keyword-pick-candidate.test.mjs` | 学習: 覚える語の選び方(`pick-candidate.ts`) | 固有名詞の割合が設定どおりになる、片方が空のときの切り替え、長い語の優先、`keywordProperRate` の解釈 |
| `keyword-token-filter.test.mjs` | 学習: 覚える語の判定と分類(`token-filter.ts`) | 人名は姓・名だけ除く、普通名詞の条件、読みが無い語と `/forget` した語の除外、固有名詞と普通名詞の見分け、「今日よく見かけた言葉」は固有名詞だけ |
| `keyword-morph.test.mjs` | 学習: 形態素解析の切り替え(`morph.ts`) | 本物の Sudachi で解析し、テキストごとに MeCab と同じ並びのトークンを返す、覚える語の判定(固有名詞・人名の姓・普通名詞)。MeCab は入っている環境でだけ(要 config.json と sudachipy) |
| `keyword-strip-mfm.test.mjs` | 学習: MFM の取り除き(`strip-mfm.ts`) | 関数・装飾・リンク・URL・メンション・ハッシュタグ・引用・コード・絵文字・`<plain>` の扱い、閉じていない MFM、長い本文 |
| `keyword-note-filter.test.mjs` | 学習: Bot の投稿の除外(`note-filter.ts`) | Bot の投稿は除く、Bot でない・情報が無い投稿は除かない |
| `keyword-learn-interval.test.mjs` | 学習: 間隔(`learn-interval.ts`)と予約 | 15〜45分の一様で平均30分、乱数の端の値、学習が失敗しても予約が続く(要 config.json) |
| `noting-pick-note.test.mjs` | 独り言(`pick-note.ts`、`noting` モジュール) | 語句を使うテンプレートが30%、均等に選ばれる、1日に平均21.6件(要 config.json) |
| `reminder-notify.test.mjs` | リマインダーの催促(`reminder` モジュール) | 放っておかれた回数に応じた言い方、2ヶ月を過ぎたら 10% で忘れる、消すときに登録したキーで待ち受けを解除する(要 config.json) |
| `message-reply-visibility.test.mjs` | 返信の公開範囲(`src/message.ts`) | 元の投稿と同じ範囲、フォロワー限定はダイレクト(要 config.json) |
| `talk-by-love.test.mjs` | トーク: 親愛度に応じたセリフ(`src/modules/talk/by-love.ts`) | 既定の境目(5 / -3)、反応ごとの境目、love・hate が無いとき、呼び名の受け渡し |
| `talk-nickname.test.mjs` | トーク: あだ名の提案と引き直し、ほかの人のあだ名(`talk/nickname.ts`、`talk` モジュール) | 呼び名にできる条件、出したあだ名を飛ばす、10回で諦める、引き直しの言葉、引き直しで出したあだ名と回数を引き継ぐ、もう出せないとき、「はい」「いいえ」「やだ、別の」の判定、承諾・断りの言葉、以前の形の待ち受け、チャットの待ち受けの期限と文の頭の判定、敬称(君・先輩・先生)・カタカナの「アダナ」・メンションでほかの人・藍・本人を分ける、呼びかけと一人称の「の」を外す、メンションと敬称のあいだの空白、自分へのメンション、マスターのあだ名を使わないときのマスターの名前、ほかの人のあだ名では呼び名を変えない(要 config.json) |
| `talk-master-nickname.test.mjs` | トーク: マスターのあだ名(`talk/master-nickname.ts`、`talk` モジュール) | 設定の既定値と解釈、同じ人の1日の回数と全体の間隔、マスターの名前・メンションの判定、メンション・チャット・呼び名だけの伝え方と公開範囲、チャットで頼まれたときのチャットへの返事とその失敗、頼んだ人の書き方(表示名・ユーザー名・無効にする記号)、マスターを呼ぶ言い方(設定の先頭)、制限にかかったときの返事、伝えられなかったときに記録を戻す、マスター本人(要 config.json) |
| `talk-thanks.test.mjs` | トーク: 「ありがとう」への返事 | 親愛度 5 以上で好き、-3 以下で嫌い、そのあいだは普通(要 config.json) |
| `utils-choose-pool.test.mjs` | 2つの候補のどちらから選ぶか(`src/utils/choose-pool.ts`) | 割合どおりに選ぶ、片方が空のときの切り替え、乱数を1回だけ使う |
| `utils-is-master.test.mjs` | マスターの判定(`src/utils/is-master.ts`) | ローカルで同じユーザー名だけ、他のサーバの同名は除く、未設定なら誰もマスターではない |
| `utils-inc-love-once-a-day.test.mjs` | 親愛度を1日1回だけ上げる(`src/utils/inc-love-once-a-day.ts`) | 同じ日は1回だけ、日付が変われば再び上げる、モジュールのほかのデータは残す |

## 書くときの注意

- **確率で決まる処理は、回数を十分に取り、許容幅に余裕を持たせる。** 割合の確かめでは、許容幅を標準偏差の5倍以上にする
  (乱数を固定できないので、たまたま外れて落ちるのを避けるため)。
- **時計は差し替える。** `node:test` の `mock.timers`(`setTimeout`・`setInterval`・`Date`)で、時間を進めて確かめる。
  学習の予約のように、失敗を外に出す処理(本番では `index.ts` の `uncaughtException` でログに残る)は、テストランナーが
  テストの失敗として扱う。`setTimeout` を自分で差し替えて、予約した処理の失敗を受け取って確かめる(`keyword-learn-interval.test.mjs`)。
- **`@bindThis` のメソッドに代入しない。** `mod.learn = …` と代入すると、デコレーターの setter が**クラス共通の関数**を書き換え、
  ほかのインスタンスにも効いてしまう。差し替えるときは `Object.defineProperty(mod, 'learn', { value: …, configurable: true, writable: true })` で、
  インスタンスに直接定義する。
- モジュールを動かすときは、藍本体(`ai`)を最小限の仮の実装にする(`account`・`moduleData`・`getCollection`・`log`・`post` など、
  そのモジュールが使うものだけ)。`lokijs` は `createRequire` でリポジトリのルートから読み込む。
- `serifs` などの共有のオブジェクトを書き換えたら、`finally` で元に戻す。
- テストのファイルは `tsc` の対象外。型エラーの件数のルール(CLAUDE.md)は、`src/` の変更にだけかかる。
