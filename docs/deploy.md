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

## 2. サーバ側の準備(Dockgeのスタックをイメージで動かす)

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

### 以前の構成(スタックがGitのclone)から移行する

以前は、スタックのディレクトリをこのリポジトリのcloneにして、サーバでビルドしていました。
一度だけ、サーバで次を実行して移行します(`STACK` はスタックのパスに置き換える)。
先に、移行後の `deploy.yml` を push してイメージを GHCR に置き、パッケージを public にしておきます(「3. GitHub側の設定」)。
このときのデプロイは、`compose.yaml` が `image:` になっていないため、何も変えずに失敗します。

> **注意: `config.json` `data/` `font.ttf` を消さないこと。**
> これらが無い状態で `docker compose up` すると、Dockerがマウント元の名前で**空のディレクトリ**を作り、
> コンテナが `ERR_UNSUPPORTED_DIR_IMPORT` で起動しません(実際に起きた)。必ず先にバックアップします。

```bash
STACK=<スタックの絶対パス>
cd "$STACK"

# 0. バックアップ(ディレクトリごと)
cp -a "$STACK" "$STACK.bak-$(date +%Y%m%d)"

# 1. compose.yaml を上の例のように書き換える(build: の4行を image: の1行にする。dns などはそのまま)

# 2. イメージを取得して起動し直す(ソースはまだ残っているが、もう使われない)
docker compose pull
docker compose up -d
docker compose ps                                     # app が running であること
docker inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$(docker compose ps -q app)"
                                                      # custom の最新コミットのSHAが出ること

# 3. Gitのclone(ソースと .git)を片付ける。残すのは compose.yaml config.json font.ttf data .env だけ
find . -mindepth 1 -maxdepth 1 \
  ! -name compose.yaml ! -name config.json ! -name font.ttf ! -name data ! -name .env \
  -print                                              # まず消える対象を確認する
find . -mindepth 1 -maxdepth 1 \
  ! -name compose.yaml ! -name config.json ! -name font.ttf ! -name data ! -name .env \
  -exec rm -rf {} +
ls -la config.json font.ttf data/memory.json          # 先頭が - (ファイル)であること。d(ディレクトリ)ならNG
docker compose up -d                                  # 設定は変わらないので、そのまま動き続ける
```

最後に、Actions → Deploy → Run workflow で手動実行し、デプロイが通ることを確かめます。
バックアップ(`$STACK.bak-…`)は、しばらく問題がなければ消します。トークン入りの `config.json` を含むので、放置しないこと。

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
2. 失敗したら、下の「つまずきやすい点」を確認する

## つまずきやすい点

- **`tailscale ssh` が権限エラー / プロンプトで止まる**: CI用の `ssh` ルールが `accept` になっているか(`check` だと止まる)、
  `src: tag:ci` / `dst: tag:server` / `users` にSSHユーザーが入っているかを確認する
- **サーバに繋がらない**: Actionの `ping` が待機しているのはtailnetへの反映待ち(最大3分)。
  サーバに `tag:server` が付いているか、`grants` で `tag:ci` の通信を制限していないかを確認する
- **サーバのタグを付けたら他のサービスが止まった**: `--advertise-tags` は一覧を置き換える。
  元のタグ(例: `tag:既存のタグ`)も含めて指定し直す
- **コンテナが `ERR_UNSUPPORTED_DIR_IMPORT` で起動しない / `not a directory` でマウントに失敗する**:
  `config.json` `data/` `font.ttf` のいずれかが、Dockerの作った空のディレクトリになっている。復旧は次のとおり
  (元のファイルは、バックアップ(`<スタックの絶対パス>.bak-…`)から戻す)

  ```bash
  cd "<スタックの絶対パス>"
  docker compose stop
  sudo rmdir config.json data font.ttf          # 空のディレクトリだけが消える(中身があれば失敗して安全)
  cp -a "<バックアップのパス>"/config.json "<バックアップのパス>"/font.ttf "<バックアップのパス>"/data .
  docker compose down && docker compose up -d   # 古いコンテナの中身も作り直す。upだけだと同じエラーが出る
  ```

  `docker compose down` が必要なのは、前回の失敗時にコンテナ内の `/ai/config.json` もディレクトリとして作られており、
  `up -d` だけではそのコンテナが再利用されるため。
- **ビルドの型エラー**: upstream時点で多数あり、DockerfileもCIも成果物の有無で判定している
- **`config.json` を変えたのに反映されない**: `config.json` はファイル単体でマウントしているため、
  エディタが保存時にファイルを置き換えると、`docker compose restart` では古い内容のまま。
  `docker compose up -d --force-recreate` でコンテナを作り直す
- **デプロイが `compose.yaml の app が image: … になっていない` で止まる**: サーバの `compose.yaml` がまだ `build:` のまま。
  「以前の構成から移行する」を行う。このとき、動いているコンテナは変更されていない
- **pullが `denied` / `unauthorized` で失敗する**: GHCRのパッケージが private のまま。「3. GitHub側の設定」で public にする
- **デプロイが `running image is …, expected …` で止まる**: pullしたイメージが、デプロイしたコミットのものではない。
  build ジョブが成功しているか、`compose.yaml` の `image:` のタグが `:custom` かを確認する
- **Dockerfileを変えた後のビルドが遅い**: Sudachiの辞書(約140MB)のダウンロードと展開が走るため。
  ビルドはCI(build ジョブ)で行うので、失敗した場合はデプロイまで進まず、動いているコンテナはそのまま残る
- **コンテナが起動直後に落ちる(学習のタイミングで落ちる)**: イメージに MeCab が無いのに、`config.json` の
  `morphAnalyzer` が `sudachi` になっていない。[morph-analyzer.md](morph-analyzer.md) を参照

## ロールバック

イメージには、コミットごとのタグ(`:sha-<コミットのSHA>`)が付いています。
デプロイに失敗するとスクリプトが直前のSHAを表示するので、すぐ戻したいときは `compose.yaml` の `image:` を
`ghcr.io/mirashiya37/ai:sha-<直前のSHA>` にして `docker compose up -d` します(戻したあと、`:custom` に戻すのを忘れない)。
恒久的には `git revert` してpushすると、再デプロイされます。
