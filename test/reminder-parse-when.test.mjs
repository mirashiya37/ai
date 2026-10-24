// リマインダー: 日時の読み取り(src/modules/reminder/parse-when.ts)
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { parseWhen, checkWhen } = await import('../built/modules/reminder/parse-when.js');

// 2026-10-25(日) 15:30:20 を「今」にする(動かす環境の時刻で作るので、タイムゾーンによらない)
const NOW = new Date(2026, 9, 25, 15, 30, 20);
const d = (y, mo, da, h = 0, mi = 0) => new Date(y, mo - 1, da, h, mi);

const parse = text => {
	const w = parseWhen(text, NOW);
	return w && { at: w.at.getTime(), rest: w.rest };
};
const ok = (at, rest) => ({ at: at.getTime(), rest });

test('相対(分・時間・日・週間)', () => {
	assert.deepEqual(parse('30分後 洗濯物'), ok(new Date(NOW.getTime() + 30 * 60000), '洗濯物'));
	assert.deepEqual(parse('1時間後に 牛乳を買う'), ok(new Date(NOW.getTime() + 3600000), '牛乳を買う'));
	assert.deepEqual(parse('１０分後、電話'), ok(new Date(NOW.getTime() + 600000), '電話'));
	// 日・週間は、日付として数え、時刻の指定がなければ 9時
	assert.deepEqual(parse('3日後 ゴミ出し'), ok(d(2026, 10, 28, 9), 'ゴミ出し'));
	assert.deepEqual(parse('2週間後 更新'), ok(d(2026, 11, 8, 9), '更新'));
	assert.deepEqual(parse('3日後の18時 飲み会'), ok(d(2026, 10, 28, 18), '飲み会'));
	// 月をまたぐ
	assert.deepEqual(parse('7日後 x'), ok(d(2026, 11, 1, 9), 'x'));
});

test('今日・明日・あさって', () => {
	assert.deepEqual(parse('明日 ゴミ出し'), ok(d(2026, 10, 26, 9), 'ゴミ出し'));
	assert.deepEqual(parse('明日の9時 会議の資料'), ok(d(2026, 10, 26, 9), '会議の資料'));
	assert.deepEqual(parse('明日 午後3時半 会議'), ok(d(2026, 10, 26, 15, 30), '会議'));
	assert.deepEqual(parse('あさって 18:30 飲み会'), ok(d(2026, 10, 27, 18, 30), '飲み会'));
	assert.deepEqual(parse('明後日に 荷物'), ok(d(2026, 10, 27, 9), '荷物'));
	assert.deepEqual(parse('今日 20時 お風呂'), ok(d(2026, 10, 25, 20), 'お風呂'));
	// 今日の朝 9時は過ぎているので、あとで範囲の判定が断る
	assert.deepEqual(parse('今日 洗濯'), ok(d(2026, 10, 25, 9), '洗濯'));
});

test('日付', () => {
	assert.deepEqual(parse('10/30 18:00 締め切り'), ok(d(2026, 10, 30, 18), '締め切り'));
	assert.deepEqual(parse('12月3日 午後3時 歯医者'), ok(d(2026, 12, 3, 15), '歯医者'));
	assert.deepEqual(parse('２０２７/１/５ 年始'), ok(d(2027, 1, 5, 9), '年始'));
	assert.deepEqual(parse('2027年2月3日の10時 x'), ok(d(2027, 2, 3, 10), 'x'));
	assert.deepEqual(parse('2027-02-03 x'), ok(d(2027, 2, 3, 9), 'x'));
	// 年がなく、もう過ぎた日付なら来年。今日は過ぎていない
	assert.deepEqual(parse('10/24 x'), ok(d(2027, 10, 24, 9), 'x'));
	assert.deepEqual(parse('10/25 x'), ok(d(2026, 10, 25, 9), 'x'));
	assert.deepEqual(parse('1月1日 x'), ok(d(2027, 1, 1, 9), 'x'));
	// 年を書いたなら、過ぎていても来年にしない
	assert.deepEqual(parse('2026/1/1 x'), ok(d(2026, 1, 1, 9), 'x'));
});

test('時刻だけ(過ぎていたら明日)', () => {
	assert.deepEqual(parse('21時 お風呂'), ok(d(2026, 10, 25, 21), 'お風呂'));
	assert.deepEqual(parse('9時 起きる'), ok(d(2026, 10, 26, 9), '起きる'));
	assert.deepEqual(parse('15:30 x'), ok(d(2026, 10, 26, 15, 30), 'x'));
	assert.deepEqual(parse('15:31 x'), ok(d(2026, 10, 25, 15, 31), 'x'));
	assert.deepEqual(parse('９時３０分 x'), ok(d(2026, 10, 26, 9, 30), 'x'));
});

test('午前・午後と、24時間の端の値', () => {
	const at = text => parse(text + ' x').at;
	assert.equal(at('明日 午前12時'), d(2026, 10, 26, 0).getTime());
	assert.equal(at('明日 午後12時'), d(2026, 10, 26, 12).getTime());
	assert.equal(at('明日 午前0時'), d(2026, 10, 26, 0).getTime());
	assert.equal(at('明日 午後1時'), d(2026, 10, 26, 13).getTime());
	assert.equal(at('明日 0時'), d(2026, 10, 26, 0).getTime());
	assert.equal(at('明日 23:59'), d(2026, 10, 26, 23, 59).getTime());
});

test('年・月をまたぐ', () => {
	const dec = new Date(2026, 11, 31, 23, 50);
	const w = parseWhen('20分後 x', dec);
	assert.deepEqual(w.at, new Date(2027, 0, 1, 0, 10));
	assert.deepEqual(parseWhen('明日 x', dec).at, new Date(2027, 0, 1, 9));
	assert.deepEqual(parseWhen('1/1 x', dec).at, new Date(2027, 0, 1, 9));
});

test('日時と読まないもの', () => {
	for (const text of [
		'牛乳を買う',
		'明日の準備をする', // 「明日」のあとが区切りでない
		'3時間かかる', // 時刻の「3時」ではない
		'3時のおやつ',
		'明日は雨',
		'25時 x',
		'午後13時 x',
		'9時60分 x',
		'2/30 x', // 存在しない日付
		'13/1 x',
		'10日後ろ',
		'12345分後 x',
		'',
	]) {
		assert.equal(parse(text), null, text);
	}
});

test('日時だけで内容がないときは、rest が空になる', () => {
	assert.deepEqual(parse('明日'), ok(d(2026, 10, 26, 9), ''));
	assert.deepEqual(parse('30分後'), ok(new Date(NOW.getTime() + 30 * 60000), ''));
});

test('「明日」のあとが時刻でなければ、日付だけを読み、続きは内容にする', () => {
	assert.deepEqual(parse('明日 9時間の会議'), ok(d(2026, 10, 26, 9), '9時間の会議'));
});

test('改行で区切っても読める', () => {
	assert.deepEqual(parse('明日\n牛乳\n卵'), ok(d(2026, 10, 26, 9), '牛乳\n卵'));
});

test('指定できる範囲', () => {
	const at = ms => new Date(NOW.getTime() + ms);
	assert.equal(checkWhen(at(-1000), NOW), 'past');
	assert.equal(checkWhen(at(59 * 1000), NOW), 'past');
	assert.equal(checkWhen(at(60 * 1000), NOW), 'ok');
	assert.equal(checkWhen(at(365 * 86400000), NOW), 'ok');
	assert.equal(checkWhen(at(365 * 86400000 + 1), NOW), 'far');
});
