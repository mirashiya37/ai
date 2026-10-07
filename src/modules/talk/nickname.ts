import { safeForInterpolate } from '@/utils/safe-for-interpolate.js';

/** 呼び名にできる最大の長さ(core の「〇〇って呼んで」と同じ) */
const MAX_LENGTH = 10;

/** 呼び名にできるあだ名が出るまで、考え直す最大の回数 */
const MAX_TRIES = 10;

/** あだ名の提案に返事をするとき、「別のあだ名がいい」とみなす言葉 */
export const REROLL_WORDS = ['別の', 'ほかの', '他の', 'もう一回', 'もう一度', '引き直', 'やり直', '違うの', 'ちがうの'];

/** あだ名の話だとみなす言葉 */
export const ADANA_WORDS = ['あだな', 'あだ名', '渾名', 'あだにゃ'];

/** 「〇〇のあだ名」の〇〇として受け付ける最大の長さ。長いものは、文の一部を拾ったとみなす */
const MAX_TARGET_LENGTH = 20;

/** 〇〇の後ろの敬称。「〇〇さんのあだ名」のように敬称が付いたものだけを、ほかの人とみなす */
const HONORIFIC = /(ちゃん|ちゃま|さん|さま|様|くん|氏|殿)$/;

/** 藍を指す言葉(二人称)。敬称が無くても、藍とみなす */
const SECOND_PERSON = [
	'あなた', 'アナタ', '貴方', '貴女', 'あんた', 'アンタ', '君', 'きみ', 'キミ',
	'お前', 'おまえ', 'オマエ', '貴様', 'きさま', 'そなた', 'おぬし', 'お主', '汝', 'てめえ', 'てめぇ',
];

/** 藍の名前。「藍ちゃん」「@ai」のように、敬称かメンションが付いたときだけ藍とみなす(「藍」「あい」は友達の名前かもしれない) */
const AI_NAMES = ['藍', 'あい', 'アイ', 'ai'];

/** 「〇〇のあだ名」の〇〇。name は、メンションなら「@」とサーバー名を外したもの。敬称は付けたまま */
export type AdanaTargetWord = { name: string; base: string; honorific: boolean; mention: boolean };

/**
 * 「〇〇のあだ名」の〇〇を取り出す。なければ null。
 * 誰のものかの分類は、parseAdanaTarget() で行う。
 */
export function findAdanaTarget(text: string): AdanaTargetWord | null {
	const match = text.match(new RegExp(`([^\\s、。!！?？「」『』]+?)\\s*の(?:${ADANA_WORDS.join('|')})`));
	if (match == null) return null;

	const mention = match[1].startsWith('@');
	// 「@user@host」「@user」は「user」にする(返信で、その人に通知が届かないようにする)
	const name = match[1].replace(/^@?([^@]+)(@.*)?$/, '$1');
	if (name.length === 0 || name.length > MAX_TARGET_LENGTH) return null;

	const base = name.replace(HONORIFIC, '');
	const honorific = base !== name && base.length > 0;
	return { name, base: honorific ? base : name, honorific, mention };
}

export type AdanaTarget =
	| { kind: 'self' }
	| { kind: 'ai' }
	| { kind: 'other'; name: string };

/**
 * 誰のあだ名を考えるかを決める。
 * - 「〇〇さんのあだ名」「@user のあだ名」(敬称かメンションが付く): ほかの人(other)。藍の名前なら ai
 * - 「あなたのあだ名」(二人称): ai
 * - それ以外(「あだ名」「わたしのあだ名」「田中のあだ名」など): 送った本人(self)
 * 一人称は「〇〇さん」にならないので、見分けるリストは要らない。
 */
export function parseAdanaTarget(text: string): AdanaTarget {
	const target = findAdanaTarget(text);
	if (target == null) return { kind: 'self' };

	if (SECOND_PERSON.includes(target.base)) return { kind: 'ai' };
	if (!target.honorific && !target.mention) return { kind: 'self' };
	if (AI_NAMES.includes(target.base.toLowerCase())) return { kind: 'ai' };
	return { kind: 'other', name: target.name };
}

/** 呼び名にできるか。条件は core の「〇〇って呼んで」と同じ */
export function canBeName(name: string): boolean {
	return name.length <= MAX_LENGTH && safeForInterpolate(name);
}

/**
 * 呼び名にできるあだ名を1つ考える。
 * @param generate あだ名の候補を作る関数(呼ぶたびに別の候補になる)
 * @param exclude すでに出したあだ名。同じものは出さない
 * @returns 考えつかなければ null
 */
export function pickNickname(generate: () => string, exclude: readonly string[] = []): string | null {
	for (let i = 0; i < MAX_TRIES; i++) {
		const item = generate();
		if (canBeName(item) && !exclude.includes(item)) return item;
	}
	return null;
}
