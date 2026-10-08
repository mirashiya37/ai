import { randomUUID } from 'node:crypto';
import got from 'got';
import { bindThis } from '@/decorators.js';
import Module from '@/module.js';
import Message from '@/message.js';
import serifs from '@/serifs.js';
import config from '@/config.js';
import Friend from '@/friend.js';
import { isMaster } from '@/utils/is-master.js';
import { resolveMasterNicknameSettings, MasterNicknameOverrides, MasterNicknameSettings } from '@/modules/talk/master-nickname.js';
import { YES_WORDS, NO_WORDS, startsWithWord } from '@/modules/talk/nickname.js';
import { parseNicknameCommand, NICKNAME_HELP, NicknameCommand, RenameMode } from './commands.js';
import { checkToken, apiErrorCode, TokenCheckResult } from './token-check.js';
import { miauthUrl, checkMiAuth, MIAUTH_TIMEOUT, MIAUTH_POLL_INTERVAL } from './miauth.js';

/** 承認を待っている表示名の変更 */
type PendingRename = { item: string; from: string; at: number };

type RenameData = {
	/** 表示名の変更がオンか(初期状態はオフ) */
	on?: boolean;
	/** コマンドで変えた方式。無ければ config.json の masterRenameMode */
	mode?: RenameMode;
	/** MiAuth で受け取った、マスターのトークン */
	token?: string;
	/** トークンの持ち主(マスター)のユーザー ID */
	userId?: string;
	/** 最初に変える前の表示名(revert で戻す)。hasOriginal が true のときだけ意味がある(null は、表示名が無かった) */
	originalName?: string | null;
	hasOriginal?: boolean;
	pending?: PendingRename | null;
	/** 最後にマスターに知らせた、トークンの問題(同じ問題を、起動のたびに知らせないため) */
	lastProblem?: string;
};

type Data = { overrides?: MasterNicknameOverrides; rename?: RenameData };

/** トークンの検証の状態。起動のたびに確かめ直す(記憶には残さない) */
type TokenState =
	| { state: 'none' }
	| { state: 'checking' }
	| { state: 'ok'; unprobeable: string[] }
	| { state: 'ng'; problems: string[] };

const DEFAULT_APPROVAL_MINUTES = 60;

/** トークンが使えなくなったとみなすエラー */
const TOKEN_ERROR_CODES = ['PERMISSION_DENIED', 'AUTHENTICATION_FAILED', 'CREDENTIAL_REQUIRED'];

/**
 * マスターのあだ名の設定(コマンドで変える)と、マスターの表示名の変更。
 * あだ名を考えて伝える処理そのものは、talk モジュールの adanaForMaster が行い、ここから設定を取る。
 * マスター用のコマンドを、あだ名の反応より先に処理するため、src/index.ts で TalkModule より前に置く。
 */
export default class extends Module {
	public readonly name = 'masterNickname';

	private tokenState: TokenState = { state: 'none' };
	private miauthTimer: ReturnType<typeof setInterval> | null = null;

	@bindThis
	public install() {
		if (config.masterRenameEnabled === true && this.rename().token != null) {
			this.verifyToken().catch(err => this.log(`Failed to verify the token: ${err}`));
		}

		return {
			mentionHook: this.mentionHook,
		};
	}

	//#region 設定

	private data(): Data {
		return this.getData() ?? {};
	}

	private rename(): RenameData {
		return this.data().rename ?? {};
	}

	private updateRename(patch: Partial<RenameData>) {
		const data = this.data();
		this.setData({ ...data, rename: { ...(data.rename ?? {}), ...patch } });
	}

	private updateOverrides(patch: MasterNicknameOverrides | null) {
		const data = this.data();
		this.setData({ ...data, overrides: patch == null ? {} : { ...(data.overrides ?? {}), ...patch } });
	}

	/** 実際に使う、マスターのあだ名の設定(config.json とコマンドで変えた値を合わせたもの)。使わないなら null */
	@bindThis
	public settings(): MasterNicknameSettings | null {
		return resolveMasterNicknameSettings(config, this.data().overrides ?? {}, this.renameActive());
	}

	/** 表示名の変更が使えるか(config.json で使えるようにしていて、オンで、トークンの検証が済んでいる) */
	@bindThis
	public renameActive(): boolean {
		return config.masterRenameEnabled === true && this.rename().on === true && this.tokenState.state === 'ok';
	}

