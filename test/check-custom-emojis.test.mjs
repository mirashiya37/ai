// カスタム絵文字チェック(src/modules/check-custom-emojis)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const ROOT = new URL('..', import.meta.url).pathname;
const hasConfig = existsSync(ROOT + 'config.json');
const skip = !hasConfig && 'config.json がない';

// Misskey の admin/emoji/list と同じ並び: sinceId なしは ID の降順、あり(sinceId より新しいもの)は昇順。limit は 100 まで
function fakeEmojiApi(all, calls) {
	const asc = [...all].sort((a, b) => (a.id < b.id ? -1 : 1));
	return async (endpoint, param) => {
		assert.equal(endpoint, 'admin/emoji/list');
		calls.push(param);
		const limit = Math.min(param.limit ?? 10, 100);
		if (param.sinceId == null) return [...asc].reverse().slice(0, limit);
		return asc.filter(e => e.id > param.sinceId).slice(0, limit);
	};
}

// id は辞書順で並ぶように桁をそろえる
const makeEmojis = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => {
	const n = from + i;
	return { id: String(n).padStart(6, '0'), name: 'emoji_' + n };
});

async function setup({ existing = [], lastId = null, atOnce = false, chunkSize, master = 'master' } = {}) {
	const require = createRequire(ROOT);
	const loki = require('lokijs');
	const config = (await import('../built/config.js')).default;
	const serifs = (await import('../built/serifs.js')).default;
	const CheckCustomEmojis = (await import('../built/modules/check-custom-emojis/index.js')).default;

	const saved = {};
	for (const k of ['checkEmojisEnabled', 'checkEmojisAtOnce', 'checkEmojisChunkSize', 'serverName', 'master']) saved[k] = config[k];
	config.checkEmojisEnabled = true;
	config.checkEmojisAtOnce = atOnce;
	config.checkEmojisChunkSize = chunkSize;
	config.serverName = 'テスト鯖';
	config.master = master;
	const restore = () => { for (const k in saved) config[k] = saved[k]; };

	const db = new loki('test.json');
	const cols = {};
	const getCollection = (name, opts) => cols[name] ?? (cols[name] = db.addCollection(name, opts));
	const posts = [];
	const calls = [];
	const events = [];
	const chats = [];
	const api = fakeEmojiApi(existing, calls);
	const ai = {
		account: { id: 'bot' },
		moduleData: getCollection('moduleData'),
		getCollection,
		log: () => {},
		api: async (endpoint, param) => {
			if (endpoint === 'users/show') return { id: 'id-' + param.username };
			events.push('api');
			return api(endpoint, param);
		},
		post: async note => { events.push('post'); posts.push(note); return { id: 'n' + posts.length }; },
		sendMessage: async (userId, param) => { chats.push({ userId, ...param }); },
	};

	const mod = new CheckCustomEmojis();
	mod.init(ai);
	// 起動時と3分ごとの確認(timeCheck)は動かさず、post だけを試す
	const realSetInterval = globalThis.setInterval;
	globalThis.setInterval = () => 0;
	const realHours = Date.prototype.getHours;
	Date.prototype.getHours = () => 0;
	try { mod.install(); } finally { globalThis.setInterval = realSetInterval; Date.prototype.getHours = realHours; }

	// 待ち時間は省く(間隔の長さは確かめない)
	const sleeps = [];
	Object.defineProperty(mod, 'sleep', { value: async ms => { sleeps.push(ms); }, configurable: true, writable: true });

	if (lastId != null) cols.lastEmoji.insertOne({ id: lastId, updatedAt: 0 });
	const savedId = () => cols.lastEmoji.find({}).map(d => d.id);

	return { mod, serifs, posts, chats, calls, events, sleeps, savedId, restore };
}

// 頼まれたときのメッセージ(Message の代わり)。投稿への返信は、Message.reply と同じく公開範囲を引き継ぐ想定で返す
function fakeMessage({ isChat = false } = {}) {
	const replies = [];
	const obj = {
		isChat,
		replies,
		replyOpts: [],
		reply: async (text, opts) => {
			replies.push(text);
			obj.replyOpts.push(opts);
			return isChat ? {} : { id: 'r' + replies.length, visibility: 'specified', visibleUserIds: ['requester'] };
		},
	};
	return obj;
}

