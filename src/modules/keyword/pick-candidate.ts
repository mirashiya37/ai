import { choosePool } from '@/utils/choose-pool.js';

/** 固有名詞を覚える確率の初期値(config.json の keywordProperRate で変える) */
export const DEFAULT_PROPER_RATE = 0.6;

export type KeywordKind = 'proper' | 'common';

/** 解析結果のトークンが、固有名詞か普通名詞か(覚える語として選ばれたトークンだけを渡す) */
export function kindOf(token: string[]): KeywordKind {
	return token[2] === '固有名詞' ? 'proper' : 'common';
}

/** 「今日よく見かけた言葉」に数える語。固有名詞だけにする(普通名詞は、一般的すぎる語が上位に混ざるので数えない) */
export function trendKeywordsOf(tokens: string[][]): string[] {
	return tokens.filter(token => kindOf(token) === 'proper').map(token => token[0]);
}

/** 0〜1 の数でなければ初期値にする(config.json には文字列で書かれることもあるので、数に直す) */
export function resolveProperRate(value: unknown): number {
	const rate = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
	return typeof rate === 'number' && Number.isFinite(rate) && rate >= 0 && rate <= 1 ? rate : DEFAULT_PROPER_RATE;
}

/**
 * 覚える語を1つ選ぶ。
 * まず、固有名詞と普通名詞のどちらから選ぶかを、properRate の確率で決める(選んだほうに候補がなければ、もう一方から選ぶ)。
 * そのあと、選んだ側の中から、長い語が選ばれやすいように選ぶ。
 * @param candidates まだ覚えていない語のトークン(同じ語が複数あってもよい)
 * @param random 0以上1未満の乱数
 */
export function pickCandidate(candidates: string[][], properRate: number, random: () => number = Math.random): string[] | undefined {
	const proper = candidates.filter(token => kindOf(token) === 'proper');
	const common = candidates.filter(token => kindOf(token) === 'common');

	const pool = choosePool(proper, common, properRate, random);
	if (pool.length === 0) return undefined;

	const rnd = Math.floor((1 - Math.sqrt(random())) * pool.length);
	return pool.sort((a, b) => a[0].length < b[0].length ? 1 : -1)[rnd];
}
