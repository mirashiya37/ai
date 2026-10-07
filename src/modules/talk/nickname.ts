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

/** 送った本人を指す言葉(一人称)。敬称を外したあとで、完全に一致したら本人とみなす */
const FIRST_PERSON = [
	'私', 'わたし', 'ワタシ', 'わたくし', 'ワタクシ', 'あたし', 'アタシ', 'あたい', 'アタイ',
	'僕', 'ぼく', 'ボク', '俺', 'おれ', 'オレ', 'おいら', 'オイラ', 'あっし',
	'うち', 'ウチ', '自分', 'わし', 'ワシ', 'わい', 'ワイ', '我', 'われ', 'ワレ',
	'拙者', '吾輩', '我輩', 'わがはい', '小生', '某', 'それがし', '余', '朕',
];

/** 藍を指す言葉(二人称と、藍の名前) */
const AI_NAMES = [
	'あなた', 'アナタ', '貴方', '貴女', 'あんた', 'アンタ', '君', 'きみ', 'キミ',
	'お前', 'おまえ', 'オマエ', '貴様', 'きさま', 'そなた', 'おぬし', 'お主', '汝', 'てめえ', 'てめぇ',
	'藍', 'あい', 'アイ', 'ai',
];

/**
 * 〇〇のあだ名の〇〇ではない言葉。
 * 「この/その/あの/どのあだ名」(「こ」+「の」に分けてしまう)、「別の/ほかの/違うのあだ名」(引き直し)、「誰の/何のあだ名」
 */
const NOT_A_PERSON = ['こ', 'そ', 'あ', 'ど', '別', '他', 'ほか', '外', '違う', 'ちがう', '次', '誰', 'だれ', '何', 'なに', 'なん'];

/** 〇〇の後ろの敬称。外してから一人称・藍の名前と比べる(「藍ちゃん」「僕ちゃん」など) */
const HONORIFIC = /(ちゃん|ちゃま|さん|さま|様|くん|たん|氏|殿|どの)$/;

export type AdanaTarget =
	| { kind: 'self' }
	| { kind: 'ai' }
	| { kind: 'other'; name: string };

/**
 * 誰のあだ名を考えるかを決める。
 * 「〇〇のあだ名」の〇〇が一人称か、〇〇が無ければ送った本人。〇〇が藍なら ai。それ以外は other。
 * other の name は、メンションの「@」と、ほかのサーバーの部分を外す(返信で、その人に通知が届かないようにする)
 */
export function parseAdanaTarget(text: string): AdanaTarget {
	const match = text.match(new RegExp(`([^\\s、。!！?？「」『』]+?)\\s*の(?:${ADANA_WORDS.join('|')})`));
	if (match == null) return { kind: 'self' };

	// 「@user@host」「@user」は「user」にする
	const name = match[1].replace(/^@?([^@]+)(@.*)?$/, '$1');
	if (name.length === 0 || name.length > MAX_TARGET_LENGTH || NOT_A_PERSON.includes(name)) return { kind: 'self' };

	// 敬称だけの語は、そのまま比べる
	const base = name.replace(HONORIFIC, '') || name;
	if (FIRST_PERSON.includes(base)) return { kind: 'self' };
	if (AI_NAMES.includes(base.toLowerCase())) return { kind: 'ai' };
	return { kind: 'other', name };
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
