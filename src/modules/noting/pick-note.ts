/**
 * 独り言を1つ選ぶ。まず、学習した語句を使うテンプレートから選ぶかを、keywordRate の確率で決める。
 * そのあと、選んだ側の中から、等しい確率で選ぶ(片方が空なら、もう一方から選ぶ)。
 * 全部をまとめて等しい確率で選ぶと、語句を使うテンプレートは数が少なく、ほとんど選ばれないため。
 * @param random 0以上1未満の乱数
 */
export function pickNote<T>(fixedNotes: T[], keywordNotes: T[], keywordRate: number, random: () => number = Math.random): T {
	const useKeyword = random() < keywordRate;
	const pool = (useKeyword ? keywordNotes : fixedNotes).length > 0
		? (useKeyword ? keywordNotes : fixedNotes)
		: (useKeyword ? fixedNotes : keywordNotes);

	return pool[Math.floor(random() * pool.length)];
}
