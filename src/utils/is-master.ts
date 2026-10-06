/**
 * マスター(config.json の master)のユーザーか。このサーバのローカルユーザー(host が無い)に限る。
 * 他のサーバに同じユーザー名の人がいても、マスターとして扱わないため。
 * @param master config.master(未設定なら、誰もマスターではない)
 */
export function isMaster(user: { username: string; host?: string | null }, master: string | undefined): boolean {
	return !!master && user.username === master && user.host == null;
}
