// マスターのあだ名: コマンドと、マスターの表示名の変更(src/modules/master-nickname/index.ts、talk モジュールとのつなぎ)
// Misskey とのやりとり(masterApi・fetchApiSpec・publicApi)は、Object.defineProperty で差し替える
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { miauthUrl, checkMiAuth } from '../built/modules/master-nickname/miauth.js';

const ROOT = new URL('..', import.meta.url).pathname;
const hasConfig = existsSync(ROOT + 'config.json');
const SPEC = JSON.parse(readFileSync(new URL('./fixtures/misskey-api-permissions.json', import.meta.url), 'utf8'));
const MASTER = { id: 'm1', username: 'boss', host: null, name: 'ボス' };
const ALICE = { id: 'u1', username: 'alice', host: null, name: 'アリス' };
const tick = () => new Promise(r => setTimeout(r, 0));

function httpError(statusCode, code) {
	return Object.assign(new Error(`Response code ${statusCode}`), { name: 'HTTPError', response: { statusCode, body: JSON.stringify({ error: { code } }) } });
}

/**
 * マスターのトークンで呼ぶ API の偽物。権限は read:account・write:account だけ(ほかは PERMISSION_DENIED)。
 * i/update は、型の違う値なら INVALID_PARAM、正しければ表示名を変える
 */
function masterServer(state) {
	return async (endpoint, params = {}) => {
		state.calls.push({ endpoint, params });
		if (state.fail?.[endpoint]) throw state.fail[endpoint];
		if (endpoint === 'i') return { ...MASTER, name: state.name };
		if (endpoint === 'i/apps') throw httpError(403, 'ACCESS_DENIED');
		if (endpoint === 'i/update') {
			if (params.name != null && typeof params.name === 'object') throw httpError(400, 'INVALID_PARAM');
			state.name = params.name;
			return { ...MASTER, name: state.name };
		}
		throw httpError(403, 'PERMISSION_DENIED');
	};
}

async function setup(settings = {}) {
	const require = createRequire(ROOT);
	const loki = require('lokijs');
	const config = (await import('../built/config.js')).default;
	const serifs = (await import('../built/serifs.js')).default;
	const Friend = (await import('../built/friend.js')).default;
	const Nickname = (await import('../built/modules/master-nickname/index.js')).default;
	const Talk = (await import('../built/modules/talk/index.js')).default;

	const saved = {};
	const all = { master: 'boss', masterNicknameNames: ['ご主人'], masterNicknameNotify: 'chat', masterNicknameUpdateName: false, masterNicknamePerUserDaily: 0, masterNicknameIntervalMinutes: 0, masterNicknameIntervalHours: undefined, masterNicknameMentionVisibility: undefined, masterRenameEnabled: true, masterRenameMode: undefined, masterRenameApprovalMinutes: undefined, ...settings };
	for (const [key, value] of Object.entries(all)) { saved[key] = config[key]; config[key] = value; }
	const restore = () => { for (const [key, value] of Object.entries(saved)) config[key] = value; };

	const db = new loki('test.json');
	const cols = {};
	const getCollection = name => cols[name] ?? (cols[name] = db.addCollection(name));
	const state = { name: 'ボス', calls: [], chats: [], fail: {} };
	const ai = {
		moduleData: getCollection('moduleData'),
		friends: getCollection('friends'),
		getCollection,
		log: () => {},
		subscribeReply: () => {},
		unsubscribeReply: () => {},
		api: async (endpoint, param) => {
			if (endpoint === 'users/show') return MASTER;
			throw new Error(`unexpected ${endpoint}`);
		},
		post: async () => ({ id: 'post' }),
		sendMessage: async (userId, param) => {
			if (state.failChat) throw new Error('chat failed');
			state.chats.push({ userId, ...param });
			return { id: 'chat' };
		},
	};
	ai.lookupFriend = userId => { const doc = ai.friends.findOne({ userId }); return doc ? new Friend(ai, { doc }) : null; };

	const nickname = new Nickname();
	const talk = new Talk();
	ai.modules = [nickname, talk];
	nickname.init(ai);
	talk.init(ai);
	Object.defineProperty(nickname, 'masterApi', { value: masterServer(state), configurable: true, writable: true });
	Object.defineProperty(nickname, 'fetchApiSpec', { value: async () => SPEC, configurable: true, writable: true });
	Object.defineProperty(nickname, 'publicApi', { value: async () => ({ ok: false }), configurable: true, writable: true });

	return { config, serifs, nickname, talk, ai, state, restore };
}

