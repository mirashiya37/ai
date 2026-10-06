// 学習: 形態素解析の切り替え(src/modules/keyword/morph.ts)と、本物の解析結果での語の判定(token-filter.ts)
// 本物の Sudachi(sudachipy、full 辞書)を使う。入っていなければ skip する。
// MeCab は本番で使っていないので、入っている環境でだけ確かめる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const ROOT = new URL('..', import.meta.url).pathname;
const hasConfig = existsSync(ROOT + 'config.json');
const has = command => spawnSync('sh', ['-c', `command -v ${command}`]).status === 0;
const skipReason = command => !hasConfig ? 'config.json がない' : !has(command) ? `${command} が入っていない` : false;

// 「田中さん」は full 辞書に1語(固有名詞,一般)で載っているので、例文は敬称を付けない
const TEXTS = ['初音ミクと東京へ行った', '田中は武勇伝を語った', ''];

async function analyzeWith(settings) {
	const config = (await import('../built/config.js')).default;
	const { analyze } = await import('../built/modules/keyword/morph.js');
	const saved = { ...config };
	try {
		Object.assign(config, settings);
		return await analyze(TEXTS);
	} finally {
		for (const key of Object.keys(config)) if (!(key in saved)) delete config[key];
		Object.assign(config, saved);
	}
}

async function assertTokens(result) {
	const { isLearnableToken, kindOf } = await import('../built/modules/keyword/token-filter.js');
	const none = new Set();

	assert.equal(result.length, TEXTS.length, 'テキストごとに結果がある');
	assert.deepEqual(result[2], [], '空のテキストは語なし');

	const find = (tokens, surface) => tokens.find(token => token[0] === surface);
	const miku = find(result[0], '初音ミク');
	const tokyo = find(result[0], '東京');
	const tanaka = find(result[1], '田中');
	const buyuden = find(result[1], '武勇伝');

	// 並びは MeCab(IPADIC)と同じ: [表層形, 品詞, 細分類1, 細分類2, 細分類3, 活用型, 活用形, 原形, 読み]
	assert.deepEqual([miku[1], miku[2], miku[8]], ['名詞', '固有名詞', 'ハツネミク']);

	const learnable = result.flat().filter(token => isLearnableToken(token, none)).map(token => [token[0], kindOf(token)]);
	assert.deepEqual(learnable, [['初音ミク', 'proper'], ['東京', 'proper'], ['武勇伝', 'common']], '人名の姓(田中)は覚えない');
	assert.ok(tanaka && tokyo && buyuden);
}

test('Sudachi: テキストごとに MeCab と同じ並びのトークンを返し、覚える語を正しく判定できる', { skip: skipReason('sudachipy') }, async () => {
	await assertTokens(await analyzeWith({ morphAnalyzer: 'sudachi', sudachi: 'sudachipy', sudachiDict: 'full' }));
});

test('MeCab: テキストごとにトークンを返し、覚える語を正しく判定できる', { skip: skipReason('mecab') }, async () => {
	await assertTokens(await analyzeWith({ morphAnalyzer: 'mecab', mecab: 'mecab', mecabDic: undefined }));
});
