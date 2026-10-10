export const DEFAULT_CHUNK_SIZE = 20;

// Misskey のノートの最大文字数の既定値
export const MAX_NOTE_LENGTH = 3000;
// Misskey の注釈(CW)の最大文字数
export const MAX_CW_LENGTH = 100;

// 設定値が正の整数でなければ既定値にする
export function resolveChunkSize(value: unknown): number {
	const n = Number(value);
	return Number.isInteger(n) && n > 0 ? n : DEFAULT_CHUNK_SIZE;
}

/**
 * 絵文字を、1ノートに入れる数ごとに分ける。
 * chunkSize 件までで区切り、さらに render が返す投稿の文字数が maxLength を超えるなら、超えない件数まで減らす。
 * 1件だけで超える場合は、それ以上分けられないので、そのまま1件のノートにする。
 * @param render ノートの位置(0 が最初)と、そのノートに入れる絵文字から、投稿の文字列を作る
 */
export function splitEmojis<T>(
	items: T[],
	chunkSize: number,
	maxLength: number,
	render: (index: number, chunk: T[]) => string
): T[][] {
	const chunks: T[][] = [];
	let start = 0;
	while (start < items.length) {
		let end = Math.min(start + chunkSize, items.length);
		while (end - start > 1 && render(chunks.length, items.slice(start, end)).length > maxLength) {
			end--;
		}
		chunks.push(items.slice(start, end));
		start = end;
	}
	return chunks;
}
