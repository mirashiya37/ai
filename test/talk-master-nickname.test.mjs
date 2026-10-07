// トーク: マスターのあだ名(src/modules/talk/master-nickname.ts、nickname.ts の parseAdanaTarget、talk モジュールの adanaForMaster)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolveMasterNicknameSettings, checkMasterNicknameLimit, nextMasterNicknameUserRecord } from '../built/modules/talk/master-nickname.js';
import { parseAdanaTarget } from '../built/modules/talk/nickname.js';

const ROOT = new URL('..', import.meta.url).pathname;
const hasConfig = existsSync(ROOT + 'config.json');
const HOUR = 1000 * 60 * 60;

test('マスターのユーザー名が無いか、伝えず呼び名にもしないなら、使わない', () => {
	assert.equal(resolveMasterNicknameSettings({ masterNicknameNotify: 'mention' }), null);
	assert.equal(resolveMasterNicknameSettings({ master: 'm' }), null, '既定はオフ');
	assert.equal(resolveMasterNicknameSettings({ master: 'm', masterNicknameNotify: 'off', masterNicknameUpdateName: false }), null);
	assert.equal(resolveMasterNicknameSettings({ master: 'm', masterNicknameNotify: 'unknown' }), null, '知らない値はオフ');
});

test('設定の既定値と、文字列で書いた数', () => {
	assert.deepEqual(resolveMasterNicknameSettings({ master: 'm', masterNicknameNotify: 'mention' }), {
		username: 'm', names: [], notify: 'mention', updateName: false, perUserDaily: 1, interval: 3 * HOUR,
	});
	assert.deepEqual(resolveMasterNicknameSettings({
		master: 'm', masterNicknameNames: ['マスター', '', 1, 'ご主人'], masterNicknameNotify: 'off', masterNicknameUpdateName: true,
		masterNicknamePerUserDaily: '2', masterNicknameIntervalHours: '0.5',
	}), {
		username: 'm', names: ['マスター', 'ご主人'], notify: 'off', updateName: true, perUserDaily: 2, interval: 0.5 * HOUR,
	}, '伝えなくても、呼び名にするなら使う');
	assert.equal(resolveMasterNicknameSettings({ master: 'm', masterNicknameNotify: 'chat', masterNicknameIntervalHours: -1 }).interval, 3 * HOUR, '負の数は既定値');
});

test('同じ人は1日の回数まで。日付が変わればまた頼める', () => {
	const settings = { perUserDaily: 1, interval: 0 };
	assert.deepEqual(checkMasterNicknameLimit(settings, {}, undefined, '2026/10/7', 0), { ok: true });
	const record = nextMasterNicknameUserRecord({}, '2026/10/7');
	assert.deepEqual(record, { date: '2026/10/7', count: 1 });
	assert.deepEqual(checkMasterNicknameLimit(settings, record, undefined, '2026/10/7', 0), { ok: false, reason: 'daily' });
	assert.deepEqual(checkMasterNicknameLimit(settings, record, undefined, '2026/10/8', 0), { ok: true });
	assert.deepEqual(nextMasterNicknameUserRecord(record, '2026/10/8'), { date: '2026/10/8', count: 1 }, '日付が変わったら数え直す');
	assert.deepEqual(checkMasterNicknameLimit({ perUserDaily: 0, interval: 0 }, { date: '2026/10/7', count: 99 }, undefined, '2026/10/7', 0), { ok: true }, '0 なら制限しない');
});

test('マスターに伝える間隔は、誰からかに関わらずまとめて数え、次に伝えられる時刻を返す', () => {
	const settings = { perUserDaily: 1, interval: 3 * HOUR };
	const last = 1_000_000_000_000;
	assert.deepEqual(checkMasterNicknameLimit(settings, {}, last, 'd', last + 3 * HOUR - 1), { ok: false, reason: 'interval', nextAt: last + 3 * HOUR });
	assert.deepEqual(checkMasterNicknameLimit(settings, {}, last, 'd', last + 3 * HOUR), { ok: true });
	assert.deepEqual(checkMasterNicknameLimit(settings, { date: 'd', count: 1 }, last, 'd', last), { ok: false, reason: 'daily' }, '1日の回数を先に見る');
});

