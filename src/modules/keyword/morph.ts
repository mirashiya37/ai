import config from '@/config.js';
import { mecab } from './mecab.js';
import { sudachi } from './sudachi.js';

/** 使っている形態素解析の名前(ログと日次レポートに出す) */
export const morphAnalyzerName = config.morphAnalyzer ?? 'mecab';

/**
 * config.json の morphAnalyzer で選んだ形態素解析で、テキストごとのトークンを返す。
 * トークンの並びは、どちらも MeCab(IPADIC)と同じ。
 * Sudachi は起動のたびに辞書を読み込むので、まとめて1回で解析する。MeCab は1件ずつ解析する。
 */
export async function analyze(texts: string[]): Promise<string[][][]> {
	if (config.morphAnalyzer === 'sudachi') {
		return await sudachi(texts, config.sudachi, config.sudachiDict);
	}

	const results: string[][][] = [];
	for (const text of texts) {
		results.push(await mecab(text, config.mecab, config.mecabDic));
	}
	return results;
}
