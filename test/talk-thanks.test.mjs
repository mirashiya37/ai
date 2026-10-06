// トーク: 「ありがとう」への返事(src/modules/talk/index.ts の thanks)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const ROOT = new URL('..', import.meta.url).pathname;
const hasConfig = existsSync(ROOT + 'config.json');

test('親愛度が 5 以上なら好き、-3 以下なら嫌い、そのあいだは普通の返事', { skip: !hasConfig && 'config.json がない' }, async () => {
	const require = createRequire(ROOT);
	const loki = require('lokijs');
	const serifs = (await import('../built/serifs.js')).default;
	const Talk = (await import('../built/modules/talk/index.js')).default;

	const db = new loki('test.json');
	const mod = new Talk();
	mod.init({ moduleData: db.addCollection('moduleData'), log: () => {} });

	const replyAt = love => {
		const replies = [];
		const msg = { includes: words => words.includes('ありがとう'), friend: { love, name: 'テスト' }, reply: text => replies.push(text) };
		assert.equal(mod.thanks(msg), true);
		return replies[0];
	};

	const { thanks } = serifs.core;
	assert.equal(replyAt(5), thanks.love('テスト')[0]);
	assert.equal(replyAt(4), thanks.normal('テスト')[0]);
	assert.equal(replyAt(0), thanks.normal('テスト')[0]);
	assert.equal(replyAt(-2), thanks.normal('テスト')[0]);
	assert.equal(replyAt(-3), thanks.hate);
});
