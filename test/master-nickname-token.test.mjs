// マスターのあだ名: トークンの検証(src/modules/master-nickname/token-check.ts)
// 権限の一覧は、Misskey 2026.10.0 の /api.json から、権限とパラメーターの型だけを取り出したもの(test/fixtures/misskey-api-permissions.json)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildProbes, runProbe, checkToken, apiErrorCode, ALLOWED_PERMISSIONS } from '../built/modules/master-nickname/token-check.js';

const SPEC = JSON.parse(readFileSync(new URL('./fixtures/misskey-api-permissions.json', import.meta.url), 'utf8'));

/** got の HTTPError と同じ形(err.response.statusCode、err.response.body は JSON の文字列) */
function httpError(statusCode, code) {
	return Object.assign(new Error(`Response code ${statusCode}`), { name: 'HTTPError', response: { statusCode, body: JSON.stringify({ error: { message: code, code, id: 'x' } }) } });
}

/**
 * Misskey の API の偽物。本物と同じく「secure → レート制限 → 権限 → パラメーターの検査 → 処理」の順に判定する。
 * 処理まで進んだ API を executed に記録する(書き込みの API が処理まで進まないことを確かめるため)
 */
function fakeServer({ permissions = [...ALLOWED_PERMISSIONS], native = false, username = 'boss', host = null, rateLimited = [] } = {}) {
	const endpoints = new Map();
	for (const [path, item] of Object.entries(SPEC.paths)) {
		endpoints.set(path.slice(1), {
			kind: item.post.description.match(/\*\*Permission\*\*: \*([\w:-]+)\*/)[1],
			schema: item.post.requestBody?.content?.['application/json']?.schema,
		});
	}
	const executed = [];
	const call = async (endpoint, params) => {
		if (endpoint === 'i/apps') {
			if (!native) throw httpError(403, 'ACCESS_DENIED');
			executed.push(endpoint);
			return [];
		}
		if (rateLimited.includes(endpoint)) throw httpError(429, 'RATE_LIMIT_EXCEEDED');
		const ep = endpoints.get(endpoint);
		if (ep == null) throw httpError(404, 'NO_SUCH_ENDPOINT');
		if (!native && !permissions.includes(ep.kind)) throw httpError(403, 'PERMISSION_DENIED');
		for (const [name, value] of Object.entries(params)) {
			const type = ep.schema?.properties?.[name]?.type;
			const types = Array.isArray(type) ? type : [type];
			if (type != null && value != null && typeof value === 'object' && !Array.isArray(value) && !types.includes('object')) throw httpError(400, 'INVALID_PARAM');
		}
		if ((ep.schema?.required ?? []).some(name => !(name in params))) throw httpError(400, 'INVALID_PARAM');
		executed.push(endpoint);
		if (endpoint === 'i') return { id: 'm1', username, host, name: 'ボス' };
		return {};
	};
	return { call, executed };
}

const ALL_PERMISSIONS = [...new Set(Object.values(SPEC.paths).map(item => item.post.description.match(/\*\*Permission\*\*: \*([\w:-]+)\*/)[1]))];
const fetchSpec = async () => SPEC;

test('エラーコードを取り出す(本文は JSON の文字列。取り出せなければ null)', () => {
	assert.equal(apiErrorCode(httpError(400, 'INVALID_PARAM')), 'INVALID_PARAM');
	assert.equal(apiErrorCode({ response: { body: { error: { code: 'PERMISSION_DENIED' } } } }), 'PERMISSION_DENIED');
	assert.equal(apiErrorCode({ response: { body: '<html>' } }), null);
	assert.equal(apiErrorCode(new Error('ECONNREFUSED')), null);
	assert.equal(apiErrorCode(undefined), null);
});

test('本物の権限の一覧: 許された2つ以外の、すべての権限に調べ方があり、調べられないのは write:admin:drive だけ', () => {
	const { probes, unprobeable } = buildProbes(SPEC);
	const permissions = probes.map(probe => probe.permission);
	assert.deepEqual(unprobeable, ['write:admin:drive']);
	assert.deepEqual([...permissions, ...unprobeable].sort(), ALL_PERMISSIONS.filter(p => !ALLOWED_PERMISSIONS.includes(p)).sort());
	assert.ok(!permissions.includes('write:account') && !permissions.includes('read:account'));
	for (const probe of probes.filter(p => !p.permission.startsWith('read:'))) {
		assert.equal(probe.mode, 'invalid', `${probe.permission}: 書き込みの権限は、不正なパラメーターでしか調べない`);
	}
});

test('どの権限も持つトークンでも、書き込みの API は処理まで進まない(調べるだけで、何も変えない)', async () => {
	const server = fakeServer({ permissions: ALL_PERMISSIONS });
	const result = await checkToken(server.call, fetchSpec, 'boss');
	assert.equal(result.ok, false);
	const kinds = new Map(Object.entries(SPEC.paths).map(([path, item]) => [path.slice(1), item.post.description.match(/\*\*Permission\*\*: \*([\w:-]+)\*/)[1]]));
	for (const endpoint of server.executed) {
		assert.ok(kinds.get(endpoint).startsWith('read:'), `${endpoint}(${kinds.get(endpoint)})が処理まで進んだ`);
	}
	assert.match(result.problems.join('\n'), /要らない権限があります: .+ ほか\d+個/);
	assert.ok(!result.problems.join('\n').includes('write:account'), '許された権限は挙げない');
});

