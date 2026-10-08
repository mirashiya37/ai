// トーク: あだ名の提案と引き直し、ほかの人のあだ名(src/modules/talk/nickname.ts と、talk モジュールの adana・contextHook)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pickNickname, canBeName, parseAdanaTarget, REROLL_WORDS, YES_WORDS, NO_WORDS, isChatReplyExpired, startsWithReplyWord, CHAT_REPLY_TTL } from '../built/modules/talk/nickname.js';

const ROOT = new URL('..', import.meta.url).pathname;
const hasConfig = existsSync(ROOT + 'config.json');

const sequence = items => { let i = 0; return () => items[i++ % items.length]; };

test('呼び名にできるのは、10文字以下で、記号を含まないあだ名', () => {
	assert.equal(canBeName('伝説のカード'), true);
	assert.equal(canBeName('あ'.repeat(10)), true);
	assert.equal(canBeName('あ'.repeat(11)), false);
	assert.equal(canBeName('@user'), false);
	assert.equal(canBeName('ふたつ 空白'), false);
});

test('呼び名にできないあだ名と、すでに出したあだ名は飛ばして、次の候補を選ぶ', () => {
	const gen = sequence(['@mention', 'あ'.repeat(11), '出したやつ', '新しいやつ']);
	assert.equal(pickNickname(gen, ['出したやつ']), '新しいやつ');
});

test('10回考えても出なければ null', () => {
	let calls = 0;
	assert.equal(pickNickname(() => { calls++; return '出したやつ'; }, ['出したやつ']), null);
	assert.equal(calls, 10);
	assert.equal(pickNickname(() => '@mention'), null);
});

test('引き直しの言葉を含む返事を見分ける', () => {
	const hit = text => REROLL_WORDS.some(word => text.includes(word));
	for (const text of ['別のがいい', 'ほかのは？', '他のあだ名', 'もう一回', 'もう一度お願い', '引き直して', 'やり直し', '違うのがいい']) assert.ok(hit(text), text);
	for (const text of ['はい', 'いいよ', 'いいえ', 'ううん', 'やだ', 'こんにちは']) assert.ok(!hit(text), text);
});

test('「〇〇さんのあだ名」のように敬称が付いていれば、ほかの人のあだ名', () => {
	const other = name => ({ kind: 'other', name });
	assert.deepEqual(parseAdanaTarget('田中さんのあだ名考えて'), other('田中さん'));
	assert.deepEqual(parseAdanaTarget('ねえ、のび太くんのあだ名は？'), other('のび太くん'));
	assert.deepEqual(parseAdanaTarget('はなこちゃんの渾名'), other('はなこちゃん'));
	assert.deepEqual(parseAdanaTarget('鈴木様のあだな'), other('鈴木様'));
	assert.deepEqual(parseAdanaTarget('鈴木の弟さんのあだ名'), other('鈴木の弟さん'));
});

test('敬称もメンションも無ければ、送った本人のあだ名(一人称のリストは要らない)', () => {
	for (const text of [
		'あだ名', 'あだ名つけて', '新しいあだ名', '田中のあだ名', 'わたしのあだ名', '私の渾名', '僕のあだ名', 'うちのあだ名', '自分のあだ名', 'ワイのあだな', 'ねえ、俺のあだにゃ',
		'このあだ名', 'そのあだ名はやだ', '別のあだ名', 'ほかのあだ名がいい', '違うのあだ名', '誰のあだ名？', '何のあだ名', '彼のあだ名',
		'さんのあだ名', // 敬称だけで、名前が無い
		'あ'.repeat(21) + 'さんのあだ名', // 長すぎるものは、文の一部を拾ったとみなす
	]) {
		assert.deepEqual(parseAdanaTarget(text), { kind: 'self' }, text);
	}
});

test('敬称に、君・先輩・先生も使う。「君のあだ名」は、これまでどおり藍', () => {
	const other = name => ({ kind: 'other', name });
	assert.deepEqual(parseAdanaTarget('田中君のあだ名'), other('田中君'));
	assert.deepEqual(parseAdanaTarget('山田先生のあだ名'), other('山田先生'));
	assert.deepEqual(parseAdanaTarget('部活の先輩のあだ名'), other('部活の先輩'));
	assert.deepEqual(parseAdanaTarget('はなこせんぱいのあだ名'), other('はなこせんぱい'));
	assert.deepEqual(parseAdanaTarget('君のあだ名'), { kind: 'ai' });
	assert.deepEqual(parseAdanaTarget('先生のあだ名'), { kind: 'self' }, '名前が無い');
});