/** マスター(または、ほかの人)のチャットか投稿 */
function message(ai, text, replies, { user = MASTER, isChat = true } = {}) {
	const doc = ai.friends.findOne({ userId: user.id }) ?? ai.friends.insertOne({ userId: user.id, user });
	const friend = ai.lookupFriend(user.id);
	friend.doc = doc;
	return {
		id: 'note1', text, extractedText: text, userId: user.id, user, isChat, visibility: 'public', friend,
		includes: words => words.some(word => text.includes(word)),
		reply: async t => { replies.push(t); return { id: 'reply' + replies.length }; },
	};
}

/** トークンを受け取ったことにして、確かめる(MiAuth の受け取りの代わり) */
async function withToken(nickname, ai) {
	const replies = [];
	await nickname.receiveToken(message(ai, '', replies), 'TOKEN');
	return replies;
}

test('許可の URL: 求める権限は read:account と write:account だけ', () => {
	const url = new URL(miauthUrl('https://misskey.example/', 'session-1'));
	assert.equal(url.origin + url.pathname, 'https://misskey.example/miauth/session-1');
	assert.equal(url.searchParams.get('permission'), 'read:account,write:account');
	assert.ok(url.searchParams.get('name').length > 0);
});

test('許可の受け取り: 許可されていなければ null、されていればトークンと持ち主', async () => {
	const calls = [];
	assert.equal(await checkMiAuth(async endpoint => { calls.push(endpoint); return { ok: false }; }, 's1'), null);
	assert.deepEqual(calls, ['miauth/s1/check']);
	assert.deepEqual(await checkMiAuth(async () => ({ ok: true, token: 'T', user: { id: 'm1', username: 'boss' } }), 's1'), { token: 'T', user: { id: 'm1', username: 'boss' } });
	assert.equal(await checkMiAuth(async () => ({ ok: true }), 's1'), null, 'トークンが無ければ null');
});

test('コマンドは、マスター本人だけ。ほかの人のものは無視する', { skip: !hasConfig && 'config.json がない' }, async () => {
	const { nickname, ai, restore } = await setup();
	try {
		const replies = [];
		assert.equal(await nickname.mentionHook(message(ai, '/nickname off', replies, { user: ALICE })), false);
		assert.deepEqual(replies, []);
		assert.notEqual(nickname.settings(), null);
	} finally { restore(); }
});

test('設定のコマンド: config.json より優先し、reset で戻す', { skip: !hasConfig && 'config.json がない' }, async () => {
	const { nickname, ai, restore } = await setup({ masterNicknameNotify: 'mention' });
	try {
		const run = async text => { const replies = []; assert.equal(await nickname.mentionHook(message(ai, text, replies)), true, text); return replies[0]; };
		assert.equal(nickname.settings().notify, 'mention');

		assert.equal(await run('/nickname notify chat'), '伝え方を chat にしました');
		await run('/nickname callname on');
		await run('/nickname visibility home');
		await run('/nickname daily 2');
		await run('/nickname interval 30');
		const settings = nickname.settings();
		assert.equal(settings.notify, 'chat');
		assert.equal(settings.updateName, true);
		assert.equal(settings.mentionVisibility, 'home');
		assert.equal(settings.perUserDaily, 2);
		assert.equal(settings.interval, 30 * 60 * 1000);

		await run('/nickname off');
		assert.equal(nickname.settings(), null, 'off なら使わない');
		assert.match(await run('/nickname status'), /^マスターのあだ名: 使わない\(\/nickname off\)/);

		const talkReplies = [];
		ai.modules[1].adana(message(ai, 'ご主人のあだ名', talkReplies, { user: ALICE, isChat: false }));
		await tick();
		assert.match(talkReplies[0], /^ご主人のあだ名は、「.+」とかいかがでしょうか？$/, 'off なら、talk でもマスターのあだ名として扱わない(ほかの人の提案)');

		assert.match(await run('/nickname reset'), /config\.json の値に戻しました/);
		assert.equal(nickname.settings().notify, 'mention');
		assert.equal(nickname.settings().interval, 0);

		assert.match(await run('/nickname notify all'), /^書き方:/);
		assert.match(await run('/nickname'), /\/nickname status/);
	} finally { restore(); }
});

