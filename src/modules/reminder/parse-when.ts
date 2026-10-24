// リマインダーの頭にある日時の言葉(「明日9時」「30分後」「10/30 18:00」など)を読み取る。
// 時刻は、動いている環境の時刻(コンテナは日本時間)で計算する。

export type When = {
	at: Date;
	rest: string; // 日時を取り除いた、残りの内容
};

const DAY = 24 * 60 * 60 * 1000;

// 日付だけで時刻の指定がないときに知らせる時刻
const DEFAULT_HOUR = 9;

// 指定できる範囲
const MIN_AHEAD = 60 * 1000;
const MAX_AHEAD = 365 * DAY;

// 全角の数字と記号を半角にする(1文字ずつ置き換えるので、文字数は変わらない)
const normalize = (s: string) => s
	.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
	.replace(/：/g, ':')
	.replace(/[／]/g, '/');

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

const addDays = (d: Date, days: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);

// 存在しない日付(2/30 など)なら null
function ymd(y: number, m: number, d: number): Date | null {
	const date = new Date(y, m - 1, d);
	if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
	return date;
}

const DAY_WORDS: [RegExp, number][] = [
	[/^(?:明後日|あさって)/, 2],
	[/^(?:明日|あした)/, 1],
	[/^(?:今日|きょう)/, 0],
];

type Head = {
	len: number;
	day: Date | null; // 日付の指定(なければ時刻だけ)
	exact: Date | null; // 「N分後」など、日時が決まるもの
	yearless: boolean; // 年の指定がない日付
};

function parseDate(s: string, now: Date): Head | null {
	let m = s.match(/^(\d+)(分|時間|日|週間)後/);
	if (m) {
		const n = parseInt(m[1], 10);
		if (m[1].length > 4) return null;
		switch (m[2]) {
			case '分': return { len: m[0].length, day: null, exact: new Date(now.getTime() + n * 60 * 1000), yearless: false };
			case '時間': return { len: m[0].length, day: null, exact: new Date(now.getTime() + n * 60 * 60 * 1000), yearless: false };
			case '日': return { len: m[0].length, day: addDays(now, n), exact: null, yearless: false };
			default: return { len: m[0].length, day: addDays(now, n * 7), exact: null, yearless: false };
		}
	}

	for (const [re, days] of DAY_WORDS) {
		m = s.match(re);
		if (m) return { len: m[0].length, day: addDays(now, days), exact: null, yearless: false };
	}

	m = s.match(/^(\d{4})[\/\-年](\d{1,2})[\/\-月](\d{1,2})日?/);
	if (m) {
		const day = ymd(parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10));
		return day ? { len: m[0].length, day, exact: null, yearless: false } : null;
	}

	m = s.match(/^(\d{1,2})[\/月](\d{1,2})日?/);
	if (m) {
		const day = ymd(now.getFullYear(), parseInt(m[1], 10), parseInt(m[2], 10));
		return day ? { len: m[0].length, day, exact: null, yearless: true } : null;
	}

	return null;
}

// 「午後3時」「18:00」「9時30分」「9時半」。(時, 分) と長さを返す
function parseTime(s: string): { len: number; hour: number; minute: number } | null {
	const m = s.match(/^(午前|午後)?(\d{1,2})(?::(\d{2})|時(?:(\d{1,2})分|半)?)/);
	if (!m) return null;

	let hour = parseInt(m[2], 10);
	const minute = m[3] != null ? parseInt(m[3], 10) : m[4] != null ? parseInt(m[4], 10) : m[0].endsWith('半') ? 30 : 0;
	if (minute > 59) return null;

	if (m[1]) {
		if (hour > 12) return null;
		hour = hour % 12 + (m[1] === '午後' ? 12 : 0);
	} else if (hour > 23) {
		return null;
	}
	return { len: m[0].length, hour, minute };
}

// 日時のあとに続く言葉の区切り(空白・読点・「に」)かどうか
const isBoundary = (rest: string) => /^(?:$|[\s　、,，]|に)/.test(rest);

/**
 * 文頭の日時を読み取る。日時がなければ null。
 * 「明日の準備」のように、日時のあとが区切りでなければ、日時とは読まない。
 */
export function parseWhen(text: string, now: Date = new Date()): When | null {
	const s = normalize(text);

	const head = parseDate(s, now);
	const heads: [Head, number][] = [];

	if (head) {
		if (head.exact == null) {
			// 日付のあとに時刻が続いているなら、それも読む(「明日の9時」「10/30 18:00」)
			const conn = s.slice(head.len).match(/^[\s　]*の?[\s　]*/)![0].length;
			const time = parseTime(s.slice(head.len + conn));
			if (time) heads.push([{ ...head, len: head.len + conn + time.len }, time.hour * 60 + time.minute]);
		}
		heads.push([head, -1]);
	} else {
		const time = parseTime(s);
		if (time) heads.push([{ len: time.len, day: null, exact: null, yearless: false }, time.hour * 60 + time.minute]);
	}

	for (const [h, minutes] of heads) {
		if (!isBoundary(s.slice(h.len))) continue;

		const at = resolve(h, minutes, now);
		if (at == null) continue;

		const rest = text.slice(h.len).replace(/^(?:に|、|,|，)?[\s　]*/, '').trim();
		return { at, rest };
	}
	return null;
}

// minutes: 指定された時刻(0時からの分)。日付だけなら -1
function resolve(h: Head, minutes: number, now: Date): Date | null {
	if (h.exact) return h.exact;

	const hour = minutes < 0 ? DEFAULT_HOUR : Math.floor(minutes / 60);
	const minute = minutes < 0 ? 0 : minutes % 60;

	// 時刻だけなら今日。過ぎていたら明日
	if (h.day == null) {
		const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute);
		return today.getTime() > now.getTime() ? today : new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, hour, minute);
	}

	let day = h.day;
	// 年の指定がない日付は、もう過ぎた日なら来年にする(今日は過ぎていない)
	if (h.yearless && day.getTime() < startOfDay(now).getTime()) {
		const next = ymd(day.getFullYear() + 1, day.getMonth() + 1, day.getDate());
		if (next == null) return null; // 閏日(2/29)で、来年がない
		day = next;
	}
	return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute);
}

/** 指定できる範囲かどうか(past: 近すぎる・過ぎている、far: 遠すぎる) */
export function checkWhen(at: Date, now: Date = new Date()): 'ok' | 'past' | 'far' {
	const ahead = at.getTime() - now.getTime();
	if (ahead < MIN_AHEAD) return 'past';
	if (ahead > MAX_AHEAD) return 'far';
	return 'ok';
}
