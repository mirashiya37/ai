import { bindThis } from '@/decorators.js';
import Module from '@/module.js';
import serifs from '@/serifs.js';
import { getLearnedKeywords, genItemWithKeyword } from '@/utils/gen-item-with-keyword.js';
import config from '@/config.js';

export default class extends Module {
	public readonly name = 'noting';

	@bindThis
	public install() {
		if (config.notingEnabled === false) return {};

		setInterval(() => {
			if (Math.random() < 0.1) {
				this.post();
			}
		}, 1000 * 60 * 10);

		return {};
	}

	@bindThis
	private post() {
		const keywords = getLearnedKeywords(this.ai);
		const notes = [
			...serifs.noting.notes,
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

		const note = notes[Math.floor(Math.random() * notes.length)];

		// TODO: 季節に応じたセリフ

		this.ai.post({
			text: typeof note === 'function' ? note() : note
		});
	}
}
