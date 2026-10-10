# 設定(`config.json`)

`config.json` は、リポジトリ(Docker ならスタック)のルートに置く。Git 管理外で、イメージにも入れない。
書き方の見本は `example.json`、各項目の型は `src/config.ts`。**変えたら、Bot を再起動する**
(Docker は `docker compose up -d --force-recreate`。`restart` では反映されないことがある)。

真偽値は `true` / `false`(二重引用符は付けない)。数値は、数でも、数字の文字列(`"0.5"`)でもよい項目がある(下の表)。
ドキュメントやコミットには、実際の値(接続先、ユーザー名、トークンなど)を書かない。

## 接続と基本

| 項目 | 既定 | 内容 |
|---|---|---|
| `host` | (必須) | Misskey サーバーの URL(`https://` から。末尾の `/` は付けない)。WebSocket と API の URL は、これから作る |
| `i` | (必須) | 藍として動かすアカウントのアクセストークン。秘密の値 |
| `master` | なし | マスターのユーザー名(このサーバーのユーザー)。管理コマンド、日次レポート、マスターのあだ名で使う。無ければ、これらは使わない |
| `serverName` | `このサーバー` | カスタム絵文字チェックの投稿に書く、サーバーの呼び名 |
| `memoryDir` | `.`(ルート) | 記憶(`memory.json`)の保存先。Docker では `data` にする(書き込めるのは `data/` だけ) |

## 機能の入り切り

| 項目 | 既定 | 内容 |
|---|---|---|
| `notingEnabled` | 有効 | `false` で、独り言(ランダムな投稿)をやめる。書かなければ有効 |
| `chartEnabled` | 有効 | `false` で、チャート機能と、キーワードの集計をやめる。書かなければ有効 |
| `keywordEnabled` | 無効 | `true` で、語句の学習を使う([features.md](features.md)、形態素解析が要る) |
| `reversiEnabled` | 無効 | `true` で、リバーシの対局を使う |
| `serverMonitoring` | 無効 | `true` で、サーバー監視を使う |
| `checkEmojisEnabled` | 無効 | `true` で、カスタム絵文字チェックを使う。藍のアカウントに管理者権限と「絵文字を見る」権限のトークンが要る |
| `checkEmojisAtOnce` | `false` | `true` で、絵文字チェックの投稿をまとめる(1ノートに `checkEmojisChunkSize` 件まで。多いときは複数のノートに分ける)。`false` でも、20件を超えるときはまとめる |
| `checkEmojisChunkSize` | `20` | まとめ投稿で、1ノートに入れる絵文字の数。正の整数で指定する(それ以外は 20)。数が多くて 3000 字を超えるときは、この数より少なくして分ける |

## 語句の学習と形態素解析

| 項目 | 既定 | 内容 |
|---|---|---|
| `keywordProperRate` | `0.6` | 覚える語を、固有名詞から選ぶ確率(0〜1)。範囲外・数でない値は既定値。[features.md](features.md) の「学習」 |
| `morphAnalyzer` | `mecab` | `sudachi` で Sudachi を使う。**本番のイメージは MeCab を入れていないので、`sudachi` が必須**([morph-analyzer.md](morph-analyzer.md)) |
| `sudachi` | `sudachipy` | sudachipy のコマンド |
| `sudachiDict` | `full` | Sudachi の辞書(`small` / `core` / `full`)。イメージに入っているのは `full` だけ |
| `mecab` | `mecab` | MeCab のコマンドのパス |
| `mecabDic` | なし | MeCab の辞書のパス |

## aichat(AI との会話)

| 項目 | 既定 | 内容 |
|---|---|---|
| `geminiProApiKey` | なし | Gemini の API キー。秘密の値 |
| `pLaMoApiKey` | なし | PLaMo の API キー。秘密の値 |
| `prompt` | 内蔵のプロンプト | aichat のプロンプト(口調や返答のルール)。書けば置き換わる |
| `aichatRandomTalkEnabled` | 無効 | `true` で、藍からタイムラインの誰かに話しかける |
| `aichatRandomTalkProbability` | `0.02` | 話しかける確率(0〜1 の小数。1 に近いほど出やすい) |
| `aichatRandomTalkIntervalMinutes` | `720` | タイムラインを見て、話しかけるかを決める間隔(分) |
| `aichatGroundingWithGoogleSearchAlwaysEnabled` | 無効 | `true` で、メンションへの返答で、いつも Google 検索を使う |

