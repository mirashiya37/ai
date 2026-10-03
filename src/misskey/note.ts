export type Note = {
	id: string;
	text: string | null;
	reply: any | null;
	poll?: {
		choices: {
			votes: number;
			text: string;
		}[];
		expiredAfter: number;
		multiple: boolean;
	} | null;
	cw: string | null;
	userId: | string;
};
