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
	let failPost = null;
	const friend = { userId: 'u1', name: 'テスト', doc: { user: { username: 'tester', host: null } } };
	const ai = {
		account: { id: 'bot' },
		moduleData: getCollection('moduleData'),
		getCollection,
		log: () => {},
		lookupFriend: () => friend,
		post: async note => {
			if (failPost) throw failPost;
			posts.push(note);
			return { id: 'reply' + posts.length };
		},
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

	const setFailPost = err => { failPost = err; };

	return { serifs, reminds, unsubscribed, nthNotify, setFailPost };
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

test('引用だけのリマインダーでも、消すときは登録したキー(リマインダーの ID)で待ち受けを解除する', { skip: !hasConfig && 'config.json がない' }, async () => {
	const { reminds, unsubscribed, nthNotify, setFailPost } = await setup();
	const random = Math.random;
	try {
		// 忘れたとき
		Math.random = () => 0.15;
		const post = await nthNotify(61, { id: 'r1', thing: null, quoteId: 'q1' });
		assert.equal(post.renoteId, 'q1');
		assert.deepEqual(unsubscribed, ['r1']);
		assert.equal(reminds.findOne({ id: 'r1' }), null);

		// 引用元が消されていたとき
		unsubscribed.length = 0;
		// got の HTTPError と同じく、ステータスは response に入る(err.statusCode は無い)
		setFailPost(Object.assign(new Error('Response code 400 (Bad Request)'), { response: { statusCode: 400 } }));
		await nthNotify(1, { id: 'r2', thing: null, quoteId: 'q2' });
		assert.deepEqual(unsubscribed, ['r2']);
		assert.equal(reminds.findOne({ id: 'r2' }), null);
	} finally {
		Math.random = random;
	}
});
