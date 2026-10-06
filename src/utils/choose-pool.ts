/**
 * 2つの候補のうち、どちらから選ぶかを決める。preferred を rate の確率で選び、選んだ側が空なら、もう一方を返す。
 * 乱数は、この中で1回だけ使う。
 * @param random 0以上1未満の乱数
 */
export function choosePool<T>(preferred: T[], other: T[], rate: number, random: () => number = Math.random): T[] {
	const usePreferred = random() < rate;
	const [first, second] = usePreferred ? [preferred, other] : [other, preferred];
	return first.length > 0 ? first : second;
}
