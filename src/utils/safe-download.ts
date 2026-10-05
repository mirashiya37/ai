import { lookup as dnsLookup } from 'node:dns';
import type { LookupAddress } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import got from 'got';
import config from '@/config.js';

/** 1回の取得で受け取る最大サイズ(バイト)。展開した後のサイズで数える */
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
/** 取得を始めてから終わるまでの時間切れ(ミリ秒) */
const DEFAULT_TIMEOUT = 20 * 1000;
const MAX_REDIRECTS = 3;

/**
 * 接続しないアドレス(特殊用途のアドレス)。
 * IPv4 射影の IPv6(::ffff:127.0.0.1 など)は、IPv4 のルールで判定される。
 * (::ffff:0:0/96 を入れてはいけない。Node の BlockList では、すべての IPv4 アドレスに一致してしまう)
 */
const BLOCKED_SUBNETS: [string, number, 'ipv4' | 'ipv6'][] = [
	['0.0.0.0', 8, 'ipv4'],
	['10.0.0.0', 8, 'ipv4'],
	['100.64.0.0', 10, 'ipv4'],
	['127.0.0.0', 8, 'ipv4'],
	['169.254.0.0', 16, 'ipv4'],
	['172.16.0.0', 12, 'ipv4'],
	['192.0.0.0', 24, 'ipv4'],
	['192.0.2.0', 24, 'ipv4'],
	['192.168.0.0', 16, 'ipv4'],
	['198.18.0.0', 15, 'ipv4'],
	['198.51.100.0', 24, 'ipv4'],
	['203.0.113.0', 24, 'ipv4'],
	['224.0.0.0', 4, 'ipv4'],
	['240.0.0.0', 4, 'ipv4'],
	['::', 128, 'ipv6'],
	['::1', 128, 'ipv6'],
	['64:ff9b::', 96, 'ipv6'],
	['100::', 64, 'ipv6'],
	['2001::', 32, 'ipv6'],
	['2001:db8::', 32, 'ipv6'],
	['2002::', 16, 'ipv6'],
	['fc00::', 7, 'ipv6'],
	['fe80::', 10, 'ipv6'],
	['ff00::', 8, 'ipv6'],
];

function createDefaultBlockList(): net.BlockList {
	const list = new net.BlockList();
	for (const [address, prefix, family] of BLOCKED_SUBNETS) {
		list.addSubnet(address, prefix, family);
	}
	return list;
}

const defaultBlockList = createDefaultBlockList();

export type DownloadOptions = {
	maxBytes?: number;
	timeout?: number;
	/** 接続しないアドレス。既定は BLOCKED_SUBNETS */
	blockList?: net.BlockList;
	/** BLOCKED_SUBNETS の対象外にするホスト名。既定は config.host */
	trustedHosts?: string[];
};

type Resolved = Required<DownloadOptions>;

function resolveOptions(options: DownloadOptions): Resolved {
	return {
		maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES,
		timeout: options.timeout ?? DEFAULT_TIMEOUT,
		blockList: options.blockList ?? defaultBlockList,
		trustedHosts: (options.trustedHosts ?? [new URL(config.host).hostname]).map(h => h.toLowerCase()),
	};
}

function isBlockedAddress(address: string, list: net.BlockList): boolean {
	const family = net.isIPv6(address) ? 'ipv6' : 'ipv4';
	return list.check(address, family);
}

/** IP アドレスを直接書いた URL は名前解決を通らないので、ここで確かめる */
function assertAllowedUrl(url: URL, resolved: Resolved): void {
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Error(`Blocked protocol: ${url.protocol}`);
	}

	// IPv6 は [::1] のように括弧が付いている
	const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
	if (resolved.trustedHosts.includes(hostname)) return;

	if (net.isIP(hostname) !== 0 && isBlockedAddress(hostname, resolved.blockList)) {
		throw new Error(`Blocked address: ${hostname}`);
	}
}

/** 名前解決の結果を、接続の直前に確かめる */
function createLookup(resolved: Resolved) {
	return (hostname: string, options: any, callback: (...args: any[]) => void) => {
		(dnsLookup as any)(hostname, options, (err: Error | null, address: string | LookupAddress[], family?: number) => {
			if (err || resolved.trustedHosts.includes(hostname.toLowerCase())) {
				callback(err, address, family);
				return;
			}

			const addresses: LookupAddress[] = Array.isArray(address) ? address : [{ address, family: family ?? 4 }];
			const blocked = addresses.find(a => isBlockedAddress(a.address, resolved.blockList));
			if (blocked) {
				callback(new Error(`Blocked address: ${hostname} -> ${blocked.address}`), address, family);
				return;
			}

			callback(null, address, family);
		});
	};
}

/** URL の内容を取得する。接続先(リダイレクト先を含む)、サイズ、時間に制限をかける */
export async function downloadBuffer(url: string, options: DownloadOptions = {}): Promise<Buffer> {
	const resolved = resolveOptions(options);
	const parsed = new URL(url);
	assertAllowedUrl(parsed, resolved);

	const lookup = createLookup(resolved);
	const httpAgent = new http.Agent({ lookup } as http.AgentOptions);
	const httpsAgent = new https.Agent({ lookup } as https.AgentOptions);

	try {
		return await new Promise<Buffer>((resolve, reject) => {
			const stream = got.stream(parsed, {
				agent: { http: httpAgent, https: httpsAgent },
				timeout: { request: resolved.timeout },
				retry: { limit: 0 },
				maxRedirects: MAX_REDIRECTS,
				hooks: {
					beforeRedirect: [
						redirectOptions => assertAllowedUrl(new URL(redirectOptions.url!.toString()), resolved),
					],
				},
			});

			const chunks: Buffer[] = [];
			let total = 0;
			let settled = false;
			const fail = (err: Error) => {
				if (settled) return;
				settled = true;
				stream.destroy();
				reject(err);
			};

			stream.on('response', response => {
				const length = Number(response.headers['content-length']);
				if (Number.isFinite(length) && length > resolved.maxBytes) {
					fail(new Error(`Too large: ${length} bytes (max ${resolved.maxBytes})`));
				}
			});
			stream.on('data', (chunk: Buffer) => {
				total += chunk.length;
				if (total > resolved.maxBytes) {
					fail(new Error(`Too large: over ${resolved.maxBytes} bytes`));
					return;
				}
				chunks.push(chunk);
			});
			stream.on('end', () => {
				if (settled) return;
				settled = true;
				resolve(Buffer.concat(chunks));
			});
			stream.on('error', fail);
		});
	} finally {
		httpAgent.destroy();
		httpsAgent.destroy();
	}
}
