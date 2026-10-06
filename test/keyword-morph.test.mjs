// 学習: 形態素解析の切り替え(src/modules/keyword/morph.ts)
// MeCab と Sudachi の代わりに、決まった形で出力するスクリプトを使う
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const hasConfig = existsSync(ROOT + 'config.json');

// 1行を読んで、その行を1語の固有名詞として返す(MeCab の出力の形)
const FAKE_MECAB = `#!/bin/sh
read line
printf '%s\\t名詞,固有名詞,一般,*,*,*,%s,ヨミ,ヨミ\\nEOS\\n' "$line" "$line"
`;

// 行ごとに、その行を1語の固有名詞として返す(Sudachi の -a の出力の形)
const FAKE_SUDACHI = `#!/bin/sh
while IFS= read -r line; do
	printf '%s\\t名詞,固有名詞,一般,*,*,*\\t%s\\t%s\\tヨミ\\t0\\t[]\\nEOS\\n' "$line" "$line" "$line"
done
`;

test('設定に応じて MeCab と Sudachi を使い分け、テキストごとに同じ並びのトークンを返す', { skip: !hasConfig && 'config.json がない' }, async () => {
	const config = (await import('../built/config.js')).default;
	const { analyze } = await import('../built/modules/keyword/morph.js');

	const dir = mkdtempSync(join(tmpdir(), 'ai-morph-'));
	const saved = { ...config };
	try {
		writeFileSync(join(dir, 'mecab'), FAKE_MECAB, { mode: 0o755 });
		writeFileSync(join(dir, 'sudachi'), FAKE_SUDACHI, { mode: 0o755 });
		const texts = ['ずんだもん', '初音ミク', '東京'];

		Object.assign(config, { morphAnalyzer: 'mecab', mecab: join(dir, 'mecab'), mecabDic: undefined });
		const byMecab = await analyze(texts);

		Object.assign(config, { morphAnalyzer: 'sudachi', sudachi: join(dir, 'sudachi'), sudachiDict: 'full' });
		const bySudachi = await analyze(texts);

		for (const result of [byMecab, bySudachi]) {
			assert.equal(result.length, texts.length);
			assert.deepEqual(result.map(tokens => tokens.map(token => token[0])), texts.map(text => [text]));
			assert.deepEqual(result.map(tokens => [tokens[0][2], tokens[0][8]]), texts.map(() => ['固有名詞', 'ヨミ']));
		}
	} finally {
		for (const key of Object.keys(config)) if (!(key in saved)) delete config[key];
		Object.assign(config, saved);
		rmSync(dir, { recursive: true, force: true });
	}
});
