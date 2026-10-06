/**
 * Bot アカウント(プロフィールで Bot にしているアカウント)の投稿か。
 * Bot の投稿(地震速報、天気、定型文の返信など)を学習すると、同じ語が大量に混ざる。
 * user が付いていない投稿は、Bot とみなさない。
 */
export function isBotNote(note: { user?: { isBot?: boolean } | null }): boolean {
	return note.user?.isBot === true;
}
