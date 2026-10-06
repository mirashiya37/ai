// 2つの候補のどちらから選ぶか(src/utils/choose-pool.ts)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { choosePool } from '../built/utils/choose-pool.js';

const A = ['a'];
const B = ['b'];

test('preferred を rate の確率で選ぶ', () => {
	const n = 100000;
	let a = 0;
	for (let i = 0; i < n; i++) if (choosePool(A, B, 0.3) === A) a++;
	assert.ok(Math.abs(a / n - 0.3) < 0.01, `share ${a / n}`);
});

test('選んだ側が空なら、もう一方を返す', () => {
	assert.equal(choosePool(A, [], 0), A);
	assert.equal(choosePool([], B, 1), B);
	assert.deepEqual(choosePool([], [], 0.5), []);
});

test('乱数は1回だけ使い、rate 未満なら preferred', () => {
	let calls = 0;
	const random = value => () => { calls++; return value; };
	assert.equal(choosePool(A, B, 0.3, random(0.29)), A);
	assert.equal(choosePool(A, B, 0.3, random(0.3)), B);
	assert.equal(calls, 2);
});
