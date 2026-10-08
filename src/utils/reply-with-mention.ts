import type Message from '@/message.js';

/**
 * 投稿への返信の頭に、送った人へのメンション(@ユーザー名、別のサーバーの人は @ユーザー名@サーバー)を付ける。
 * チャットは相手が決まっているので、付けない
 */
export function withMention(msg: Pick<Message, 'isChat' | 'user'>, text: string): string {
	if (msg.isChat) return text;
	const { username, host } = msg.user;
	return `@${username}${host ? `@${host}` : ''} ${text}`;
}

/** msg.reply() で、送った人へのメンションを頭に付けて返信する */
export function replyWithMention(msg: Message, text: string, opts?: Parameters<Message['reply']>[1]) {
	return msg.reply(withMention(msg, text), opts);
}
