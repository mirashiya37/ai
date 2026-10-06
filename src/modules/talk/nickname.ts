import { safeForInterpolate } from '@/utils/safe-for-interpolate.js';

/** 呼び名にできる最大の長さ(core の「〇〇って呼んで」と同じ) */
const MAX_LENGTH = 10;

/** 呼び名にできるあだ名が出るまで、考え直す最大の回数 */
const MAX_TRIES = 10;

/** あだ名の提案に返事をするとき、「別のあだ名がいい」とみなす言葉 */
export const REROLL_WORDS = ['別の', 'ほかの', '他の', 'もう一回', 'もう一度', '引き直', 'やり直', '違うの', 'ちがうの'];

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
