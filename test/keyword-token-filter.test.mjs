// 学習: 覚える語の判定と分類(src/modules/keyword/token-filter.ts)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLearnableToken, isLearnableCommonNoun, kindOf, trendKeywordsOf } from '../built/modules/keyword/token-filter.js';

// Sudachi 形式のトークン: [表層形, 品詞, 品詞細分類1, 品詞細分類2, 品詞細分類3, 活用型, 活用形, 原形, 読み]
const token = (s, pos, reading = 'ヨミ') => [s, ...pos, '*', '*', s, ...(reading == null ? [] : [reading])];
const proper = (s, sub2 = '一般', sub3 = '*') => token(s, ['名詞', '固有名詞', sub2, sub3]);
const common = (s, sub2 = '一般', reading) => token(s, ['名詞', '普通名詞', sub2, '*'], reading);
const none = new Set();

test('固有名詞は覚える。人名は姓・名だけを除き、フルネーム(一般)は覚える', () => {
	assert.equal(isLearnableToken(proper('ずんだもん'), none), true);
	assert.equal(isLearnableToken(proper('東京', '地名', '一般'), none), true);
	assert.equal(isLearnableToken(proper('初音ミク', '人名', '一般'), none), true);
	assert.equal(isLearnableToken(proper('田中', '人名', '姓'), none), false);
	assert.equal(isLearnableToken(proper('太郎', '人名', '名'), none), false);
});

test('普通名詞は、細分類が一般・3文字以上・英数字だけやひらがなだけでない語だけ', () => {
	assert.equal(isLearnableCommonNoun(common('武勇伝')), true);
	assert.equal(isLearnableCommonNoun(token('ジンギスカン', ['名詞', '一般', '*', '*'])), true, 'IPADIC の並び');
	assert.equal(isLearnableCommonNoun(common('天気')), false);
	assert.equal(isLearnableCommonNoun(common('ほんとう')), false);
	assert.equal(isLearnableCommonNoun(common('site')), false);
	assert.equal(isLearnableCommonNoun(common('ＬＬＭ')), false);
	assert.equal(isLearnableCommonNoun(common('発見する', 'サ変可能')), false);
	assert.equal(isLearnableCommonNoun(common('武勇伝', '一般', null)), false, '読みが無い');
});

test('読みが無い語と、覚えないようにした語は覚えない', () => {
	assert.equal(isLearnableToken(token('ずんだもん', ['名詞', '固有名詞', '一般', '*'], null), none), false);
	assert.equal(isLearnableToken(proper('ずんだもん'), new Set(['ずんだもん'])), false);
	assert.equal(isLearnableToken(token('走る', ['動詞', '一般', '*', '*']), none), false);
});

test('kindOf は固有名詞と普通名詞を見分ける', () => {
	assert.equal(kindOf(proper('初音ミク')), 'proper');
	assert.equal(kindOf(common('武勇伝')), 'common');
});

test('「今日よく見かけた言葉」には、固有名詞だけを数える', () => {
	assert.deepEqual(trendKeywordsOf([proper('初音ミク'), common('武勇伝'), proper('東京'), common('ジンギスカン')]), ['初音ミク', '東京']);
	assert.deepEqual(trendKeywordsOf([common('武勇伝')]), []);
	assert.deepEqual(trendKeywordsOf([]), []);
});
