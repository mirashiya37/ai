// マスターのあだ名: コマンド(/nickname)の解釈(src/modules/master-nickname/commands.ts)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNicknameCommand } from '../built/modules/master-nickname/commands.js';

test('/nickname で始まらなければ null', () => {
	for (const text of ['nickname status', 'あだ名', '/keywords', '/nicknames status', '']) assert.equal(parseNicknameCommand(text), null, text);
});

test('設定のコマンド', () => {
	const table = [
		['/nickname', { type: 'help' }],
		['/nickname help', { type: 'help' }],
		['/nickname status', { type: 'status' }],
		['/NICKNAME Status', { type: 'status' }],
		['  /nickname   on  ', { type: 'enabled', value: true }],
		['/nickname off', { type: 'enabled', value: false }],
		['/nickname notify mention', { type: 'notify', value: 'mention' }],
		['/nickname notify CHAT', { type: 'notify', value: 'chat' }],
		['/nickname notify off', { type: 'notify', value: 'off' }],
		['/nickname callname on', { type: 'callname', value: true }],
		['/nickname callname off', { type: 'callname', value: false }],
		['/nickname visibility home', { type: 'visibility', value: 'home' }],
		['/nickname daily 0', { type: 'daily', value: 0 }],
		['/nickname daily 3', { type: 'daily', value: 3 }],
		['/nickname interval 30', { type: 'interval', value: 30 }],
		['/nickname reset', { type: 'reset' }],
	];
	for (const [text, expected] of table) assert.deepEqual(parseNicknameCommand(text), expected, text);
});

test('表示名の変更のコマンド', () => {
	for (const action of ['on', 'off', 'setup', 'revert', 'forget', 'check']) {
		assert.deepEqual(parseNicknameCommand(`/nickname rename ${action}`), { type: 'rename', action });
	}
	assert.deepEqual(parseNicknameCommand('/nickname rename mode approval'), { type: 'renameMode', value: 'approval' });
	assert.deepEqual(parseNicknameCommand('/nickname rename mode immediate'), { type: 'renameMode', value: 'immediate' });
});

test('値がおかしいときは、書き方を返す', () => {
	for (const text of [
		'/nickname notify all', '/nickname callname yes', '/nickname visibility followers',
		'/nickname daily', '/nickname daily -1', '/nickname daily 1.5', '/nickname interval abc',
		'/nickname rename', '/nickname rename mode', '/nickname rename mode later', '/nickname rename start',
	]) {
		const result = parseNicknameCommand(text);
		assert.equal(result.type, 'error', text);
		assert.match(result.message, /^書き方: \/nickname/, text);
	}
	assert.equal(parseNicknameCommand('/nickname unknown').type, 'error');
	assert.match(parseNicknameCommand('/nickname unknown').message, /知らないコマンド/);
});
