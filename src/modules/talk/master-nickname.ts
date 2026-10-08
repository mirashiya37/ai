/** マスターのあだ名を伝える方法。off なら伝えない */
export type MasterNicknameNotify = 'off' | 'mention' | 'chat';

/** マスターへのメンションの投稿の、公開範囲の上限。頼まれた投稿がこれより広くても、ここまでに狭める */
export type MasterNicknameMentionVisibility = 'public' | 'home' | 'specified';

export type MasterNicknameSettings = {
	/** マスターのユーザー名(config.json の master) */
	username: string;
	/** 「〇〇のあだ名」の〇〇が、これならマスターとみなす */
	names: string[];
	notify: MasterNicknameNotify;
	/** notify が mention のとき、マスターへのメンションの公開範囲の上限 */
	mentionVisibility: MasterNicknameMentionVisibility;
	/** 考えたあだ名を、マスターの呼び名にするか */
	updateName: boolean;
	/** 同じ人が1日(日本時間の0時で区切る)に頼める回数。0 なら制限しない */
	perUserDaily: number;
	/** マスターに伝える間隔(ミリ秒)。誰から頼まれたかに関わらず、まとめて数える。0 なら制限しない */
	interval: number;
};

/** 通知や返事で、マスターを呼ぶ言い方の既定(masterNicknameNames が空のとき) */
const DEFAULT_LABEL = 'マスター';

/** 通知や返事で、マスターを呼ぶ言い方。masterNicknameNames の先頭。無ければ「マスター」 */
export function masterLabel(settings: Pick<MasterNicknameSettings, 'names'>): string {
	return settings.names[0] ?? DEFAULT_LABEL;
}

const DEFAULT_MENTION_VISIBILITY: MasterNicknameMentionVisibility = 'public';
const DEFAULT_PER_USER_DAILY = 1;
const DEFAULT_INTERVAL_MINUTES = 180;

