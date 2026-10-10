import { bindThis } from '@/decorators.js';
import loki from 'lokijs';
import Module from '@/module.js';
import serifs from '@/serifs.js';
import config from '@/config.js';
import Message from '@/message.js';
import { MAX_CW_LENGTH, MAX_NOTE_LENGTH, resolveChunkSize, splitEmojis } from './chunk.js';

// 新着の取得: 1回の件数と、繰り返す回数の上限
const FETCH_LIMIT = 100;
const FETCH_MAX_PAGES = 10;
// 初回は、新しい順に何件を新着として投稿するか
const FIRST_RUN_COUNT = 5;
// 連続の取得・投稿の間隔(ミリ秒)
const FETCH_INTERVAL = 50;
const POST_INTERVAL = 1000;
// 個別投稿の設定でも、この件数を超えたら、まとめ投稿にする(連投と、投稿数の上限を避ける)
const INDIVIDUAL_MAX = 20;

// トークンやアカウントの権限が足りないときのエラーか(Misskey は 401・403 を返す)
function isPermissionError(err: unknown): boolean {
	const status = (err as any)?.response?.statusCode;
	return status === 401 || status === 403;
}

export default class extends Module {
	public readonly name = 'checkCustomEmojis';

	private lastEmoji: loki.Collection<{
		id: string;
		updatedAt: number;
	}>;

	@bindThis
	public install() {
		if (!config.checkEmojisEnabled) return {};
		this.lastEmoji = this.ai.getCollection('lastEmoji', {
			indices: ['id']
		});

		this.timeCheck();
		setInterval(this.timeCheck, 1000 * 60 * 3);

		return {
			mentionHook: this.mentionHook
		};
	}

	@bindThis
	private timeCheck() {
		const now = new Date();
		if (now.getHours() !== 8) return;
		const date = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
		const data = this.getData();
		if (data.lastPosted == date) return;
		data.lastPosted = date;
		this.setData(data);

		this.log('Time to Check CustomEmojis!');
		this.post();
	}

	@bindThis
	private async post(msg: Message | null = null) {
		this.log('Start to Check CustomEmojis.');
		const lastEmoji = this.lastEmoji.find({});

		const lastId = lastEmoji.length != 0 ? lastEmoji[0].id : null;
		let fetched: { emojis: any[]; hasMore: boolean; } | null = null;
		let fetchError: unknown = null;
		try {
			fetched = await this.checkCumstomEmojis(lastId);
		} catch (err: unknown) {
			fetchError = err;
			this.log('Error By API(admin/emoji/list)');
			if (err instanceof Error) {
				this.log(`${err.name}\n${err.message}`);
			}
		}
		if (fetched === null) {
			// 頼まれたときは頼んだ人へ返事をし、定期の確認ではマスターにチャットで知らせる
			const errMessage = isPermissionError(fetchError)
				? serifs.checkCustomEmojis.errorPermission
				: serifs.checkCustomEmojis.error;
			this.log(errMessage);
			if (msg) {
				await msg.reply(errMessage);
			} else {
				await this.tellMaster(errMessage);
			}
			return;
		}
		const emojisData = fetched.emojis;
		const hasMore = fetched.hasMore;
		if (emojisData.length == 0) {
			this.log('No CustomEmojis Added.');
			if (msg) {
				await msg.reply(serifs.checkCustomEmojis.nothing);
			}
			return;
		}

		const emojiSize = emojisData.length;

		const server_name = config.serverName ? config.serverName : 'このサーバー';
		this.log('Posting...');

		// 投稿で頼まれたときは、最初のノートを頼んだ投稿への返信にし、続くノートも同じ公開範囲にする
		let scope: { visibility?: string; visibleUserIds?: string[]; } = {};
		const postFirst = async (text: string, cw?: string) => {
			if (msg && !msg.isChat) {
				const posted = await msg.reply(text, { cw });
				scope = { visibility: posted.visibility, visibleUserIds: posted.visibleUserIds };
				return posted;
			}
			return await this.ai.post({ text, cw });
		};

		// 一気に投稿しないver
		if (!config.checkEmojisAtOnce && emojiSize <= INDIVIDUAL_MAX){
			// 概要について投稿
			this.log(serifs.checkCustomEmojis.post(server_name, emojiSize));
			await postFirst(serifs.checkCustomEmojis.post(server_name, emojiSize));

			// 各絵文字について投稿
			for (const emoji of emojisData){
				await this.sleep(POST_INTERVAL);
				await this.ai.post({
					text: serifs.checkCustomEmojis.emojiPost(emoji.name),
					...scope
				});
				this.log(serifs.checkCustomEmojis.emojiPost(emoji.name));
			}
		} else {
			// 一気に投稿ver(件数や文字数が多いときは、複数のノートに分ける)
			// 長くなりやすいので、絵文字の並びは折りたたみ、注釈(CW)に追加の件数を書く
			// 取得の上限で止まったときは、続きを次の回に出すことを1ノート目に書く
			const render = (index: number, chunk: any[]) => {
				const text = chunk.map(emoji => serifs.checkCustomEmojis.emojiOnce(emoji.name)).join('');
				return serifs.checkCustomEmojis.bodyOnce(index === 0 && hasMore ? `${serifs.checkCustomEmojis.continued}\n${text}` : text);
			};
			const chunks = splitEmojis(emojisData, resolveChunkSize(config.checkEmojisChunkSize), MAX_NOTE_LENGTH, render);
			// 注釈が長すぎるとき(サーバーの呼び名が長いとき)は、呼び名を既定の「このサーバー」にする
			const summary = serifs.checkCustomEmojis.post(server_name, emojiSize);
			const baseCw = serifs.checkCustomEmojis.cwOncePage(summary, chunks.length, chunks.length).length <= MAX_CW_LENGTH
				? summary
				: serifs.checkCustomEmojis.post('このサーバー', emojiSize);

			// 2ノート目以降は、直前のノートへの返信としてつなげる
			let prevNoteId: string | null = null;
			for (let i = 0; i < chunks.length; i++) {
				if (i > 0) await this.sleep(POST_INTERVAL);
				const message = render(i, chunks[i]);
				// 複数のノートに分けたときは、注釈にページ表記を付ける
				const cw = chunks.length > 1 ? serifs.checkCustomEmojis.cwOncePage(baseCw, i + 1, chunks.length) : baseCw;
				this.log(`${cw}\n${message}`);
				const posted = prevNoteId ? await this.ai.post({
					text: message,
					cw,
					replyId: prevNoteId,
					...scope
				}) : await postFirst(message, cw);
				prevNoteId = posted.id;
			}
		}

		// データの保存
		this.log('Last CustomEmojis data saving...');
		this.log(JSON.stringify(emojisData[emojiSize-1],null,'\t'));
		this.lastEmoji.remove(lastEmoji);
		this.lastEmoji.insertOne({
			id: emojisData[emojiSize-1].id,
			updatedAt: Date.now()
		});
		this.log('Check CustomEmojis finished!');
	}

