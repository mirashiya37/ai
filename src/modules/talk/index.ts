import { bindThis } from '@/decorators.js';
import { HandlerResult } from '@/ai.js';
import Module from '@/module.js';
import Message from '@/message.js';
import { genItem } from '@/vocabulary.js';
import serifs, { getSerif } from '@/serifs.js';
import getDate from '@/utils/get-date.js';

export default class extends Module {
	public readonly name = 'talk';

	@bindThis
	public install() {
		return {
			mentionHook: this.mentionHook,
		};
	}

	@bindThis
	private async mentionHook(msg: Message) {
		if (!msg.text) return false;

		return (
			this.greet(msg) ||
			this.erait(msg) ||
			this.omedeto(msg) ||
			this.nadenade(msg) ||
			this.kawaii(msg) ||
			this.suki(msg) ||
			this.hug(msg) ||
			this.humu(msg) ||
			this.batou(msg) ||
			this.itai(msg) ||
			this.ote(msg) ||
			this.ponkotu(msg) ||
			this.rmrf(msg) ||
			this.shutdown(msg) ||
			this.mom(msg) ||
			this.baby(msg) ||
			this.diet(msg) ||
			this.sleep(msg) ||
			this.nade(msg) ||
			this.otukare(msg) ||
			this.hightouch(msg) ||
			this.adana(msg) ||
			this.otukaresama(msg) ||
			this.height(msg) ||
			this.weight(msg) ||
			this.thanks(msg) ||
			this.sugoi(msg) ||
			this.sorry(msg) ||
			this.hold(msg) ||
			this.nuge(msg) ||
			this.can(msg)
		);
	}

	@bindThis
	private greet(msg: Message): boolean {
		if (msg.text == null) return false;

		const incLove = () => {
			//#region 1日に1回だけ親愛度を上げる
			const today = getDate();

			const data = msg.friend.getPerModulesData(this);

			if (data.lastGreetedAt == today) return;

			data.lastGreetedAt = today;
			msg.friend.setPerModulesData(this, data);

			msg.friend.incLove();
			//#endregion
		};

		// 末尾のエクスクラメーションマーク
		const tension = (msg.text.match(/[！!]{2,}/g) || [''])
			.sort((a, b) => a.length < b.length ? 1 : -1)[0]
			.substr(1);

		if (msg.includes(['こんにちは', 'こんにちわ'])) {
			msg.reply(serifs.core.hello(msg.friend.name));
			incLove();
			return true;
		}

		if (msg.includes(['こんばんは', 'こんばんわ'])) {
			msg.reply(serifs.core.helloNight(msg.friend.name));
			incLove();
			return true;
		}

		if (msg.includes(['おは', 'おっは', 'お早う'])) {
			msg.reply(serifs.core.goodMorning(tension, msg.friend.name));
			incLove();
			return true;
		}

		if (msg.includes(['おやすみ', 'お休み'])) {
			msg.reply(serifs.core.goodNight(msg.friend.name));
			incLove();
			return true;
		}

		if (msg.includes(['行ってくる', '行ってきます', 'いってくる', 'いってきます'])) {
			msg.reply(
				msg.friend.love >= 7
					? serifs.core.itterassyai.love(msg.friend.name)
					: serifs.core.itterassyai.normal(msg.friend.name));
			incLove();
			return true;
		}

		if (msg.includes(['ただいま'])) {
			msg.reply(
				msg.friend.love >= 15 ? serifs.core.okaeri.love2(msg.friend.name) :
				msg.friend.love >= 7 ? getSerif(serifs.core.okaeri.love(msg.friend.name)) :
				serifs.core.okaeri.normal(msg.friend.name));
			incLove();
			return true;
		}

		return false;
	}

