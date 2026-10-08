import type { MasterNicknameNotify, MasterNicknameMentionVisibility } from '@/modules/talk/master-nickname.js';

/** 表示名を変えるときの方式。approval は、マスターが承認してから変える */
export type RenameMode = 'approval' | 'immediate';

export type NicknameCommand =
	| { type: 'status' }
	| { type: 'help' }
	| { type: 'enabled'; value: boolean }
	| { type: 'notify'; value: MasterNicknameNotify }
	| { type: 'callname'; value: boolean }
	| { type: 'visibility'; value: MasterNicknameMentionVisibility }
	| { type: 'daily'; value: number }
	| { type: 'interval'; value: number }
	| { type: 'reset' }
	| { type: 'rename'; action: 'on' | 'off' | 'setup' | 'revert' | 'forget' | 'check' }
	| { type: 'renameMode'; value: RenameMode }
	| { type: 'error'; message: string };

/** コマンドの書き方(help で返す) */
export const NICKNAME_HELP = [
	'マスターのあだ名のコマンド(チャットで送ってください)',
	'/nickname status: 今の設定',
	'/nickname on | off: マスターのあだ名を使うか',
	'/nickname notify off | mention | chat: 伝え方',
	'/nickname callname on | off: 考えたあだ名を、私が呼ぶ呼び名にするか',
	'/nickname visibility public | home | specified: メンションの公開範囲の上限',
	'/nickname daily <回数>: 同じ人が1日に頼める回数(0 で制限しない)',
	'/nickname interval <分>: マスターに伝える間隔(0 で制限しない)',
	'/nickname reset: コマンドで変えた設定を消して、config.json の値に戻す',
	'/nickname rename on | off: 表示名を変えるか',
	'/nickname rename mode approval | immediate: 承認してから変えるか、すぐ変えるか',
	'/nickname rename setup: 表示名を変えるための許可の URL を出す',
	'/nickname rename check: 許可(トークン)をもう一度確かめる',
	'/nickname rename revert: 表示名を、変える前の名前に戻す',
	'/nickname rename forget: 許可(トークン)を消す',
].join('\n');

const ON_OFF: Record<string, boolean> = { on: true, off: false };

/** 0 以上の整数か */
function toCount(value: string | undefined): number | null {
	return value != null && /^\d+$/.test(value) ? Number(value) : null;
}

/**
 * マスターのあだ名のコマンドを解釈する。/nickname で始まらなければ null。
 * 大文字小文字は区別しない(値も小文字にそろえる)
 */
export function parseNicknameCommand(text: string): NicknameCommand | null {
	const words = text.trim().split(/\s+/);
	if (words[0]?.toLowerCase() !== '/nickname') return null;

	const [sub, arg, arg2] = words.slice(1).map(word => word.toLowerCase());
	const invalid = (usage: string): NicknameCommand => ({ type: 'error', message: `書き方: ${usage}` });

	switch (sub) {
		case undefined:
		case 'help':
			return { type: 'help' };
		case 'status':
			return { type: 'status' };
		case 'on':
		case 'off':
			return { type: 'enabled', value: sub === 'on' };
		case 'reset':
			return { type: 'reset' };
		case 'notify':
			return arg === 'off' || arg === 'mention' || arg === 'chat' ? { type: 'notify', value: arg } : invalid('/nickname notify off | mention | chat');
		case 'callname':
			return arg != null && arg in ON_OFF ? { type: 'callname', value: ON_OFF[arg] } : invalid('/nickname callname on | off');
		case 'visibility':
			return arg === 'public' || arg === 'home' || arg === 'specified' ? { type: 'visibility', value: arg } : invalid('/nickname visibility public | home | specified');
		case 'daily': {
			const value = toCount(arg);
			return value != null ? { type: 'daily', value } : invalid('/nickname daily <回数>(0 以上の整数)');
		}
		case 'interval': {
			const value = toCount(arg);
			return value != null ? { type: 'interval', value } : invalid('/nickname interval <分>(0 以上の整数)');
		}
		case 'rename':
			if (arg === 'mode') {
				return arg2 === 'approval' || arg2 === 'immediate' ? { type: 'renameMode', value: arg2 } : invalid('/nickname rename mode approval | immediate');
			}
			if (arg === 'on' || arg === 'off' || arg === 'setup' || arg === 'revert' || arg === 'forget' || arg === 'check') {
				return { type: 'rename', action: arg };
			}
			return invalid('/nickname rename on | off | mode | setup | check | revert | forget');
		default:
			return { type: 'error', message: '知らないコマンドです。/nickname help で、書き方を確かめてください' };
	}
}
