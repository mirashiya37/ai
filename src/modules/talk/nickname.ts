import { safeForInterpolate } from '@/utils/safe-for-interpolate.js';
import { katakanaToHiragana, hiraganaToKatagana, hankakuToZenkaku } from '@/utils/japanese.js';

/** 呼び名にできる最大の長さ(core の「〇〇って呼んで」と同じ) */
const MAX_LENGTH = 10;

/** 呼び名にできるあだ名が出るまで、考え直す最大の回数 */
const MAX_TRIES = 10;

/** あだ名の提案に返事をするとき、「別のあだ名がいい」とみなす言葉 */
export const REROLL_WORDS = ['別の', 'ほかの', '他の', 'もう一回', 'もう一度', '引き直', 'やり直', '違うの', 'ちがうの'];

/** あだ名の話だとみなす言葉 */
export const ADANA_WORDS = ['あだな', 'あだ名', '渾名', 'あだにゃ'];

/** 提案への返事で、呼び名にしてよいとみなす言葉(否定を先に判定する。「ううん」は「うん」を含む) */
export const YES_WORDS = ['はい', 'いいよ', 'いいね', 'いいですね', 'うん', 'それで', 'お願い', 'おねがい', '気に入', 'ok', 'オーケー'];

/** 提案への返事で、断るとみなす言葉 */
export const NO_WORDS = ['いいえ', 'ううん', 'いや', 'やだ', '嫌', 'だめ', 'やめ'];

/** チャットでの提案への返事を待つ時間(ミリ秒)。チャットは返信先の投稿が無く、この人の次の発言がすべて返事になってしまうため */
export const CHAT_REPLY_TTL = 10 * 60 * 1000;

/** チャットの待ち受けが、待つ時間を過ぎているか。時刻の記録(at)が無い以前の形のものは、過ぎていないとみなす */
export function isChatReplyExpired(at: number | undefined, now: number): boolean {
	return at != null && now - at > CHAT_REPLY_TTL;
}

/**
 * 提案への返事は、文の頭にあるとみなす。チャットでは「はい、おやすみ」は返事、「別の話だけど」は返事ではない。
 * 頭の句読点や空白は読み飛ばす
 */
