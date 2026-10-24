// リマインダー: 登録(src/modules/reminder/index.ts の mentionHook)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const ROOT = new URL('..', import.meta.url).pathname;
const hasConfig = existsSync(ROOT + 'config.json');

async function setup() {
	const require = createRequire(ROOT);
	const loki = require('lokijs');
	const serifs = (await import('../built/serifs.js')).default;
	const Reminder = (await import('../built/modules/reminder/index.js')).default;

	const db = new loki('test.json');
	const cols = {};
	const getCollection = (name, opts) => cols[name] ?? (cols[name] = db.addCollection(name, opts));
	const timers = [];
	const subscribed = [];
	const ai = {
		account: { id: 'bot' },
		moduleData: getCollection('moduleData'),
		getCollection,
		log: () => {},
		subscribeReply: (module, key, isChat, id) => subscribed.push({ key, isChat, id }),
		unsubscribeReply: () => {},
		setTimeoutWithPersistence: (module, delay, data) => timers.push({ delay, data }),
	};

	const mod = new Reminder();
	mod.init(ai);
	mod.install();
	const reminds = cols.reminds;

	let seq = 0;
	const register = async (text, opts = {}) => {
		const replies = [];
		const msg = {
			id: 'm' + ++seq,
			userId: 'u1',
			isChat: false,
			quoteId: null,
			visibility: 'public',
			extractedText: text,
			reply: async t => { replies.push(t); },
			...opts,
		};
		const res = await mod.mentionHook(msg);
		return { res, replies, msg };
	};

	return { serifs, reminds, timers, subscribed, register };
}

test('内容に空白や改行があっても、最初の語は消えず、大文字小文字もそのまま残る', { skip: !hasConfig && 'config.json がない' }, async () => {
	const { reminds, register } = await setup();

	const cases = [
		['remind 牛乳を買う', '牛乳を買う'],
		['remind 牛乳 と 卵', '牛乳 と 卵'],
		['remind\n牛乳\n卵', '牛乳\n卵'],
		['todo Buy Milk', 'Buy Milk'],
		['REMIND   Buy Milk  ', 'Buy Milk'],
	];
	for (const [text, thing] of cases) {
		const { res, msg } = await register(text);
		assert.deepEqual(res, { reaction: '🆗', immediate: true }, text);
		assert.equal(reminds.findOne({ id: msg.id }).thing, thing, text);
	}
});

test('内容も引用もなければ断る', { skip: !hasConfig && 'config.json がない' }, async () => {
	const { serifs, reminds, register } = await setup();

	for (const text of ['remind', 'remind   ', 'todo\n']) {
		const { res, replies } = await register(text);
		assert.deepEqual(res, { reaction: '🆖', immediate: true }, text);
		assert.deepEqual(replies, [serifs.reminder.invalid], text);
	}
	assert.equal(reminds.count(), 0);
});

test('日時を指定すると、その時刻に1回知らせるように登録し、いつ知らせるかを返事する', { skip: !hasConfig && 'config.json がない' }, async () => {
	const { serifs, reminds, timers, register } = await setup();
	const HOUR = 1000 * 60 * 60;

	const before = Date.now();
	const { res, replies, msg } = await register('remind 2時間後に 牛乳 と 卵');
	assert.deepEqual(res, { reaction: '🆗', immediate: true });

	const remind = reminds.findOne({ id: msg.id });
	assert.equal(remind.thing, '牛乳 と 卵');
	assert.ok(remind.notifyAt >= before + 2 * HOUR && remind.notifyAt <= Date.now() + 2 * HOUR);
	assert.deepEqual(replies, [serifs.reminder.set(Math.floor(remind.notifyAt / 1000))]);

	// タイマーは、お知らせの時刻までの時間
	assert.equal(timers.length, 1);
	assert.ok(Math.abs(timers[0].delay - 2 * HOUR) < 5000);
	assert.deepEqual(timers[0].data, { id: msg.id });

	// 日付だけなら、朝9時
	const tomorrow = new Date();
	tomorrow.setDate(tomorrow.getDate() + 1);
	tomorrow.setHours(9, 0, 0, 0);
	const { msg: msg2 } = await register('remind 明日 ゴミ出し');
	assert.equal(reminds.findOne({ id: msg2.id }).notifyAt, tomorrow.getTime());
	assert.equal(reminds.findOne({ id: msg2.id }).thing, 'ゴミ出し');
});

test('日時と読めなければ、これまでどおり内容として登録し、24時間後に催促する', { skip: !hasConfig && 'config.json がない' }, async () => {
	const { reminds, timers, register } = await setup();

	for (const text of ['remind 明日の準備をする', 'remind 3時間かかる作業', 'remind 牛乳を買う']) {
		const { res, replies, msg } = await register(text);
		assert.deepEqual(res, { reaction: '🆗', immediate: true }, text);
		const remind = reminds.findOne({ id: msg.id });
		assert.equal(remind.thing, text.replace('remind ', ''), text);
		assert.equal(remind.notifyAt, null, text);
		assert.deepEqual(replies, [], text);
		assert.equal(timers.at(-1).delay, 1000 * 60 * 60 * 24, text);
	}
});

test('過ぎている日時・遠すぎる日時・内容のない日時は断る', { skip: !hasConfig && 'config.json がない' }, async () => {
	const { serifs, reminds, timers, register } = await setup();

	for (const [text, serif] of [
		['remind 2020/1/1 テスト', serifs.reminder.past],
		['remind 2099/1/1 テスト', serifs.reminder.tooFar],
		['remind 明日', serifs.reminder.invalid],
		['remind 30分後', serifs.reminder.invalid],
	]) {
		const { res, replies } = await register(text);
		assert.deepEqual(res, { reaction: '🆖', immediate: true }, text);
		assert.deepEqual(replies, [serif], text);
	}
	assert.equal(reminds.count(), 0);
	assert.deepEqual(timers, []);

	// 引用があれば、内容がなくてもよい
	const { res, msg } = await register('remind 明日', { quoteId: 'q1' });
	assert.deepEqual(res, { reaction: '🆗', immediate: true });
	assert.equal(reminds.findOne({ id: msg.id }).thing, null);
	assert.notEqual(reminds.findOne({ id: msg.id }).notifyAt, null);
});

test('やること一覧に、日時を指定したものは予定の時刻を出す', { skip: !hasConfig && 'config.json がない' }, async () => {
	const { serifs, register } = await setup();

	await register('remind 2時間後 牛乳');
	await register('remind 洗濯');
	const { replies } = await register('reminds');
	assert.equal(replies.length, 1);

	// 並びは決まっていない
	const [head, ...lines] = replies[0].split('\n');
	assert.equal(head, serifs.reminder.reminds);
	assert.equal(lines.length, 2);
	assert.ok(lines.includes('・洗濯'));
	assert.ok(lines.some(line => /^・牛乳\(予定: \$\[unixtime \d+\]\)$/.test(line)));
});
