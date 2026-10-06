// トーク: 親愛度に応じたセリフの選び方(src/modules/talk/by-love.ts)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byLove } from '../built/modules/talk/by-love.js';

const serif = { normal: 'normal', love: 'love', hate: 'hate' };
const at = love => ({ love, name: null });

test('既定の境目は、好きが 5 以上、嫌いが -3 以下', () => {
	assert.equal(byLove(at(5), serif), 'love');
	assert.equal(byLove(at(4), serif), 'normal');
	assert.equal(byLove(at(-2), serif), 'normal');
	assert.equal(byLove(at(-3), serif), 'hate');
});

test('境目は反応ごとに変えられる', () => {
	assert.equal(byLove(at(14), serif, { love: 15, hate: -6 }), 'normal');
	assert.equal(byLove(at(15), serif, { love: 15, hate: -6 }), 'love');
	assert.equal(byLove(at(-6), serif, { love: 15, hate: -6 }), 'hate');
});

test('love・hate が無いセリフは normal を使う', () => {
	assert.equal(byLove(at(100), { normal: 'n', hate: 'h' }), 'n');
	assert.equal(byLove(at(-100), { normal: 'n', love: 'l' }), 'n');
});

test('名前を受け取るセリフには呼び名を渡し、配列はそのまま返す', () => {
	const named = { normal: name => `${name ?? 'あなた'}さん`, love: ['a', 'b'] };
	assert.equal(byLove({ love: 0, name: 'テスト' }, named), 'テストさん');
	assert.equal(byLove({ love: 0, name: null }, named), 'あなたさん');
	assert.deepEqual(byLove({ love: 5, name: null }, named), ['a', 'b']);
});
