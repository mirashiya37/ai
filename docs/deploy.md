# デプロイ(CI/CD)

`custom` ブランチへの push で、CI(ビルド確認)を通した後、イメージをビルドしてGHCRに置き、サーバへ自動デプロイします。

```
push (custom)
  └─ ci.yml      : npm install → build → built/index.js の存在と構文を確認
  └─ deploy.yml  : build  : Dockerイメージをビルド → ghcr.io/mirashiya37/ai に push(:custom と :sha-<コミット>)
                   deploy : Tailscaleに参加(tag:ci) → Tailscale SSHでサーバへ入る
                     └─ scripts/deploy.sh : docker compose pull → up -d → イメージのコミットと起動を確認
```

サーバはイメージをpullするだけで、ソースもビルドも持ちません。
Dockgeのスタックには `compose.yaml` `config.json` `data/` `font.ttf`(と Dockge の `.env`)だけを置きます。

- イメージには MeCab を入れていない(CI のビルド引数 `enable_mecab=0`)。形態素解析は Sudachi を使うので、
  サーバの `config.json` に `"morphAnalyzer": "sudachi"` が必要([morph-analyzer.md](morph-analyzer.md))。
- イメージは public。`config.json` `data/` `.env` などは `.dockerignore` でイメージから除外している。
  秘密の値を Dockerfile で COPY しないこと。

## 1. Tailscale側の設定(Tailscale SSHを有効のまま使う)

Tailscale SSHでは、SSH鍵ではなく**tailnet上のIDとACL**でログインを許可します。
そのため「CI用タグ」と「サーバのタグ」を作り、`ssh`ルールで許可します。
ACLは既存の内容(`grants` で全許可、`ssh` で `autogroup:member` → 自分/タグ付き機器を `check` で許可)に**追記するだけ**です。

1. **タグを追加する**(`tagOwners` を次のように変更)

   ```jsonc
   "tagOwners": {
     // 既存のタグはそのまま残す。オーナーは既存のタグと同じ指定にそろえる
     "tag:ci":     ["<タグのオーナー(既存と同じ指定)>"],   // 追加: GitHub Actionsのランナー用
     "tag:server": ["<タグのオーナー(既存と同じ指定)>"],   // 追加: デプロイ先サーバ用
   },
   ```

2. **CI用のSSHルールを追加する**(`ssh` の配列に1件足す)

   ```jsonc
   "ssh": [
     // 既存: 自分のデバイスやタグ付き機器へ、人間がcheckモードで入る
     {
       "src":    ["autogroup:member"],
       "dst":    ["autogroup:self", "autogroup:tagged"],
       "users":  ["autogroup:nonroot", "root"],
       "action": "check",
     },
     // 追加: CI(tag:ci)がデプロイ先(tag:server)へ入る。
     // 自動実行なので承認操作ができない。"check" だと通らないので "accept"
     {
       "src":    ["tag:ci"],
       "dst":    ["tag:server"],
       "users":  ["<サーバのSSHユーザー名>"],       // デプロイ用SSHユーザーだけ。root/nonrootにはしない
       "action": "accept",
     },
   ],
   ```

   - `grants` は既存の全許可(`*` → `*`)のままで、通信の許可は追加不要です。
     そのため `tag:ci` はtailnetの他の機器にも**通信としては**届きます。SSHができるのは上のルールで許可した
     `tag:server` だけです。通信そのものも絞りたい場合は、別途 `grants` の `src` を見直します。
   - 既存の人間用ルールの宛先は `autogroup:tagged` を含むので、サーバにタグを付けても、自分のSSHは塞がりません。

3. **サーバにタグを付ける**(SSHは有効のまま)

   `--advertise-tags` は**タグの一覧を置き換えます**。まず、今付いているタグを確認します。

   ```bash
   tailscale status --json | grep -A5 '"Tags"' | head   # または管理画面(Machines)で確認
   ```

   - タグが付いていない場合: `sudo tailscale set --advertise-tags=tag:server`
   - 既に `tag:既存のタグ` などが付いている場合: 既存分も含めて指定する
     例: `sudo tailscale set --advertise-tags=tag:既存のタグ,tag:server`

   設定後、管理画面(Machines)でタグが付いたことを確認します。