test('read:account と write:account だけなら、使える', async () => {
	const server = fakeServer();
	const result = await checkToken(server.call, fetchSpec, 'boss');
	assert.deepEqual(result, { ok: true, user: { id: 'm1', username: 'boss', name: 'ボス' }, unprobeable: ['write:admin:drive'] });
	assert.deepEqual(server.executed, ['i'], 'i だけが処理まで進む');
});

test('要らない権限が1つでもあれば、その権限を挙げて使わない', async () => {
	for (const extra of ['read:notifications', 'write:notes', 'write:admin:delete-account', 'read:clip-favorite']) {
		const result = await checkToken(fakeServer({ permissions: [...ALLOWED_PERMISSIONS, extra] }).call, fetchSpec, 'boss');
		assert.equal(result.ok, false, extra);
		assert.deepEqual(result.problems, [`要らない権限があります: ${extra}`], extra);
	}
});

test('ブラウザのログインのトークン(secure な API が通る)は、使わない。権限の一覧は、先頭の数個と残りの個数にする', async () => {
	const result = await checkToken(fakeServer({ native: true }).call, fetchSpec, 'boss');
	assert.equal(result.ok, false);
	assert.match(result.problems[0], /ブラウザのログインのトークン/);
	assert.match(result.problems[1], /^要らない権限があります: (read|write):[\w:-]+(, (read|write):[\w:-]+){4} ほか\d+個$/);
});

test('持ち主がマスターでない(ほかの人、ほかのサーバーの同じユーザー名)なら、ほかは調べずに使わない', async () => {
	for (const [username, host] of [['alice', null], ['boss', 'remote.example']]) {
		const server = fakeServer({ username, host });
		const result = await checkToken(server.call, fetchSpec, 'boss');
		assert.equal(result.ok, false);
		assert.match(result.problems[0], /マスター\(@boss\)のトークンではありません/);
		assert.deepEqual(server.executed, ['i']);
	}
	assert.equal((await checkToken(fakeServer({ username: 'Boss' }).call, fetchSpec, 'boss')).ok, true, '大文字小文字は問わない');
});

test('read:account・write:account が無ければ、使わない', async () => {
	const noRead = await checkToken(fakeServer({ permissions: ['write:account'] }).call, fetchSpec, 'boss');
	assert.deepEqual(noRead, { ok: false, problems: ['アカウントを読めません(PERMISSION_DENIED)'], unprobeable: [] });
	const noWrite = await checkToken(fakeServer({ permissions: ['read:account'] }).call, fetchSpec, 'boss');
	assert.equal(noWrite.ok, false);
	assert.match(noWrite.problems[0], /write:account.*がありません/);
});

test('分からないとき(権限の一覧が取れない、レート制限、通信の失敗)は、安全のため使わない', async () => {
	const noSpec = await checkToken(fakeServer().call, async () => { throw new Error('ECONNREFUSED'); }, 'boss');
	assert.equal(noSpec.ok, false);
	assert.match(noSpec.problems.join(), /権限の一覧\(\/api\.json\)が取れません/);

	const emptySpec = await checkToken(fakeServer().call, async () => ({ paths: {} }), 'boss');
	assert.equal(emptySpec.ok, false, '調べる API が無いのは、おかしい');

	const limited = await checkToken(fakeServer({ rateLimited: ['notes/create'] }).call, fetchSpec, 'boss');
	assert.equal(limited.ok, false);
	assert.match(limited.problems.join(), /確かめられなかった権限があります: write:notes/);

	assert.equal(await runProbe(async () => { throw new Error('ECONNRESET'); }, { endpoint: 'x', params: {} }), 'unknown');
});

test('調べた結果の判定: 処理が通った・パラメーターのエラー・各 API のエラーは「ある」、権限・ロールのエラーは「無い」', async () => {
	const result = async error => runProbe(async () => { if (error) throw error; return {}; }, { endpoint: 'x', params: {} });
	assert.equal(await result(null), 'granted');
	assert.equal(await result(httpError(400, 'INVALID_PARAM')), 'granted');
	assert.equal(await result(httpError(400, 'NO_SUCH_NOTE')), 'granted');
	for (const code of ['PERMISSION_DENIED', 'ROLE_PERMISSION_DENIED', 'ACCESS_DENIED', 'CREDENTIAL_REQUIRED']) assert.equal(await result(httpError(403, code)), 'denied', code);
	for (const code of ['RATE_LIMIT_EXCEEDED', 'AUTHENTICATION_FAILED', 'INTERNAL_ERROR']) assert.equal(await result(httpError(429, code)), 'unknown', code);
});

test('調べ方の選び方: 型のあるプロパティに object を入れる。無ければ、読み取りは実際に呼び、書き込みは調べない', () => {
	const spec = { paths: {
		'/a/write': { post: { description: '**Permission**: *write:a*', requestBody: { content: { 'application/json': { schema: { properties: { obj: { type: 'object' }, any: {}, id: { type: ['string', 'null'] } } } } } } } },
		'/a/read': { post: { description: '**Permission**: *read:a*' } },
		'/b/write': { post: { description: '**Permission**: *write:b*', requestBody: { content: { 'application/json': { schema: { properties: { obj: { type: 'object' } } } } } } } },
		'/account': { post: { description: '**Permission**: *write:account*', requestBody: { content: { 'application/json': { schema: { properties: { name: { type: 'string' } } } } } } } },
		'/no-permission': { post: { description: 'No description provided.' } },
	} };
	assert.deepEqual(buildProbes(spec), {
		probes: [
			{ permission: 'read:a', endpoint: 'a/read', params: {}, mode: 'read' },
			{ permission: 'write:a', endpoint: 'a/write', params: { id: { invalid: true } }, mode: 'invalid' },
		],
		unprobeable: ['write:b'],
	});
});
