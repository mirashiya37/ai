import { ALLOWED_PERMISSIONS } from './token-check.js';

/** 許可の画面に出す、アプリの名前 */
export const MIAUTH_APP_NAME = '藍(マスターの表示名の変更)';

/** 許可を待つ時間(ミリ秒) */
export const MIAUTH_TIMEOUT = 10 * 60 * 1000;

/** 許可されたかを確かめる間隔(ミリ秒) */
export const MIAUTH_POLL_INTERVAL = 5 * 1000;

/**
 * マスターに開いてもらう、許可の URL。権限は、表示名の変更に要るもの(read:account・write:account)だけを求める
 * @param host Misskey の URL(config.json の host)
 * @param session 許可を受け取るための ID(推測されないもの)
 */
export function miauthUrl(host: string, session: string): string {
	const params = new URLSearchParams({ name: MIAUTH_APP_NAME, permission: ALLOWED_PERMISSIONS.join(',') });
	return `${host.replace(/\/$/, '')}/miauth/${session}?${params.toString()}`;
}

/** 許可を受け取った結果。まだ許可されていなければ null */
export type MiAuthResult = { token: string; user: { id: string; username: string; host?: string | null } };

/**
 * 許可されたかを確かめる(POST /api/miauth/<session>/check)。トークンは、1回だけ受け取れる
 * @param post Misskey の API に POST する関数(エンドポイント名は /api/ より後ろ)
 */
export async function checkMiAuth(post: (endpoint: string) => Promise<any>, session: string): Promise<MiAuthResult | null> {
	const res = await post(`miauth/${session}/check`);
	if (res?.ok !== true || typeof res.token !== 'string' || res.user == null) return null;
	return { token: res.token, user: res.user };
}
