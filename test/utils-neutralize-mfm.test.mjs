// 利用者が書いた文字列を、投稿に入れても MFM などにならないようにする(src/utils/neutralize-mfm.ts)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neutralizeMfm } from '../built/utils/neutralize-mfm.js';

test('メンション・MFM・リンク・ハッシュタグ・絵文字コードになる記号を全角にし、制御文字を空白にする', () => {
	assert.equal(neutralizeMfm('@boss $[x4 a] <b> `c` **d** ~~e~~ #f :g: \\h [i](https://j)'), '＠boss ＄［x4 a］ ＜b＞ ｀c｀ ＊＊d＊＊ ～～e～～ ＃f ：g： ＼h ［i］（https：//j）');
	assert.equal(neutralizeMfm('一行目\n二行目\r\tタブ'), '一行目 二行目  タブ');
	assert.equal(neutralizeMfm('ふつうの名前 a_b-c.d!?'), 'ふつうの名前 a_b-c.d!?', 'ほかの文字は変えない');
});