// 投稿に出てくる絵文字名を、順に取り出す
const namesIn = text => [...text.matchAll(/:(emoji_\d+):/g)].map(m => m[1]);

for (const n of [0, 3, 50, 250]) {
	test(`初回(lastId なし): 絵文字が ${n} 件でも、新しい順に最大5件を古い順で投稿し、一番新しいIDを保存する`, { skip }, async () => {
		const all = makeEmojis(1, n);
		const t = await setup({ existing: all });
		try {
			await t.mod.post();
			const expected = all.slice(-5).map(e => e.name);
			assert.deepEqual(t.calls, [{ limit: 5 }], 'sinceId なし・limit 5 の1回だけ取得する');
			if (n === 0) {
				assert.equal(t.posts.length, 0);
				assert.deepEqual(t.savedId(), []);
				return;
			}
			assert.equal(t.posts.length, 1 + expected.length, '概要 + 1絵文字1ノート');
			assert.equal(t.posts[0].text, t.serifs.checkCustomEmojis.post('テスト鯖', expected.length));
			assert.deepEqual(t.posts.slice(1).map(p => namesIn(p.text)[0]), expected, '古い順');
			assert.deepEqual(t.savedId(), [all[n - 1].id]);
		} finally { t.restore(); }
	});
}

for (const n of [0, 1, 20, 21, 30, 100, 150, 1000, 1100]) {
	test(`2回目以降(lastId あり): 新着が ${n} 件なら、全件を古い順に集めて、最後のIDを保存する`, { skip }, async () => {
		const old = makeEmojis(1, 10);
		const added = makeEmojis(11, 10 + n);
		const t = await setup({ existing: [...old, ...added], lastId: old[9].id });
		try {
			await t.mod.post();
			// 1回100件で、100件に満たなくなるまで取る。ただし10回まで(10回目も100件なら、続きがあるかを1件だけ取って確かめる)
			const expectedFetched = Math.min(n, 1000);
			const expectedCalls = n >= 1000 ? 11 : Math.floor(n / 100) + 1;
			assert.equal(t.calls.length, expectedCalls);
			assert.ok(t.calls.slice(0, 10).every(c => c.limit === 100 && c.sinceId != null));
			if (n >= 1000) assert.deepEqual(t.calls[10], { sinceId: added[999].id, limit: 1 });
			assert.equal(t.calls[0].sinceId, old[9].id);
			if (n === 0) {
				assert.equal(t.posts.length, 0);
				assert.deepEqual(t.savedId(), [old[9].id], '新着がなければ保存済みのIDのまま');
				return;
			}
			// 20件までは1件ずつ(概要は本文)、21件からはまとめ投稿(概要は注釈)
			if (n <= 20) {
				assert.equal(t.posts.length, 1 + expectedFetched);
				assert.equal(t.posts[0].text, t.serifs.checkCustomEmojis.post('テスト鯖', expectedFetched), '件数は取得した全件数');
				assert.ok(t.posts.every(p => p.cw === undefined), '個別投稿は折りたたまない');
			} else {
				assert.ok(namesIn(t.posts[0].text).length > 0, 'まとめ投稿になる');
				assert.ok(t.posts.every(p => p.cw.startsWith(t.serifs.checkCustomEmojis.post('テスト鯖', expectedFetched))), '件数は取得した全件数');
			}
			assert.deepEqual(t.posts.flatMap(p => namesIn(p.text)), added.slice(0, expectedFetched).map(e => e.name));
			// 続きがあるときだけ、1ノート目に「続きは次の回に」と書く
			assert.equal(t.posts[0].text.includes(t.serifs.checkCustomEmojis.continued), n > 1000);
			assert.ok(t.posts.slice(1).every(p => !p.text.includes(t.serifs.checkCustomEmojis.continued)));
			assert.deepEqual(t.savedId(), [added[expectedFetched - 1].id]);
		} finally { t.restore(); }
	});
}

