/** マスターのあだ名を伝える方法。off なら伝えない */
export type MasterNicknameNotify = 'off' | 'mention' | 'chat';

export type MasterNicknameSettings = {
	/** マスターのユーザー名(config.json の master) */
	username: string;
	/** 「〇〇のあだ名」の〇〇が、これならマスターとみなす */
	names: string[];
	notify: MasterNicknameNotify;
	/** 考えたあだ名を、マスターの呼び名にするか */
	updateName: boolean;
	/** 同じ人が1日(日本時間の0時で区切る)に頼める回数。0 なら制限しない */
	perUserDaily: number;
	/** マスターに伝える間隔(ミリ秒)。誰から頼まれたかに関わらず、まとめて数える。0 なら制限しない */
	interval: number;
};

const DEFAULT_PER_USER_DAILY = 1;
const DEFAULT_INTERVAL_HOURS = 3;

/** 0 以上の数か、数を表す文字列なら数にする。それ以外は既定値 */
function toNumber(value: unknown, fallback: number): number {
	const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
	return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * config.json の値から、マスターのあだ名の設定を作る。使わないなら null。
 * 伝えない(notify が off)うえに呼び名にもしないなら、マスターには何も起きないので使わない
 * (「〇〇さんのあだ名」として、ほかの人と同じに扱う)。
 */
export function resolveMasterNicknameSettings(config: {
	master?: string;
	masterNicknameNames?: unknown;
	masterNicknameNotify?: unknown;
	masterNicknameUpdateName?: unknown;
	masterNicknamePerUserDaily?: unknown;
	masterNicknameIntervalHours?: unknown;
}): MasterNicknameSettings | null {
	if (!config.master) return null;

	const notify: MasterNicknameNotify = config.masterNicknameNotify === 'mention' || config.masterNicknameNotify === 'chat' ? config.masterNicknameNotify : 'off';
	const updateName = config.masterNicknameUpdateName === true;
	if (notify === 'off' && !updateName) return null;

	const names = Array.isArray(config.masterNicknameNames)
		? config.masterNicknameNames.filter((name): name is string => typeof name === 'string' && name.length > 0)
		: [];

	return {
		username: config.master,
		names,
		notify,
		updateName,
		perUserDaily: toNumber(config.masterNicknamePerUserDaily, DEFAULT_PER_USER_DAILY),
		interval: toNumber(config.masterNicknameIntervalHours, DEFAULT_INTERVAL_HOURS) * 1000 * 60 * 60,
	};
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