	private renameMode(): RenameMode {
		return this.rename().mode ?? (config.masterRenameMode === 'immediate' ? 'immediate' : 'approval');
	}

	private approvalMinutes(): number {
		const n = Number(config.masterRenameApprovalMinutes);
		return config.masterRenameApprovalMinutes != null && Number.isFinite(n) && n > 0 ? n : DEFAULT_APPROVAL_MINUTES;
	}

	//#endregion

	//#region Misskey とのやりとり(テストでは差し替える)

	/** マスターのトークンで API を呼ぶ。トークンはログに出さない */
	protected masterApi(endpoint: string, params: Record<string, unknown> = {}): Promise<any> {
		this.log(`API (master): ${endpoint}`);
		return got.post(`${config.apiUrl}/${endpoint}`, { json: { ...params, i: this.rename().token } }).json();
	}

	/** サーバーの権限の一覧(/api.json) */
	protected fetchApiSpec(): Promise<any> {
		return got.get(`${config.host.replace(/\/$/, '')}/api.json`).json();
	}

	/** 認証の要らない API(MiAuth の受け取り)を呼ぶ */
	protected publicApi(endpoint: string): Promise<any> {
		return got.post(`${config.apiUrl}/${endpoint}`, { json: {} }).json();
	}

	private async masterUserId(): Promise<string> {
		const userId = this.rename().userId;
		if (userId != null) return userId;
		const master: any = await this.ai.api('users/show', { username: config.master });
		return master.id;
	}

	/** マスターにチャットで知らせる。失敗したらログに残すだけ */
	private async tellMaster(text: string) {
		try {
			await this.ai.sendMessage(await this.masterUserId(), { text });
		} catch (err) {
			this.log(`Failed to tell the master: ${err}`);
		}
	}

	//#endregion

	//#region トークン

	/**
	 * トークンを確かめて、状態を更新する。使えないときは、理由をログに残し、マスターに知らせる(同じ理由は1回だけ)
	 * @returns 確かめた結果
	 */
	private async verifyToken(): Promise<TokenCheckResult> {
		this.tokenState = { state: 'checking' };
		const result = await checkToken((endpoint, params) => this.masterApi(endpoint, params), () => this.fetchApiSpec(), config.master ?? '');

		if (result.ok) {
			this.tokenState = { state: 'ok', unprobeable: result.unprobeable };
			this.updateRename({ userId: result.user.id, lastProblem: undefined });
			if (result.unprobeable.length > 0) this.log(`Permissions not probed (no safe way): ${result.unprobeable.join(', ')}`);
			this.log('The token for renaming the master is OK');
		} else {
			this.stopRename(result.problems);
		}
		return result;
	}

	/** 表示名の変更を止める(トークンの状態を ng にする)。理由が前と違えば、マスターに知らせる */
	private stopRename(problems: string[]) {
		this.tokenState = { state: 'ng', problems };
		const problem = problems.join(' / ');
		this.log(`Renaming the master is stopped: ${problem}`);
		if (this.rename().lastProblem !== problem) {
			this.updateRename({ lastProblem: problem });
			this.tellMaster(serifs.core.adanaMasterRenameStopped(problem));
		}
	}

	/** API のエラーが、トークンが使えなくなったことを示すなら、表示名の変更を止める */
	private onApiError(err: unknown) {
		const code = apiErrorCode(err);
		if (code != null && TOKEN_ERROR_CODES.includes(code)) this.stopRename([`トークンが使えません(${code})`]);
	}

	/**
	 * MiAuth で、マスターに許可をもらう。許可の URL を返し、許可されるまで(最長10分)数秒おきに確かめる
	 */
	private startMiAuth(msg: Message) {
		if (this.miauthTimer != null) clearInterval(this.miauthTimer);

		const session = randomUUID();
		const startedAt = Date.now();
		msg.reply(`この URL を開いて、許可してください(${MIAUTH_TIMEOUT / 60000}分以内)。求める権限は、アカウントの情報を見る・変える(read:account・write:account)だけです\n${miauthUrl(config.host, session)}`, { immediate: true });

		const timer = setInterval(async () => {
			if (Date.now() - startedAt > MIAUTH_TIMEOUT) {
				clearInterval(timer);
				if (this.miauthTimer === timer) this.miauthTimer = null;
				msg.reply('許可を待つのをやめました。もう一度、/nickname rename setup からやり直してください', { immediate: true });
				return;
			}
			try {
				const result = await checkMiAuth(endpoint => this.publicApi(endpoint), session);
				if (result == null) return;
				clearInterval(timer);
				if (this.miauthTimer === timer) this.miauthTimer = null;
				await this.receiveToken(msg, result.token);
			} catch (err) {
				this.log(`Failed to check MiAuth: ${err}`);
			}
		}, MIAUTH_POLL_INTERVAL);
		this.miauthTimer = timer;
	}

