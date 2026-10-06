import { bindThis } from '@/decorators.js';
import loki from 'lokijs';
import Module from '@/module.js';
import Message from '@/message.js';
import config from '@/config.js';
import serifs from '@/serifs.js';
import { mecab } from './mecab.js';
import { sudachi } from './sudachi.js';
import { isLearnableToken, kindOf, trendKeywordsOf } from './token-filter.js';
import { pickCandidate, resolveProperRate } from './pick-candidate.js';
import { nextLearnDelay } from './learn-interval.js';
import { stripMfm } from './strip-mfm.js';
import { isBotNote } from './note-filter.js';
import getDate from '@/utils/get-date.js';
import { isMaster } from '@/utils/is-master.js';
import { countKeywords } from '@/utils/keyword-trend.js';

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
		/** 固有名詞か普通名詞か(この項目を入れる前に覚えた語にはない) */
		kind?: 'proper' | 'common';
	}>;

	@bindThis
	public install() {
		if (!config.keywordEnabled) return {};

		this.learnedKeywords = this.ai.getCollection('_keyword_learnedKeywords', {
			indices: ['userId']
		});

		this.scheduleLearn();
		setInterval(this.forget, 1000 * 60);

		this.log(`Morph analyzer: ${config.morphAnalyzer ?? 'mecab'}`);

		return {
			mentionHook: this.mentionHook
		};
	}

	/**
	 * 学習を、毎回少しずらした間隔で行う(固定の間隔だと、投稿がいつも同じ時刻に並ぶので)。
	 * 学習が失敗しても、次の予約は止めない(エラーは、これまでどおり外に出す)
	 */
	@bindThis
	private scheduleLearn() {
		const delay = nextLearnDelay();
		this.log(`Next learn in ${(delay / 1000 / 60).toFixed(1)} min`);

		setTimeout(async () => {
			try {
				await this.learn();
			} finally {
				this.scheduleLearn();
			}
		}, delay);
	}

	/** 覚えないようにした語句(/forget で追加する) */
	private getIgnored(): string[] {
		return this.getData().ignored ?? [];
	}

	private setIgnored(ignored: string[]) {
		this.setData({ ...this.getData(), ignored });
	}

	/**
	 * マスター専用のコマンド
	 * /keywords          覚えている語句の数と、最近覚えた語句を返す
	 * /forget 語句       語句を忘れて、以後も覚えないようにする
	 * /unforget 語句     覚えないようにした語句を、また覚えられるようにする
	 */
	@bindThis
	private async mentionHook(msg: Message) {
		if (!msg.text || !isMaster(msg.user, config.master)) return false;

		const text = msg.extractedText;

		if (text === '/keywords') {
			const recent = this.learnedKeywords.chain().simplesort('learnedAt', true).limit(10).data();
			msg.reply([
				`覚えている語句: ${this.learnedKeywords.count()}個(覚えないようにした語句: ${this.getIgnored().length}個)`,
				recent.length > 0 ? `最近覚えた語句: ${recent.map(doc => doc.keyword).join('、')}` : '',
			].filter(line => line !== '').join('\n'), { immediate: true });
			return true;
		}

		const command = text.match(/^\/(forget|unforget)\s+(.+)$/);
		if (command == null) return false;

		const keyword = command[2].trim().replace(/^「(.*)」$/, '$1');
		const ignored = this.getIgnored();

		if (command[1] === 'forget') {
			const exist = this.learnedKeywords.findOne({ keyword });
			if (exist) this.learnedKeywords.remove(exist);
			if (!ignored.includes(keyword)) this.setIgnored([...ignored, keyword]);
			msg.reply(`「${keyword}」を${exist ? '忘れて、' : ''}覚えないようにしました`, { immediate: true });
			this.log(`Forgot by master: ${keyword}`);
		} else if (ignored.includes(keyword)) {
			this.setIgnored(ignored.filter(k => k !== keyword));
			msg.reply(`「${keyword}」をまた覚えられるようにしました`, { immediate: true });
		} else {
			msg.reply(`「${keyword}」は、覚えないようにしていません`, { immediate: true });
		}

		return true;
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
		if (isFirstTime) {
			this.log('Forget: skipped on the first run');
			return;
		}

		const threshold = Date.now() - 1000 * 60 * 60 * 24 * FORGET_AFTER_DAYS;
		const eligible = this.learnedKeywords.find({ learnedAt: { $lt: threshold } });
		const forgotten = eligible.filter(() => Math.random() < FORGET_RATE);

		for (const doc of forgotten) {
			this.learnedKeywords.remove(doc);
		}

		// 忘れた語がなくても、動いたことが分かるよう毎回ログに残す。
		// 一度に大量に忘れることもあるので、語句は先頭の数個だけ出す
		const examples = forgotten.length > 0
			? ` (e.g. ${forgotten.slice(0, 5).map(doc => doc.keyword).join(', ')}${forgotten.length > 5 ? ', ...' : ''})`
			: '';
		this.log(`Forget: ${forgotten.length} forgotten of ${eligible.length} older than ${FORGET_AFTER_DAYS} days, ${this.learnedKeywords.count()} remain${examples}`);

		this.report(forgotten.length);
	}

	/**
	 * 日付が変わったときに、学習の状況をマスターにチャットで送る
	 * (マスターが設定されていない場合や、送れなかった場合は何もしない)
	 */
	@bindThis
	private async report(forgottenCount: number) {
		if (!config.master) return;

		try {
			const user: any = await this.ai.api('users/show', { username: config.master });
			const learned = this.learnedKeywords.find({ learnedAt: { $gte: Date.now() - 1000 * 60 * 60 * 24 } });
			const learnedCount = learned.length;
			const properCount = learned.filter(doc => doc.kind === 'proper').length;
			const commonCount = learned.filter(doc => doc.kind === 'common').length;

			await this.ai.sendMessage(user.id, {
				text: [
					'語句の学習のレポートです',
					`覚えた: ${learnedCount}個${properCount + commonCount > 0 ? `(固有名詞 ${properCount} / 普通名詞 ${commonCount})` : ''} / 忘れた: ${forgottenCount}個 / いま覚えている: ${this.learnedKeywords.count()}個`,
					`形態素解析: ${config.morphAnalyzer ?? 'mecab'}`,
				].join('\n'),
			});
		} catch (e) {
			this.log(`Failed to send report: ${e}`);
		}
	}

	@bindThis
	private async learn() {
		const tl: any = await this.ai.api('notes/global-timeline', {
			limit: 100
		});

		const publicNotes = tl.filter(note =>
			note.userId !== this.ai.account.id &&
			note.text != null &&
			note.visibility == "public" &&
			note.cw == null);

		// Bot の投稿は、学習にも「今日よく見かけた言葉」にも使わない(note-filter.ts)
		const interestedNotes = publicNotes.filter(note => !isBotNote(note));
		const botNoteCount = publicNotes.length - interestedNotes.length;

		let keywords: string[][] = [];
		const ignored = new Set(this.getIgnored());
		const trendNotes: { id: string; keywords: string[] }[] = [];

		// MFM の記法や URL、絵文字の名前(「meow」「https」など)が、固有名詞と判定されてしまうので、解析の前に取り除く(strip-mfm.ts)
		const texts: string[] = interestedNotes.map(note => stripMfm(note.text));

		// Sudachi は起動のたびに辞書を読み込むので、まとめて解析しておく
		const sudachiTokens = config.morphAnalyzer === 'sudachi'
			? await sudachi(texts, config.sudachi, config.sudachiDict)
			: null;

		for (const [i, note] of interestedNotes.entries()) {
			const tokens = sudachiTokens ? sudachiTokens[i] : await mecab(texts[i], config.mecab, config.mecabDic);
			// 人名(姓・名)と一般的すぎる普通名詞は覚えない(token-filter.ts)
			const keywordsInThisNote = tokens.filter(token => isLearnableToken(token, ignored));
			keywords = keywords.concat(keywordsInThisNote);
			trendNotes.push({ id: note.id, keywords: trendKeywordsOf(keywordsInThisNote) });
		}

		// 「今日よく見かけた言葉」(チャートの投稿に添える)のために数える。
		// チャートが無効だと数がリセットされず増え続けるので、そのときは数えない
		if (config.chartEnabled !== false) countKeywords(this.ai, trendNotes);

		// 学習したかどうかが投稿以外に分からないので、毎回の経過をログに残す
		const uniqueKeywords = [...new Set(keywords.map(token => token[0]))];
		const newKeywords = uniqueKeywords.filter(keyword => this.learnedKeywords.findOne({ keyword }) == null);

		// すでに覚えている語を選ぶと、その回は何も起きないので、まだ覚えていない語の中から選ぶ
		const newSet = new Set(newKeywords);
		const candidates = keywords.filter(token => newSet.has(token[0]));

		const kinds = (kind: string) => new Set(candidates.filter(token => kindOf(token) === kind).map(token => token[0])).size;
		this.log(`Learn: ${interestedNotes.length} notes (${botNoteCount} bot notes skipped), ${uniqueKeywords.length} keywords (${newKeywords.length} not yet learned: ${kinds('proper')} proper, ${kinds('common')} common)`);

		const keyword = pickCandidate(candidates, resolveProperRate(config.keywordProperRate));
		if (keyword == null) return;

		const exist = this.learnedKeywords.findOne({
			keyword: keyword[0]
		});

		let text: string;

		if (exist) {
			return;
		} else {
			this.learnedKeywords.insertOne({
				keyword: keyword[0],
				learnedAt: Date.now(),
				kind: kindOf(keyword)
			});
			if (/^[ぁ-んァ-ヴー]*$/.test(keyword[0]) == true) {
				text = serifs.keyword.learned(keyword[0], null);
			} else {
				text = serifs.keyword.learned(keyword[0], kanaToHira(keyword[8]));
			}
		}

		this.log(`Learned: "${keyword[0]}" (${kindOf(keyword)})`);

		this.ai.post({
			text: text
		});
	}
}
