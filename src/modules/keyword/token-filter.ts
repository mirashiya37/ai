// トークンは MeCab(IPADIC)と同じ並び: [表層形, 品詞, 品詞細分類1, 品詞細分類2, 品詞細分類3, 活用型, 活用形, 原形, 読み]

export type KeywordKind = 'proper' | 'common';

/** 普通名詞として覚える語の、最小の文字数 */
const COMMON_NOUN_MIN_LENGTH = 3;

/**
 * 普通名詞のうち、覚えてよいもの。
 * 一般的すぎる語(「天気」「ほんと」「site」など)で、固有名詞の語が埋もれないよう、次の条件で絞る。
 * - 細分類が「一般」(「今日」などの副詞可能、「発見」などのサ変可能、助数詞可能は除く)
 * - 3文字以上
 * - 読みがある
 * - 英数字だけ・ひらがなだけの語ではない
 *
 * 品詞の並びは MeCab(IPADIC)と同じ。Sudachi は「名詞,普通名詞,一般」、IPADIC は「名詞,一般」なので、どちらも受ける。
 */
export function isLearnableCommonNoun(token: string[]): boolean {
	const isCommonNoun = token[1] === '名詞' && (token[2] === '一般' || (token[2] === '普通名詞' && token[3] === '一般'));
	if (!isCommonNoun || token[8] == null) return false;

	const surface = token[0];
	return surface.length >= COMMON_NOUN_MIN_LENGTH
		&& !/^[\x21-\x7Eａ-ｚＡ-Ｚ０-９]+$/.test(surface)
		&& !/^[ぁ-ゟー]+$/.test(surface);
}

/**
 * 覚えてよい語か。
 * - 固有名詞。人名は、名字・名前(姓・名)だけを除く。キャラクター名など辞書にフルネームで載っている名前(一般)は覚える
 * - 普通名詞は、一般的すぎる語を除いた一部だけ(isLearnableCommonNoun)
 * - 読みがある
 * - /forget で覚えないようにした語ではない
 * @param ignored 覚えないようにした語句
 */
export function isLearnableToken(token: string[], ignored: ReadonlySet<string>): boolean {
	const isProperNoun = token[2] === '固有名詞' && (token[3] !== '人名' || token[4] === '一般');
	return (isProperNoun || isLearnableCommonNoun(token)) && token[8] != null && !ignored.has(token[0]);
}

/** 解析結果のトークンが、固有名詞か普通名詞か(isLearnableToken で選んだトークンだけを渡す) */
export function kindOf(token: string[]): KeywordKind {
	return token[2] === '固有名詞' ? 'proper' : 'common';
}

/** 「今日よく見かけた言葉」に数える語。固有名詞だけにする(普通名詞は、一般的すぎる語が上位に混ざるので数えない) */
export function trendKeywordsOf(tokens: string[][]): string[] {
	return tokens.filter(token => kindOf(token) === 'proper').map(token => token[0]);
}