test('「あだ名」がカタカナでも、〇〇を取り出す(反応の判定と同じにする)', () => {
	const other = name => ({ kind: 'other', name });
	assert.deepEqual(parseAdanaTarget('田中さんのアダナ'), other('田中さん'));
	assert.deepEqual(parseAdanaTarget('田中さんのアダ名'), other('田中さん'));
	assert.deepEqual(parseAdanaTarget('田中さんのあだニャ'), other('田中さん'));
	assert.deepEqual(parseAdanaTarget('@bob のアダナ'), other('bob'));
});

test('マスターのあだ名を使わないとき、マスターの名前は、送った本人のあだ名にせず、ほかの人にする', () => {
	const names = ['マスター', 'ご主人'];
	assert.deepEqual(parseAdanaTarget('マスターのあだ名', undefined, names), { kind: 'other', name: 'マスター' });
	assert.deepEqual(parseAdanaTarget('ご主人のあだ名', undefined, names), { kind: 'other', name: 'ご主人' });
	assert.deepEqual(parseAdanaTarget('ご主人様のあだ名', undefined, names), { kind: 'other', name: 'ご主人様' });
	assert.deepEqual(parseAdanaTarget('田中のあだ名', undefined, names), { kind: 'self' });
	assert.deepEqual(parseAdanaTarget('マスターのあだ名'), { kind: 'self' }, '名前を渡さなければ、これまでどおり');
	assert.deepEqual(parseAdanaTarget('@ご主人 のあだ名', undefined, names), { kind: 'other', name: 'ご主人' });
});

test('「はい」「いいえ」の言葉: いいね・OK・気に入ったは承諾、いや・いやですは断り', () => {
	const hit = (words, text) => words.some(word => text.toLowerCase().includes(word.toLowerCase()));
	for (const text of ['はい', 'いいね！', 'いいですね', 'OK', 'ok!', 'オーケー', '気に入った', 'うん', 'それで', 'お願いします']) assert.ok(hit(YES_WORDS, text), text);
	for (const text of ['いいえ', 'ううん', 'いや', 'いやです', 'いやいや', 'いいや', 'やだ', '嫌', 'だめ', 'やめて']) assert.ok(hit(NO_WORDS, text), text);
	for (const text of ['いいです']) assert.ok(!hit(YES_WORDS, text) && !hit(NO_WORDS, text), `${text}: どちらにもとれるので、どちらにも入れない`);
});

test('チャットの待ち受けは、10分を過ぎたら期限切れ。時刻の記録が無い以前の形は、期限切れにしない', () => {
	const now = 1_000_000_000;
	assert.equal(isChatReplyExpired(now - CHAT_REPLY_TTL, now), false);
	assert.equal(isChatReplyExpired(now - CHAT_REPLY_TTL - 1, now), true);
	assert.equal(isChatReplyExpired(undefined, now), false);
});

test('返事の言葉が文の頭にあるかを見る(頭の句読点・空白は読み飛ばす)', () => {
	for (const text of ['はい', 'はい、おやすみ', '、はい', '  うん！', 'ううん', 'やだ、別の', '別のがいい', 'もう一回', 'OK', 'オーケー', 'いやです']) assert.ok(startsWithReplyWord(text), text);
	for (const text of ['ところで、はい', 'おはよう', '今日はいい天気ですね', 'ありがとう', 'さっきの話だけど、別の']) assert.ok(!startsWithReplyWord(text), text);
	// 「別の話だけど」は、引き直しの言葉で始まるので返事とみなす(言葉の判定は部分一致のため。チャットの誤爆は、期限と合わせて減らす)
	assert.ok(startsWithReplyWord('別の話だけど'));
});

test('藍のあだ名: 二人称は敬称が無くても、藍の名前は敬称かメンションが付いたときだけ', () => {
	for (const text of ['あなたのあだ名', '君のあだ名', 'おまえのあだ名', 'あなたさんのあだ名', '藍ちゃんのあだ名', '藍さんのあだ名', 'AIさんのあだ名', 'アイちゃんのあだ名', '@ai のあだ名', '@ai@misskey.example のあだ名']) {
		assert.deepEqual(parseAdanaTarget(text), { kind: 'ai' }, text);
	}
	for (const text of ['藍のあだ名', 'あいのあだ名']) {
		assert.deepEqual(parseAdanaTarget(text), { kind: 'self' }, `${text}: 友達の名前かもしれない`);
	}
});

