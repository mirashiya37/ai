// 独り言: 選び方(src/modules/noting/pick-note.ts)と、10分ごとの投稿(noting モジュール)
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pickNote } from '../built/modules/noting/pick-note.js';

const ROOT = new URL('..', import.meta.url).pathname;
const hasConfig = existsSync(ROOT + 'config.json');
const FIXED = Array.from({ length: 75 }, (_, i) => 'f' + i);
const KEYWORD = ['k0', 'k1', 'k2'];

test('語句を使うテンプレートは 30%、それぞれの側の中では均等に選ばれる', () => {
	const n = 200000;
	const counts = new Map();
	let keyword = 0;
	for (let i = 0; i < n; i++) {
		const r = pickNote(FIXED, KEYWORD, 0.3);
		if (r[0] === 'k') keyword++;
		counts.set(r, (counts.get(r) ?? 0) + 1);
	}
	assert.ok(Math.abs(keyword / n - 0.3) < 0.005, `keyword share ${keyword / n}`);
	const fixed = FIXED.map(f => counts.get(f) ?? 0);
	const kw = KEYWORD.map(k => counts.get(k) ?? 0);
	assert.ok(Math.min(...fixed) > 0 && Math.max(...fixed) / Math.min(...fixed) < 1.2, `fixed ${Math.min(...fixed)}〜${Math.max(...fixed)}`);
	assert.ok(Math.max(...kw) / Math.min(...kw) < 1.05);
});

test('確率 0 と 1、片方が空のとき、乱数の端の値', () => {
	assert.ok(Array.from({ length: 2000 }, () => pickNote(FIXED, KEYWORD, 0)).every(x => x[0] === 'f'));
	assert.ok(Array.from({ length: 2000 }, () => pickNote(FIXED, KEYWORD, 1)).every(x => x[0] === 'k'));
	assert.ok(Array.from({ length: 2000 }, () => pickNote(FIXED, [], 1)).every(x => x[0] === 'f'));
	assert.ok(Array.from({ length: 2000 }, () => pickNote([], KEYWORD, 0)).every(x => x[0] === 'k'));
	assert.equal(pickNote(FIXED, KEYWORD, 0.3, () => 0), 'k0');
	assert.equal(pickNote(FIXED, KEYWORD, 0.3, () => 0.9999999999), 'f74');
});

test('独り言は 1 日に平均 21.6 件、うち 30% が語句を使うテンプレート', { skip: !hasConfig && 'config.json がない' }, async () => {
	const require = createRequire(ROOT);
	const loki = require('lokijs');
	const config = (await import('../built/config.js')).default;
	config.notingEnabled = true;
	const serifs = (await import('../built/serifs.js')).default;
	const originals = {};
	const calls = { want: 0, see: 0, expire: 0 };
	for (const k of Object.keys(calls)) {
		originals[k] = serifs.noting[k];
		serifs.noting[k] = (...a) => { calls[k]++; return originals[k](...a); };
	}
	const Noting = (await import('../built/modules/noting/index.js')).default;

	const db = new loki('test.json');
	const cols = {};
	const getCollection = (name, opts) => cols[name] ?? (cols[name] = db.addCollection(name, opts));
	getCollection('_keyword_learnedKeywords').insert({ keyword: 'ずんだもん', learnedAt: 1 });
	const posts = [];
	const ai = { moduleData: getCollection('moduleData'), getCollection, log: () => {}, post: async o => { posts.push(o.text); } };

	mock.timers.enable({ apis: ['setInterval'] });
	try {
		const mod = new Noting();
		mod.init(ai);
		mod.install();
		const days = 3000;
		for (let i = 0; i < days * 144; i++) mock.timers.tick(10 * 60 * 1000);
		const perDay = posts.length / days;
		const keyword = calls.want + calls.see + calls.expire;
		assert.ok(Math.abs(perDay - 21.6) < 0.3, `per day ${perDay}`);
		assert.ok(Math.abs(keyword / posts.length - 0.3) < 0.01, `keyword share ${keyword / posts.length}`);
		assert.ok(posts.every(t => typeof t === 'string' && t.length > 0));
	} finally {
		mock.timers.reset();
		Object.assign(serifs.noting, originals);
	}
});
