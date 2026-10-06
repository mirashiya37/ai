import * as mfm from 'mfm-js';

/**
 * 解析で、語として扱わない MFM の関数。
 * unixtime は数字だけ(中の文字は語ではない)
 */
const DROPPED_FUNCTIONS = new Set(['unixtime']);

/**
 * 閉じていない MFM は、パーサーが全体をただの文字として返すので、関数名(`$[tada ` の tada など)が語として残る。
 * 解析の前に、関数の開き(`$[name ` と `$[name.arg=1,arg2 `)と、装飾のタグだけを取り除く。
 */
const UNPARSED_MFM = /\$\[[\w]+(?:\.[\w.=,\-]*)?\s?|<\/?(?:small|center|plain|i|b|s)>/g;

/** URL は、後ろに空白なしで日本語が続くこともあるので、URL に使える ASCII の文字だけを取り除く */
const URL_PATTERN = /https?:\/\/[\w\-.~:/?#\[\]@!$&'()*+,;=%]+/g;

/** カスタム絵文字の記法(:meow_sushi: や :name@host:)。直前が英数字のもの(時刻の 12:30:45 など)は残す */
const EMOJI_CODE_PATTERN = /(?<![A-Za-z0-9]):[\w+\-]+(?:@[\w.\-]+)?:/g;

/**
 * 本文から、語として学習してよい文字だけを取り出す。
 * 取り除くもの: URL、メンション、カスタム・Unicode 絵文字、コード、数式、引用、MFM の関数名と引数。
 * 残すもの: 装飾の中の文字、リンクの表示名、ハッシュタグ(# を除く)、<plain> の中身。
 * 取り除いた部分は、前後の語がつながらないよう空白にする。
 */
export function stripMfm(text: string): string {
	let result: string;
	try {
		result = textOf(mfm.parse(text), false);
	} catch {
		result = text.replace(UNPARSED_MFM, ' ');
	}

	// 構文として解釈されなかった URL と絵文字の記法を、念のため取り除く
	return result.replace(URL_PATTERN, ' ').replace(EMOJI_CODE_PATTERN, ' ');
}

/**
 * @param raw <plain> の中。MFM として解釈しない文字なので、そのまま残す
 */
function textOf(nodes: mfm.MfmNode[], raw: boolean): string {
	return nodes.map(node => nodeText(node, raw)).join('');
}

function nodeText(node: mfm.MfmNode, raw: boolean): string {
	switch (node.type) {
		case 'text':
			return raw ? node.props.text : node.props.text.replace(UNPARSED_MFM, ' ');

		case 'plain':
			return textOf(node.children, true);

		case 'hashtag':
			return ` ${node.props.hashtag} `;

		case 'search':
			// 検索の語は書いた人の言葉なので残し、「検索」のボタンの部分だけ除く
			return ` ${node.props.query} `;

		case 'link':
			return ` ${textOf(node.children, raw)} `;

		case 'fn':
			if (DROPPED_FUNCTIONS.has(node.props.name)) return ' ';
			// ruby は「親文字 ふりがな」の形。ふりがなまで残すと、同じ語が二重に入る
			if (node.props.name === 'ruby') return textOf(node.children, raw).trim().split(/\s+/)[0];
			return textOf(node.children, raw);

		case 'bold':
		case 'small':
		case 'italic':
		case 'strike':
		case 'center':
			return textOf(node.children, raw);

		// 語として学習しないもの
		case 'quote':
		case 'blockCode':
		case 'inlineCode':
		case 'mathBlock':
		case 'mathInline':
		case 'mention':
		case 'url':
		case 'emojiCode':
		case 'unicodeEmoji':
		default:
			return ' ';
	}
}