test('上限(10ページ)で止まったぶんは、次の回に続きから取る', { skip }, async () => {
	const old = makeEmojis(1, 1);
	const added = makeEmojis(2, 1201);
	const t = await setup({ existing: [...old, ...added], lastId: old[0].id });
	try {
		await t.mod.post();
		assert.equal(t.calls.length, 11, '10回 + 続きの確認');
		assert.deepEqual(t.savedId(), [added[999].id]);
		assert.ok(t.posts[0].cw.startsWith('テスト鯖に1000件の絵文字が追加されました！('));
		assert.ok(t.posts[0].text.startsWith(t.serifs.checkCustomEmojis.continued + '\n:'));
		t.calls.length = 0;
		t.posts.length = 0;
		await t.mod.post();
		assert.equal(t.calls.length, 3, '残り200件 + 100件に満たない回');
		assert.deepEqual(t.savedId(), [added[1199].id]);
		assert.equal(t.calls[0].sinceId, added[999].id);
		assert.ok(t.posts[0].cw.startsWith('テスト鯖に200件の絵文字が追加されました！('));
		assert.ok(t.posts[0].text.startsWith(':'), '残りを出し切った回には書かない');
	} finally { t.restore(); }
});

test('取得の間(2ページ目以降)とノートの間に待ち時間を入れる', { skip }, async () => {
	const old = makeEmojis(1, 1);
	const t = await setup({ existing: [...old, ...makeEmojis(2, 251)], lastId: old[0].id });
	try {
		await t.mod.post();
		const fetches = t.events.filter(e => e === 'api').length;
		assert.equal(fetches, 3);
		assert.equal(t.sleeps.filter(ms => ms === 50).length, 2, '取得の間は、取得の回数 - 1');
		assert.equal(t.sleeps.filter(ms => ms >= 1000).length, t.posts.length - 1, 'まとめ投稿は、ノートの間');
	} finally { t.restore(); }
	const t2 = await setup({ existing: [...old, ...makeEmojis(2, 21)], lastId: old[0].id });
	try {
		await t2.mod.post();
		assert.equal(t2.posts.length, 21);
		assert.equal(t2.sleeps.filter(ms => ms >= 1000).length, 20, '個別投稿は、概要のあとの各絵文字の前');
	} finally { t2.restore(); }
});

test('まとめ投稿: チャンクサイズ 20 で 45 件が 20/20/5 の3ノートに分かれ、2ノート目以降にページ表記が付く', { skip }, async () => {
	const old = makeEmojis(1, 1);
	const added = makeEmojis(2, 46);
	const t = await setup({ existing: [...old, ...added], lastId: old[0].id, atOnce: true, chunkSize: 20 });
	try {
		await t.mod.post();
		assert.deepEqual(t.posts.map(p => namesIn(p.text).length), [20, 20, 5]);
		// 絵文字の並びは折りたたみ、注釈に件数(全件数)とページを書く
		assert.deepEqual(t.posts.map(p => p.cw), [1, 2, 3].map(i => `テスト鯖に45件の絵文字が追加されました！(${i}/3)`));
		assert.ok(t.posts.every(p => p.text.startsWith(':emoji_') && !p.text.includes('追加されました')), '本文は絵文字の並びだけ');
		assert.deepEqual(t.posts.flatMap(p => namesIn(p.text)), added.map(e => e.name), '全件が古い順に1回ずつ');
		assert.ok(t.posts.every(p => p.text.endsWith('#AddCustomEmojis')));
		assert.equal(t.posts[0].replyId, undefined, '1ノート目は返信にしない');
		assert.equal(t.posts[1].replyId, 'n1', '2ノート目は1ノート目への返信');
		assert.equal(t.posts[2].replyId, 'n2', '3ノート目は2ノート目への返信');
		assert.deepEqual(t.savedId(), [added[44].id], '全部投稿してから、最後のIDを保存する');
		assert.equal(t.sleeps.filter(ms => ms >= 1000).length, 2, 'ノートの間');
	} finally { t.restore(); }
});

