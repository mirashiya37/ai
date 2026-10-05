// 学習: 学習の間隔(src/modules/keyword/learn-interval.ts)と、予約の続け方(keyword モジュールの scheduleLearn)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { nextLearnDelay, MIN_MINUTES, MAX_MINUTES } from '../built/modules/keyword/learn-interval.js';

const ROOT = new URL('..', import.meta.url).pathname;
// keyword モジュールは config.json を読み込むので、無い環境(CI など)では、モジュールを動かすテストを飛ばす
const hasConfig = existsSync(ROOT + 'config.json');

test('間隔は 15〜45 分の一様で、平均は 30 分', () => {
	const n = 200000;
	const xs = Array.from({ length: n }, () => nextLearnDelay() / 60000);
	assert.ok(xs.every(x => x >= MIN_MINUTES && x <= MAX_MINUTES));
	const mean = xs.reduce((a, b) => a + b, 0) / n;
	assert.ok(Math.abs(mean - 30) < 0.2, `mean ${mean}`);
	const bins = [0, 0, 0];
	for (const x of xs) bins[Math.min(2, Math.floor((x - 15) / 10))]++;
	for (const b of bins) assert.ok(Math.abs(b / n - 1 / 3) < 0.01, `bins ${bins}`);
});

test('乱数の端の値でも、範囲に収まる', () => {
	assert.equal(nextLearnDelay(() => 0), 15 * 60000);
	assert.ok(nextLearnDelay(() => 0.9999999999) <= 45 * 60000);
});

test('学習が失敗しても、次の予約は続き、失敗は外に出る', { skip: !hasConfig && 'config.json がない' }, async () => {
	const require = createRequire(ROOT);
	const loki = require('lokijs');
	const config = (await import('../built/config.js')).default;
	config.keywordEnabled = true;
	const Keyword = (await import('../built/modules/keyword/index.js')).default;

	const db = new loki('test.json');
	const cols = {};
	const getCollection = (name, opts) => cols[name] ?? (cols[name] = db.addCollection(name, opts));
	const logs = [];
	const ai = { account: { id: 'bot' }, moduleData: getCollection('moduleData'), getCollection, log: m => logs.push(m) };

	// 予約を自分で実行できるよう、setTimeout / setInterval を差し替える。
	// 本番では、学習の失敗は処理されないまま外に出て、index.ts の uncaughtException でログに残る(ボットは止まらない)。
	// テストランナーはそれをテストの失敗として扱うので、ここでは予約した処理の失敗を受け取って確かめる
	const scheduled = [];
	const { setTimeout: realSetTimeout, setInterval: realSetInterval } = globalThis;
	globalThis.setTimeout = (fn, delay) => { scheduled.push({ fn, delay }); return 0; };
	globalThis.setInterval = () => 0;
	try {
		const mod = new Keyword();
		mod.init(ai);
		let calls = 0;
		// 代入すると @bindThis の setter がクラス共通の関数を書き換えるので、インスタンスに直接定義する
		Object.defineProperty(mod, 'learn', { value: async () => { calls++; if (calls === 2) throw new Error('boom'); }, configurable: true, writable: true });
		mod.install();

		const errors = [];
		for (let i = 0; i < 6; i++) {
			const { fn, delay } = scheduled.shift();
			assert.ok(delay >= 15 * 60000 && delay <= 45 * 60000, `delay ${delay}`);
			await fn().catch(e => errors.push(e.message));
		}
		assert.equal(calls, 6);
		assert.deepEqual(errors, ['boom']);
		assert.equal(scheduled.length, 1, '次の予約が1つ残っている');
		assert.equal(logs.filter(l => l.includes('Next learn in')).length, 7);
	} finally {
		globalThis.setTimeout = realSetTimeout;
		globalThis.setInterval = realSetInterval;
	}
});