test('コマンドは、どれもチャットだけ(投稿への返信は公開になることがある)。config.json で使えるようにしていなければ、表示名の変更は使えない', { skip: !hasConfig && 'config.json がない' }, async () => {
	{
		const { nickname, ai, restore } = await setup();
		try {
			for (const text of ['/nickname status', '/nickname off', '/nickname rename setup', '/nickname']) {
				const replies = [];
				assert.equal(await nickname.mentionHook(message(ai, text, replies, { isChat: false })), true, text);
				assert.deepEqual(replies, ['/nickname のコマンドは、チャットで送ってください'], text);
			}
			assert.notEqual(nickname.settings(), null, '投稿で送った off は効かない');
		} finally { restore(); }
	}
	{
		const { nickname, ai, restore } = await setup({ masterRenameEnabled: false });
		try {
			const replies = [];
			await nickname.mentionHook(message(ai, '/nickname rename on', replies));
			assert.match(replies[0], /masterRenameEnabled が true のときだけ/);
			assert.equal(nickname.renameActive(), false);
		} finally { restore(); }
	}
});

test('オンにするには、使える許可(トークン)が要る。初期状態はオフ', { skip: !hasConfig && 'config.json がない' }, async () => {
	const { nickname, ai, restore } = await setup();
	try {
		const run = async text => { const replies = []; await nickname.mentionHook(message(ai, text, replies)); return replies[0]; };
		assert.match(await run('/nickname rename on'), /許可\(トークン\)がまだありません/);

		assert.deepEqual(await withToken(nickname, ai), ['許可を受け取りました。/nickname rename on で、表示名の変更をオンにできます']);
		assert.equal(nickname.renameActive(), false, '受け取っただけでは、オフのまま');
		assert.match(await run('/nickname rename on'), /表示名の変更をオンにしました\(承認してから変えます。60分以内\)/);
		assert.equal(nickname.renameActive(), true);
		assert.match(await run('/nickname status'), /表示名の変更: オン\(承認してから変える。60分以内\)\n許可\(トークン\): 使える/);
		assert.match(await run('/nickname rename off'), /オフにしました/);
		assert.equal(nickname.renameActive(), false);
	} finally { restore(); }
});

test('使えない許可(要らない権限・ほかの人のもの)は残さず、理由を返す', { skip: !hasConfig && 'config.json がない' }, async () => {
	const { nickname, ai, state, restore } = await setup();
	try {
		// write:notes も持つトークン(notes/create が、パラメーターの検査まで進む)
		const server = masterServer(state);
		Object.defineProperty(nickname, 'masterApi', { value: async (endpoint, params = {}) => {
			if (endpoint === 'notes/create') throw httpError(400, 'INVALID_PARAM');
			return server(endpoint, params);
		} });
		const replies = await withToken(nickname, ai);
		assert.match(replies[0], /^この許可は使えません: 要らない権限があります: write:notes\nMisskey の設定の「連携」/);
		assert.equal(nickname.rename().token, undefined, 'トークンは残さない');
		assert.match(state.chats.at(-1).text, /^表示名の変更を止めました。要らない権限があります: write:notes/);
	} finally { restore(); }
});

/** 許可を受け取って、表示名の変更をオンにする */
async function turnOn(nickname, ai, mode) {
	await withToken(nickname, ai);
	if (mode) await nickname.mentionHook(message(ai, `/nickname rename mode ${mode}`, []));
	await nickname.mentionHook(message(ai, '/nickname rename on', []));
	assert.equal(nickname.renameActive(), true);
}