4. **OAuthクライアントを作る**(Settings → Trust credentials → OAuth)
   - スコープ: `auth_keys` の Write
   - タグ: `tag:ci`
   - 発行された Client ID / Secret を控える

## 2. サーバ側の構成(Dockgeのスタックをイメージで動かす)

Dockgeのスタック(以下 `<スタックの絶対パス>`)の `compose.yaml` は、`build:` ではなく `image:` でイメージを指定します。
DNSなど環境固有の設定は、`compose.yaml` に書いたままにします。

```yaml
services:
  app:
    image: ghcr.io/mirashiya37/ai:custom
    platform: linux/amd64
    volumes:
      - ./config.json:/ai/config.json:ro
      - ./font.ttf:/ai/font.ttf:ro
      - ./data:/ai/data
    restart: always
    dns:                     # 環境に合わせる(不要なら消す)
      - <IPv6 address>
      - <IPv4 address>
networks: {}
```

以降は `docker compose` をスタックのディレクトリで実行すれば、Dockgeの画面にも同じスタックとして表示されます
(プロジェクト名がディレクトリ名と一致するため)。Dockgeの「更新」ボタンでも、最新のイメージをpullして起動し直せます。

SSHユーザーが `docker` グループに入っていること。

スタックのディレクトリに置くのは、次だけです(ソースやDockerfileはイメージに入っているので置かない)。

| ファイル | 中身 |
|---|---|
| `compose.yaml` | スタックの定義(上の例) |
| `config.json` | トークンなどの設定 |
| `font.ttf` | フォント(チャートや迷路の画像に使う) |
| `data/` | Botの記憶(`memory.json`) |
| `.env` | Dockgeの環境変数(あれば) |

動いているイメージがどのコミットのものかは、次で確かめられます。

```bash
docker inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$(docker compose ps -q app)"
```

## 3. GitHub側の設定

Settings → Environments → `production` を作成し、次を設定します。

- **Deployment branches**: `custom` のみ(他のブランチから秘密情報を使えなくする)
- (任意) Required reviewers: 承認してから本番反映したい場合

| 種類 | 名前 | 値 |
|---|---|---|
| Secret | `TS_OAUTH_CLIENT_ID` | OAuthクライアントのID |
| Secret | `TS_OAUTH_SECRET` | OAuthクライアントのSecret |
| Secret | `DEPLOY_SSH_HOST` | サーバのTailscaleホスト名(MagicDNS名) |
| Secret | `DEPLOY_SSH_USER` | SSHユーザー名 |
| Secret | `DEPLOY_PATH` | Dockgeのスタックの絶対パス |

ホスト名・ユーザー名・パスもSecretsにしているのは、publicリポジトリで実環境の値を見せないためです
(Secretsの値はログでも `***` に伏せられます)。そのためデバッグ時、ログ上でこれらの値は見えません。

GHCRへのpushは、ワークフローの `GITHUB_TOKEN`(`packages: write`)で行うので、追加のSecretは不要です。
初めてpushしたあと、パッケージを public にします(Your profile → Packages → `ai` → Package settings →
Change visibility → Public)。private のままだと、サーバのpullが `denied` で失敗します。

## 4. 動作確認

1. Actions → Deploy → Run workflow(`custom` を選択)で手動実行する
2. 失敗したら、どのジョブで止まったかを見て、下の「つまずきやすい点」を探す

## つまずきやすい点

Actions のどのジョブで失敗したか(`ci` → `build` → `deploy`)で探します。
コンテナが入れ替わるのは、`deploy` の `docker compose up` 以降だけです。
それより前の段階(`ci`・`build`・Tailscale / SSH・pull)で止まったときは、**動いているコンテナは変更されません**。

### `ci` / `build` ジョブで失敗する

- **型エラーでは落ちない**: upstream 時点で多数あり、CI も Dockerfile も、終了コードではなく `built/index.js` の存在と構文で判定している。
  落ちるのは、成果物が無いか、構文が壊れているとき
- **`build` が遅い・失敗する**: Sudachi の辞書(約140MB)のダウンロードと展開が走る。初回やキャッシュが無いときは時間がかかる。
  辞書の取得先(PyPI など)に届かないと失敗する。ログで `pip install` の行を確認する
