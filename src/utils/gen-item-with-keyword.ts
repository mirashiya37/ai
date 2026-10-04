import type 藍 from '@/ai.js';
import { genItem, itemPrefixes } from '@/vocabulary.js';

/** 学習した語句を使う確率 */
const KEYWORD_RATE = 0.3;

/** 長すぎる語句はアンケートの選択肢などに収まらないので使わない */
const KEYWORD_MAX_LENGTH = 10;

/**
 * 学習済みの語句を、学習した順に返す
 * @param learnedBefore 指定すると、これより前(ミリ秒)に学習した語句だけを返す。
 *                      同じ日は候補を変えたくない場合(おみくじなど)に、その日の0時を渡す。
 */
export function getLearnedKeywords(ai: 藍, learnedBefore = Infinity): string[] {
	return ai.getCollection('_keyword_learnedKeywords')
		.find()
		.filter(doc => doc.learnedAt < learnedBefore && doc.keyword.length <= KEYWORD_MAX_LENGTH)
		.sort((a, b) => a.learnedAt - b.learnedAt || (a.keyword < b.keyword ? -1 : 1))
		.map(doc => doc.keyword);
}

/**
 * genItem() の代わりに使う。一定の確率で、学習した語句を使ったアイテム名を返す。
 * seedrandom の rng を渡した場合も、同じ keywords なら同じ結果になる。
 */
export function genItemWithKeyword(keywords: string[], rng: () => number = Math.random): string {
	// 乱数の消費順を固定するため、候補が空でも先に引く
	const useKeyword = rng() < KEYWORD_RATE;
	const pick = rng();

	if (!useKeyword || keywords.length === 0) return genItem(rng);

	const keyword = keywords[Math.floor(pick * keywords.length)];
	if (Math.floor(rng() * 5) === 0) return keyword;
	return itemPrefixes[Math.floor(rng() * itemPrefixes.length)] + keyword;
}
