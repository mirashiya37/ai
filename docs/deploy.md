# デプロイ(CI/CD)

`custom` ブランチへの push で、CI(ビルド確認)を通した後にサーバへ自動デプロイします。

```
push (custom)
  └─ ci.yml      : npm install → build → built/index.js の存在と構文を確認
  └─ deploy.yml  : Tailscaleに参加(tag:ci) → Tailscale SSHでサーバへ入る
                     └─ scripts/deploy.sh : git merge --ff-only → docker compose up -d --build → 起動確認
```

サーバ上の `compose.yaml` `config.json` `data/` `font.ttf` はGit管理外なので、
`git merge` では変更されません。Dockgeのスタックにそのまま残します。

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

## 2. サーバ側の準備(Dockgeのスタックをその場でGitリポジトリ化する)

Dockgeのスタック(以下 `<スタックの絶対パス>`)に置いてあるファイルのうち、
**ソースコード(`src/` `Dockerfile` など)だけをGit管理に切り替え**、
`compose.yaml` `config.json` `data/` `font.ttf` はそのまま残します。
これらは `.gitignore` で除外されているか、リポジトリに存在しないため、上書きされません。
一度だけ、サーバで次を実行します(`STACK` はスタックのパスに置き換える)。

```bash
STACK=<スタックの絶対パス>
cd "$STACK"

# 0. 念のためバックアップ(data/ には学習データが入っている)
cp -a "$STACK" "$STACK.bak-$(date +%Y%m%d)"

# 1. その場でリポジトリ化して、customブランチの内容に揃える
git init -q
git remote add origin https://github.com/mirashiya37/ai
git fetch origin custom
git checkout -f -B custom origin/custom   # ソースはcustomの内容で上書きされる

# 2. 除外されているはずのファイルが無事か確認
git status --short            # 何も表示されなければ、ローカル専用ファイルはすべて除外済み
ls compose.yaml config.json font.ttf data/memory.json

# 3. 起動確認(Dockgeのcompose.yamlが使われる)
docker compose up -d --build
```

注意点:

- Forkがpublicなので、`git fetch` に認証は不要です。
- Dockgeの `compose.yaml` が優先して使われます。リポジトリ側の `docker-compose.yml` は同じディレクトリに現れますが、
  使われません(複数あるという警告が出ることがあります)。DNS設定など環境固有の設定は、
  Dockge側の `compose.yaml` に書いたままにします。`docker-compose.override.yml` はサーバでは不要です。
- SSHユーザーが `docker` グループに入っていること。スタックのディレクトリの所有者がSSHユーザーであること
  (違う場合、gitが "dubious ownership" で止まるので `git config --global --add safe.directory "$STACK"` を実行する)。
- 以降は `docker compose` をスタックのディレクトリで実行すれば、Dockgeの画面にも同じスタックとして表示されます
  (プロジェクト名がディレクトリ名と一致するため)。

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
- **ビルドの型エラー**: upstream時点で多数あり、DockerfileもCIも成果物の有無で判定している

## ロールバック

デプロイに失敗するとスクリプトが直前のコミットを表示します。`git revert` してpushすると、再デプロイされます。