test('メンションは、敬称が無くても、ほかの人。「@」とサーバーの部分を外す(返信で通知が届かないようにする)', () => {
	assert.deepEqual(parseAdanaTarget('@bob のあだ名'), { kind: 'other', name: 'bob' });
	assert.deepEqual(parseAdanaTarget('@bob@misskey.example のあだ名'), { kind: 'other', name: 'bob' });
	assert.deepEqual(parseAdanaTarget('@bobのあだ名'), { kind: 'other', name: 'bob' });
});

async function setup() {
	const require = createRequire(ROOT);
	const loki = require('lokijs');
	const serifs = (await import('../built/serifs.js')).default;
	const Talk = (await import('../built/modules/talk/index.js')).default;

	const db = new loki('test.json');
	const cols = {};
	const getCollection = name => cols[name] ?? (cols[name] = db.addCollection(name));
	const subscribed = [];
	const unsubscribed = [];
	const ai = {
		moduleData: getCollection('moduleData'),
		getCollection,
		log: () => {},
		subscribeReply: (module, key, isChat, id, data) => subscribed.push({ key, isChat, id, data }),
		unsubscribeReply: (module, key) => unsubscribed.push(key),
	};
	const mod = new Talk();
	mod.init(ai);

	return { serifs, mod, subscribed, unsubscribed };
}

const withoutAt = ({ at, ...rest }) => rest;

const message = (text, replies, love = 0) => ({
	text,
	extractedText: text,
	userId: 'u1',
	user: { username: 'alice', host: null },
	isChat: false,
	includes: words => words.some(word => text.includes(word)),
	friend: { love, name: 'テスト', updateName(name) { this.name = name; } },
	reply: t => { replies.push(t); return Promise.resolve({ id: 'reply' + replies.length }); },
});

test('チャット: 待ち受けが期限切れなら、返事とみなさず、待ち受けをやめて普段の会話として扱う', { skip: !hasConfig && 'config.json がない' }, async () => {
	const { mod, subscribed, unsubscribed } = await setup();
	const replies = [];
	const msg = { ...message('はい', replies), isChat: true };
	const data = { name: '古いやつ', seen: ['古いやつ'], rerolls: 0, at: Date.now() - CHAT_REPLY_TTL - 1000 };

	assert.equal(await mod.contextHook('u1', msg, data), false);
	assert.equal(msg.friend.name, 'テスト', '呼び名は変えない');
	assert.deepEqual(replies, []);
	assert.deepEqual(unsubscribed, ['u1']);
	assert.deepEqual(subscribed, []);
});

test('チャット: 期限内でも、文の頭に返事の言葉が無ければ返事とみなさない。あれば、これまでどおり', { skip: !hasConfig && 'config.json がない' }, async () => {
	const { mod, serifs, unsubscribed } = await setup();
	const data = { name: '決めるやつ', seen: ['決めるやつ'], rerolls: 0, at: Date.now() - 60 * 1000 };

	const otherReplies = [];
	const other = { ...message('今日はいい天気ですね。はい、散歩します', otherReplies), isChat: true };
	assert.equal(await mod.contextHook('u1', other, data), false);
	assert.equal(other.friend.name, 'テスト');
	assert.deepEqual(unsubscribed, ['u1']);

	const yesReplies = [];
	const yes = { ...message('はい、お願いします', yesReplies), isChat: true };
	assert.deepEqual(await mod.contextHook('u1', yes, data), { reaction: '🙌' });
	assert.equal(yes.friend.name, '決めるやつ');
	assert.deepEqual(yesReplies, [serifs.core.setNameOk('決めるやつ')]);
});

test('投稿への返信なら、時間がたっていても返事とみなす(返信先がはっきりしているため)', { skip: !hasConfig && 'config.json がない' }, async () => {
	const { mod, serifs } = await setup();
	const replies = [];
	const msg = message('いいね！', replies);
	const data = { name: '決めるやつ', seen: ['決めるやつ'], rerolls: 0, at: Date.now() - 24 * 60 * 60 * 1000 };

	assert.deepEqual(await mod.contextHook('u1', msg, data), { reaction: '🙌' });
	assert.equal(msg.friend.name, '決めるやつ');
	assert.deepEqual(replies, [serifs.core.setNameOk('決めるやつ')]);
});

