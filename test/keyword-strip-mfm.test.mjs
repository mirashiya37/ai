// 学習: 本文から MFM を取り除く処理(src/modules/keyword/strip-mfm.ts)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripMfm } from '../built/modules/keyword/strip-mfm.js';

// 取り除いた部分は空白になるので、比較は空白をまとめてから行う
const strip = text => stripMfm(text).replace(/\s+/g, ' ').trim();

test('関数は、関数名と引数を取り除いて、中の文字を残す', () => {
	assert.equal(strip('$[tada 東京タワー]に行った'), '東京タワーに行った');
	assert.equal(strip('$[spin.speed=1s,delay=2s 回る] $[fg.color=f00 赤]'), '回る 赤');
});

test('関数が入れ子でも、中の文字だけ残る', () => {
	assert.equal(strip('$[tada $[spin 入れ子 :emoji:]]ですね'), '入れ子 ですね');
});

test('装飾の中の文字は残る', () => {
	assert.equal(strip('**太字**と~~取消~~と<small>小さい</small>と<i>斜体</i>'), '太字と取消と小さいと斜体');
});

test('リンクは表示名だけ残る', () => {
	assert.equal(strip('[初音ミク](https://example.com/miku)の話'), '初音ミク の話');
});

test('URL は取り除く(後ろに日本語が続いても)', () => {
	assert.equal(strip('見て https://example.com/a?b=1 を<https://example.com>'), '見て を');
	assert.equal(strip('https://example.com/abc日本語'), '日本語');
});

test('メンションは取り除き、ハッシュタグは # を外して中身を残す', () => {
	assert.equal(strip('@alice @bob@host.example こんにちは'), 'こんにちは');
	assert.equal(strip('今日の#ずんだもん と #PR'), '今日の ずんだもん と PR');
});

test('引用は取り除く', () => {
	assert.equal(strip('> 他人の文章です\n\n自分の文章です'), '自分の文章です');
});

test('コードと数式は取り除く', () => {
	assert.equal(strip('`inlineCode` と\n```js\nconst Foo = 1\n```\n\\(x^2\\)'), 'と');
});

test('絵文字は取り除く(カスタム絵文字・Unicode 絵文字)', () => {
	assert.equal(strip('寿司 :meow_sushi: :name@host.example: 🍣'), '寿司');
});

test('時刻の 12:30:45 は残る', () => {
	assert.equal(strip('12:30:45 に集合'), '12:30:45 に集合');
});

test('<plain> の中身は、MFM として解釈せず、そのまま残る', () => {
	assert.equal(strip('<plain>$[tada 生の文字]</plain>'), '$[tada 生の文字]');
});

test('unixtime は取り除き、ruby は親文字だけ残す', () => {
	assert.equal(strip('$[unixtime 1700000000]に$[ruby 漢字 かんじ]'), 'に漢字');
});

test('検索は、検索の語だけ残す', () => {
	assert.equal(strip('ずんだもん 検索 [検索]'), 'ずんだもん 検索');
});

test('閉じていない MFM でも、関数名やタグは語として残らない', () => {
	const result = strip('$[tada 閉じてない <small>壊れた $[spin.speed=1s 回る');
	assert.ok(!/tada|spin|speed|small/.test(result), result);
	assert.ok(result.includes('閉じてない') && result.includes('壊れた') && result.includes('回る'), result);
});

test('MFM のない本文は、そのまま残る', () => {
	assert.equal(strip('今日は初音ミクのライブに行った。'), '今日は初音ミクのライブに行った。');
	assert.equal(strip(''), '');
});

test('長い本文でも、現実的な時間で終わる', () => {
	const text = '$[tada 長い **投稿** です] :a: https://example.com/x '.repeat(500);
	const start = Date.now();
	stripMfm(text);
	assert.ok(Date.now() - start < 2000);
});
