// 学習: Bot の投稿を除く(src/modules/keyword/note-filter.ts)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBotNote } from '../built/modules/keyword/note-filter.js';

test('Bot アカウントの投稿は、Bot の投稿とみなす', () => {
	assert.equal(isBotNote({ user: { isBot: true } }), true);
});

test('Bot でないアカウントの投稿は、Bot の投稿とみなさない', () => {
	assert.equal(isBotNote({ user: { isBot: false } }), false);
});

test('Bot かどうかの情報が無い投稿は、Bot とみなさない', () => {
	assert.equal(isBotNote({}), false);
	assert.equal(isBotNote({ user: null }), false);
	assert.equal(isBotNote({ user: {} }), false);
});