	/** 受け取ったトークンを確かめて、使えるなら残す */
	private async receiveToken(msg: Message, token: string) {
		this.updateRename({ token, userId: undefined, lastProblem: undefined });
		const result = await this.verifyToken();
		if (result.ok) {
			msg.reply('許可を受け取りました。/nickname rename on で、表示名の変更をオンにできます', { immediate: true });
		} else {
			this.updateRename({ token: undefined, on: false });
			this.tokenState = { state: 'none' };
			msg.reply(`この許可は使えません: ${result.problems.join(' / ')}\nMisskey の設定の「連携」(アクセストークン)から、取り消してください`, { immediate: true });
		}
	}

	//#endregion

	//#region 表示名の変更

	/**
	 * 表示名を変える。最初に変えるときだけ、変える前の名前を残す(revert で戻す)。
	 * 藍の中の呼び名にする設定(callname)なら、呼び名も変える
	 */
	private async applyRename(item: string) {
		try {
			if (this.rename().hasOriginal !== true) {
				const me = await this.masterApi('i');
				this.updateRename({ originalName: me.name ?? null, hasOriginal: true });
			}
			await this.masterApi('i/update', { name: item });
		} catch (err) {
			this.onApiError(err);
			throw err;
		}

		if (this.settings()?.updateName) {
			try {
				const master: any = await this.ai.api('users/show', { userId: await this.masterUserId() });
				const friend = this.ai.lookupFriend(master.id) ?? new Friend(this.ai, { user: master });
				friend.updateName(item);
			} catch (err) {
				this.log(`Failed to rename the master (callname): ${err}`);
			}
		}
	}

	/**
	 * 頼まれたあだ名で、マスターの表示名を変える(talk モジュールから呼ぶ)。
	 * - 承認(approval): マスターにチャットで聞く。承認を待っているものがあれば、聞かずに busy を返す(呼び出し元が、通常の連絡をする)
	 * - すぐ(immediate): 表示名を変えて、マスターに知らせる
	 * マスターに伝えられなかった(聞けなかった・変えられなかった)ときは、投げる(呼び出し元が、回数の記録を戻す)。
	 * 頼んだ人への返事は、ここで行う
	 */
	@bindThis
	public async requestRename(msg: Message, item: string, from: string, label: string): Promise<'asked' | 'renamed' | 'busy'> {
		if (this.renameMode() === 'approval') {
			const pending = this.rename().pending;
			if (pending != null && Date.now() - pending.at <= this.approvalMinutes() * 60 * 1000) return 'busy';

			await this.ai.sendMessage(await this.masterUserId(), { text: serifs.core.adanaMasterRenameAsk(from, item, label, this.approvalMinutes()) });
			this.updateRename({ pending: { item, from, at: Date.now() } });
			await msg.reply(serifs.core.adanaMasterRenameAskedToSender(item, label)).catch(err => this.log(`Failed to reply to the requester: ${err}`));
			return 'asked';
		}

		await this.applyRename(item);
		await this.tellMaster(serifs.core.adanaMasterRenamedNow(from, item, label));
		await msg.reply(serifs.core.adanaMasterRenamedNowToSender(item, label)).catch(err => this.log(`Failed to reply to the requester: ${err}`));
		return 'renamed';
	}