## マスターのあだ名(独自機能)

「マスターのあだ名」と頼まれたときの動作を決める。**既定はオフ**。動作の詳細は [nickname.md](nickname.md) の「マスターのあだ名」。
`master` が無いか、呼び名にも表示名にもしない設定(`masterNicknameUpdateName` が `false` で、表示名の変更も使わない)のときは、使わない。
使わないときは、「マスターのあだ名」も「〇〇さんのあだ名」と同じ扱い(マスターには何も送らない)。

| 項目 | 既定 | 内容 |
|---|---|---|
| `masterNicknameNames` | `[]` | 「〇〇のあだ名」の〇〇がこれならマスターとみなす名前(文字列の配列。複数可。敬称は付いても付かなくてもよい)。`@<master>`(このサーバーのユーザー)は、書かなくてもマスター。**先頭の名前は、マスターへの通知や頼んだ人への返事、`/nickname` のコマンドの返事で、マスターを呼ぶ言い方にも使う**(空なら「ご主人様」) |
| `masterNicknameNotify` | `off` | 呼び名を変えた・表示名を変えたことを、マスターに知らせる伝え方(呼び名にも表示名にもしない設定のときは、使われない)。`off`(呼び名にする設定のときは、`chat` と同じく、チャットで知らせる)、`mention`(メンション)、`chat`(チャット) |
| `masterNicknameMentionVisibility` | `public` | `mention` のとき、マスターへのメンションの公開範囲の上限。`public`、`home`、`specified`(頼んだ人とマスターだけのダイレクト)。頼まれた投稿がこれより広くても、ここまでに狭める。フォロワー限定で頼まれたときは、いつもダイレクト |
| `masterNicknameUpdateName` | `false` | `true` で、考えたあだ名を、マスターの呼び名にする |
| `masterNicknamePerUserDaily` | `1` | 同じ人が1日(日本時間の0時区切り)に頼める回数。`0` で制限しない |
| `masterNicknameIntervalMinutes` | `180` | マスターに伝える間隔(**分**)。誰からの依頼でもまとめて数える。`0` で制限しない |
| `masterNicknameIntervalHours` | なし | 以前の書き方(時間)。`masterNicknameIntervalMinutes` が無いときだけ使う(時間 × 60 分)。新しく書くなら `masterNicknameIntervalMinutes` を使う |
| `masterRenameEnabled` | `false` | `true` で、マスターの Misskey の表示名を、頼まれたあだ名に変える機能を使えるようにする。実際に使うには、マスターがチャットで許可(`/nickname rename setup`)してオン(`/nickname rename on`)にする |
| `masterRenameMode` | `approval` | 表示名を変える方式。`approval`(マスターが承認してから)、`immediate`(すぐ) |
| `masterRenameApprovalMinutes` | `60` | 承認を待つ時間(分) |

`masterNickname…` と `masterRename…` の多くは、マスターがチャットの `/nickname` コマンドで変えられる。コマンドで変えた値は、`config.json` より優先する
(`/nickname reset` で、`config.json` の値に戻る)。詳しくは [nickname.md](nickname.md) の「マスターのあだ名」。

## 書き方の例(接続先などは仮の値)

```jsonc
{
	"host": "https://misskey.example.com",
	"i": "<アクセストークン>",
	"master": "<マスターのユーザー名>",
	"memoryDir": "data",
	"keywordEnabled": true,
	"morphAnalyzer": "sudachi",
	"masterNicknameNames": ["マスター"],
	"masterNicknameNotify": "mention",
	"masterNicknameUpdateName": true
}
```