/** 0 以上の数か、数を表す文字列なら数にする。それ以外は既定値 */
function toNumber(value: unknown, fallback: number): number {
	const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
	return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * マスターに伝える間隔(分)。masterNicknameIntervalMinutes を使う。
 * 以前の masterNicknameIntervalHours(時間)だけが書かれているときは、それを分にして使う
 */
function intervalMinutes(config: { masterNicknameIntervalMinutes?: unknown; masterNicknameIntervalHours?: unknown }): number {
	const hours = toNumber(config.masterNicknameIntervalHours, NaN);
	return toNumber(config.masterNicknameIntervalMinutes, Number.isNaN(hours) ? DEFAULT_INTERVAL_MINUTES : hours * 60);
}

/**
 * コマンド(/nickname)で変えた設定。config.json の値より優先する。undefined の項目は config.json の値を使う
 */
export type MasterNicknameOverrides = {
	/** false なら、マスターのあだ名を使わない */
	enabled?: boolean;
	notify?: MasterNicknameNotify;
	mentionVisibility?: MasterNicknameMentionVisibility;
	updateName?: boolean;
	perUserDaily?: number;
	intervalMinutes?: number;
};

/**
 * config.json の値と、コマンドで変えた値から、マスターのあだ名の設定を作る。使わないなら null。
 * 伝えない(notify が off)うえに呼び名にもせず、表示名も変えないなら、マスターには何も起きないので使わない
 * (「〇〇さんのあだ名」として、ほかの人と同じに扱う)。
 * @param overrides コマンドで変えた設定
 * @param renameActive 表示名の変更が使える状態か(オンで、トークンの検証が済んでいる)
 */
export function resolveMasterNicknameSettings(config: {
	master?: string;
	masterNicknameNames?: unknown;
	masterNicknameNotify?: unknown;
	masterNicknameMentionVisibility?: unknown;
	masterNicknameUpdateName?: unknown;
	masterNicknamePerUserDaily?: unknown;
	masterNicknameIntervalMinutes?: unknown;
	masterNicknameIntervalHours?: unknown;
}, overrides: MasterNicknameOverrides = {}, renameActive = false): MasterNicknameSettings | null {
	if (!config.master) return null;
	if (overrides.enabled === false) return null;

	const notify: MasterNicknameNotify = overrides.notify
		?? (config.masterNicknameNotify === 'mention' || config.masterNicknameNotify === 'chat' ? config.masterNicknameNotify : 'off');
	const updateName = overrides.updateName ?? config.masterNicknameUpdateName === true;
	if (notify === 'off' && !updateName && !renameActive) return null;

	const names = masterNames(config);

	return {
		username: config.master,
		names,
		notify,
		mentionVisibility: overrides.mentionVisibility
			?? (config.masterNicknameMentionVisibility === 'public' || config.masterNicknameMentionVisibility === 'home' || config.masterNicknameMentionVisibility === 'specified' ? config.masterNicknameMentionVisibility : DEFAULT_MENTION_VISIBILITY),
		updateName,
		perUserDaily: overrides.perUserDaily ?? toNumber(config.masterNicknamePerUserDaily, DEFAULT_PER_USER_DAILY),
		interval: (overrides.intervalMinutes ?? intervalMinutes(config)) * 1000 * 60,
	};
}

/** config.json の masterNicknameNames(文字列だけ。空の文字列は除く) */
export function masterNames(config: { masterNicknameNames?: unknown }): string[] {
	return Array.isArray(config.masterNicknameNames)
		? config.masterNicknameNames.filter((name): name is string => typeof name === 'string' && name.length > 0)
		: [];
}

/** 頼んだ人ごとの記録(Friend の perModulesData に置く) */
export type MasterNicknameUserRecord = { date?: string; count?: number };

export type MasterNicknameLimit =
	| { ok: true }
	| { ok: false; reason: 'daily' }
	| { ok: false; reason: 'interval'; nextAt: number };

/**
 * マスターに伝えてよいかを決める。同じ人の1日の回数を先に見て、次に、誰からかに関わらない間隔を見る。
 * @param user 頼んだ人の記録
 * @param lastNotifiedAt 最後にマスターに伝えた時刻(ミリ秒)
 * @param today 今日の日付(getDate())
 * @param now 今の時刻(ミリ秒)
 */
export function checkMasterNicknameLimit(
	settings: Pick<MasterNicknameSettings, 'perUserDaily' | 'interval'>,
	user: MasterNicknameUserRecord,
	lastNotifiedAt: number | undefined,
	today: string,
	now: number,
): MasterNicknameLimit {
	const count = user.date === today ? (user.count ?? 0) : 0;
	if (settings.perUserDaily > 0 && count >= settings.perUserDaily) return { ok: false, reason: 'daily' };

	if (lastNotifiedAt != null && now - lastNotifiedAt < settings.interval) {
		return { ok: false, reason: 'interval', nextAt: lastNotifiedAt + settings.interval };
	}

	return { ok: true };
}

/** マスターに伝えたあとの、頼んだ人の記録 */
export function nextMasterNicknameUserRecord(user: MasterNicknameUserRecord, today: string): MasterNicknameUserRecord {
	return { date: today, count: (user.date === today ? (user.count ?? 0) : 0) + 1 };
}

/** 頼んだ人の表示名として使う最大の文字数 */
const MAX_DISPLAY_NAME_LENGTH = 20;

/**
 * マスターへの通知で、頼んだ人を示す文字列。「表示名(@ユーザー名)」の形で、別のサーバーの人は「@ユーザー名@サーバー」。
 * 表示名が無いか、ユーザー名と同じなら、「@ユーザー名」だけにする。
 * 表示名は本人が自由に決められるので、そのまま投稿に入れない。
 * 絵文字コードを除き、改行を空白にし、MFM やメンション・URL になる記号(@ $ < > ` * ~ # : \ [ ] ( ))を全角にして、20文字までに切る
 */
export function describeRequester(user: { username: string; host?: string | null; name?: string | null }): string {
	const acct = user.host ? `@${user.username}@${user.host}` : `@${user.username}`;

	const chars = [...(user.name ?? '')
		.replace(/:[\w@.-]+:/g, '')
		.replace(/\p{Cc}/gu, ' ')
		.replace(/[@$<>`*~#:\\[\]()]/g, c => String.fromCharCode(c.charCodeAt(0) + 0xFEE0))
		.replace(/\s+/g, ' ')
		.trim()];
	if (chars.length === 0 || chars.join('').toLowerCase() === user.username.toLowerCase()) return acct;

	const display = chars.length > MAX_DISPLAY_NAME_LENGTH ? chars.slice(0, MAX_DISPLAY_NAME_LENGTH).join('') + '…' : chars.join('');
	return `${display}(${acct})`;
}

const VISIBILITY_RANK: Record<string, number> = { public: 0, home: 1, followers: 2, specified: 3 };

/**
 * マスターへのメンションの公開範囲。頼まれた投稿の公開範囲と、上限のうち、狭いほうにする。
 * フォロワー限定は、藍がその人にフォローされているとは限らないので、ダイレクト(specified)にする(msg.reply() と同じ)。
 * @param requested 頼まれた投稿の公開範囲(public / home / followers / specified)
 */
export function masterMentionVisibility(requested: string, max: MasterNicknameMentionVisibility): 'public' | 'home' | 'specified' {
	const wanted = requested === 'followers' ? 'specified' : requested;
	return (VISIBILITY_RANK[wanted] ?? 0) >= VISIBILITY_RANK[max] ? (wanted as 'public' | 'home' | 'specified') : max;
}