	/** マスターの「はい」「いいえ」(チャット)。承認を待っているときだけ */
	private async answerRename(msg: Message): Promise<boolean> {
		const pending = this.rename().pending;
		if (pending == null) return false;

		const no = startsWithWord(msg.text, NO_WORDS);
		if (!no && !startsWithWord(msg.text, YES_WORDS)) return false;

		this.updateRename({ pending: null });
		if (Date.now() - pending.at > this.approvalMinutes() * 60 * 1000) {
			msg.reply(serifs.core.adanaMasterRenameExpired(this.approvalMinutes()), { immediate: true });
		} else if (no) {
			msg.reply(serifs.core.adanaMasterRenameDeclined, { immediate: true });
		} else if (!this.renameActive()) {
			msg.reply('表示名の変更が止まっているので、変えませんでした(/nickname status で確かめてください)', { immediate: true });
		} else {
			try {
				await this.applyRename(pending.item);
				msg.reply(serifs.core.adanaMasterRenameApproved(pending.item), { immediate: true });
			} catch (err) {
				this.log(`Failed to rename the master: ${err}`);
				msg.reply(serifs.core.adanaMasterRenameFailed, { immediate: true });
			}
		}
		return true;
	}

	//#endregion

	//#region コマンド

	@bindThis
	private async mentionHook(msg: Message) {
		if (!msg.text || !isMaster(msg.user, config.master)) return false;

		const command = parseNicknameCommand(msg.extractedText);
		if (command != null) {
			await this.runCommand(msg, command);
			return true;
		}

		if (msg.isChat && await this.answerRename(msg)) return true;
		return false;
	}

	private async runCommand(msg: Message, command: NicknameCommand) {
		const reply = (text: string) => msg.reply(text, { immediate: true });

		// 表示名の変更は、許可の URL などを含むので、チャットだけで受け付ける
		if ((command.type === 'rename' || command.type === 'renameMode') && !msg.isChat) {
			reply('表示名の変更のコマンドは、チャットで送ってください');
			return;
		}

		switch (command.type) {
			case 'help': reply(NICKNAME_HELP); return;
			case 'error': reply(command.message); return;
			case 'status': reply(this.statusText()); return;
			case 'enabled':
				this.updateOverrides({ enabled: command.value });
				reply(`マスターのあだ名を${command.value ? '使うように' : '使わないように'}しました`);
				return;
			case 'notify':
				this.updateOverrides({ notify: command.value });
				reply(`伝え方を ${command.value} にしました`);
				return;
			case 'callname':
				this.updateOverrides({ updateName: command.value });
				reply(`考えたあだ名を、私が呼ぶ呼び名に${command.value ? 'するように' : 'しないように'}しました`);
				return;
			case 'visibility':
				this.updateOverrides({ mentionVisibility: command.value });
				reply(`メンションの公開範囲の上限を ${command.value} にしました`);
				return;
			case 'daily':
				this.updateOverrides({ perUserDaily: command.value });
				reply(command.value === 0 ? '同じ人が1日に頼める回数を、制限しないようにしました' : `同じ人が1日に頼める回数を ${command.value} 回にしました`);
				return;
			case 'interval':
				this.updateOverrides({ intervalMinutes: command.value });
				reply(command.value === 0 ? 'マスターに伝える間隔を、制限しないようにしました' : `マスターに伝える間隔を ${command.value} 分にしました`);
				return;
			case 'reset':
				this.updateOverrides(null);
				reply('コマンドで変えた設定を消して、config.json の値に戻しました');
				return;
			case 'renameMode':
				this.updateRename({ mode: command.value });
				reply(command.value === 'approval' ? `表示名は、承認してから変えるようにしました(${this.approvalMinutes()}分以内)` : '表示名は、頼まれたらすぐ変えるようにしました');
				return;
			case 'rename':
				await this.runRenameCommand(msg, command.action);
				return;
		}
	}