test('まとめ投稿: 20件以下なら1ノートで、ページ表記は付かない(既存の形)', { skip }, async () => {
	const t = await setup({ existing: makeEmojis(1, 3), atOnce: true });
	try {
		await t.mod.post();
		assert.equal(t.posts.length, 1);
		assert.equal(t.posts[0].cw, 'テスト鯖に3件の絵文字が追加されました！', '1ノートなら、注釈にページ表記は付かない');
		assert.equal(t.posts[0].text, ':emoji_1:(`emoji_1`):emoji_2:(`emoji_2`):emoji_3:(`emoji_3`) #AddCustomEmojis');
		assert.equal(t.posts[0].replyId, undefined);
	} finally { t.restore(); }
});

test('まとめ投稿: 設定がなければ 20 件、正の整数でない設定も 20 件', { skip }, async () => {
	for (const size of [undefined, 0, -1, 1.5, 'abc', null]) {
		const old = makeEmojis(1, 1);
		const t = await setup({ existing: [...old, ...makeEmojis(2, 42)], lastId: old[0].id, atOnce: true, chunkSize: size });
		try {
			await t.mod.post();
			assert.deepEqual(t.posts.map(p => namesIn(p.text).length), [20, 20, 1], String(size));
		} finally { t.restore(); }
	}
	// 数値の文字列は数として読む
	const old = makeEmojis(1, 1);
	const t = await setup({ existing: [...old, ...makeEmojis(2, 11)], lastId: old[0].id, atOnce: true, chunkSize: '4' });
	try {
		await t.mod.post();
		assert.deepEqual(t.posts.map(p => namesIn(p.text).length), [4, 4, 2]);
	} finally { t.restore(); }
});

test('まとめ投稿: チャンクサイズが大きくても、3000字を超えないようにさらに分ける', { skip }, async () => {
	const old = [{ id: '000001', name: 'old' }];
	const added = Array.from({ length: 300 }, (_, i) => ({ id: String(i + 2).padStart(6, '0'), name: `emoji_${i + 2}_` + 'x'.repeat(30) }));
	const t = await setup({ existing: [...old, ...added], lastId: old[0].id, atOnce: true, chunkSize: 1000 });
	try {
		await t.mod.post();
		assert.ok(t.posts.length > 1);
		assert.ok(t.posts.every(p => p.text.length <= 3000), t.posts.map(p => p.text.length).join(','));
		const total = t.posts.length;
		t.posts.forEach((p, i) => assert.equal(p.cw, `テスト鯖に300件の絵文字が追加されました！(${i + 1}/${total})`));
		t.posts.forEach((p, i) => assert.equal(p.replyId, i === 0 ? undefined : 'n' + i));
		assert.equal(t.posts.flatMap(p => [...p.text.matchAll(/:(emoji_\d+_x+):/g)]).length, 300);
		assert.deepEqual(t.savedId(), [added[299].id]);
	} finally { t.restore(); }
});

test('まとめ投稿: 注釈が100字を超えるときは、サーバーの呼び名を「このサーバー」にする', { skip }, async () => {
	const old = makeEmojis(1, 1);
	// 「に45件の絵文字が追加されました！(n/3)」が22字なので、呼び名は78字までなら、そのまま使う
	for (const [name, expected] of [['あ'.repeat(78), 'あ'.repeat(78) + 'に45件の絵文字が追加されました！(1/3)'], ['あ'.repeat(79), 'このサーバーに45件の絵文字が追加されました！(1/3)']]) {
		const t = await setup({ existing: [...old, ...makeEmojis(2, 46)], lastId: old[0].id, atOnce: true });
		try {
			const config = (await import('../built/config.js')).default;
			config.serverName = name;
			await t.mod.post();
			assert.equal(t.posts[0].cw, expected);
			assert.ok(t.posts.every(p => p.cw.length <= 100));
		} finally { t.restore(); }
	}
});

