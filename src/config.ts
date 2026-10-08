type Config = {
	host: string;
	serverName?: string;
	i: string;
	master?: string;
	wsUrl: string;
	apiUrl: string;
	keywordEnabled: boolean;
	keywordProperRate?: number | string;
	reversiEnabled: boolean;
	notingEnabled: boolean;
	chartEnabled: boolean;
	serverMonitoring: boolean;
	checkEmojisEnabled?: boolean;
	checkEmojisAtOnce?: boolean;
	checkEmojisChunkSize?: number;
	geminiProApiKey?: string;
	pLaMoApiKey?: string;
	prompt?: string;
	aichatRandomTalkEnabled?: boolean;
	aichatRandomTalkProbability?: string;
	aichatRandomTalkIntervalMinutes?: string;
	aichatGroundingWithGoogleSearchAlwaysEnabled?: boolean;
	mecab?: string;
	mecabDic?: string;
	morphAnalyzer?: 'mecab' | 'sudachi';
	sudachi?: string;
	sudachiDict?: 'small' | 'core' | 'full';
	memoryDir?: string;
	masterNicknameNames?: string[];
	masterNicknameNotify?: 'off' | 'mention' | 'chat';
	masterNicknameMentionVisibility?: 'public' | 'home' | 'specified';
	masterNicknameUpdateName?: boolean;
	masterNicknamePerUserDaily?: number | string;
	masterNicknameIntervalMinutes?: number | string;
	/** 以前の書き方(時間)。masterNicknameIntervalMinutes があれば、そちらを使う */
	masterNicknameIntervalHours?: number | string;
	/** マスターの表示名を、頼まれたあだ名に変える機能を使えるようにするか(既定 false。オンオフはコマンドで) */
	masterRenameEnabled?: boolean;
	/** 表示名を変える方式。approval(既定): 承認してから、immediate: すぐ */
	masterRenameMode?: 'approval' | 'immediate';
	/** 承認を待つ時間(分。既定 60) */
	masterRenameApprovalMinutes?: number | string;
};

import config from '../config.json' with { type: 'json' };

config.wsUrl = config.host.replace('http', 'ws');
config.apiUrl = config.host + '/api';

export default config as Config;
