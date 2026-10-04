import type 藍 from '@/ai.js';

/** 同じ投稿を2回数えないために覚えておく投稿IDの数(学習で1回に読む100件より十分多ければよい) */
const SEEN_NOTES_LIMIT = 1000;

type TrendDoc = {
	counts: Record<string, number>;
	seenNoteIds: string[];
};

function getDoc(ai: 藍): { collection: any; doc: TrendDoc } {
	const collection = ai.getCollection('_keyword_trend');
	const doc = collection.findOne({}) ?? collection.insertOne({ counts: {}, seenNoteIds: [] });
	return { collection, doc };
}

/**
 * タイムラインの投稿に出てきた語句を数える(1つの投稿に何回出ても1回)
 * 同じ投稿が次の学習でも読まれることがあるので、数えた投稿は飛ばす。
 */
export function countKeywords(ai: 藍, notes: { id: string; keywords: string[] }[]) {
	const { collection, doc } = getDoc(ai);

	for (const note of notes) {
		if (doc.seenNoteIds.includes(note.id)) continue;
		doc.seenNoteIds.push(note.id);

		for (const keyword of new Set(note.keywords)) {
			doc.counts[keyword] = (doc.counts[keyword] ?? 0) + 1;
		}
	}

	doc.seenNoteIds = doc.seenNoteIds.slice(-SEEN_NOTES_LIMIT);
	collection.update(doc);
}

/**
 * よく見かけた語句を多い順に取り出して、数をリセットする
 * @param limit 取り出す数
 * @param minCount これより少ない投稿にしか出ていない語句は除く
 */
export function takeTrend(ai: 藍, limit = 5, minCount = 2): string[] {
	const { collection, doc } = getDoc(ai);

	const trend = Object.entries(doc.counts)
		.filter(([, count]) => count >= minCount)
		.sort(([a, countA], [b, countB]) => countB - countA || (a < b ? -1 : 1))
		.slice(0, limit)
		.map(([keyword]) => keyword);

	// 投稿IDは残す(次の集計で、すでに数えた投稿をまた数えないように)
	doc.counts = {};
	collection.update(doc);

	return trend;
}