	@bindThis
	private erait(msg: Message): boolean {
		const match = msg.extractedText.match(/(.+?)た(から|ので)(褒|ほ)めて/);
		if (match) {
			msg.reply(getSerif(serifs.core.erait.specify(match[1], msg.friend.name)));
			return true;
		}

		const match2 = msg.extractedText.match(/(.+?)る(から|ので)(褒|ほ)めて/);
		if (match2) {
			msg.reply(getSerif(serifs.core.erait.specify(match2[1], msg.friend.name)));
			return true;
		}

		const match3 = msg.extractedText.match(/(.+?)だから(褒|ほ)めて/);
		if (match3) {
			msg.reply(getSerif(serifs.core.erait.specify(match3[1], msg.friend.name)));
			return true;
		}

		if (!msg.includes(['褒めて', 'ほめて'])) return false;

		msg.reply(getSerif(serifs.core.erait.general(msg.friend.name)));

		return true;
	}

	@bindThis
	private omedeto(msg: Message): boolean {
		if (!msg.includes(['おめでと'])) return false;

		msg.reply(serifs.core.omedeto(msg.friend.name));

		return true;
	}

	@bindThis
	private nadenade(msg: Message): boolean {
		if (!msg.includes(['なでなで'])) return false;

		//#region 1日に1回だけ親愛度を上げる(嫌われてない場合のみ)
		if (msg.friend.love >= 0) {
			const today = getDate();

			const data = msg.friend.getPerModulesData(this);

			if (data.lastNadenadeAt != today) {
				data.lastNadenadeAt = today;
				msg.friend.setPerModulesData(this, data);

				msg.friend.incLove();
			}
		}
		//#endregion

		msg.reply(getSerif(
			msg.friend.love >= 10 ? serifs.core.nadenade.love3 :
			msg.friend.love >= 5 ? serifs.core.nadenade.love2 :
			msg.friend.love <= -15 ? serifs.core.nadenade.hate4 :
			msg.friend.love <= -10 ? serifs.core.nadenade.hate3 :
			msg.friend.love <= -5 ? serifs.core.nadenade.hate2 :
			msg.friend.love <= -1 ? serifs.core.nadenade.hate1 :
			serifs.core.nadenade.normal
		));

		return true;
	}

	@bindThis
	private kawaii(msg: Message): boolean {
		if (!msg.includes(['かわいい', '可愛い'])) return false;

		msg.reply(getSerif(
			msg.friend.love >= 5 ? serifs.core.kawaii.love :
			msg.friend.love <= -3 ? serifs.core.kawaii.hate :
			serifs.core.kawaii.normal));

		return true;
	}

	@bindThis
	private suki(msg: Message): boolean {
		if (!msg.or(['好き', 'すき'])) return false;

		msg.reply(
			msg.friend.love >= 5 ? (msg.friend.name ? serifs.core.suki.love(msg.friend.name) : serifs.core.suki.normal) :
			msg.friend.love <= -3 ? serifs.core.suki.hate :
			serifs.core.suki.normal);

		return true;
	}

	@bindThis
	private hug(msg: Message): boolean {
		if (!msg.or(['ぎゅ', 'むぎゅ', /^はぐ(し(て|よ|よう)?)?$/])) return false;

		//#region 前のハグから1分経ってない場合は返信しない
		// これは、「ハグ」と言って「ぎゅー」と返信したとき、相手が
		// それに対してさらに「ぎゅー」と返信するケースがあったため。
		// そうするとその「ぎゅー」に対してもマッチするため、また
		// 藍がそれに返信してしまうことになり、少し不自然になる。
		// これを防ぐために前にハグしてから少し時間が経っていないと
		// 返信しないようにする
		const now = Date.now();

		const data = msg.friend.getPerModulesData(this);

		if (data.lastHuggedAt != null) {
			if (now - data.lastHuggedAt < (1000 * 60)) return true;
		}

		data.lastHuggedAt = now;
		msg.friend.setPerModulesData(this, data);
		//#endregion

		msg.reply(
			msg.friend.love >= 5 ? serifs.core.hug.love :
			msg.friend.love <= -3 ? serifs.core.hug.hate :
			serifs.core.hug.normal);

		return true;
	}