	private async runRenameCommand(msg: Message, action: 'on' | 'off' | 'setup' | 'revert' | 'forget' | 'check') {
		const reply = (text: string) => msg.reply(text, { immediate: true });

		if (action === 'off') {
			this.updateRename({ on: false, pending: null });
			reply('表示名の変更をオフにしました');
			return;
		}

		if (config.masterRenameEnabled !== true) {
			reply('表示名の変更は、config.json の masterRenameEnabled が true のときだけ使えます');
			return;
		}

		switch (action) {
			case 'setup':
				this.startMiAuth(msg);
				return;
			case 'forget':
				this.updateRename({ token: undefined, userId: undefined, on: false, pending: null, lastProblem: undefined });
				this.tokenState = { state: 'none' };
				reply('許可(トークン)を消して、表示名の変更をオフにしました。Misskey の設定の「連携」(アクセストークン)からも、取り消してください');
				return;
			case 'check': {
				if (this.rename().token == null) {
					reply('許可(トークン)がありません。/nickname rename setup で、許可の URL を出してください');
					return;
				}
				const result = await this.verifyToken();
				reply(result.ok ? '許可(トークン)は使えます' : `許可(トークン)は使えません: ${result.problems.join(' / ')}`);
				return;
			}
			case 'on':
				if (this.tokenState.state !== 'ok') {
					reply(this.tokenState.state === 'ng'
						? `許可(トークン)が使えないので、オンにできません: ${this.tokenState.problems.join(' / ')}`
						: '許可(トークン)がまだありません。/nickname rename setup で、許可の URL を出してください');
					return;
				}
				this.updateRename({ on: true });
				reply(this.renameMode() === 'approval'
					? `表示名の変更をオンにしました(承認してから変えます。${this.approvalMinutes()}分以内)`
					: '表示名の変更をオンにしました(頼まれたらすぐ変えます)');
				return;
			case 'revert': {
				const rename = this.rename();
				if (rename.hasOriginal !== true) {
					reply('まだ表示名を変えていません');
					return;
				}
				if (this.tokenState.state !== 'ok') {
					reply('許可(トークン)が使えないので、戻せません(/nickname status で確かめてください)');
					return;
				}
				try {
					await this.masterApi('i/update', { name: rename.originalName ?? null });
					this.updateRename({ hasOriginal: false, originalName: undefined });
					reply(rename.originalName != null ? `表示名を「${rename.originalName}」に戻しました` : '表示名を、無い状態(ユーザー名)に戻しました');
				} catch (err) {
					this.onApiError(err);
					this.log(`Failed to revert the master's name: ${err}`);
					reply('表示名を戻せませんでした・・・');
				}
				return;
			}
		}
	}

	private statusText(): string {
		const settings = this.settings();
		const overrides = this.data().overrides ?? {};
		const rename = this.rename();
		const lines: string[] = [];

		if (settings == null) {
			lines.push(`マスターのあだ名: 使わない${overrides.enabled === false ? '(/nickname off)' : '(伝え方が off で、呼び名にも、表示名にもしない設定)'}`);
		} else {
			lines.push('マスターのあだ名: 使う');
			lines.push(`伝え方: ${settings.notify}${settings.notify === 'mention' ? `(公開範囲の上限: ${settings.mentionVisibility})` : ''}`);
			lines.push(`私が呼ぶ呼び名にする: ${settings.updateName ? 'する' : 'しない'}`);
			lines.push(`同じ人が1日に頼める回数: ${settings.perUserDaily === 0 ? '制限しない' : `${settings.perUserDaily}回`}`);
			lines.push(`マスターに伝える間隔: ${settings.interval === 0 ? '制限しない' : `${settings.interval / 60000}分`}`);
		}

		if (config.masterRenameEnabled !== true) {
			lines.push('表示名の変更: 使えない(config.json の masterRenameEnabled が true でない)');
		} else {
			lines.push(`表示名の変更: ${rename.on === true ? 'オン' : 'オフ'}(${this.renameMode() === 'approval' ? `承認してから変える。${this.approvalMinutes()}分以内` : 'すぐ変える'})`);
			const state = this.tokenState;
			lines.push(`許可(トークン): ${
				state.state === 'ok' ? '使える'
				: state.state === 'checking' ? '確かめているところ'
				: state.state === 'ng' ? `使えない(${state.problems.join(' / ')})`
				: rename.token != null ? 'まだ確かめていない' : '無い(/nickname rename setup)'}`);
			const pending = rename.pending;
			if (pending != null) {
				const left = Math.ceil((pending.at + this.approvalMinutes() * 60000 - Date.now()) / 60000);
				lines.push(left > 0 ? `承認を待っている表示名: 「${pending.item}」(あと${left}分)` : `承認を待っている表示名: 「${pending.item}」(期限切れ)`);
			}
			if (rename.hasOriginal === true) lines.push(`変える前の表示名: ${rename.originalName ?? '(無し)'}(/nickname rename revert で戻す)`);
		}

		const changed = Object.entries(overrides).filter(([, value]) => value !== undefined).map(([key]) => key);
		lines.push(`コマンドで変えた設定: ${changed.length > 0 ? changed.join(', ') : 'なし'}`);
		return lines.join('\n');
	}

	//#endregion
}