test('承認: 頼まれたら、マスターにチャットで聞き、「はい」で表示名を変える。変える前の名前を残し、revert で戻す', { skip: !hasConfig && 'config.json がない' }, async () => {
	const { nickname, ai, state, serifs, restore } = await setup();
	try {
		await turnOn(nickname, ai);
		state.chats.length = 0;

		const requester = [];
		ai.modules[1].adana(message(ai, 'ご主人のあだ名', requester, { user: ALICE, isChat: false }));
		await tick(); await tick();
		const item = state.chats[0].text.match(/表示名を「(.+?)」に変えてもいいですか/)?.[1];
		assert.ok(item, state.chats[0]?.text);
		assert.deepEqual(state.chats, [{ userId: 'm1', text: serifs.core.adanaMasterRenameAsk('アリス(@alice)', item, 'ご主人', 60) }], 'マスターへの連絡は、承認の問いかけだけ');
		assert.deepEqual(requester, [serifs.core.adanaMasterRenameAskedToSender(item, 'ご主人')]);
		assert.equal(state.name, 'ボス', 'まだ変えない');

		const answer = [];
		assert.equal(await nickname.mentionHook(message(ai, 'はい、お願い', answer)), true);
		assert.equal(state.name, item);
		assert.deepEqual(answer, [serifs.core.adanaMasterRenameApproved(item)]);
		assert.equal(nickname.rename().pending, null);
		assert.equal(nickname.rename().originalName, 'ボス');

		const revert = [];
		await nickname.mentionHook(message(ai, '/nickname rename revert', revert));
		assert.equal(state.name, 'ボス');
		assert.deepEqual(revert, ['表示名を「ボス」に戻しました']);
		const again = [];
		await nickname.mentionHook(message(ai, '/nickname rename revert', again));
		assert.deepEqual(again, ['まだ表示名を変えていません']);
	} finally { restore(); }
});

test('承認: 「いいえ」なら変えない。期限(60分)を過ぎた返事は、取り消したと答える。返事でないものは、ほかの反応に回す', { skip: !hasConfig && 'config.json がない' }, async () => {
	const { nickname, ai, state, serifs, restore } = await setup();
	try {
		await turnOn(nickname, ai);
		const ask = async () => { ai.modules[1].adana(message(ai, 'ご主人のあだ名', [], { user: ALICE, isChat: false })); await tick(); await tick(); };

		await ask();
		assert.equal(await nickname.mentionHook(message(ai, 'おはよう', [])), false, '返事でなければ、ほかの反応に回す');
		assert.notEqual(nickname.rename().pending, null, '待ち続ける');
		const no = [];
		await nickname.mentionHook(message(ai, 'いいえ', no));
		assert.deepEqual(no, [serifs.core.adanaMasterRenameDeclined]);
		assert.equal(state.name, 'ボス');

		await ask();
		nickname.updateRename({ pending: { ...nickname.rename().pending, at: Date.now() - 61 * 60 * 1000 } });
		const late = [];
		await nickname.mentionHook(message(ai, 'はい', late));
		assert.deepEqual(late, [serifs.core.adanaMasterRenameExpired(60)]);
		assert.equal(state.name, 'ボス');
		assert.equal(nickname.rename().pending, null);

		assert.equal(await nickname.mentionHook(message(ai, 'はい', [])), false, '待っていないときの「はい」は、ほかの反応に回す');
	} finally { restore(); }
});

test('承認を待っている間の依頼は、表示名は聞かず、通常の連絡にする', { skip: !hasConfig && 'config.json がない' }, async () => {
	const { nickname, ai, state, serifs, restore } = await setup();
	try {
		await turnOn(nickname, ai);
		state.chats.length = 0;
		ai.modules[1].adana(message(ai, 'ご主人のあだ名', [], { user: ALICE, isChat: false }));
		await tick(); await tick();
		const second = [];
		ai.modules[1].adana(message(ai, 'ご主人のあだ名', second, { user: { id: 'u2', username: 'carol', host: null }, isChat: false }));
		await tick(); await tick();
		assert.equal(state.chats.length, 2);
		assert.match(state.chats[1].text, /^@carolに頼まれて、ご主人のあだ名を考えました！ 「.+」とかいかがでしょうか？$/, '通常の連絡(chat)');
		assert.match(second[0], /ご主人に伝えておきました！$/);
		assert.equal(nickname.rename().pending.from, 'アリス(@alice)', '最初の承認待ちはそのまま');
	} finally { restore(); }
});

test('すぐ変える設定: 頼まれたら表示名を変えて、マスターと頼んだ人に知らせる。呼び名にする設定なら、呼び名も変える', { skip: !hasConfig && 'config.json がない' }, async () => {
	const { nickname, ai, state, serifs, restore } = await setup({ masterNicknameUpdateName: true });
	try {
		await turnOn(nickname, ai, 'immediate');
		state.chats.length = 0;
		const requester = [];
		ai.modules[1].adana(message(ai, 'ご主人のあだ名', requester, { user: ALICE, isChat: false }));
		await tick(); await tick(); await tick();
		const item = state.name;
		assert.notEqual(item, 'ボス');
		assert.deepEqual(state.chats, [{ userId: 'm1', text: serifs.core.adanaMasterRenamedNow('アリス(@alice)', item, 'ご主人') }]);
		assert.deepEqual(requester, [serifs.core.adanaMasterRenamedNowToSender(item, 'ご主人')]);
		assert.equal(ai.lookupFriend('m1')?.name, item, '藍の中の呼び名も変える');
	} finally { restore(); }
});