test('マスターの名前は敬称を問わず、「@マスター」はこのサーバーのユーザーのときだけマスター', () => {
	const master = { username: 'boss', names: ['マスター', 'ご主人'], localHost: 'example.com' };
	for (const text of ['マスターのあだ名', 'マスターさんのあだ名', 'ねえ、ご主人様のあだ名考えて', '@boss のあだ名', '@Boss のあだ名', '@boss@example.com のあだ名']) {
		assert.deepEqual(parseAdanaTarget(text, master), { kind: 'master' }, text);
	}
	assert.deepEqual(parseAdanaTarget('@boss@other.example のあだ名', master), { kind: 'other', name: 'boss' }, 'ほかのサーバーの同じユーザー名');
	assert.deepEqual(parseAdanaTarget('田中さんのあだ名', master), { kind: 'other', name: '田中さん' });
	assert.deepEqual(parseAdanaTarget('わたしのあだ名', master), { kind: 'self' });
	assert.deepEqual(parseAdanaTarget('マスターのあだ名'), { kind: 'self' }, '使わない設定なら、敬称が無いので本人');
	assert.deepEqual(parseAdanaTarget('マスターさんのあだ名'), { kind: 'other', name: 'マスターさん' }, '使わない設定なら、ほかの人');
});

const MASTER = { id: 'm1', username: 'boss', host: null };

async function setup(settings) {
	const require = createRequire(ROOT);
	const loki = require('lokijs');
	const config = (await import('../built/config.js')).default;
	const serifs = (await import('../built/serifs.js')).default;
	const Friend = (await import('../built/friend.js')).default;
	const Talk = (await import('../built/modules/talk/index.js')).default;

	const saved = {};
	for (const [key, value] of Object.entries(settings)) { saved[key] = config[key]; config[key] = value; }
	const restore = () => { for (const [key, value] of Object.entries(saved)) config[key] = value; };

	const db = new loki('test.json');
	const cols = {};
	const getCollection = name => cols[name] ?? (cols[name] = db.addCollection(name));
	const calls = { posts: [], chats: [], subscribed: [] };
	const ai = {
		moduleData: getCollection('moduleData'),
		friends: getCollection('friends'),
		getCollection,
		log: () => {},
		subscribeReply: (module, key, isChat, id, data) => calls.subscribed.push({ key, isChat, id, data }),
		unsubscribeReply: () => {},
		api: async (endpoint, param) => {
			assert.equal(endpoint, 'users/show');
			assert.deepEqual(param, { username: 'boss' });
			return MASTER;
		},
		post: async param => { if (calls.failPost) throw new Error('post failed'); calls.posts.push(param); return { id: 'post' }; },
		sendMessage: async (userId, param) => { calls.chats.push({ userId, ...param }); return { id: 'chat' }; },
	};
	ai.lookupFriend = userId => { const doc = ai.friends.findOne({ userId }); return doc ? new Friend(ai, { doc }) : null; };
	const mod = new Talk();
	mod.init(ai);

	return { config, serifs, mod, ai, calls, restore };
}

/** 頼んだ人の投稿(またはチャット)。friend は本物の Friend にして、記録が残ることを確かめる */
function message(ai, text, replies, { user = { id: 'u1', username: 'alice', host: null }, isChat = false, visibility = 'public' } = {}) {
	const doc = ai.friends.findOne({ userId: user.id }) ?? ai.friends.insertOne({ userId: user.id, user });
	const friend = ai.lookupFriend(user.id);
	friend.doc = doc;
	return {
		id: 'note1', text, extractedText: text, userId: user.id, user, isChat, visibility, friend,
		includes: words => words.some(word => text.includes(word)),
		reply: async t => { replies.push(t); return { id: 'reply' + replies.length }; },
	};
}

