# 形態素解析(MeCab / Sudachi)

キーワード学習(`keyword` モジュール)は、タイムラインのノートを形態素解析して固有名詞を覚える。
解析には MeCab(mecab-ipadic-NEologd)と Sudachi(SudachiDict)のどちらかを使える。

| | MeCab + NEologd | Sudachi + SudachiDict(full) |
|---|---|---|
| 辞書の更新 | 2020年で止まっている | 定期的に更新されている |
| 起動 | ノート1件ごと | 1回の学習でまとめて1回 |
| コードの既定 | ○ | |
| 本番のイメージ | 入っていない | ○ |

どちらも、品詞は IPADIC と同じ並びで扱う(`src/modules/keyword/sudachi.ts` で変換している)。
学習の条件(固有名詞・名字や名前だけの人名ではない・読みがある)は共通。

本番のイメージ(CI でビルドして GHCR に置くもの)は、Sudachi だけを入れている(`deploy.yml` のビルド引数 `enable_mecab=0`)。
そのため、サーバの `config.json` には `"morphAnalyzer": "sudachi"` が必須。
無いと MeCab を起動しようとして、学習のタイミングで Bot が落ちる。

## Sudachi に切り替える

本番はすでに Sudachi を使っている。以下は、MeCab から切り替えたときの手順(新しく環境を作るときにも使う)。
`Dockerfile` は `enable_mecab` / `enable_sudachi` で、それぞれを入れるかを選べる。

1. 新しいイメージでコンテナが動いていることを確認し、コンテナの中で Sudachi が動くか試す。

   ```sh
   cd <スタックの絶対パス>
   echo '東京ドームで初音ミクのライブ' | docker compose exec -T app sudachipy tokenize -m C -a -s full
   ```

   `東京ドーム	名詞,固有名詞,一般,…	トウキョウドーム` のような行のあと、最後に `EOS` が出ればよい。
   Bot は `EOS` で文の区切りを判断するので、出ていないと何も学習しなくなる。
   コマンドが無い状態で切り替えると、学習のたびに Bot が落ちるので、必ず先に確かめる。

2. サーバの `config.json` をバックアップしてから、
   次を足して、コンテナを作り直す(`docker compose up -d --force-recreate`)。
   `config.json` はファイル単体でマウントしているため、エディタが保存時にファイルを置き換えると、
   `docker compose restart` では古い内容のまま反映されない。

   ```json
   "morphAnalyzer": "sudachi"
   ```

   | 項目 | 既定 | 内容 |
   |---|---|---|
   | `morphAnalyzer` | `mecab` | `sudachi` にすると Sudachi を使う |
   | `sudachi` | `sudachipy` | sudachipy のコマンド |
   | `sudachiDict` | `full` | 辞書の種類(`small` / `core` / `full`)。イメージに入っているのは `full` だけ |

3. コンテナ側で設定が見えていることを確認する。どちらの解析を使っているかはログに出ないため、これで判断する。

   ```sh
   docker compose exec app grep morphAnalyzer /ai/config.json
   ```

   学習は30分ごとなので、しばらくして `docker compose logs --tail 50 app` にエラーや再起動がないことも確かめる。

MeCab に戻すときは、先に `deploy.yml` のビルド引数を `enable_mecab=1` にして push し、MeCab 入りのイメージにする。
そのあと `morphAnalyzer` を消して、同じくコンテナを作り直す。

## 辞書を更新する

`Dockerfile` の `sudachidict_version`(必要なら `sudachipy_version` も)を、PyPI の新しいバージョンに上げて push する。
バージョンを固定しているのは、CI のビルドキャッシュが効き、上げないと更新されないため。

## 注意点

- 人名は、細分類が「姓」「名」(名字・名前だけ)のものを学習しない。
  キャラクター名(例: 初音ミク)や、辞書にフルネームで載っている有名人の名前は「一般」なので学習する。
  一般の人の名前は辞書に載っていないため、名字と名前に分かれて除外される。
- 読みがカタカナでない語(例: 「ｗｗ」の読みが `ww`)や辞書にない語は、MeCab で読みが無い語と同じく学習しない。
- イメージのビルドは CI(`deploy.yml` の build ジョブ)で行う。失敗した場合はデプロイまで進まず、
  動いているコンテナはそのまま残る。
