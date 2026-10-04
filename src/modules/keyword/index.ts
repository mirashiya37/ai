import { bindThis } from '@/decorators.js';
import loki from 'lokijs';
import Module from '@/module.js';
import config from '@/config.js';
import serifs from '@/serifs.js';
import { mecab } from './mecab.js';
import { sudachi } from './sudachi.js';
import getDate from '@/utils/get-date.js';

/** 覚えてから忘れ始めるまでの日数 */
const FORGET_AFTER_DAYS = 30;

/** 忘れ始めてから、1日ごとに忘れる確率 */
const FORGET_RATE = 0.05;

function kanaToHira(str: string) {
	return str.replace(/[\u30a1-\u30f6]/g, match => {
		const chr = match.charCodeAt(0) - 0x60;
		return String.fromCharCode(chr);
	});
}

export default class extends Module {
	public readonly name = 'keyword';

	private learnedKeywords: loki.Collection<{
		keyword: string;
		learnedAt: number;
	}>;

	@bindThis
	public install() {
		if (!config.keywordEnabled) return {};

		this.learnedKeywords = this.ai.getCollection('_keyword_learnedKeywords', {
			indices: ['userId']
		});

		setInterval(this.learn, 1000 * 60 * 30);
		setInterval(this.forget, 1000 * 60);

		return {};
	}

	/**
	 * 覚えてから FORGET_AFTER_DAYS 日を過ぎた語句を、1日ごとに FORGET_RATE の確率で忘れる。
	 * おみくじの結果が1日の途中で変わらないよう、日付が変わったときにだけ行う。
	 */
	@bindThis
	private forget() {
		const today = getDate();
		const data = this.getData();
		if (data.lastForgotOn === today) return;

		const isFirstTime = data.lastForgotOn == null;
		data.lastForgotOn = today;
		this.setData(data);

		// 初回(この機能を入れた日)は、その日のおみくじを変えないよう翌日から始める
		if (isFirstTime) return;

		const threshold = Date.now() - 1000 * 60 * 60 * 24 * FORGET_AFTER_DAYS;
		const forgotten = this.learnedKeywords
			.find({ learnedAt: { $lt: threshold } })
			.filter(() => Math.random() < FORGET_RATE);

		for (const doc of forgotten) {
			this.learnedKeywords.remove(doc);
		}

		if (forgotten.length > 0) {
			// 一度に大量に忘れることもあるので、語句は先頭の数個だけ出す
			const examples = forgotten.slice(0, 5).map(doc => doc.keyword).join(', ');
			this.log(`Forgot ${forgotten.length} keywords (e.g. ${examples}${forgotten.length > 5 ? ', ...' : ''})`);
		}
	}

	@bindThis
	private async learn() {
		const tl: any = await this.ai.api('notes/global-timeline', {
			limit: 100
		});

		const interestedNotes = tl.filter(note =>
			note.userId !== this.ai.account.id &&
			note.text != null &&
			note.visibility == "public" &&
			note.cw == null);

		let keywords: string[][] = [];

		// Sudachi は起動のたびに辞書を読み込むので、まとめて解析しておく
		const sudachiTokens = config.morphAnalyzer === 'sudachi'
			? await sudachi(interestedNotes.map(note => note.text), config.sudachi, config.sudachiDict)
			: null;

		for (const [i, note] of interestedNotes.entries()) {
			const tokens = sudachiTokens ? sudachiTokens[i] : await mecab(note.text, config.mecab, config.mecabDic);
			const keywordsInThisNote = tokens.filter(token => token[2] == '固有名詞' && token[3] !== '人名' && token[8] != null);
			keywords = keywords.concat(keywordsInThisNote);
		}

		if (keywords.length === 0) return;

		const rnd = Math.floor((1 - Math.sqrt(Math.random())) * keywords.length);
		const keyword = keywords.sort((a, b) => a[0].length < b[0].length ? 1 : -1)[rnd];

		const exist = this.learnedKeywords.findOne({
			keyword: keyword[0]
		});

		let text: string;

		if (exist) {
			return;
		} else {
			this.learnedKeywords.insertOne({
				keyword: keyword[0],
				learnedAt: Date.now()
			});
			if (/^[ぁ-んァ-ヴー]*$/.test(keyword[0]) == true) {
				text = serifs.keyword.learned(keyword[0], null);
			} else {
				text = serifs.keyword.learned(keyword[0], kanaToHira(keyword[8]));
			}
		}

		this.ai.post({
			text: text
		});
	}
}
