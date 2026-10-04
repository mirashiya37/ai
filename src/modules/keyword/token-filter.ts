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
