import { bindThis } from '@/decorators.js';
import { HandlerResult } from '@/ai.js';
import Module from '@/module.js';
import Message from '@/message.js';
import { getLearnedKeywords, genItemWithKeyword } from '@/utils/gen-item-with-keyword.js';
import serifs, { getSerif } from '@/serifs.js';
import getDate from '@/utils/get-date.js';
import { byLove } from './by-love.js';
import config from '@/config.js';
import Friend from '@/friend.js';
import { isMaster } from '@/utils/is-master.js';
import { pickNickname, parseAdanaTarget, ADANA_WORDS, REROLL_WORDS, YES_WORDS, NO_WORDS, isChatReplyExpired, startsWithReplyWord } from './nickname.js';
import { resolveMasterNicknameSettings, checkMasterNicknameLimit, nextMasterNicknameUserRecord, describeRequester, masterLabel, masterMentionVisibility, MasterNicknameSettings } from './master-nickname.js';

export default class extends Module {
	public readonly name = 'talk';

	@bindThis
	public install() {
		return {
			mentionHook: this.mentionHook,
			contextHook: this.contextHook,
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
			this.nade(msg) ||
			this.sleep(msg) ||
			this.otukare(msg) ||
			this.hightouch(msg) ||
			this.adana(msg) ||
			this.learned(msg) ||
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

		msg.reply(getSerif(byLove(msg.friend, serifs.core.mom)));

		return true;
	}

	@bindThis
	private hold(msg: Message): boolean {
		if (!msg.includes(['だっこ', '抱っこ'])) return false;

		msg.reply(getSerif(byLove(msg.friend, serifs.core.hold)));

		return true;
	}

	@bindThis
	private baby(msg: Message): boolean {
		if (!msg.includes(['よちよち', 'よしよし'])) return false;

		msg.reply(getSerif(byLove(msg.friend, serifs.core.baby)));

		return true;
	}

	@bindThis
	private diet(msg: Message): boolean {
		if (!msg.includes(['ご飯', 'ごはん'])) return false;

		msg.reply(getSerif(byLove(msg.friend, serifs.core.diet, { love: 10, hate: -10 })));

		return true;
	}

	@bindThis
	private nade(msg: Message): boolean | HandlerResult {
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
	private sleep(msg: Message): boolean {
		if (!msg.includes(['眠い', 'ねむい', '寝たい', 'ねたい'])) return false;

		msg.reply(getSerif(byLove(msg.friend, serifs.core.sleep, { love: 15, hate: -6 })));

		return true;
	}

	@bindThis
	private hightouch(msg: Message): boolean | HandlerResult {
		if (!msg.includes(['ハイタッチ', 'はいたっち'])) return false;

		msg.reply(getSerif(byLove(msg.friend, serifs.core.hightouch)));

		return {
			reaction: '🙌'
		};
	}

	@bindThis
	private adana(msg: Message): boolean | HandlerResult {
		if (!msg.includes(ADANA_WORDS)) return false;

		// 「〇〇さんのあだ名」は、送った本人ではなく〇〇さんのあだ名を考える。
		// 誰のあだ名かが増えるときは、parseAdanaTarget() の kind と、ここの分岐を増やす
		const master = resolveMasterNicknameSettings(config);
		// マスターのあだ名を使わないときも、マスターの名前は、送った本人のあだ名にしない(マスター本人が言ったときは、本人のあだ名)
		const otherNames = master == null && config.master && !isMaster(msg.user, config.master) && Array.isArray(config.masterNicknameNames)
			? config.masterNicknameNames.filter((name): name is string => typeof name === 'string' && name.length > 0)
			: [];
		const localHost = new URL(config.host).host;
		const target = parseAdanaTarget(msg.extractedText, master != null ? { username: master.username, names: master.names, localHost } : undefined, otherNames, { username: msg.user.username, host: msg.user.host, localHost }, this.ai.account?.username ? { username: this.ai.account.username, localHost } : undefined);
		switch (target.kind) {
			case 'ai': return this.adanaForAi(msg);
			case 'master': return this.adanaForMaster(msg, master!);
			case 'other': return this.adanaForOther(msg, target.name);
			default: return this.adanaForSelf(msg);
		}
	}

	/** 藍自身のあだ名は、やんわり断る */
	private adanaForAi(msg: Message): HandlerResult {
		msg.reply(getSerif(byLove(msg.friend, serifs.core.adanaForAi)));
		return { reaction: 'confused' };
	}

	/**
	 * ほかの人のあだ名を提案する。返事を待ち受けて引き直せるが、送った本人の呼び名にはしない
	 * (待ち受けのデータの target で見分ける)
	 */
	private adanaForOther(msg: Message, targetName: string): HandlerResult {
		const keywords = getLearnedKeywords(this.ai);
		const item = pickNickname(() => genItemWithKeyword(keywords));

		if (item == null) {
			msg.reply(serifs.core.adana('', msg.friend.name));
			return { reaction: '🙌' };
		}

		msg.reply(serifs.core.adanaOther(targetName, item)).then(reply => {
			this.subscribeReply(msg.userId, msg.isChat, msg.isChat ? msg.userId : reply.id, {
				name: item,
				seen: [item],
				rerolls: 0,
				target: targetName,
				at: Date.now()
			});
		});
		return { reaction: '🙌' };
	}

	/**
	 * マスターのあだ名を考えて、マスターに伝える(または呼び名にする)。返事は待ち受けない(一発)。
	 * 荒らし対策で、同じ人は1日に決まった回数まで、マスターに伝えるのは、誰からかに関わらず決まった間隔まで。
	 * 制限にかかったら、考えたあだ名だけ返して、伝えられない理由を添える。
	 */
	private adanaForMaster(msg: Message, settings: MasterNicknameSettings): HandlerResult {
		// マスター本人が言ったときは、本人のあだ名
		if (isMaster(msg.user, config.master)) return this.adanaForSelf(msg);

		const keywords = getLearnedKeywords(this.ai);
		const item = pickNickname(() => genItemWithKeyword(keywords));
		if (item == null) {
			msg.reply(serifs.core.adana('', msg.friend.name));
			return { reaction: '🙌' };
		}

		const today = getDate();
		const now = Date.now();
		const userData = msg.friend.getPerModulesData(this);
		const moduleData = this.getData();
		const limit = checkMasterNicknameLimit(settings, userData.masterNickname ?? {}, moduleData.masterNicknameNotifiedAt, today, now);
		if (!limit.ok) {
			msg.reply(limit.reason === 'daily'
				? serifs.core.adanaMasterLimitDaily(item, masterLabel(settings))
				: serifs.core.adanaMasterLimitInterval(item, Math.ceil(limit.nextAt / 1000), masterLabel(settings)));
			return { reaction: '🙌' };
		}

		// 同時に頼まれても制限を超えないように、伝える前に記録する。伝えられなかったら元に戻す
		const prevUser = userData.masterNickname;
		const prevNotifiedAt = moduleData.masterNicknameNotifiedAt;
		msg.friend.setPerModulesData(this, { ...userData, masterNickname: nextMasterNicknameUserRecord(prevUser ?? {}, today) });
		this.setData({ ...moduleData, masterNicknameNotifiedAt: now });

		this.tellMaster(msg, settings, item).catch(err => {
			this.log(`Failed to tell the master a nickname: ${err}`);
			msg.friend.setPerModulesData(this, { ...msg.friend.getPerModulesData(this), masterNickname: prevUser });
			this.setData({ ...this.getData(), masterNicknameNotifiedAt: prevNotifiedAt });
			msg.reply(serifs.core.adanaMasterFailed(item, masterLabel(settings)))
				.catch(err => this.log(`Failed to reply to the requester: ${err}`));
		});

		return { reaction: '🙌' };
	}

	/**
	 * マスターに、頼まれて考えたあだ名を伝える。呼び名にする設定なら、伝えられたあとで呼び名にする。
	 * 失敗とみなす(呼び出し元が記録を戻す)のは、マスターに伝えられなかったときだけ。
	 * 伝え終わったあとの、呼び名の変更と頼んだ人への返事は、失敗してもログに残すだけにする
	 * (マスターには届いているのに、回数の記録を戻して「伝えられませんでした」と答えると、何度でも頼めてしまうため)
	 */
	private async tellMaster(msg: Message, settings: MasterNicknameSettings, item: string) {
		const master: any = await this.ai.api('users/show', { username: settings.username });
		// 藍が付けた呼び名はマスターには分からないので、表示名とユーザー名で示す
		const from = describeRequester(msg.user);

		// 呼び名にする設定なら、提案ではなく、決まったこととして伝える(伝えない設定でも、呼び名を変えたことはチャットで知らせる)
		const renamed = settings.updateName;
		const label = masterLabel(settings);

		if (settings.notify === 'mention') {
			const mention = `@${master.username}`;
			const text = renamed ? serifs.core.adanaMasterRenamedMention(mention, from, item, label) : serifs.core.adanaMasterMention(mention, from, item, label);
			await this.ai.post(this.masterMentionParams(msg, master, text, settings.mentionVisibility));
		} else {
			await this.ai.sendMessage(master.id, { text: renamed ? serifs.core.adanaMasterRenamedToMaster(from, item, label) : serifs.core.adanaMasterToMaster(from, item, label) });
		}

		// ここから先は、マスターに伝え終わっている
		if (settings.updateName) {
			try {
				const friend = this.ai.lookupFriend(master.id) ?? new Friend(this.ai, { user: master });
				friend.updateName(item);
			} catch (err) {
				this.log(`Failed to rename the master: ${err}`);
			}
		}

		// メンションの投稿は、投稿で頼まれたなら、頼んだ人への返信そのもの。
		// チャットで頼まれたときは、メンションの投稿(ダイレクト)が頼んだ人のチャットには出ないので、チャットにも返す
		if (settings.notify !== 'mention' || msg.isChat) {
			await msg.reply(renamed ? serifs.core.adanaMasterRenamedToSender(item, label) : serifs.core.adanaMasterToSender(item, label))
				.catch(err => this.log(`Failed to reply to the requester: ${err}`));
		}
	}

	/**
	 * マスターへのメンションの投稿。頼んだ人の投稿への返信にして、公開範囲は msg.reply() と同じ考え方にする。
	 * チャットで頼まれたときは、チャットの内容が公開されないように、頼んだ人とマスターだけのダイレクト投稿にする。
	 * 頼まれた投稿が公開でも、設定の上限(masterNicknameMentionVisibility)より広くはしない
	 */
	private masterMentionParams(msg: Message, master: any, text: string, max: MasterNicknameSettings['mentionVisibility']) {
		if (msg.isChat) {
			const acct = msg.user.host ? `@${msg.user.username}@${msg.user.host}` : `@${msg.user.username}`;
			return { text: `${acct} ${text}`, visibility: 'specified', visibleUserIds: [msg.userId, master.id] };
		}

		const visibility = masterMentionVisibility(msg.visibility ?? 'public', max);
		return {
			replyId: msg.id,
			text,
			visibility,
			visibleUserIds: visibility === 'specified' ? [msg.userId, master.id] : undefined,
		};
	}

	/** 送った本人のあだ名を提案して、「はい」なら呼び名にする */
	private adanaForSelf(msg: Message): HandlerResult {
		const keywords = getLearnedKeywords(this.ai);
		const item = pickNickname(() => genItemWithKeyword(keywords));

		if (item != null) {
			msg.reply(serifs.core.adanaAsk(item, msg.friend.name)).then(reply => {
				// seen: これまでに出したあだ名、rerolls: 引き直した回数(引き直しで使う)
				this.subscribeReply(msg.userId, msg.isChat, msg.isChat ? msg.userId : reply.id, {
					name: item,
					seen: [item],
					rerolls: 0,
					at: Date.now()
				});
			});
		} else {
			msg.reply(serifs.core.adana('', msg.friend.name));
		}

		return { reaction: '🙌' };
	}

	@bindThis
	private async contextHook(key: any, msg: Message, data: any) {
		if (msg.text == null) return;

		// チャットは返信先の投稿が無く、この人の次の発言がすべて返事になる。
		// 時間がたったものと、文の頭に返事の言葉が無いもの(「別の話だけど」など)は、返事とみなさない
		if (msg.isChat && (isChatReplyExpired(data.at, Date.now()) || !startsWithReplyWord(msg.text))) {
			this.unsubscribeReply(key);
			return false;
		}

		// 「やだ、別の」のように否定と一緒に言われても、引き直しとして扱う
		if (msg.includes(REROLL_WORDS)) return this.rerollNickname(key, msg, data);

		// ほかの人のあだ名を提案したときは、送った本人の呼び名を変えない
		const target: string | undefined = data.target;

		// 「ううん」は「うん」を含むので、否定を先に判定する
		if (msg.includes(NO_WORDS)) {
			msg.reply(target != null ? serifs.core.adanaOtherNo(target) : serifs.core.adanaNo(msg.friend.name));
		} else if (msg.includes(YES_WORDS)) {
			if (target != null) {
				msg.reply(serifs.core.adanaOtherOk(target));
			} else {
				msg.friend.updateName(data.name);
				msg.reply(serifs.core.setNameOk(data.name));
			}
		} else {
			// あだ名への返事ではなさそうなので、待ち受けをやめて普段の会話として扱う
			this.unsubscribeReply(key);
			return false;
		}

		this.unsubscribeReply(key);
		return {
			reaction: '🙌'
		};
	}

	/**
	 * あだ名を引き直す。すでに出したあだ名は出さない。
	 * 待ち受けのデータは、出したあだ名(seen)と引き直した回数(rerolls)、ほかの人のあだ名なら誰のものか(target)を引き継ぐ
	 */
	@bindThis
	private rerollNickname(key: any, msg: Message, data: any): HandlerResult {
		const seen: string[] = data.seen ?? [data.name];
		const keywords = getLearnedKeywords(this.ai);
		const item = pickNickname(() => genItemWithKeyword(keywords), seen);

		this.unsubscribeReply(key);

		if (item == null) {
			msg.reply(serifs.core.adana('', msg.friend.name));
			return { reaction: 'confused' };
		}

		const target: string | undefined = data.target;
		const text = target != null ? serifs.core.adanaOtherAgain(target, item) : serifs.core.adanaAgain(item, msg.friend.name);

		msg.reply(text).then(reply => {
			this.subscribeReply(msg.userId, msg.isChat, msg.isChat ? msg.userId : reply.id, {
				name: item,
				seen: [...seen, item],
				rerolls: (data.rerolls ?? 0) + 1,
				at: Date.now(),
				...(target != null ? { target } : {})
			});
		});

		return { reaction: '🙌' };
	}

	@bindThis
	private learned(msg: Message): boolean | HandlerResult {
		if (!msg.includes(['何覚えた', 'なに覚えた', '何を覚えた', 'なにを覚えた', 'なにおぼえた', '覚えた言葉', 'おぼえた言葉'])) return false;

		// 新しく覚えた順に3つ
		const keywords = getLearnedKeywords(this.ai).slice(-3).reverse();

		msg.reply(serifs.core.learnedKeywords(keywords));

		return {
			reaction: '💡'
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

		msg.reply(getSerif(byLove(msg.friend, serifs.core.sugoi)));

		return true;
	}

	@bindThis
	private thanks(msg: Message): boolean {
		if (!msg.includes(["ありがとう", "ありがたい"])) return false;

		msg.reply(getSerif(byLove(msg.friend, serifs.core.thanks)));

		return true;
	}

	@bindThis
	private sorry(msg: Message): boolean | HandlerResult {
		if (!msg.includes(['ごめん', 'ゴメン', "sorry"])) return false;

		msg.reply(getSerif(byLove(msg.friend, serifs.core.sorry)));

		return {
			reaction: 'confused'
		};
	}

	@bindThis
	private nuge(msg: Message): boolean | HandlerResult {
		if (!msg.includes(['脱げ', '脱いで', "ぬげ", "ぬいで"])) return false;

		msg.reply(getSerif(byLove(msg.friend, serifs.core.nuge)));

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