test('表示名を変えられないとき: 回数の記録を戻して「伝えられませんでした」。トークンが使えなくなっていれば、止めて知らせる', { skip: !hasConfig && 'config.json がない' }, async () => {
	const { nickname, ai, state, restore } = await setup({ masterNicknamePerUserDaily: 1 });
	try {
		await turnOn(nickname, ai, 'immediate');
		state.chats.length = 0;
		state.fail['i/update'] = httpError(403, 'PERMISSION_DENIED');
		const requester = [];
		ai.modules[1].adana(message(ai, 'ご主人のあだ名', requester, { user: ALICE, isChat: false }));
		await tick(); await tick(); await tick();
		assert.match(requester[0], /うまく伝えられませんでした/);
		assert.equal(nickname.renameActive(), false, '止める');
		assert.match(state.chats.at(-1).text, /^表示名の変更を止めました。トークンが使えません\(PERMISSION_DENIED\)/);

		// 止まったあとは、通常の連絡(回数の記録は戻っているので、同じ人がまた頼める)
		delete state.fail['i/update'];
		const again = [];
		ai.modules[1].adana(message(ai, 'ご主人のあだ名', again, { user: ALICE, isChat: false }));
		await tick(); await tick();
		assert.match(again[0], /ご主人に伝えておきました！$/);
		assert.equal(state.name, 'ボス');
	} finally { restore(); }
});

test('起動時の検証で使えなかった理由は、同じものを2回知らせない', { skip: !hasConfig && 'config.json がない' }, async () => {
	const { nickname, ai, state, restore } = await setup();
	try {
		await withToken(nickname, ai);
		state.chats.length = 0;
		state.fail['i'] = httpError(401, 'AUTHENTICATION_FAILED');
		await nickname.verifyToken();
		await nickname.verifyToken();
		await tick();
		assert.equal(state.chats.length, 1);
		assert.match(state.chats[0].text, /アカウントを読めません\(AUTHENTICATION_FAILED\)/);
	} finally { restore(); }
});

test('forget: トークンを消して、オフにする', { skip: !hasConfig && 'config.json がない' }, async () => {
	const { nickname, ai, restore } = await setup();
	try {
		await turnOn(nickname, ai);
		const replies = [];
		await nickname.mentionHook(message(ai, '/nickname rename forget', replies));
		assert.match(replies[0], /許可\(トークン\)を消して/);
		assert.equal(nickname.rename().token, undefined);
		assert.equal(nickname.renameActive(), false);
	} finally { restore(); }
});

test('MiAuth: 許可の URL を返し、5秒おきに受け取りを試みる。受け取ったら確かめて残す。10分で諦める', { skip: !hasConfig && 'config.json がない' }, async () => {
	mock.timers.enable({ apis: ['setInterval', 'Date'] });
	const { nickname, ai, restore } = await setup();
	try {
		let authorized = false;
		const checks = [];
		Object.defineProperty(nickname, 'publicApi', { value: async endpoint => { checks.push(endpoint); return authorized ? { ok: true, token: 'TOKEN', user: MASTER } : { ok: false }; }, configurable: true, writable: true });

		const replies = [];
		await nickname.mentionHook(message(ai, '/nickname rename setup', replies));
		const url = replies[0].match(/(https?:\/\/\S+)/)[1];
		const session = new URL(url).pathname.split('/').at(-1);
		assert.match(new URL(url).searchParams.get('permission'), /^read:account,write:account$/);

		mock.timers.tick(5000); await tick();
		assert.deepEqual(checks, [`miauth/${session}/check`]);
		authorized = true;
		mock.timers.tick(5000); for (let i = 0; i < 10; i++) await tick();
		assert.equal(nickname.rename().token, 'TOKEN');
		assert.match(replies.at(-1), /^許可を受け取りました/);
		mock.timers.tick(5000); await tick();
		assert.equal(checks.length, 2, '受け取ったら、試すのをやめる');

		const late = [];
		authorized = false;
		await nickname.mentionHook(message(ai, '/nickname rename setup', late));
		mock.timers.tick(10 * 60 * 1000 + 5000); await tick();
		assert.match(late.at(-1), /^許可を待つのをやめました/);
	} finally { mock.timers.reset(); restore(); }
});

