import { cmd } from './mecab.js';

/**
 * Run Sudachi (sudachipy) and return tokens in the same layout as MeCab (IPADIC).
 * [表層形, 品詞, 品詞細分類1, 品詞細分類2, 品詞細分類3, 活用型, 活用形, 原形, 読み]
 *
 * Sudachi は起動のたびに辞書を読み込むので、複数のテキストを1回でまとめて解析する。
 * @param texts Texts to analyze
 * @param sudachi sudachipy bin
 * @param dict Dictionary type (small, core, full)
 * @returns Tokens for each text
 */
export async function sudachi(texts: string[], sudachi = 'sudachipy', dict = 'full'): Promise<string[][][]> {
	const input = texts.map(text => text.replace(/[\n\s\t]/g, ' ')).join('\n') + '\n';
	const lines = await cmd(sudachi, ['tokenize', '-m', 'C', '-a', '-s', dict], input);

	const results: string[][][] = [];
	let tokens: string[][] = [];

	for (const line of lines) {
		if (line === 'EOS') {
			results.push(tokens);
			tokens = [];
			continue;
		}
		if (line === '') continue;

		// 表層形, 品詞(6つ), 正規化形, 辞書形, 読み, 辞書ID, 同義語グループID, (OOV)
		const [surface, pos = '', , dictionaryForm, reading] = line.split('\t');

		// 辞書にない語や、読みがカタカナでない語(「ｗｗ」の読みが「ww」になるなど)は、
		// MeCab で読みが無い語と同じく読みを空にする
		const isOov = line.endsWith('\t(OOV)');
		const validReading = !isOov && reading != null && /^[ァ-ヶー・]+$/.test(reading) ? reading : undefined;

		const token = [surface, ...pos.split(','), dictionaryForm];
		if (validReading != null) token.push(validReading);
		tokens.push(token);
	}

	return results;
}
