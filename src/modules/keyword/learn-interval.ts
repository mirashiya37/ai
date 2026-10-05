/** 学習の間隔の下限(分) */
export const MIN_MINUTES = 15;
/** 学習の間隔の上限(分) */
export const MAX_MINUTES = 45;

/**
 * 次の学習までの間隔(ミリ秒)。15〜45分から、一様に選ぶ(平均は30分)。
 * @param random 0以上1未満の乱数
 */
export function nextLearnDelay(random: () => number = Math.random): number {
	return (MIN_MINUTES + random() * (MAX_MINUTES - MIN_MINUTES)) * 60 * 1000;
}
