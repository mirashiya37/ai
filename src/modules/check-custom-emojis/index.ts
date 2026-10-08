import { bindThis } from '@/decorators.js';
import loki from 'lokijs';
import Module from '@/module.js';
import serifs from '@/serifs.js';
import config from '@/config.js';
import Message from '@/message.js';
import { MAX_NOTE_LENGTH, resolveChunkSize, splitEmojis } from './chunk.js';

// 新着の取得: 1回の件数と、繰り返す回数の上限
const FETCH_LIMIT = 100;
const FETCH_MAX_PAGES = 10;
// 初回は、新しい順に何件を新着として投稿するか
const FIRST_RUN_COUNT = 5;
// 連続の取得・投稿の間隔(ミリ秒)
const FETCH_INTERVAL = 50;
const POST_INTERVAL = 1000;

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
	private async post(byMentionHook:boolean = false) {
		this.log('Start to Check CustomEmojis.');
		const lastEmoji = this.lastEmoji.find({});

		const lastId = lastEmoji.length != 0 ? lastEmoji[0].id : null;
		let emojisData:any[] | null = null;
		try {
			emojisData = await this.checkCumstomEmojis(lastId);
		} catch (err: unknown) {
			this.log('Error By API(admin/emoji/list)');
			if (err instanceof Error) {
				this.log(`${err.name}\n${err.message}`);
			}
		}
		if (emojisData === null) {
			const errMessage = 'read:admin:emoji権限がないため、エラーが発生しました。\nカスタム絵文字管理の権限が付与されているか見直しをお願いします。';
			this.log(errMessage);
			await this.ai.post({
				text: errMessage
			});
			return;
		}
		else if (emojisData.length == 0) {
			this.log('No CustomEmojis Added.');
			if (byMentionHook) {
				await this.ai.post({
					text: serifs.checkCustomEmojis.nothing
				});
			}
			return;
		}

		const emojiSize = emojisData.length;

		const server_name = config.serverName ? config.serverName : 'このサーバー';
		this.log('Posting...');

		// 一気に投稿しないver
		if (!config.checkEmojisAtOnce){
			// 概要について投稿
			this.log(serifs.checkCustomEmojis.post(server_name, emojiSize));
			await this.ai.post({
				text: serifs.checkCustomEmojis.post(server_name, emojiSize)
			});

			// 各絵文字について投稿
			for (const emoji of emojisData){
				await this.sleep(POST_INTERVAL);
				await this.ai.post({
					text: serifs.checkCustomEmojis.emojiPost(emoji.name)
				});
				this.log(serifs.checkCustomEmojis.emojiPost(emoji.name));
			}
		} else {
			// 一気に投稿ver(件数や文字数が多いときは、複数のノートに分ける)
			const render = (index: number, chunk: any[]) => {
				const text = chunk.map(emoji => serifs.checkCustomEmojis.emojiOnce(emoji.name)).join('');
				// 2ノート目以降のページ表記は、桁数が最大になる値で見積もる(ページ数は件数以下)
				return index === 0
					? serifs.checkCustomEmojis.postOnce(server_name, emojiSize, text)
					: serifs.checkCustomEmojis.postOncePage(emojiSize, emojiSize, text);
			};
			const chunks = splitEmojis(emojisData, resolveChunkSize(config.checkEmojisChunkSize), MAX_NOTE_LENGTH, render);

			for (let i = 0; i < chunks.length; i++) {
				if (i > 0) await this.sleep(POST_INTERVAL);
				const text = chunks[i].map(emoji => serifs.checkCustomEmojis.emojiOnce(emoji.name)).join('');
				const message = i === 0
					? serifs.checkCustomEmojis.postOnce(server_name, emojiSize, text)
					: serifs.checkCustomEmojis.postOncePage(i + 1, chunks.length, text);
				this.log(message);
				await this.ai.post({
					text: message
				});
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
	 * 新しく追加された絵文字を、古い順に返す
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
			return emojisData.reverse();
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
			if (res.length < FETCH_LIMIT) return emojisData;
			sinceId = res[res.length - 1].id;
		}
		// 上限に達したぶんは、翌日以降に続きを取る(保存するIDは取得した最後のもの)
		this.log(`CustomEmojis fetch reached the page limit (${FETCH_MAX_PAGES}).`);
		return emojisData;
	}

	@bindThis
	private async mentionHook(msg: Message) {
		if (!msg.includes(['カスタム絵文字チェック','カスタムえもじチェック','カスタムえもじを調べて','カスタムえもじを確認'])) {
			return false;
		} else {
			this.log('Check CustomEmojis requested');
		}

		await this.post(true);

		return {
			reaction: 'like'
		};
	}

	@bindThis
	private async sleep(ms: number) {
		return new Promise((res) => setTimeout(res, ms));
	}
}