	/**
	 * 新しく追加された絵文字を、古い順に返す。hasMore は、取得の上限で止まり、続きが残っているか
	 */
	@bindThis
	private async checkCumstomEmojis(lastId : any) {
		this.log('CustomEmojis fetching...');
		if (lastId == null) {
			this.log('lastId is null');
			// sinceId を指定しないと新しい順で返る。新着の扱いにそろえて古い順にする
			const emojisData = await this.ai.api('admin/emoji/list', {
				limit: FIRST_RUN_COUNT
			}) as any[];
			return { emojis: emojisData.reverse(), hasMore: false };
		}

		this.log('lastId is **not** null');
		// sinceId を指定すると古い順で返るので、取得した最後のIDから続きを取る
		const emojisData: any[] = [];
		let sinceId = lastId;
		for (let page = 0; page < FETCH_MAX_PAGES; page++) {
			if (page > 0) await this.sleep(FETCH_INTERVAL);
			const res = await this.ai.api('admin/emoji/list', {
				sinceId,
				limit: FETCH_LIMIT
			}) as any[];
			emojisData.push(...res);
			if (res.length < FETCH_LIMIT) return { emojis: emojisData, hasMore: false };
			sinceId = res[res.length - 1].id;
		}
		// 上限に達したぶんは、翌日以降に続きを取る(保存するIDは取得した最後のもの)
		// ちょうど上限の件数で終わっていることもあるので、続きがあるかを1件だけ取って確かめる
		await this.sleep(FETCH_INTERVAL);
		const rest = await this.ai.api('admin/emoji/list', {
			sinceId,
			limit: 1
		}) as any[];
		this.log(`CustomEmojis fetch reached the page limit (${FETCH_MAX_PAGES}).`);
		return { emojis: emojisData, hasMore: rest.length > 0 };
	}

	@bindThis
	private async mentionHook(msg: Message) {
		if (!msg.includes(['カスタム絵文字チェック','カスタムえもじチェック','カスタムえもじを調べて','カスタムえもじを確認'])) {
			return false;
		} else {
			this.log('Check CustomEmojis requested');
		}

		await this.post(msg);

		return {
			reaction: 'like'
		};
	}

	/** マスターにチャットで知らせる。マスターがいない・送れないときは、ログに残すだけ */
	@bindThis
	private async tellMaster(text: string) {
		if (!config.master) return;
		try {
			const master: any = await this.ai.api('users/show', { username: config.master });
			await this.ai.sendMessage(master.id, { text });
		} catch (err) {
			this.log(`Failed to tell the master: ${err}`);
		}
	}

	@bindThis
	private async sleep(ms: number) {
		return new Promise((res) => setTimeout(res, ms));
	}
}