test('引き直すと、別のあだ名を提案し、出したあだ名と回数を引き継いで待ち受ける', { skip: !hasConfig && 'config.json がない' }, async () => {
	const { mod, serifs, subscribed, unsubscribed } = await setup();
	const replies = [];
	const data = { name: '最初のやつ', seen: ['最初のやつ'], rerolls: 0 };

	const result = await mod.contextHook('u1', message('別のがいい', replies), data);
	await new Promise(r => setTimeout(r, 0));

	assert.deepEqual(result, { reaction: '🙌' });
	assert.deepEqual(unsubscribed, ['u1'], '古い待ち受けは解除する');
	assert.equal(replies.length, 1);
	const proposed = replies[0].match(/「(.+)」はどうでしょうか/)?.[1];
	assert.ok(proposed && proposed !== '最初のやつ', replies[0]);
	assert.equal(replies[0], serifs.core.adanaAgain(proposed, 'テスト'));
	assert.equal(subscribed.length, 1);
	assert.deepEqual(withoutAt(subscribed[0].data), { name: proposed, seen: ['最初のやつ', proposed], rerolls: 1 });
	assert.ok(Math.abs(subscribed[0].data.at - Date.now()) < 5000, '待ち受けた時刻を持つ');
	assert.equal(subscribed[0].id, 'reply1');
});

test('もう出せるあだ名がなければ、思い浮かばないと答えて、待ち受けをやめる', { skip: !hasConfig && 'config.json がない' }, async () => {
	const { mod, serifs, subscribed, unsubscribed } = await setup();
	const { genItemWithKeyword } = await import('../built/utils/gen-item-with-keyword.js');
	const random = Math.random;
	try {
		// 乱数を固定すると、いつも同じあだ名しか出ない。それをすでに出したことにする
		Math.random = () => 0.5;
		const only = genItemWithKeyword([]);
		const replies = [];

		const result = await mod.contextHook('u1', message('別の', replies), { name: only, seen: [only], rerolls: 4 });

		assert.deepEqual(result, { reaction: 'confused' });
		assert.deepEqual(replies, [serifs.core.adana('', 'テスト')]);
		assert.deepEqual(unsubscribed, ['u1']);
		assert.deepEqual(subscribed, []);
	} finally {
		Math.random = random;
	}
});

test('「はい」で決め、「いいえ」で断り、「やだ、別の」は引き直し。関係ない返事は待ち受けをやめる', { skip: !hasConfig && 'config.json がない' }, async () => {
	const { mod, serifs, subscribed, unsubscribed } = await setup();
	const data = { name: '決めるやつ', seen: ['決めるやつ'], rerolls: 2 };

	const yes = [];
	const yesMsg = message('はい', yes);
	assert.deepEqual(await mod.contextHook('u1', yesMsg, data), { reaction: '🙌' });
	assert.equal(yesMsg.friend.name, '決めるやつ');
	assert.deepEqual(yes, [serifs.core.setNameOk('決めるやつ')]);

	const no = [];
	const noMsg = message('ううん', no);
	assert.deepEqual(await mod.contextHook('u1', noMsg, data), { reaction: '🙌' });
	assert.equal(noMsg.friend.name, 'テスト', '呼び名は変えない');
	assert.deepEqual(no, [serifs.core.adanaNo('テスト')]);

	const other = [];
	assert.equal(await mod.contextHook('u1', message('こんにちは', other), data), false);
	assert.deepEqual(other, []);

	const both = [];
	await mod.contextHook('u1', message('やだ、別のがいい', both), data);
	await new Promise(r => setTimeout(r, 0));
	assert.match(both[0], /はどうでしょうか/);
	assert.equal(subscribed.at(-1).data.rerolls, 3, '引き直した回数は引き継ぐ');
	assert.equal(unsubscribed.length, 4);
});

test('以前の形(name だけ)の待ち受けでも、引き直せる', { skip: !hasConfig && 'config.json がない' }, async () => {
	const { mod, subscribed } = await setup();
	const replies = [];
	await mod.contextHook('u1', message('もう一回', replies), { name: '前のやつ' });
	await new Promise(r => setTimeout(r, 0));
	assert.deepEqual(subscribed[0].data.seen[0], '前のやつ');
	assert.equal(subscribed[0].data.rerolls, 1);
	assert.notEqual(subscribed[0].data.name, '前のやつ');
});