	@bindThis
	private humu(msg: Message): boolean {
		if (!msg.includes(['踏んで'])) return false;

		msg.reply(
			msg.friend.love >= 5 ? serifs.core.humu.love :
			msg.friend.love <= -3 ? serifs.core.humu.hate :
			serifs.core.humu.normal);

		return true;
	}

	@bindThis
	private batou(msg: Message): boolean {
		if (!msg.includes(['罵倒して', '罵って'])) return false;

		msg.reply(
			msg.friend.love >= 5 ? serifs.core.batou.love :
			msg.friend.love <= -5 ? serifs.core.batou.hate :
			serifs.core.batou.normal);

		return true;
	}

	@bindThis
	private itai(msg: Message): boolean {
		if (!msg.or(['痛い', 'いたい']) && !msg.extractedText.endsWith('痛い')) return false;

		msg.reply(serifs.core.itai(msg.friend.name));

		return true;
	}

	@bindThis
	private ote(msg: Message): boolean {
		if (!msg.or(['お手'])) return false;

		msg.reply(
			msg.friend.love >= 10 ? serifs.core.ote.love2 :
			msg.friend.love >= 5 ? serifs.core.ote.love1 :
			serifs.core.ote.normal);

		return true;
	}

	@bindThis
	private ponkotu(msg: Message): boolean | HandlerResult {
		if (!msg.includes(['ぽんこつ'])) return false;

		msg.friend.decLove();

		return {
			reaction: 'angry'
		};
	}

	@bindThis
	private rmrf(msg: Message): boolean | HandlerResult {
		if (!msg.includes(['rm -rf'])) return false;

		msg.friend.decLove();

		return {
			reaction: 'angry'
		};
	}

	@bindThis
	private shutdown(msg: Message): boolean | HandlerResult {
		if (!msg.includes(['shutdown'])) return false;

		msg.reply(serifs.core.shutdown);

		return {
			reaction: 'confused'
		};
	}

	// 以下ワード追加分

	@bindThis
	private mom(msg: Message): boolean {
		if (!msg.includes(['ママ', 'まま', 'マンマ', 'ばぶ', 'バブ', '母上', 'お母さん'])) return false;

		msg.reply(getSerif(msg.friend.love >= 5 ? serifs.core.mom.love(msg.friend.name) :
			msg.friend.love <= -3 ? serifs.core.mom.hate :
				serifs.core.mom.normal(msg.friend.name)));

		return true;
	}

	@bindThis
	private hold(msg: Message): boolean {
		if (!msg.includes(['だっこ', '抱っこ'])) return false;

		msg.reply(msg.friend.love >= 5 ? serifs.core.hold.love :
			msg.friend.love <= -3 ? serifs.core.hold.hate :
				serifs.core.hold.normal);

		return true;
	}

	@bindThis
	private baby(msg: Message): boolean {
		if (!msg.includes(['よちよち', 'よしよし'])) return false;

		msg.reply(
			msg.friend.love >= 5 ? serifs.core.baby.love :
				msg.friend.love <= -3 ? serifs.core.baby.hate :
					serifs.core.baby.normal);

		return true;
	}

	@bindThis
	private diet(msg: Message): boolean {
		if (!msg.includes(['ご飯', 'ごはん'])) return false;

		msg.reply(getSerif(
			msg.friend.love >= 10 ? serifs.core.diet.love(msg.friend.name) :
				msg.friend.love <= -10 ? serifs.core.diet.hate :
					serifs.core.diet.normal));

		return true;
	}

	@bindThis
	private sleep(msg: Message): boolean | HandlerResult {
		if (!msg.includes(['慰めて', 'なぐさめて'])) return false;

		msg.reply(serifs.core.nade);

		return {
			reaction: ':petthex:'
		};
	}

	@bindThis
	private otukare(msg: Message): boolean | HandlerResult {
		if (!msg.includes(['疲れた', 'つかれた'])) return false;

		msg.reply(serifs.core.otukare(msg.friend.name));

		return {
			reaction: ':petthex:'
		};
	}

