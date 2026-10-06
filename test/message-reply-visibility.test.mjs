// 返信の公開範囲(src/message.ts の reply)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const ROOT = new URL('..', import.meta.url).pathname;
const hasConfig = existsSync(ROOT + 'config.json');

test('返信は元の投稿と同じ公開範囲にし、フォロワー限定はダイレクトにする', { skip: !hasConfig && 'config.json がない' }, async () => {
	const require = createRequire(ROOT);
	const loki = require('lokijs');
	const Message = (await import('../built/message.js')).default;

	const db = new loki('test.json');
	const posts = [];
	const ai = {
		account: { id: 'bot', username: 'ai' },
		friends: db.addCollection('friends'),
		log: () => {},
		api: async () => ({}),
		post: async note => { posts.push(note); return note; },
	};

	const replyTo = async visibility => {
		const note = { id: 'n1', user: { id: 'u1', username: 'tester' }, userId: 'u1', text: 'hi', renoteId: null, replyId: null, visibility };
		await new Message(ai, note, false).reply('ok', { immediate: true });
		const { visibility: v, visibleUserIds } = posts.pop();
		return { visibility: v, visibleUserIds };
	};

	assert.deepEqual(await replyTo('public'), { visibility: 'public', visibleUserIds: undefined });
	assert.deepEqual(await replyTo('home'), { visibility: 'home', visibleUserIds: undefined });
	assert.deepEqual(await replyTo('followers'), { visibility: 'specified', visibleUserIds: ['u1'] });
	assert.deepEqual(await replyTo('specified'), { visibility: 'specified', visibleUserIds: ['u1'] });
});
