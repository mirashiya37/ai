/**
 * マスターのトークンの検証。表示名を変えるのに要る権限だけを持っているかを確かめる。
 *
 * Misskey の API は「secure の確認 → レート制限 → 権限の確認 → パラメーターの検査 → 処理」の順で動く。
 * そこで、権限ごとに API を1つ選び、わざと不正なパラメーターで呼ぶ。
 * 権限が無ければ PERMISSION_DENIED、あれば INVALID_PARAM になり、どちらでも処理は動かない。
 * 権限の一覧とパラメーターの形は、サーバーの /api.json から取る(Misskey が更新されて権限が増えても、調べる対象に入る)。
 */

import { DEFAULT_LABEL } from '@/modules/talk/master-nickname.js';

/** 表示名の変更で使う権限。これ以外の権限が1つでもあれば、使わない */
export const ALLOWED_PERMISSIONS = ['read:account', 'write:account'] as const;

/** 権限が無いときに返るエラー。権限の確認より前(または同じ段階)で止まったもの */
const DENIED_CODES = ['PERMISSION_DENIED', 'ROLE_PERMISSION_DENIED', 'ACCESS_DENIED', 'CREDENTIAL_REQUIRED', 'YOUR_ACCOUNT_SUSPENDED', 'YOUR_ACCOUNT_MOVED'];

/** 権限の確認より前で止まり、権限があるかが分からないエラー */
const UNKNOWN_CODES = ['RATE_LIMIT_EXCEEDED', 'AUTHENTICATION_FAILED', 'INTERNAL_ERROR'];

/** API を呼ぶ関数。失敗したら、got の HTTPError と同じ形(err.response.statusCode / err.response.body)で投げる */
export type ApiCall = (endpoint: string, params: Record<string, unknown>) => Promise<any>;

/** API のエラーから、Misskey のエラーコードを取り出す。取り出せなければ null */
export function apiErrorCode(err: any): string | null {
	let body = err?.response?.body;
	if (typeof body === 'string') {
		try {
			body = JSON.parse(body);
		} catch {
			return null;
		}
	}
	return typeof body?.error?.code === 'string' ? body.error.code : null;
}

export type Probe = {
	permission: string;
	endpoint: string;
	params: Record<string, unknown>;
	/** invalid: わざと不正なパラメーター(処理は動かない)。read: 読み取りだけの API を実際に呼ぶ */
	mode: 'invalid' | 'read';
};

/** /api.json の、POST の操作 */
type Operation = { description?: string; requestBody?: any };

/** 型の違う値を送れば、確実に INVALID_PARAM になるプロパティを探す(型が書かれていないものや、object 型は使わない) */
function pickTypedProperty(schema: any): string | null {
	const properties = schema?.properties ?? {};
	for (const [name, property] of Object.entries<any>(properties)) {
		const types = Array.isArray(property?.type) ? property.type : [property?.type];
		if (types.length > 0 && types.every((type: unknown) => typeof type === 'string' && type !== 'object')) return name;
	}
	return null;
}

/**
 * /api.json から、権限ごとに、調べるための呼び方を決める。
 * 型の違う値を送れるプロパティがあれば、それに object を入れる(パラメーターの検査で必ず止まる)。
 * 無いときは、読み取りの権限なら、パラメーター無しで実際に呼ぶ(読むだけなので、何も変わらない)。
 * 書き込みの権限で、どちらもできないもの(パラメーターの無い管理用 API など)は、調べない(unprobeable)。
 */
