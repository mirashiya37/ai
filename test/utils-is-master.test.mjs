// マスターの判定(src/utils/is-master.ts)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isMaster } from '../built/utils/is-master.js';

test('ローカルの、同じユーザー名のユーザーだけをマスターとする', () => {
	assert.equal(isMaster({ username: 'admin', host: null }, 'admin'), true);
	assert.equal(isMaster({ username: 'admin' }, 'admin'), true);
	assert.equal(isMaster({ username: 'admin', host: 'example.com' }, 'admin'), false);
	assert.equal(isMaster({ username: 'other', host: null }, 'admin'), false);
});

test('master が未設定なら、誰もマスターではない', () => {
	assert.equal(isMaster({ username: 'admin', host: null }, undefined), false);
	assert.equal(isMaster({ username: '', host: null }, ''), false);
});