const tick = () => new Promise(r => setTimeout(r, 0));

test('メンション: 頼んだ人の投稿への返信で、マスターにメンションする。呼び名にする設定なら、マスターの呼び名にする', { skip: !hasConfig && 'config.json がない' }, async () => {
	const { mod, ai, calls, serifs, restore } = await setup({ master: 'boss', masterNicknameNames: ['マスター'], masterNicknameNotify: 'mention', masterNicknameUpdateName: true });
	try {
		const replies = [];
		assert.deepEqual(mod.adana(message(ai, 'マスターのあだ名考えて', replies, { visibility: 'home' })), { reaction: '🙌' });
		await tick();

		assert.equal(calls.posts.length, 1);
		const post = calls.posts[0];
		const item = post.text.match(/「(.+?)」とかいかがでしょうか/)?.[1];
		assert.ok(item, post.text);
		assert.deepEqual(post, { replyId: 'note1', text: serifs.core.adanaMasterMention('@boss', 'aliceさん', item, true), visibility: 'home', visibleUserIds: undefined });
		assert.deepEqual(replies, [], '返信はメンションの投稿だけ');
		assert.deepEqual(calls.chats, []);
		assert.deepEqual(calls.subscribed, [], '待ち受けない(一発)');
		assert.equal(ai.lookupFriend('m1').name, item, 'マスターの呼び名にする');
	} finally { restore(); }
});

test('メンション: フォロワー限定・チャットで頼まれたら、頼んだ人とマスターだけのダイレクト投稿にする', { skip: !hasConfig && 'config.json がない' }, async () => {
	const { mod, ai, calls, restore } = await setup({ master: 'boss', masterNicknameNames: ['マスター'], masterNicknameNotify: 'mention', masterNicknameUpdateName: false, masterNicknameIntervalHours: 0 });
	try {
		mod.adana(message(ai, 'マスターのあだ名', [], { visibility: 'followers' }));
		await tick();
		assert.equal(calls.posts[0].visibility, 'specified');
		assert.deepEqual(calls.posts[0].visibleUserIds, ['u1', 'm1']);
		assert.equal(calls.posts[0].replyId, 'note1');
		assert.equal(ai.lookupFriend('m1'), null, '呼び名にしない設定なら、マスターの記録も作らない');

		mod.adana(message(ai, 'マスターのあだ名', [], { user: { id: 'u2', username: 'bob', host: 'remote.example' }, isChat: true }));
		await tick();
		assert.equal(calls.posts[1].visibility, 'specified');
		assert.deepEqual(calls.posts[1].visibleUserIds, ['u2', 'm1']);
		assert.equal(calls.posts[1].replyId, undefined);
		assert.ok(calls.posts[1].text.startsWith('@bob@remote.example @boss '), calls.posts[1].text);
	} finally { restore(); }
});

test('チャット: マスターにチャットで伝え、頼んだ人には「伝えておきます」と返す', { skip: !hasConfig && 'config.json がない' }, async () => {
	const { mod, ai, calls, serifs, restore } = await setup({ master: 'boss', masterNicknameNames: ['マスター'], masterNicknameNotify: 'chat', masterNicknameUpdateName: false });
	try {
		const replies = [];
		const msg = message(ai, 'マスターさんのあだ名', replies);
		msg.friend.updateName('アリス');
		mod.adana(msg);
		await tick();

		assert.equal(calls.chats.length, 1);
		const item = calls.chats[0].text.match(/「(.+?)」とかいかがでしょうか/)?.[1];
		assert.deepEqual(calls.chats[0], { userId: 'm1', text: serifs.core.adanaMasterToMaster('アリス', item, false) }, '頼んだ人は、藍の呼び名で書く');
		assert.deepEqual(replies, [serifs.core.adanaMasterToSender(item)]);
		assert.deepEqual(calls.posts, []);
	} finally { restore(); }
});

