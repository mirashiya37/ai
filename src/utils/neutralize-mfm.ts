/**
 * 利用者が書いた文字列を、藍の投稿に入れても、メンション・MFM・リンク・ハッシュタグにならないようにする。
 * 制御文字(改行など)を空白にし、それらになる記号(@ $ < > ` * ~ # : \ [ ] ( ))を全角にする(「://」も崩れるので、URL にもならない)
 */
export function neutralizeMfm(text: string): string {
	return text
		.replace(/\p{Cc}/gu, ' ')
		.replace(/[@$<>`*~#:\\[\]()]/g, c => String.fromCharCode(c.charCodeAt(0) + 0xFEE0));
}