export function startsWithReplyWord(text: string): boolean {
	const normalized = katakanaToHiragana(hankakuToZenkaku(text)).toLowerCase().replace(/^[\s、。，．,.!！?？…～~「『(（]+/, '');
	return [...YES_WORDS, ...NO_WORDS, ...REROLL_WORDS].some(word => normalized.startsWith(katakanaToHiragana(word).toLowerCase()));
}

/** 「あだ名」の言葉を、ひらがなとカタカナのどちらで書かれても拾う正規表現にする(「アダナ」「あだニャ」) */
function kanaInsensitive(word: string): string {
	return [...word].map(c => {
		const hira = katakanaToHiragana(c);
		const kata = hiraganaToKatagana(c);
		return hira === kata ? c : `[${hira}${kata}]`;
	}).join('');
}

/** 「〇〇のあだ名」の〇〇として受け付ける最大の長さ。長いものは、文の一部を拾ったとみなす */
const MAX_TARGET_LENGTH = 20;

/** 〇〇の後ろの敬称。「〇〇さんのあだ名」のように敬称が付いたものだけを、ほかの人とみなす */
const HONORIFIC_WORDS = 'ちゃん|ちゃま|さん|さま|様|くん|君|氏|殿|先輩|せんぱい|先生|せんせい';
const HONORIFIC = new RegExp(`(${HONORIFIC_WORDS})$`);

/** 〇〇の前に付く呼びかけ。「ねえ田中さんのあだ名」の「ねえ」は、名前に含めない */
const LEADING_WORDS = ['ねえねえ', 'ねーねー', 'ねえ', 'ねぇ', 'ねー', 'ところで', 'ちょっと', 'じゃあ', 'じゃー', 'えっと', 'えーと', 'おい', 'そういえば', 'ちなみに', 'それと', 'それから'];

/** 〇〇の前に付く一人称の「の」。「私の友達の田中さん」の「私の」は、名前に含めない(藍のことと取り違えないため) */
const FIRST_PERSON_POSSESSIVE = /^(?:私|わたし|ワタシ|僕|ぼく|ボク|俺|おれ|オレ|あたし|アタシ|うち|自分|わし|ワイ)の/;

/**
 * 〇〇の頭の、呼びかけと一人称の「の」を外す。外した残りが敬称だけになるとき(「ねえさん」)は、名前の一部とみなして外さない
 */
function stripLeading(name: string): string {
	const stripped = (rest: string) => rest.replace(HONORIFIC, '').length > 0;
	let current = name;
	for (let changed = true; changed;) {
		changed = false;
		for (const word of LEADING_WORDS) {
			if (current.startsWith(word) && stripped(current.slice(word.length))) {
				current = current.slice(word.length);
				changed = true;
				break;
			}
		}
	}
	const possessive = current.match(FIRST_PERSON_POSSESSIVE);
	if (possessive != null && stripped(current.slice(possessive[0].length))) current = current.slice(possessive[0].length);
	return current;
}

/** 藍を指す言葉(二人称)。敬称が無くても、藍とみなす */
const SECOND_PERSON = [
	'あなた', 'アナタ', '貴方', '貴女', 'あんた', 'アンタ', '君', 'きみ', 'キミ',
	'お前', 'おまえ', 'オマエ', '貴様', 'きさま', 'そなた', 'おぬし', 'お主', '汝', 'てめえ', 'てめぇ',
];

/** 藍の名前。「藍ちゃん」「@ai」のように、敬称かメンションが付いたときだけ藍とみなす(「藍」「あい」は友達の名前かもしれない) */
const AI_NAMES = ['藍', 'あい', 'アイ', 'ai'];

/**
 * 「〇〇のあだ名」の〇〇。name は、メンションなら「@」とサーバー名を外したもの。敬称は付けたまま。
 * host は、メンションに付いていたサーバー名(「@user@host」の host。無ければ null)
 */
export type AdanaTargetWord = { name: string; base: string; honorific: boolean; mention: boolean; host: string | null };

/**
 * 「〇〇のあだ名」の〇〇を取り出す。なければ null。
 * 誰のものかの分類は、parseAdanaTarget() で行う。
 */
export function findAdanaTarget(text: string): AdanaTargetWord | null {
	const adana = ADANA_WORDS.map(kanaInsensitive).join('|');
	// 「@bob さんのあだ名」のように、メンションと敬称のあいだに空白があるものは、ひとまとまりにする
	const spaced = text.match(new RegExp(`(@[^\\s@、。!！?？「」『』]+(?:@[^\\s、。!！?？「」『』]+)?)\\s+(${HONORIFIC_WORDS})\\s*の(?:${adana})`));
	const match = spaced ?? text.match(new RegExp(`([^\\s、。!！?？「」『』]+?)\\s*の(?:${adana})`));
	if (match == null) return null;

	const mention = match[1].startsWith('@');
	// 「@user@host」「@user」は「user」にする(返信で、その人に通知が届かないようにする)
	const parts = match[1].match(/^@?([^@]+)(?:@(.*))?$/);
	const name = mention ? (parts?.[1] ?? match[1]) + (spaced?.[2] ?? '') : stripLeading(parts?.[1] ?? match[1]);
	const host = mention ? (parts?.[2] || null) : null;
	if (name.length === 0 || name.length > MAX_TARGET_LENGTH) return null;

	const base = name.replace(HONORIFIC, '');
	const honorific = base !== name && base.length > 0;
	return { name, base: honorific ? base : name, honorific, mention, host };
}

export type AdanaTarget =
	| { kind: 'self' }
	| { kind: 'ai' }
	| { kind: 'master' }
	| { kind: 'other'; name: string };

/** マスターとみなす〇〇。使わないなら parseAdanaTarget() に渡さない */
export type AdanaMasterNames = {
	/** マスターのユーザー名。「@ユーザー名」(このサーバーのユーザー)ならマスター */
	username: string;
	/** マスターの名前。敬称が付いても付かなくても、マスターとみなす */
	names: readonly string[];
	/** このサーバーのホスト名。「@ユーザー名@このサーバー」もマスターとみなす */
	localHost?: string;
};

/**
 * 誰のあだ名を考えるかを決める。
 * - 「〇〇さんのあだ名」「@user のあだ名」(敬称かメンションが付く): ほかの人(other)。藍の名前なら ai
 * - 「あなたのあだ名」(二人称): ai
 * - master を渡したとき、〇〇がマスターの名前(敬称は問わない)か「@マスター」(このサーバーのユーザー): master
 * - それ以外(「あだ名」「わたしのあだ名」「田中のあだ名」など): 送った本人(self)
 * 一人称は「〇〇さん」にならないので、見分けるリストは要らない。
 * @param master マスターのあだ名を使うときに渡す
 * @param otherNames マスターのあだ名を使わないとき、敬称やメンションが無くてもほかの人とみなす名前
 *   (マスターの名前を、送った本人のあだ名と取り違えないため)
 */
export function parseAdanaTarget(text: string, master?: AdanaMasterNames, otherNames: readonly string[] = []): AdanaTarget {
	const target = findAdanaTarget(text);
	if (target == null) return { kind: 'self' };

	if (master != null && isMasterTarget(target, master)) return { kind: 'master' };
	if (!target.mention && (otherNames.includes(target.name) || otherNames.includes(target.base))) return { kind: 'other', name: target.name };

	if (SECOND_PERSON.includes(target.base)) return { kind: 'ai' };
	if (!target.honorific && !target.mention) return { kind: 'self' };
	if (AI_NAMES.includes(target.base.toLowerCase())) return { kind: 'ai' };
	return { kind: 'other', name: target.name };
}

function isMasterTarget(target: AdanaTargetWord, master: AdanaMasterNames): boolean {
	if (target.mention) {
		// ほかのサーバーに同じユーザー名の人がいても、マスターにしない
		const local = target.host == null || (master.localHost != null && target.host.toLowerCase() === master.localHost.toLowerCase());
		return local && target.name.toLowerCase() === master.username.toLowerCase();
	}
	return master.names.includes(target.name) || master.names.includes(target.base);
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
