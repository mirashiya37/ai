#!/usr/bin/env bash
# サーバ上で実行されるデプロイスクリプト。
# 使い方: bash deploy.sh <デプロイ先ディレクトリ> <デプロイするコミットSHA>
set -euo pipefail

DEPLOY_PATH="${1:?deploy path is required}"
SHA="${2:?commit sha is required}"
SERVICE=app

cd "$DEPLOY_PATH"

if [ ! -d .git ]; then
  echo "::error::$DEPLOY_PATH is not a git repository" >&2
  exit 1
fi

prev="$(git rev-parse HEAD)"
echo "==> $prev -> $SHA"

git fetch --quiet origin custom
git checkout --quiet custom
git merge --ff-only "$SHA"

echo "==> docker compose up"
docker compose up -d --build --remove-orphans

echo "==> waiting for container"
cid="$(docker compose ps -q "$SERVICE")"
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
docker compose logs --tail 50 "$SERVICE" >&2 || true
echo "previous commit was $prev (rollback: git revert, then push)" >&2
exit 1
