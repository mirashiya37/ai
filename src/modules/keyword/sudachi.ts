import { spawn } from 'child_process';

/** 解析が終わらないままになるのを防ぐための時間切れ(ミリ秒) */
const TIMEOUT = 1000 * 60;

/**
 * 1件あたりの最大文字数。Sudachi は、1件が約17000〜20000文字を超えると、まとめて渡した他の投稿も含めて
 * 全体がエラーになる。Misskey の投稿は3000文字までだが、他のサーバーからは長い投稿が来ることがあるので、切り詰める。
 */
const MAX_TEXT_LENGTH = 5000;

/**
 * コマンドを実行して、標準出力を行ごとに返す。
 * mecab.ts の cmd() は、出力が大きい(約16KB以上)と終わらなくなるので、ここでは使わない。
 * タイムラインの100件をまとめて解析すると、出力が大きくなる。
 */
function run(command: string, args: string[], stdin: string): Promise<string[]> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { timeout: TIMEOUT });
		const chunks: Buffer[] = [];

		child.stdout.on('data', chunk => chunks.push(chunk));
		child.stderr.resume(); // 読み捨てる(読まないと、詰まって止まることがある)
		child.stdin.on('error', () => { /* 先に終了した場合の EPIPE は、close で扱う */ });
		child.on('error', reject);
		child.on('close', (code, signal) => {
			if (code === 0) resolve(Buffer.concat(chunks).toString('utf8').split(/\r?\n/));
			else reject(new Error(`${command} exited with ${signal ?? `code ${code}`}`));
		});

		child.stdin.end(stdin);
	});
}

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
	const input = texts.map(text => text.slice(0, MAX_TEXT_LENGTH).replace(/[\n\s\t]/g, ' ')).join('\n') + '\n';
	const lines = await run(sudachi, ['tokenize', '-m', 'C', '-a', '-s', dict], input);

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
