// 学習: 覚える語の選び方(src/modules/keyword/pick-candidate.ts)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickCandidate, resolveProperRate, DEFAULT_PROPER_RATE } from '../built/modules/keyword/pick-candidate.js';
import { kindOf } from '../built/modules/keyword/token-filter.js';

// Sudachi 形式のトークン: [表層形, 品詞, 品詞細分類1, 品詞細分類2, 品詞細分類3, ...]
const proper = s => [s, '名詞', '固有名詞', '一般', '*', '*', s, 'ヨミ'];
const common = s => [s, '名詞', '普通名詞', '一般', '*', '*', s, 'ヨミ'];
const candidates = (p, c) => [
	...Array.from({ length: p }, (_, i) => proper('固' + 'あ'.repeat(i % 4 + 1) + i)),
	...Array.from({ length: c }, (_, i) => common('普' + 'あ'.repeat(i % 4 + 2) + i)),
];
const properShare = (cands, rate, n = 40000) => {
	let p = 0;
	for (let i = 0; i < n; i++) if (kindOf(pickCandidate([...cands], rate)) === 'proper') p++;
	return p / n;
};

test('固有名詞が選ばれる割合は、設定した確率になる', () => {
	for (const rate of [0.6, 0.3]) {
		const share = properShare(candidates(10, 25), rate);
		assert.ok(Math.abs(share - rate) < 0.02, `rate ${rate}: ${share}`);
	}
	assert.equal(properShare(candidates(10, 25), 1, 2000), 1);
	assert.equal(properShare(candidates(10, 25), 0, 2000), 0);
});

test('選んだ側に候補がなければ、もう一方から選ぶ', () => {
	assert.equal(kindOf(pickCandidate(candidates(0, 5), 1)), 'common');
	assert.equal(kindOf(pickCandidate(candidates(5, 0), 0)), 'proper');
	assert.equal(pickCandidate([], 0.6), undefined);
});

test('渡した配列を書き換えない', () => {
	const cands = candidates(3, 3);
	const before = JSON.stringify(cands);
	pickCandidate(cands, 0.6);
	assert.equal(JSON.stringify(cands), before);
});

test('同じ種類の中では、長い語が選ばれやすい', () => {
	const pool = ['ア', 'アイ', 'アイウ', 'アイウエ', 'アイウエオ'].map(proper);
	let long = 0, short = 0;
	for (let i = 0; i < 20000; i++) {
		const len = pickCandidate([...pool], 1)[0].length;
		if (len >= 4) long++;
		if (len <= 2) short++;
	}
	assert.ok(long > short * 2, `long ${long}, short ${short}`);
});

test('resolveProperRate は 0〜1 の数(文字列も可)だけを受け、それ以外は初期値にする', () => {
	assert.equal(DEFAULT_PROPER_RATE, 0.6);
	for (const [value, expected] of [[0.6, 0.6], ['0.7', 0.7], [0, 0], [1, 1]]) assert.equal(resolveProperRate(value), expected);
	for (const value of [1.5, -0.1, 'abc', '', undefined, null, NaN]) assert.equal(resolveProperRate(value), DEFAULT_PROPER_RATE);
});