test('個別投稿: 20件までは1件ずつ投稿し、返信でつなげない', { skip }, async () => {
	const old = makeEmojis(1, 1);
	const t = await setup({ existing: [...old, ...makeEmojis(2, 21)], lastId: old[0].id });
	try {
		await t.mod.post();
		assert.equal(t.posts[0].text, 'テスト鯖に20件の絵文字が追加されました！');
		assert.equal(t.posts.length, 21);
		assert.ok(t.posts.every(p => p.replyId === undefined), '個別投稿は返信でつなげない');
		assert.ok(t.posts.every(p => p.visibility === undefined), '定期の確認は、既定の公開範囲');
	} finally { t.restore(); }
});

test('個別投稿: 21件以上なら、まとめ投稿(チャンクサイズの設定どおり)に切り替える', { skip }, async () => {
	const old = makeEmojis(1, 1);
	const added = makeEmojis(2, 151);
	const t = await setup({ existing: [...old, ...added], lastId: old[0].id, chunkSize: 50 });
	try {
		await t.mod.post();
		assert.deepEqual(t.posts.map(p => namesIn(p.text).length), [50, 50, 50]);
		assert.equal(t.posts[0].cw, 'テスト鯖に150件の絵文字が追加されました！(1/3)');
		assert.equal(t.posts[1].cw, 'テスト鯖に150件の絵文字が追加されました！(2/3)');
		assert.equal(t.posts[1].replyId, 'n1');
		assert.deepEqual(t.posts.flatMap(p => namesIn(p.text)), added.map(e => e.name));
	} finally { t.restore(); }
});

test('投稿が途中で失敗したときは、IDを保存しない(保存済みのIDも消さない)', { skip }, async () => {
	const old = makeEmojis(1, 1);
	const t = await setup({ existing: [...old, ...makeEmojis(2, 46)], lastId: old[0].id, atOnce: true, chunkSize: 20 });
	try {
		let n = 0;
		const post = t.mod.ai.post;
		t.mod.ai.post = async note => { if (++n === 2) throw new Error('boom'); return post(note); };
		await assert.rejects(() => t.mod.post(), /boom/);
		assert.deepEqual(t.savedId(), [old[0].id]);
	} finally { t.restore(); }
});

// got の HTTPError と同じく、response.statusCode を持つエラー
const httpError = statusCode => Object.assign(new Error(`Response code ${statusCode}`), { response: { statusCode } });

for (const [label, err, key] of [
	['403(権限が無い)', httpError(403), 'errorPermission'],
	['401(トークンが無効)', httpError(401), 'errorPermission'],
	['500', httpError(500), 'error'],
	['通信のエラー', new Error('ECONNRESET'), 'error'],
]) {
	test(`取得が失敗(${label}): 定期の確認ではマスターにチャットで知らせ、投稿はしない`, { skip }, async () => {
		const t = await setup({ existing: [] });
		try {
			const api = t.mod.ai.api;
			t.mod.ai.api = async (endpoint, param) => { if (endpoint === 'admin/emoji/list') throw err; return api(endpoint, param); };
			await t.mod.post();
			assert.equal(t.posts.length, 0);
			assert.deepEqual(t.chats, [{ userId: 'id-master', text: t.serifs.checkCustomEmojis[key] }]);
			assert.deepEqual(t.savedId(), []);
		} finally { t.restore(); }
	});

	test(`取得が失敗(${label}): 頼まれたときは、頼んだ人に返事をする`, { skip }, async () => {
		const t = await setup({ existing: [] });
		try {
			t.mod.ai.api = async () => { throw err; };
			const msg = fakeMessage();
			await t.mod.post(msg);
			assert.deepEqual(msg.replies, [t.serifs.checkCustomEmojis[key]]);
			assert.equal(t.posts.length, 0);
			assert.equal(t.chats.length, 0);
		} finally { t.restore(); }
	});
}

test('取得が失敗: マスターが設定されていなければ、ログに残すだけ', { skip }, async () => {
	const t = await setup({ existing: [], master: undefined });
	try {
		t.mod.ai.api = async () => { throw httpError(403); };
		await t.mod.post();
		assert.equal(t.posts.length, 0);
		assert.equal(t.chats.length, 0);
	} finally { t.restore(); }
});

