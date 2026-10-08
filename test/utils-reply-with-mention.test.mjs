// 返信の頭に、送った人へのメンションを付ける(src/utils/reply-with-mention.ts)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withMention, replyWithMention } from '../built/utils/reply-with-mention.js';

test('投稿への返信は、頭に @ユーザー名 を付ける', () => {
	assert.equal(withMention({ isChat: false, user: { username: 'alice', host: null } }, 'こんにちは'), '@alice こんにちは');
	assert.equal(withMention({ isChat: false, user: { username: 'alice' } }, 'こんにちは'), '@alice こんにちは');
});

test('別のサーバーの人は @ユーザー名@サーバー', () => {
	assert.equal(withMention({ isChat: false, user: { username: 'bob', host: 'example.com' } }, 'やあ'), '@bob@example.com やあ');
});

test('チャットには付けない', () => {
	assert.equal(withMention({ isChat: true, user: { username: 'alice', host: null } }, 'こんにちは'), 'こんにちは');
});

test('replyWithMention は、付けた文で reply を呼び、オプションを引き継ぐ', async () => {
	const calls = [];
	const msg = { isChat: false, user: { username: 'alice', host: null }, reply: async (text, opts) => { calls.push([text, opts]); return 'sent'; } };
	assert.equal(await replyWithMention(msg, 'はい', { immediate: true }), 'sent');
	assert.deepEqual(calls, [['@alice はい', { immediate: true }]]);
});
