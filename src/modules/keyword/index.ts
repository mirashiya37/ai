import { bindThis } from '@/decorators.js';
import loki from 'lokijs';
import Module from '@/module.js';
import Message from '@/message.js';
import config from '@/config.js';
import serifs from '@/serifs.js';
import { mecab } from './mecab.js';
import { sudachi } from './sudachi.js';
import getDate from '@/utils/get-date.js';
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
	}>;

	@bindThis
	public install() {
		if (!config.keywordEnabled) return {};

		this.learnedKeywords = this.ai.getCollection('_keyword_learnedKeywords', {
			indices: ['userId']
		});

		setInterval(this.learn, 1000 * 60 * 30);
		setInterval(this.forget, 1000 * 60);

		this.log(`Morph analyzer: ${config.morphAnalyzer ?? 'mecab'}`);

		return {
			mentionHook: this.mentionHook
		};
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
		// 他のサーバの同名ユーザーを弾くため、ローカルユーザー(host が無い)に限る
		if (!msg.text || !config.master || msg.user.username !== config.master || msg.user.host != null) return false;

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
			const learnedCount = this.learnedKeywords.find({ learnedAt: { $gte: Date.now() - 1000 * 60 * 60 * 24 } }).length;

			await this.ai.sendMessage(user.id, {
				text: [
					'語句の学習のレポートです',
					`覚えた: ${learnedCount}個 / 忘れた: ${forgottenCount}個 / いま覚えている: ${this.learnedKeywords.count()}個`,
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

		const interestedNotes = tl.filter(note =>
			note.userId !== this.ai.account.id &&
			note.text != null &&
			note.visibility == "public" &&
			note.cw == null);

		let keywords: string[][] = [];
		const ignored = this.getIgnored();
		const trendNotes: { id: string; keywords: string[] }[] = [];

		// Sudachi は起動のたびに辞書を読み込むので、まとめて解析しておく
		const sudachiTokens = config.morphAnalyzer === 'sudachi'
			? await sudachi(interestedNotes.map(note => note.text), config.sudachi, config.sudachiDict)
			: null;

		for (const [i, note] of interestedNotes.entries()) {
			const tokens = sudachiTokens ? sudachiTokens[i] : await mecab(note.text, config.mecab, config.mecabDic);
			// 人名は、名字・名前(姓・名)だけを除く。キャラクター名など辞書にフルネームで載っている名前(一般)は覚える
			const keywordsInThisNote = tokens.filter(token => token[2] == '固有名詞' && (token[3] !== '人名' || token[4] === '一般') && token[8] != null && !ignored.includes(token[0]));
			keywords = keywords.concat(keywordsInThisNote);
			trendNotes.push({ id: note.id, keywords: keywordsInThisNote.map(token => token[0]) });
		}

		// 「今日よく見かけた言葉」(チャートの投稿に添える)のために数える。
		// チャートが無効だと数がリセットされず増え続けるので、そのときは数えない
		if (config.chartEnabled !== false) countKeywords(this.ai, trendNotes);

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
