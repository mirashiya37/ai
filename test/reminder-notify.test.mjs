// リマインダー: 催促の言い方(src/modules/reminder/index.ts の timeoutCallback)
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
	const posts = [];
	const unsubscribed = [];
	const friend = { userId: 'u1', name: 'テスト', doc: { user: { username: 'tester', host: null } } };
	const ai = {
		account: { id: 'bot' },
		moduleData: getCollection('moduleData'),
		getCollection,
		log: () => {},
		lookupFriend: () => friend,
		post: async note => { posts.push(note); return { id: 'reply' + posts.length }; },
		subscribeReply: () => {},
		unsubscribeReply: (module, key) => unsubscribed.push(key),
		setTimeoutWithPersistence: () => {},
	};

	const mod = new Reminder();
	mod.init(ai);
	mod.install();
	const reminds = cols.reminds;

	// n 回目の催促(timeoutCallback は、催促の前に times を1増やす)
	const nthNotify = async (n, remind = {}) => {
		const id = remind.id ?? 'n' + n;
		reminds.insertOne({ id, userId: 'u1', isChat: false, thing: 'しごと', quoteId: null, times: n - 1, createdAt: 0, ...remind });
		posts.length = 0;
		await mod.timeoutCallback({ id });
		return posts[0];
	};

	return { serifs, reminds, unsubscribed, nthNotify };
}

test('催促の回数に応じて(8回目から week、31回目から month)、催促の言い方を変える', { skip: !hasConfig && 'config.json がない' }, async () => {
	const { serifs, nthNotify } = await setup();
	const text = serif => '@tester ' + serif('テスト');

	assert.deepEqual(await nthNotify(1), { renoteId: 'n1', text: text(serifs.reminder.notify) });
	assert.equal((await nthNotify(7)).text, text(serifs.reminder.notify));
	assert.equal((await nthNotify(8)).text, text(serifs.reminder.week));
	assert.equal((await nthNotify(30)).text, text(serifs.reminder.week));
	assert.equal((await nthNotify(31)).text, text(serifs.reminder.month));
});

test('61回目からは、10% の確率で忘れて、リマインダーを消す', { skip: !hasConfig && 'config.json がない' }, async () => {
	const { serifs, reminds, nthNotify } = await setup();
	const random = Math.random;
	try {
		Math.random = () => 0.15; // Math.floor(0.15 * 10) == 1
		assert.equal((await nthNotify(61)).text, '@tester ' + serifs.reminder.forget);
		assert.equal(reminds.findOne({ id: 'n61' }), null);

		Math.random = () => 0.5;
		assert.equal((await nthNotify(62)).text, '@tester ' + serifs.reminder.month('テスト'));
		assert.notEqual(reminds.findOne({ id: 'n62' }), null);
	} finally {
		Math.random = random;
	}
});
