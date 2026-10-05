#!/usr/bin/env bash
# サーバ上で実行されるデプロイスクリプト。
# 使い方: bash deploy.sh <スタックのディレクトリ> <デプロイするコミットSHA> <イメージ名(タグなし)>
# イメージはCIがGHCRにpush済みなので、ここではpullして起動し直すだけ。
set -euo pipefail

DEPLOY_PATH="${1:?deploy path is required}"
SHA="${2:?commit sha is required}"
IMAGE="${3:?image is required}"
SERVICE=app

cd "$DEPLOY_PATH"

revision_of() {
  docker inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$1" 2>/dev/null || echo unknown
}

# compose.yaml が、まだサーバでビルドする形(build:)のままなら、何も変えずに止める
if ! docker compose config --images 2>/dev/null | grep -qx "$IMAGE:custom"; then
  echo "::error::compose.yaml の $SERVICE が image: $IMAGE:custom になっていない(docs/deploy.md の移行手順を参照)" >&2
  exit 1
fi

prev_cid="$(docker compose ps -q "$SERVICE" 2>/dev/null || true)"
prev="$( [ -n "$prev_cid" ] && revision_of "$prev_cid" || echo none)"
echo "==> $prev -> $SHA"

echo "==> docker compose pull"
docker compose pull --quiet "$SERVICE"

# コンテナは一般ユーザー(uid 1000)で動く。マウントするファイルを読み書きできないと、起動し直した後に動かなくなるので、
# 動いているコンテナを止める前に、新しいイメージ(pull済み)で、実際のマウントのとおりに確かめる。
# stdin はこのスクリプト自身なので、docker には渡さない(</dev/null)
echo "==> docker compose run (permission check)"
if ! docker compose run --rm --no-deps -T --entrypoint sh "$SERVICE" -c '
  test -r /ai/config.json && test -r /ai/font.ttf && test -w /ai/data &&
  { [ ! -e /ai/data/memory.json ] || { test -r /ai/data/memory.json && test -w /ai/data/memory.json; }; }
' </dev/null; then
  echo "::error::コンテナの実行ユーザー(uid 1000)が config.json / font.ttf を読めない、または data/ に書けない(docs/deploy.md の「一般ユーザーで動かす」を参照)" >&2
  echo "動いているコンテナは、そのままにしてある" >&2
  exit 1
fi

echo "==> docker compose up"
docker compose up -d --remove-orphans

cid="$(docker compose ps -q "$SERVICE")"
rev="$(revision_of "$cid")"
if [ "$rev" != "$SHA" ]; then
  echo "::error::running image is $rev, expected $SHA" >&2
  exit 1
fi

echo "==> waiting for container"
for i in $(seq 1 15); do
  sleep 2
  running="$(docker inspect -f '{{.State.Running}}' "$cid" 2>/dev/null || echo false)"
  restarts="$(docker inspect -f '{{.RestartCount}}' "$cid" 2>/dev/null || echo 0)"
  if [ "$running" = true ] && [ "$restarts" = 0 ] && [ "$i" -ge 5 ]; then
    echo "==> OK (running, restarts=0)"
    docker image prune -f >/dev/null
    exit 0
  fi
done

echo "::error::container did not become stable" >&2
# ログは、リポジトリが public でActionsのログが誰にでも見えるため、ここには出さない
echo "ログはサーバで確認する: docker compose logs --tail 50 $SERVICE" >&2
echo "previous revision was $prev" >&2
echo "rollback: compose.yaml の image を $IMAGE:sha-$prev にして docker compose up -d、または git revert して push" >&2
exit 1