export function buildProbes(spec: any, allowed: readonly string[] = ALLOWED_PERMISSIONS): { probes: Probe[]; unprobeable: string[] } {
	const byPermission = new Map<string, { endpoint: string; operation: Operation }[]>();
	for (const [path, item] of Object.entries<any>(spec?.paths ?? {})) {
		const operation: Operation | undefined = item?.post;
		const permission = operation?.description?.match(/\*\*Permission\*\*: \*([\w:-]+)\*/)?.[1];
		if (operation == null || permission == null || allowed.includes(permission)) continue;
		const list = byPermission.get(permission) ?? [];
		list.push({ endpoint: path.replace(/^\//, ''), operation });
		byPermission.set(permission, list);
	}

	const probes: Probe[] = [];
	const unprobeable: string[] = [];
	for (const [permission, endpoints] of [...byPermission].sort(([a], [b]) => a.localeCompare(b))) {
		let probe: Probe | null = null;
		for (const { endpoint, operation } of endpoints) {
			const property = pickTypedProperty(operation.requestBody?.content?.['application/json']?.schema);
			if (property != null) {
				probe = { permission, endpoint, params: { [property]: { invalid: true } }, mode: 'invalid' };
				break;
			}
		}
		if (probe == null && permission.startsWith('read:')) {
			probe = { permission, endpoint: endpoints[0].endpoint, params: {}, mode: 'read' };
		}
		if (probe != null) probes.push(probe);
		else unprobeable.push(permission);
	}
	return { probes, unprobeable };
}

/** 調べた結果。granted: 権限がある、denied: 無い、unknown: 分からない */
export async function runProbe(call: ApiCall, probe: Pick<Probe, 'endpoint' | 'params'>): Promise<'granted' | 'denied' | 'unknown'> {
	try {
		await call(probe.endpoint, probe.params);
		return 'granted';
	} catch (err) {
		const code = apiErrorCode(err);
		if (code == null || UNKNOWN_CODES.includes(code)) return 'unknown';
		if (DENIED_CODES.includes(code)) return 'denied';
		// INVALID_PARAM や、各 API のエラー(NO_SUCH_... など)は、権限の確認を通ったあとのもの
		return 'granted';
	}
}

/** 権限の一覧を、長くなりすぎないように、先頭の数個と残りの個数にする(ブラウザのトークンは、60個以上になる) */
function summarize(permissions: string[], max = 5): string {
	return permissions.length <= max ? permissions.join(', ') : `${permissions.slice(0, max).join(', ')} ほか${permissions.length - max}個`;
}

export type TokenCheckResult =
	| { ok: true; user: { id: string; username: string; name: string | null }; unprobeable: string[] }
	| { ok: false; problems: string[]; unprobeable: string[] };

/**
 * マスターのトークンを確かめる。次のどれかなら使わない(ok: false)。
 * - 持ち主がマスター本人でない(このサーバーの、config.json の master のユーザーでない)
 * - ブラウザのログインのトークン(secure な API が通る。すべての権限を持つ)
 * - read:account と write:account 以外の権限がある。read:account・write:account が無い
 *   (read:account は、最初の i が通ったことで確かめる)
 * - 権限の一覧(/api.json)が取れない、調べた結果が分からない(安全のため、使わない)
 * @param call マスターのトークンで API を呼ぶ関数
 * @param fetchSpec サーバーの /api.json を取る関数
 * @param label 理由の文で、マスターを呼ぶ言い方(masterLabel())
 */
export async function checkToken(call: ApiCall, fetchSpec: () => Promise<any>, master: string, label = DEFAULT_LABEL): Promise<TokenCheckResult> {
	const problems: string[] = [];

	let user: any;
	try {
		user = await call('i', {});
	} catch (err) {
		return { ok: false, problems: [`アカウントを読めません(${apiErrorCode(err) ?? '通信の失敗'})`], unprobeable: [] };
	}
	if (user?.username?.toLowerCase() !== master.toLowerCase() || user?.host != null) {
		return { ok: false, problems: [`${label}(@${master})のトークンではありません(@${user?.username})`], unprobeable: [] };
	}

	if ((await runProbe(call, { endpoint: 'i/apps', params: {} })) !== 'denied') {
		problems.push('ブラウザのログインのトークンです(すべての権限を持っています)');
	}

	if ((await runProbe(call, { endpoint: 'i/update', params: { name: { invalid: true } } })) !== 'granted') {
		problems.push('write:account(アカウントの情報を変える権限)がありません');
	}

	let spec: any;
	try {
		spec = await fetchSpec();
	} catch {
		problems.push('権限の一覧(/api.json)が取れません');
		return { ok: false, problems, unprobeable: [] };
	}

	const { probes, unprobeable } = buildProbes(spec);
	if (probes.length === 0) {
		problems.push('権限の一覧(/api.json)から、調べる API が見つかりません');
	}
	const extra: string[] = [];
	const unknown: string[] = [];
	for (const probe of probes) {
		const result = await runProbe(call, probe);
		if (result === 'granted') extra.push(probe.permission);
		if (result === 'unknown') unknown.push(probe.permission);
	}
	if (extra.length > 0) problems.push(`要らない権限があります: ${summarize(extra)}`);
	if (unknown.length > 0) problems.push(`確かめられなかった権限があります: ${unknown.join(', ')}`);

	return problems.length === 0
		? { ok: true, user: { id: user.id, username: user.username, name: user.name ?? null }, unprobeable }
		: { ok: false, problems, unprobeable };
}