	@bindThis
	private nade(msg: Message): boolean {
		if (!msg.includes(['眠い', 'ねむい', '寝たい', 'ねたい'])) return false;

		msg.reply(
			msg.friend.love >= 15 ? serifs.core.sleep.love(msg.friend.name) :
				msg.friend.love <= -6 ? serifs.core.sleep.hate :
					serifs.core.sleep.normal);

		return true;
	}

	@bindThis
	private hightouch(msg: Message): boolean | HandlerResult {
		if (!msg.includes(['ハイタッチ', 'はいたっち'])) return false;

		msg.reply(
			msg.friend.love <= -3 ? serifs.core.higntouch.hate :
				serifs.core.higntouch.normal(msg.friend.name));

		return {
			reaction: '🙌'
		};
	}

	@bindThis
	private adana(msg: Message): boolean | HandlerResult {  // いつかそのまま名前を覚えさせられたらいいね
		if (!msg.includes(['あだな', 'あだ名', '渾名', 'あだにゃ'])) return false;
		const item = genItem();

		msg.reply(serifs.core.adana(item, msg.friend.name));

		return {
			reaction: '🙌'
		};
	}

	@bindThis
	private height(msg: Message): boolean | HandlerResult {
		if (!msg.includes(['身長', '背の高さ'])) return false;

		msg.reply(serifs.core.height);

		return {
			reaction: ':neko_tere_nya:'
		};
	}

	@bindThis
	private weight(msg: Message): boolean | HandlerResult {
		if (!msg.includes(['体重'])) return false;

		msg.reply(serifs.core.weight);

		msg.friend.decLove();

		return {
			reaction: 'confused'
		};
	}

	@bindThis
	private otukaresama(msg: Message): boolean {
		if (!msg.includes(['おつかれ', 'お疲れ'])) return false;

		msg.reply(getSerif(
			msg.friend.love >= 5 ? serifs.core.otukaresama.love(msg.friend.name) :
				msg.friend.love <= -20 ? serifs.core.otukaresama.hate2 :
					msg.friend.love <= -3 ? serifs.core.otukaresama.hate1 :
						serifs.core.otukaresama.normal(msg.friend.name)));

		return true;
	}

	@bindThis
	private sugoi(msg: Message): boolean {
		if (!msg.includes(["えらい", "すごい"])) return false;

		msg.reply(getSerif(
			msg.friend.love >= 5 ? serifs.core.sugoi.love(msg.friend.name) :
				serifs.core.sugoi.normal));

		return true;
	}

	@bindThis
	private thanks(msg: Message): boolean {
		if (!msg.includes(["ありがとう", "ありがたい"])) return false;

		msg.reply(getSerif(
			msg.friend.love >= 5 ? serifs.core.thanks.love(msg.friend.name) :
			msg.friend.love <= 3 ? serifs.core.thanks.hate :
				serifs.core.thanks.normal(msg.friend.name)));

		return true;
	}

	@bindThis
	private sorry(msg: Message): boolean | HandlerResult {
		if (!msg.includes(['ごめん', 'ゴメン', "sorry"])) return false;

		msg.reply(
			msg.friend.love <= -3 ? serifs.core.sorry.hate :
				serifs.core.sorry.normal);

		return {
			reaction: 'confused'
		};
	}

	@bindThis
	private nuge(msg: Message): boolean | HandlerResult {
		if (!msg.includes(['脱げ', '脱いで', "ぬげ", "ぬいで"])) return false;

		msg.reply(
			msg.friend.love <= -3 ? serifs.core.nuge.hate :
				serifs.core.nuge.normal);

		return {
			reaction: 'confused'
		};
	}

	@bindThis
	private can(msg: Message): boolean | HandlerResult {
		if (!msg.includes(["できる","出来る"])) return false;

		msg.reply(serifs.core.can);

		return {
			reaction: '🙌'
		};
	}
}


