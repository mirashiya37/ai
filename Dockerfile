# ベースイメージはダイジェストで固定する(タグが指す中身が、知らないうちに変わらないように)。
# 更新するときは `docker buildx imagetools inspect node:lts` で新しいダイジェストを調べ、ビルドして確かめてから差し替える
FROM node:lts@sha256:64af3819f9275802414d7cdc38c27e9d82bd564dec4d4da87d008255d36c63b4

RUN apt-get update && apt-get install tini --no-install-recommends -y && apt-get clean && rm -rf /var/lib/apt-get/lists/*

ARG enable_mecab=1

RUN if [ $enable_mecab -ne 0 ]; then apt-get update \
  && apt-get install mecab libmecab-dev mecab-ipadic-utf8 make curl xz-utils file sudo --no-install-recommends -y \
  && apt-get clean \
  && rm -rf /var/lib/apt-get/lists/* \
  && cd /opt \
  && git clone --depth 1 https://github.com/yokomotod/mecab-ipadic-neologd.git \
  && cd /opt/mecab-ipadic-neologd \
  && ./bin/install-mecab-ipadic-neologd -n -y \
  && rm -rf /opt/mecab-ipadic-neologd \
  && echo "dicdir = /usr/lib/x86_64-linux-gnu/mecab/dic/mecab-ipadic-neologd/" > /etc/mecabrc \
  && apt-get purge git make curl xz-utils file -y; fi

# 形態素解析に Sudachi も使えるようにする(config.json の morphAnalyzer で選ぶ)
# 辞書を更新するときは、SudachiDict のバージョンを上げる(ビルドキャッシュが効くので、上げないと更新されない)
ARG enable_sudachi=1
ARG sudachipy_version=0.7.0
ARG sudachidict_version=20260723.1

RUN if [ $enable_sudachi -ne 0 ]; then apt-get update \
  && apt-get install python3-venv --no-install-recommends -y \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/* \
  && python3 -m venv /opt/sudachi \
  && /opt/sudachi/bin/pip install --no-cache-dir sudachipy==$sudachipy_version sudachidict_full==$sudachidict_version \
  && ln -s /opt/sudachi/bin/sudachipy /usr/local/bin/sudachipy; fi

COPY . /ai

WORKDIR /ai
# 依存は package-lock.json のとおりに入れる(入れられなければ失敗させる)。型エラーはビルド成果物の有無で判定する
RUN npm ci && (npm run build || test -f ./built/index.js)

# 実行は一般ユーザーで行う。書き込めるのは data/ だけ
RUN mkdir -p /ai/data && chown node:node /ai/data
USER node

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD npm start
