// トーク: マスターのあだ名(src/modules/talk/master-nickname.ts、nickname.ts の parseAdanaTarget、talk モジュールの adanaForMaster)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolveMasterNicknameSettings, checkMasterNicknameLimit, nextMasterNicknameUserRecord, describeRequester, masterLabel, masterMentionVisibility } from '../built/modules/talk/master-nickname.js';
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
		username: 'm', names: [], notify: 'mention', mentionVisibility: 'public', updateName: false, perUserDaily: 1, interval: 3 * HOUR,
	});
	assert.deepEqual(resolveMasterNicknameSettings({
		master: 'm', masterNicknameNames: ['マスター', '', 1, 'ご主人'], masterNicknameNotify: 'off', masterNicknameUpdateName: true,
		masterNicknamePerUserDaily: '2', masterNicknameIntervalHours: '0.5',
	}), {
		username: 'm', names: ['マスター', 'ご主人'], notify: 'off', mentionVisibility: 'public', updateName: true, perUserDaily: 2, interval: 0.5 * HOUR,
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

test('頼んだ人は「表示名(@ユーザー名)」。表示名が無い・ユーザー名と同じなら「@ユーザー名」、別のサーバーなら「@ユーザー名@サーバー」', () => {
	assert.equal(describeRequester({ username: 'alice', name: 'アリス' }), 'アリス(@alice)');
	assert.equal(describeRequester({ username: 'alice', name: null }), '@alice');
	assert.equal(describeRequester({ username: 'alice' }), '@alice');
	assert.equal(describeRequester({ username: 'alice', name: 'Alice' }), '@alice', 'ユーザー名と同じ(大文字小文字は問わない)');
	assert.equal(describeRequester({ username: 'bob', host: 'remote.example', name: 'ボブ' }), 'ボブ(@bob@remote.example)');
	assert.equal(describeRequester({ username: 'bob', host: 'remote.example' }), '@bob@remote.example');
});

test('頼んだ人の表示名は、メンション・MFM・URL・絵文字コード・改行を無効にして、20文字までに切る', () => {
	const name = text => describeRequester({ username: 'alice', name: text });
	assert.equal(name('たろう:custom_emoji:'), 'たろう(@alice)', '絵文字コードは除く');
	assert.equal(name(':a@remote.example:たろう'), 'たろう(@alice)');
	assert.equal(name('@boss に注目'), '＠boss に注目(@alice)', 'メンションにならない');
	assert.equal(name('$[x4 たろう]'), '＄［x4 たろう］(@alice)', 'MFM にならない');
	assert.ok(!name('<plain>x</plain> `code` **b** ~~s~~ #tag [l](u)').match(/[<>`*~#\[\]]|\(u\)/), '記号は全角');
	assert.ok(!name('https://evil.example/').includes('://'), 'URL にならない');
	assert.equal(name('一行目\n二行目\r\n三行目'), '一行目 二行目 三行目(@alice)');
	assert.equal(name('あ'.repeat(25)), 'あ'.repeat(20) + '…(@alice)');
	assert.equal(name('😀'.repeat(21)), '😀'.repeat(20) + '…(@alice)', '絵文字は1文字として数える');
	assert.equal(name(':only_emoji:'), '@alice', '表示名が残らなければ、ユーザー名だけ');
	assert.equal(name('   '), '@alice');
});

test('通知と返事でマスターを呼ぶ言い方は、masterNicknameNames の先頭。無ければ「マスター」', { skip: !hasConfig && 'config.json がない' }, async () => {
	assert.equal(masterLabel({ names: ['ご主人', 'マスター'] }), 'ご主人');
	assert.equal(masterLabel({ names: [] }), 'マスター');

	const { mod, ai, calls, serifs, restore } = await setup({ master: 'boss', masterNicknameNames: ['ご主人', 'マスター'], masterNicknameNotify: 'chat', masterNicknameUpdateName: false, masterNicknamePerUserDaily: 0, masterNicknameIntervalHours: 0 });
	try {
		const replies = [];
		mod.adana(message(ai, 'マスターのあだ名', replies));
		await tick();
		const item = calls.chats[0].text.match(/「(.+?)」とかいかがでしょうか/)?.[1];
		assert.equal(calls.chats[0].text, serifs.core.adanaMasterToMaster('@alice', item, 'ご主人'));
		assert.match(calls.chats[0].text, /^@aliceに頼まれて、ご主人のあだ名を考えました！/);
		assert.deepEqual(replies, [`ご主人のあだ名は、「${item}」とかどうでしょう？ ご主人に伝えておきました！`]);

		// 制限・失敗のときも同じ言い方
		const limit = [];
		ai.sendMessage = async () => { throw new Error('chat failed'); };
		mod.adana(message(ai, 'ご主人のあだ名', limit));
		await tick();
		assert.match(limit[0], /^ご主人のあだ名は、「.+」とかどうでしょう？ ・・・あれ、ご主人にうまく伝えられませんでした・・・$/);
	} finally { restore(); }
});

test('メンションの公開範囲は、頼まれた投稿と上限の狭いほう。フォロワー限定はダイレクトにする', () => {
	const table = [
		// [頼まれた投稿, 上限 public, 上限 home, 上限 specified]
		['public', 'public', 'home', 'specified'],
		['home', 'home', 'home', 'specified'],
		['followers', 'specified', 'specified', 'specified'],
		['specified', 'specified', 'specified', 'specified'],
	];
	for (const [requested, ...expected] of table) {
		assert.deepEqual(['public', 'home', 'specified'].map(max => masterMentionVisibility(requested, max)), expected, requested);
	}
});

test('マスターに伝える間隔は分で指定する。以前の時間の指定も使える(分があれば分が先)', () => {
	const interval = config => resolveMasterNicknameSettings({ master: 'm', masterNicknameNotify: 'mention', ...config }).interval;
	const MINUTE = 60 * 1000;
	assert.equal(interval({}), 180 * MINUTE, '既定は180分(3時間)');
	assert.equal(interval({ masterNicknameIntervalMinutes: 30 }), 30 * MINUTE);
	assert.equal(interval({ masterNicknameIntervalMinutes: '45' }), 45 * MINUTE, '文字列でもよい');
	assert.equal(interval({ masterNicknameIntervalMinutes: 0 }), 0, '0 は制限しない');
	assert.equal(interval({ masterNicknameIntervalHours: 2 }), 120 * MINUTE, '以前の時間の指定');
	assert.equal(interval({ masterNicknameIntervalHours: 0.5 }), 30 * MINUTE);
	assert.equal(interval({ masterNicknameIntervalMinutes: 10, masterNicknameIntervalHours: 5 }), 10 * MINUTE, '分が先');
	assert.equal(interval({ masterNicknameIntervalMinutes: 0, masterNicknameIntervalHours: 5 }), 0, '分が 0 なら 0');
	assert.equal(interval({ masterNicknameIntervalMinutes: -1 }), 180 * MINUTE, '負の数は既定値');
	assert.equal(interval({ masterNicknameIntervalMinutes: 'abc', masterNicknameIntervalHours: 1 }), 60 * MINUTE, '分が使えない値なら、時間の指定を見る');
});

test('メンションの公開範囲の上限の設定: 既定は public(これまでどおり)。知らない値は既定', () => {
	const visibility = value => resolveMasterNicknameSettings({ master: 'm', masterNicknameNotify: 'mention', masterNicknameMentionVisibility: value }).mentionVisibility;
	assert.equal(visibility(undefined), 'public');
	assert.equal(visibility('public'), 'public');
	assert.equal(visibility('home'), 'home');
	assert.equal(visibility('specified'), 'specified');
	assert.equal(visibility('followers'), 'public', 'followers は選べない(藍がフォローされているとは限らないため)');
	assert.equal(visibility('unknown'), 'public');
});

test('メンション: 公開で頼まれたら、既定では公開のまま。上限を決めると、そこまでに狭める', { skip: !hasConfig && 'config.json がない' }, async () => {
	for (const [cap, expected] of [[undefined, 'public'], ['public', 'public'], ['home', 'home'], ['specified', 'specified']]) {
		const { mod, ai, calls, restore } = await setup({ master: 'boss', masterNicknameNames: ['マスター'], masterNicknameNotify: 'mention', masterNicknameMentionVisibility: cap, masterNicknamePerUserDaily: 0, masterNicknameIntervalHours: 0 });
		try {
			mod.adana(message(ai, 'マスターのあだ名', [], { visibility: 'public' }));
			await tick();
			assert.equal(calls.posts[0].visibility, expected, `上限 ${cap}`);
			assert.deepEqual(calls.posts[0].visibleUserIds, expected === 'specified' ? ['u1', 'm1'] : undefined);
			assert.equal(calls.posts[0].replyId, 'note1', '頼んだ人の投稿への返信');
		} finally { restore(); }
	}
});

const tick = () => new Promise(r => setTimeout(r, 0));

test('メンション: 頼んだ人の投稿への返信で、マスターにメンションする。呼び名にする設定なら、マスターの呼び名にする', { skip: !hasConfig && 'config.json がない' }, async () => {
	const { mod, ai, calls, serifs, restore } = await setup({ master: 'boss', masterNicknameNames: ['マスター'], masterNicknameNotify: 'mention', masterNicknameUpdateName: true });
	try {
		const replies = [];
		assert.deepEqual(mod.adana(message(ai, 'マスターのあだ名考えて', replies, { visibility: 'home' })), { reaction: '🙌' });
		await tick();

		assert.equal(calls.posts.length, 1);
		const post = calls.posts[0];
		const item = post.text.match(/呼び名を「(.+?)」にしました/)?.[1];
		assert.ok(item, post.text);
		assert.deepEqual(post, { replyId: 'note1', text: serifs.core.adanaMasterRenamedMention('@boss', '@alice', item, 'マスター'), visibility: 'home', visibleUserIds: undefined });
		assert.ok(!post.text.includes('いかがでしょうか'), '呼び名にするなら、提案の聞き方はしない');
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

test('メンション: チャットで頼まれたら、チャットにも「伝えておきました」と返す。返事が失敗しても、伝えたことにする', { skip: !hasConfig && 'config.json がない' }, async () => {
	const { mod, ai, calls, serifs, restore } = await setup({ master: 'boss', masterNicknameNames: ['マスター'], masterNicknameNotify: 'mention', masterNicknameUpdateName: false, masterNicknameIntervalHours: 0, masterNicknamePerUserDaily: 0 });
	try {
		const replies = [];
		mod.adana(message(ai, 'マスターのあだ名', replies, { isChat: true }));
		await tick();
		const item = calls.posts[0].text.match(/「(.+?)」とかいかがでしょうか/)?.[1];
		assert.deepEqual(replies, [serifs.core.adanaMasterToSender(item, 'マスター')]);

		const notChat = [];
		mod.adana(message(ai, 'マスターのあだ名', notChat));
		await tick();
		assert.deepEqual(notChat, [], '投稿で頼まれたときは、メンションの投稿が返事なので、ほかには返さない');

		const failing = message(ai, 'マスターのあだ名', [], { isChat: true });
		failing.reply = async () => { throw new Error('chat failed'); };
		mod.adana(failing);
		await tick();
		assert.equal(calls.posts.length, 3, 'マスターには伝えている');
		assert.equal(failing.friend.getPerModulesData(mod).masterNickname?.count, 3, '頼んだ3回とも数える(返事の失敗で記録を戻さない)');
	} finally { restore(); }
});

test('メンション: チャットで頼まれ、呼び名にする設定なら、「呼び名にしてみました」と返す', { skip: !hasConfig && 'config.json がない' }, async () => {
	const { mod, ai, calls, serifs, restore } = await setup({ master: 'boss', masterNicknameNames: ['マスター'], masterNicknameNotify: 'mention', masterNicknameUpdateName: true });
	try {
		const replies = [];
		mod.adana(message(ai, 'マスターのあだ名', replies, { isChat: true }));
		await tick();
		const item = ai.lookupFriend('m1').name;
		assert.deepEqual(replies, [serifs.core.adanaMasterRenamedToSender(item, 'マスター')]);
		assert.equal(calls.posts.length, 1);
	} finally { restore(); }
});

test('チャット: マスターにチャットで伝え、頼んだ人には「伝えておきました」と返す', { skip: !hasConfig && 'config.json がない' }, async () => {
	const { mod, ai, calls, serifs, restore } = await setup({ master: 'boss', masterNicknameNames: ['マスター'], masterNicknameNotify: 'chat', masterNicknameUpdateName: false });
	try {
		const replies = [];
		const msg = message(ai, 'マスターさんのあだ名', replies, { user: { id: 'u1', username: 'alice', host: null, name: 'アリス' } });
		msg.friend.updateName('ポテト');
		mod.adana(msg);
		await tick();

		assert.equal(calls.chats.length, 1);
		const item = calls.chats[0].text.match(/「(.+?)」とかいかがでしょうか/)?.[1];
		assert.deepEqual(calls.chats[0], { userId: 'm1', text: serifs.core.adanaMasterToMaster('アリス(@alice)', item, 'マスター') }, '頼んだ人は、表示名とユーザー名で書く(藍が付けた呼び名「ポテト」ではなく)');
		assert.deepEqual(replies, [serifs.core.adanaMasterToSender(item, 'マスター')]);
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
		assert.deepEqual(calls.chats, [{ userId: 'm1', text: serifs.core.adanaMasterRenamedToMaster('@alice', item, 'マスター') }]);
		assert.deepEqual(replies, [serifs.core.adanaMasterRenamedToSender(item, 'マスター')]);
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

test('マスターに伝えたあとの失敗(頼んだ人への返事・呼び名の変更)は、伝えられなかったことにしない', { skip: !hasConfig && 'config.json がない' }, async () => {
	// チャットで伝える設定。マスターへのチャットは届き、頼んだ人への返事が失敗する
	{
		const { mod, ai, calls, restore } = await setup({ master: 'boss', masterNicknameNames: ['マスター'], masterNicknameNotify: 'chat', masterNicknameUpdateName: true, masterNicknameIntervalMinutes: 0 });
		try {
			const replies = [];
			const failing = message(ai, 'マスターのあだ名', replies);
			failing.reply = async t => { replies.push(t); throw new Error('reply failed'); };
			mod.adana(failing);
			await tick(); await tick();
			assert.equal(calls.chats.length, 1, 'マスターには届いている');
			assert.equal(replies.length, 1, '「伝えられませんでした」とは答え直さない');
			assert.ok(!replies[0].includes('うまく伝えられませんでした'));
			assert.ok(ai.lookupFriend('m1')?.name, '呼び名は変える(返事の失敗で、変え損ねない)');

			const again = [];
			mod.adana(message(ai, 'マスターのあだ名', again));
			await tick();
			assert.match(again[0], /今日はもう、マスターに伝えたんでした/, '回数の記録は戻さない');
			assert.equal(calls.chats.length, 1);
		} finally { restore(); }
	}

	// メンションで伝える設定。呼び名の変更が失敗する
	{
		const { mod, ai, calls, restore } = await setup({ master: 'boss', masterNicknameNames: ['マスター'], masterNicknameNotify: 'mention', masterNicknameUpdateName: true, masterNicknameIntervalMinutes: 0 });
		try {
			const replies = [];
			const msg = message(ai, 'マスターのあだ名', replies);
			const lookup = ai.lookupFriend;
			ai.lookupFriend = userId => userId === 'm1' ? { updateName() { throw new Error('save failed'); } } : lookup(userId);
			mod.adana(msg);
			await tick(); await tick();
			assert.equal(calls.posts.length, 1, 'マスターには届いている');
			assert.deepEqual(replies, [], '投稿で頼まれたら、メンションの投稿が返事。「伝えられませんでした」とは答えない');
		} finally { restore(); }
	}
});

test('マスターに伝えられなかったときの返事が失敗しても、未処理のエラーにしない。回数の記録は戻す', { skip: !hasConfig && 'config.json がない' }, async () => {
	const { mod, ai, calls, restore } = await setup({ master: 'boss', masterNicknameNames: ['マスター'], masterNicknameNotify: 'mention', masterNicknameUpdateName: false });
	const unhandled = [];
	const onUnhandled = err => unhandled.push(err);
	process.on('unhandledRejection', onUnhandled);
	try {
		calls.failPost = true;
		const msg = message(ai, 'マスターのあだ名', []);
		msg.reply = async () => { throw new Error('reply failed'); };
		mod.adana(msg);
		await tick(); await tick(); await tick();
		assert.deepEqual(unhandled, []);

		calls.failPost = false;
		mod.adana(message(ai, 'マスターのあだ名', []));
		await tick();
		assert.equal(calls.posts.length, 1, '記録は戻っているので、すぐ頼み直せる');
	} finally { process.off('unhandledRejection', onUnhandled); restore(); }
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

test('呼び名にする設定なら、チャットでも「いかがでしょうか」と聞かず、決まったこととして伝える。しない設定なら提案', { skip: !hasConfig && 'config.json がない' }, async () => {
	const on = await setup({ master: 'boss', masterNicknameNames: ['マスター'], masterNicknameNotify: 'chat', masterNicknameUpdateName: true });
	try {
		const replies = [];
		on.mod.adana(message(on.ai, 'マスターのあだ名', replies));
		await tick();
		const item = on.ai.lookupFriend('m1').name;
		assert.deepEqual(on.calls.chats, [{ userId: 'm1', text: on.serifs.core.adanaMasterRenamedToMaster('@alice', item, 'マスター') }]);
		assert.deepEqual(replies, [on.serifs.core.adanaMasterRenamedToSender(item, 'マスター')]);
		for (const text of [on.calls.chats[0].text, replies[0]]) assert.ok(!/いかがでしょうか|どうでしょう/.test(text), text);
	} finally { on.restore(); }

	const off = await setup({ master: 'boss', masterNicknameNames: ['マスター'], masterNicknameNotify: 'mention', masterNicknameUpdateName: false });
	try {
		off.mod.adana(message(off.ai, 'マスターのあだ名', []));
		await tick();
		assert.match(off.calls.posts[0].text, /^@boss @aliceに頼まれて、マスターのあだ名を考えました！ 「.+」とかいかがでしょうか？$/);
	} finally { off.restore(); }
});
