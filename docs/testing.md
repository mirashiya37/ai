# テスト

このフォークで追加した処理の単体テストは `test/` にある。Node 標準の `node:test` で書いていて、追加の依存はない。
ビルドした `built/` を読み込んで確かめる(パスの別名 `@/` を、ビルドで解決するため)。

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

## テストの一覧

| ファイル | 対象 | 内容 |
|---|---|---|
| `keyword-pick-candidate.test.mjs` | 学習: 覚える語の選び方(`pick-candidate.ts`) | 固有名詞の割合が設定どおりになる、片方が空のときの切り替え、長い語の優先、`keywordProperRate` の解釈 |
| `keyword-strip-mfm.test.mjs` | 学習: MFM の取り除き(`strip-mfm.ts`) | 関数・装飾・リンク・URL・メンション・ハッシュタグ・引用・コード・絵文字・`<plain>` の扱い、閉じていない MFM、長い本文 |
| `keyword-learn-interval.test.mjs` | 学習: 間隔(`learn-interval.ts`)と予約 | 15〜45分の一様で平均30分、乱数の端の値、学習が失敗しても予約が続く(要 config.json) |
| `noting-pick-note.test.mjs` | 独り言(`pick-note.ts`、`noting` モジュール) | 語句を使うテンプレートが30%、均等に選ばれる、1日に平均21.6件(要 config.json) |

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
