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