test('取得が失敗: マスターへのチャットが失敗しても、エラーにしない', { skip }, async () => {
	const t = await setup({ existing: [] });
	try {
		const api = t.mod.ai.api;
		t.mod.ai.api = async (endpoint, param) => { if (endpoint === 'admin/emoji/list') throw httpError(403); return api(endpoint, param); };
		t.mod.ai.sendMessage = async () => { throw new Error('not mutual'); };
		await t.mod.post();
		assert.equal(t.posts.length, 0);
	} finally { t.restore(); }
});

test('頼まれて追加が無いときは、頼んだ人に返事をする(定期の確認では何もしない)', { skip }, async () => {
	const old = makeEmojis(1, 1);
	for (const isChat of [false, true]) {
		const t = await setup({ existing: old, lastId: old[0].id });
		try {
			const msg = fakeMessage({ isChat });
			await t.mod.post(msg);
			assert.deepEqual(msg.replies, [t.serifs.checkCustomEmojis.nothing]);
			assert.equal(t.posts.length, 0);
			t.mod.ai.post = async () => assert.fail('定期の確認では投稿しない');
			await t.mod.post();
		} finally { t.restore(); }
	}
});

test('投稿で頼まれたとき: 個別投稿は、概要を頼んだ投稿への返信にし、各絵文字も同じ公開範囲で投稿する', { skip }, async () => {
	const old = makeEmojis(1, 1);
	const t = await setup({ existing: [...old, ...makeEmojis(2, 4)], lastId: old[0].id });
	try {
		const msg = fakeMessage();
		await t.mod.post(msg);
		assert.deepEqual(msg.replies, ['テスト鯖に3件の絵文字が追加されました！']);
		assert.equal(t.posts.length, 3);
		assert.ok(t.posts.every(p => p.visibility === 'specified' && p.visibleUserIds?.[0] === 'requester' && p.replyId === undefined));
		assert.deepEqual(t.savedId(), ['000004']);
	} finally { t.restore(); }
});

test('投稿で頼まれたとき: まとめ投稿は、1ノート目を頼んだ投稿への返信にし、続きをそれにつなげる', { skip }, async () => {
	const old = makeEmojis(1, 1);
	const added = makeEmojis(2, 46);
	const t = await setup({ existing: [...old, ...added], lastId: old[0].id, atOnce: true });
	try {
		const msg = fakeMessage();
		await t.mod.post(msg);
		assert.equal(msg.replies.length, 1);
		assert.equal(msg.replyOpts[0].cw, 'テスト鯖に45件の絵文字が追加されました！(1/3)', '頼んだ人への返信も折りたたむ');
		assert.ok(t.posts.every(p => p.cw.startsWith('テスト鯖に45件の絵文字が追加されました！')));
		assert.equal(t.posts.length, 2);
		assert.equal(t.posts[0].replyId, 'r1', '2ノート目は、頼んだ人への返信(1ノート目)につなげる');
		assert.equal(t.posts[1].replyId, 'n1');
		assert.ok(t.posts.every(p => p.visibility === 'specified' && p.visibleUserIds?.[0] === 'requester'));
		assert.deepEqual([msg.replies[0], ...t.posts.map(p => p.text)].flatMap(namesIn), added.map(e => e.name));
	} finally { t.restore(); }
});

test('チャットで頼まれたとき: 結果は、定期の確認と同じく公開の投稿にする', { skip }, async () => {
	const old = makeEmojis(1, 1);
	const t = await setup({ existing: [...old, ...makeEmojis(2, 3)], lastId: old[0].id });
	try {
		const msg = fakeMessage({ isChat: true });
		await t.mod.post(msg);
		assert.equal(msg.replies.length, 0);
		assert.equal(t.posts.length, 3);
		assert.ok(t.posts.every(p => p.visibility === undefined && p.replyId === undefined));
	} finally { t.restore(); }
});
