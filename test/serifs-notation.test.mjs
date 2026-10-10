// セリフの表記(src/serifs.ts)。独自に足したセリフは、三点リーダーを「...」、波線を「～」(全角チルダ)に揃える
import { test } from 'node:test';
import assert from 'node:assert/strict';
import serifs from '../built/serifs.js';

/** セリフを、名前ありと名前なしの両方で文にして、キーと一緒に返す */
function allSerifs(value, key = '') {
	if (value == null) return [];
	if (typeof value === 'string') return [[key, value]];
	if (Array.isArray(value)) return value.flatMap((v, i) => allSerifs(v, `${key}[${i}]`));
	if (typeof value === 'function') {
		// 引数は文字列で呼ぶ。語句の一覧(配列)を受け取るものは、配列で呼び直す。最後の引数(多くは名前)を null にした文も見る
		const call = args => {
			try { return value(...args); } catch {}
			try { return value(...args.map(a => a == null ? a : [a])); } catch { return null; } // 語句の一覧が null のときなど、作れない文は見ない
		};
		const args = Array.from({ length: value.length }, () => 'X');
		return [...allSerifs(call(args), key), ...allSerifs(call(args.map((a, i) => i === value.length - 1 ? null : a)), `${key}(名前なし)`)];
	}
	return Object.entries(value).flatMap(([k, v]) => allSerifs(v, key ? `${key}.${k}` : k));
}

test('三点リーダーに「・・・」(中黒3つ)を使わない', () => {
	const found = allSerifs(serifs).filter(([, text]) => text.includes('・・・'));
	assert.deepEqual(found, []);
});

test('波線に「〜」(波ダッシュ)を使わない(upstream の独り言を除く)', () => {
	const found = allSerifs(serifs).filter(([key, text]) => !key.startsWith('noting.') && text.includes('〜'));
	assert.deepEqual(found, []);
});

test('感嘆符に、全角と半角を混ぜない。文末に空白を残さない', () => {
	const found = allSerifs(serifs).filter(([, text]) => /！!|!！/.test(text) || /[ 　]$/.test(text));
	assert.deepEqual(found, []);
	assert.equal(serifs.core.hightouch.normal('X'), 'X！ハイターッチ！！', '名前なしの「ハイターッチ！！」と揃える');
});