test('伝えない設定で呼び名にするなら、マスターにはチャットで、呼び名を変えたことを知らせる', { skip: !hasConfig && 'config.json がない' }, async () => {
	const { mod, ai, calls, serifs, restore } = await setup({ master: 'boss', masterNicknameNames: ['マスター'], masterNicknameNotify: 'off', masterNicknameUpdateName: true });
	try {
		const replies = [];
		mod.adana(message(ai, 'マスターのあだ名', replies));
		await tick();
		const item = ai.lookupFriend('m1').name;
		assert.deepEqual(calls.chats, [{ userId: 'm1', text: serifs.core.adanaMasterRenamedToMaster('aliceさん', item) }]);
		assert.deepEqual(replies, [serifs.core.adanaMasterRenamedToSender(item)]);
	} finally { restore(); }
});

test('制限: 同じ人の2回目は「また明日」、ほかの人でも間隔内なら次に伝えられる時刻を添える。どちらも、あだ名は考えて返す', { skip: !hasConfig && 'config.json がない' }, async () => {
	const { mod, ai, calls, restore } = await setup({ master: 'boss', masterNicknameNames: ['マスター'], masterNicknameNotify: 'mention', masterNicknameUpdateName: false });
	try {
		const before = Date.now();
		mod.adana(message(ai, 'マスターのあだ名', []));
		await tick();
		assert.equal(calls.posts.length, 1);

		const again = [];
		mod.adana(message(ai, 'マスターのあだ名', again));
		await tick();
		assert.equal(calls.posts.length, 1, '伝えない');
		assert.match(again[0], /^マスターのあだ名は、「.+」とかどうでしょう？ ・・・あっ、今日はもう、マスターに伝えたんでした！ また明日、お願いしますね$/);

		const other = [];
		mod.adana(message(ai, 'マスターのあだ名', other, { user: { id: 'u2', username: 'bob', host: null } }));
		await tick();
		assert.equal(calls.posts.length, 1, '伝えない');
		const nextAt = Number(other[0].match(/\$\[unixtime (\d+)\]/)?.[1]);
		assert.ok(nextAt >= Math.floor((before + 3 * HOUR) / 1000) && nextAt <= Math.ceil((Date.now() + 3 * HOUR) / 1000), other[0]);
		assert.match(other[0], /さっき伝えたばかりでした/);
	} finally { restore(); }
});

test('伝えられなかったら、記録を元に戻して、そう答える', { skip: !hasConfig && 'config.json がない' }, async () => {
	const { mod, ai, calls, restore } = await setup({ master: 'boss', masterNicknameNames: ['マスター'], masterNicknameNotify: 'mention', masterNicknameUpdateName: true });
	try {
		calls.failPost = true;
		const replies = [];
		mod.adana(message(ai, 'マスターのあだ名', replies));
		await tick(); await tick();
		assert.match(replies[0], /うまく伝えられませんでした/);
		assert.equal(ai.lookupFriend('m1'), null, '呼び名も変えない');

		calls.failPost = false;
		mod.adana(message(ai, 'マスターのあだ名', []));
		await tick();
		assert.equal(calls.posts.length, 1, '回数も間隔も使っていないので、すぐ頼み直せる');
	} finally { restore(); }
});

test('マスター本人が言ったときは、本人のあだ名として聞く', { skip: !hasConfig && 'config.json がない' }, async () => {
	const { mod, ai, calls, restore } = await setup({ master: 'boss', masterNicknameNames: ['マスター'], masterNicknameNotify: 'mention', masterNicknameUpdateName: true });
	try {
		const replies = [];
		mod.adana(message(ai, 'マスターのあだ名', replies, { user: MASTER }));
		await tick();
		assert.match(replies[0], /とお呼びしてもいいですか？$/);
		assert.deepEqual(calls.posts, []);
		assert.equal(calls.subscribed.length, 1);
	} finally { restore(); }
});
