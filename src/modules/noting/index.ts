import { bindThis } from '@/decorators.js';
import Module from '@/module.js';
import serifs from '@/serifs.js';
import { getLearnedKeywords, genItemWithKeyword } from '@/utils/gen-item-with-keyword.js';
import config from '@/config.js';
import { pickNote } from './pick-note.js';

/** 10分ごとに、独り言を投稿する確率 */
const POST_RATE = 0.15;

/** 独り言を、学習した語句を使うテンプレートから選ぶ確率 */
const KEYWORD_NOTE_RATE = 0.3;

export default class extends Module {
	public readonly name = 'noting';

	@bindThis
	public install() {
		if (config.notingEnabled === false) return {};

		setInterval(() => {
			if (Math.random() < POST_RATE) {
				this.post();
			}
		}, 1000 * 60 * 10);

		return {};
	}

	@bindThis
	private post() {
		const keywords = getLearnedKeywords(this.ai);
		const keywordNotes = [
			() => {
				const item = genItemWithKeyword(keywords);
				return serifs.noting.want(item);
			},
			() => {
				const item = genItemWithKeyword(keywords);
				return serifs.noting.see(item);
			},
			() => {
				const item = genItemWithKeyword(keywords);
				return serifs.noting.expire(item);
			},
		];

		const note = pickNote<string | (() => string)>(serifs.noting.notes, keywordNotes, KEYWORD_NOTE_RATE);

		// TODO: 季節に応じたセリフ

		this.ai.post({
			text: typeof note === 'function' ? note() : note
		});
	}
}