test('承認: ほぼ同時に頼まれても、マスターに聞くのは1回だけ(2件目は通常の連絡)。聞けなかったら、承認待ちにしない', { skip: !hasConfig && 'config.json がない' }, async () => {
	const { nickname, ai, state, restore } = await setup();
	try {
		await turnOn(nickname, ai);
		state.chats.length = 0;
		const results = await Promise.all([
			nickname.requestRename(message(ai, '', [], { user: ALICE, isChat: false }), 'ひとつめ', '@alice', 'ご主人'),
			nickname.requestRename(message(ai, '', [], { user: ALICE, isChat: false }), 'ふたつめ', '@alice', 'ご主人'),
		]);
		assert.deepEqual(results.sort(), ['asked', 'busy']);
		assert.equal(state.chats.length, 1, '聞くのは1回');
		assert.equal(nickname.rename().pending.item, state.chats[0].text.match(/表示名を「(.+?)」に/)[1], '聞いたあだ名と、承認待ちのあだ名が同じ');

		nickname.updateRename({ pending: null });
		state.failChat = true;
		await assert.rejects(nickname.requestRename(message(ai, '', [], { user: ALICE, isChat: false }), 'みっつめ', '@alice', 'ご主人'));
		assert.equal(nickname.rename().pending, null, '聞けなかったら、承認待ちにしない(次の依頼で、また聞ける)');
	} finally { restore(); }
});

test('承認待ちのとき、マスターのチャットの「はい」は、あだ名の提案(talk の待ち受け)より、承認の返事を優先する', { skip: !hasConfig && 'config.json がない' }, async () => {
	const { nickname, talk, ai, state, restore } = await setup();
	try {
		await turnOn(nickname, ai);
		ai.modules[1].adana(message(ai, 'ご主人のあだ名', [], { user: ALICE, isChat: false }));
		await tick(); await tick();
		assert.equal(nickname.awaitingApproval(), true);

		// マスターは、自分のあだ名の提案(チャット)も待っている
		const unsubscribed = [];
		Object.defineProperty(talk, 'unsubscribeReply', { value: key => unsubscribed.push(key), configurable: true });
		const yes = message(ai, 'はい', []);
		assert.equal(await talk.contextHook('m1', yes, { name: '自分のあだ名', seen: ['自分のあだ名'], rerolls: 0, at: Date.now() }), false, 'talk は受け取らない');
		assert.deepEqual(unsubscribed, ['m1']);
		assert.equal(ai.lookupFriend('m1').name, undefined, '藍の中の呼び名は変えない');

		const answer = [];
		assert.equal(await nickname.mentionHook(message(ai, 'はい', answer)), true, '承認の返事として受け取る');
		assert.notEqual(state.name, 'ボス');
	} finally { restore(); }
});

test('表示名を変える流れでは、マスターのユーザー情報(users/show)を取らない(使わないうえ、失敗すると止まってしまうため)', { skip: !hasConfig && 'config.json がない' }, async () => {
	const { nickname, ai, state, restore } = await setup();
	try {
		await turnOn(nickname, ai, 'immediate');
		const api = ai.api;
		const calls = [];
		ai.api = async (endpoint, param) => { calls.push(endpoint); if (endpoint === 'users/show') throw new Error('users/show failed'); return api(endpoint, param); };
		const requester = [];
		ai.modules[1].adana(message(ai, 'ご主人のあだ名', requester, { user: ALICE, isChat: false }));
		await tick(); await tick(); await tick();
		assert.notEqual(state.name, 'ボス', '表示名は変わる');
		assert.deepEqual(calls, []);
		assert.match(requester[0], /表示名も変えておきました/);
	} finally { restore(); }
});

test('新しい許可を受け取ったら、前の許可を Misskey で取り消すように案内する', { skip: !hasConfig && 'config.json がない' }, async () => {
	const { nickname, ai, restore } = await setup();
	try {
		const first = await withToken(nickname, ai);
		assert.ok(!first[0].includes('前の許可'));
		const replies = [];
		await nickname.receiveToken(message(ai, '', replies), 'TOKEN2');
		assert.match(replies[0], /前の許可は、もう使いません。Misskey の設定の「連携」/);
	} finally { restore(); }
});