test('ほかの人のあだ名は、その人のあだ名として提案し、誰のものかを持って待ち受ける', { skip: !hasConfig && 'config.json がない' }, async () => {
	const { mod, serifs, subscribed } = await setup();
	const replies = [];
	const msg = message('@bob@misskey.example のあだ名考えて', replies);

	assert.deepEqual(mod.adana(msg), { reaction: '🙌' });
	await new Promise(r => setTimeout(r, 0));

	const proposed = replies[0].match(/「(.+)」とかいかがでしょうか/)?.[1];
	assert.ok(proposed, replies[0]);
	assert.equal(replies[0], serifs.core.adanaOther('bob', proposed));
	assert.ok(!replies[0].includes('テスト'), '送った本人の呼び名では呼ばない');
	assert.ok(!replies[0].includes('@'), 'メンションを書かない');
	assert.deepEqual(withoutAt(subscribed[0].data), { name: proposed, seen: [proposed], rerolls: 0, target: 'bob' });
});

test('ほかの人のあだ名に「はい」と言われても、送った本人の呼び名は変えない。引き直しでは誰のものかを引き継ぐ', { skip: !hasConfig && 'config.json がない' }, async () => {
	const { mod, serifs, subscribed } = await setup();
	const data = { name: '決めるやつ', seen: ['決めるやつ'], rerolls: 0, target: '田中' };

	const yes = [];
	const yesMsg = message('はい', yes);
	assert.deepEqual(await mod.contextHook('u1', yesMsg, data), { reaction: '🙌' });
	assert.equal(yesMsg.friend.name, 'テスト', '呼び名は変えない');
	assert.deepEqual(yes, [serifs.core.adanaOtherOk('田中')]);

	const no = [];
	const noMsg = message('いいえ', no);
	await mod.contextHook('u1', noMsg, data);
	assert.equal(noMsg.friend.name, 'テスト');
	assert.deepEqual(no, [serifs.core.adanaOtherNo('田中')]);

	const again = [];
	await mod.contextHook('u1', message('別のがいい', again), data);
	await new Promise(r => setTimeout(r, 0));
	const proposed = subscribed[0].data.name;
	assert.equal(again[0], serifs.core.adanaOtherAgain('田中', proposed));
	assert.deepEqual(withoutAt(subscribed[0].data), { name: proposed, seen: ['決めるやつ', proposed], rerolls: 1, target: '田中' });
});

test('自分のあだ名(一人称)は、これまでどおり本人の呼び名として聞く', { skip: !hasConfig && 'config.json がない' }, async () => {
	const { mod, subscribed } = await setup();
	const replies = [];
	mod.adana(message('わたしのあだ名考えて', replies));
	await new Promise(r => setTimeout(r, 0));
	assert.match(replies[0], /^テスト、「.+」とお呼びしてもいいですか？$/);
	assert.equal(subscribed[0].data.target, undefined);
});

test('藍のあだ名は、親愛度に応じてやんわり断り、待ち受けない', { skip: !hasConfig && 'config.json がない' }, async () => {
	const { mod, serifs, subscribed } = await setup();
	for (const [love, serif] of [[0, serifs.core.adanaForAi.normal], [5, serifs.core.adanaForAi.love('テスト')], [-3, [serifs.core.adanaForAi.hate]]]) {
		const replies = [];
		assert.deepEqual(mod.adana(message('藍ちゃんのあだ名は？', replies, love)), { reaction: 'confused' });
		assert.ok(serif.includes(replies[0]), `${love}: ${replies[0]}`);
	}
	assert.deepEqual(subscribed, []);
});

test('マスターのあだ名を使わない設定でも、マスターの名前は、送った本人のあだ名にしない', { skip: !hasConfig && 'config.json がない' }, async () => {
	const { mod, serifs, subscribed } = await setup();
	const config = (await import('../built/config.js')).default;
	const saved = { ...config };
	try {
		Object.assign(config, { master: 'boss', masterNicknameNames: ['マスター'], masterNicknameNotify: 'off', masterNicknameUpdateName: false });
		const replies = [];
		const msg = { ...message('マスターのあだ名考えて', replies), user: { username: 'alice', host: null } };
		mod.adana(msg);
		await new Promise(r => setTimeout(r, 0));
		assert.match(replies[0], /^マスターのあだ名は、「.+」とかいかがでしょうか？$/);
		assert.equal(subscribed[0].data.target, 'マスター', '送った本人の呼び名は変えない');

		const own = [];
		mod.adana({ ...message('マスターのあだ名考えて', own), user: { username: 'boss', host: null } });
		await new Promise(r => setTimeout(r, 0));
		assert.match(own[0], /^テスト、「.+」とお呼びしてもいいですか？$/, 'マスター本人が言ったときは、本人のあだ名');
	} finally {
		for (const key of Object.keys(config)) delete config[key];
		Object.assign(config, saved);
	}
});
