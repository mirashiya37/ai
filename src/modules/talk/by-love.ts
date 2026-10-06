type Serif = string | string[];

/** 名前を受け取るセリフには、呼び名を渡す */
type SerifOrFn = Serif | ((name: string | null | undefined) => Serif);

/**
 * 親愛度に応じてセリフを選ぶ(好き: love、普通: normal、嫌い: hate)。
 * 境目は、多くの反応で共通の、好きが 5 以上、嫌いが -3 以下。違う反応は thresholds で変える。
 * love・hate が無いセリフは、その分 normal を使う。
 */
export function byLove(
	friend: { love: number; name?: string | null },
	serif: { normal: SerifOrFn; love?: SerifOrFn; hate?: SerifOrFn },
	thresholds: { love?: number; hate?: number } = {},
): Serif {
	const { love = 5, hate = -3 } = thresholds;
	const chosen =
		serif.love !== undefined && friend.love >= love ? serif.love :
		serif.hate !== undefined && friend.love <= hate ? serif.hate :
		serif.normal;
	return typeof chosen === 'function' ? chosen(friend.name) : chosen;
}