- **`build` は通るのに、Bot が動かない**: イメージの中身は CI では動かしていない。デプロイ後に「動いているBotの問題」を確認する

### `deploy` ジョブ: Tailscale / SSH で失敗する

- **`tailscale ssh` が権限エラー / プロンプトで止まる**: CI用の `ssh` ルールが `accept` になっているか(`check` だと止まる)、
  `src: tag:ci` / `dst: tag:server` / `users` にSSHユーザーが入っているかを確認する
- **サーバに繋がらない**: Actionの `ping` が待機しているのはtailnetへの反映待ち(最大3分)。
  サーバに `tag:server` が付いているか、`grants` で `tag:ci` の通信を制限していないかを確認する
- **サーバのタグを付けたら他のサービスが止まった**(初回の設定時): `--advertise-tags` は一覧を置き換える。
  元のタグ(例: `tag:既存のタグ`)も含めて指定し直す

### `deploy` ジョブ: サーバでの処理(`scripts/deploy.sh`)で失敗する

どのメッセージで止まったかで判断します。

| メッセージ | 原因 | 対処 |
|---|---|---|
| `compose.yaml の app が image: … になっていない` | サーバの `compose.yaml` の `image:` が `ghcr.io/mirashiya37/ai:custom` ではない(ロールバックで `:sha-…` にしたまま、など) | `:custom` に戻す |
| pull が `denied` / `unauthorized` | GHCR のパッケージが private になっている | 「3. GitHub側の設定」の手順で public にする |
| `running image is …, expected …` | pull したイメージが、デプロイしたコミットのものではない | `build` ジョブが成功しているか、`compose.yaml` の `image:` のタグが `:custom` かを確認する |
| `container did not become stable` | 起動後に落ちて再起動を繰り返している | ログに出る直前の50行を見る。下の「動いているBotの問題」も参照 |

### 動いているBotの問題

- **何も覚えなくなった(ログに `Uncaught exception: spawn mecab ENOENT` が30分ごとに出る)**: イメージに MeCab が無いのに、
  `config.json` の `morphAnalyzer` が `sudachi` になっていない。Bot は落ちずに動き続けるので、気づきにくい。
  起動時のログが `Morph analyzer: mecab` なら設定漏れ。[morph-analyzer.md](morph-analyzer.md) を参照
- **語句を覚えない(「覚えました」の投稿が出ない)**: まず、学習が動いているかをログで確かめる。

  ```sh
  docker compose logs --since 6h app 2>&1 | grep -E "\[keyword\]|Uncaught"
  ```

  `Learn:` の行が30分おきに出ていれば動いている。`already known` なら、選ばれた語がすでに覚えていた語で、何も起きていない
  (覚えている語が増えるほど、新しい語に当たりにくい)。`Uncaught exception` が出ていれば、その内容が原因。
  詳しいログの見方は [features.md](features.md) の「学習の経過(ログ)」を参照
- **`config.json` を変えたのに反映されない**: `config.json` はファイル単体でマウントしているため、
  エディタが保存時にファイルを置き換えると、`docker compose restart` では古い内容のまま。
  `docker compose up -d --force-recreate` でコンテナを作り直す
- **どのコミットのイメージが動いているか分からない**: 「2. サーバ側の構成」のコマンドで、イメージのコミットを確かめられる

### 運用で気をつけること

- **ドキュメントだけの変更でデプロイを動かしたくない**: コミットメッセージに `[skip ci]` を付けて push する
- **`custom` への push は、そのまま本番に出る**: push の前に、本番に出してよい変更か確認する(CLAUDE.md にも記載)

## ロールバック

イメージには、コミットごとのタグ(`:sha-<コミットのSHA>`)が付いています。
デプロイに失敗するとスクリプトが直前のSHAを表示するので、すぐ戻したいときは `compose.yaml` の `image:` を
`ghcr.io/mirashiya37/ai:sha-<直前のSHA>` にして `docker compose up -d` します(戻したあと、`:custom` に戻すのを忘れない)。
恒久的には `git revert` してpushすると、再デプロイされます。
