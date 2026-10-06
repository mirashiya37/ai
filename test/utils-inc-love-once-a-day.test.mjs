// 親愛度を1日に1回だけ上げる(src/utils/inc-love-once-a-day.ts)
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { incLoveOncePerDay } from '../built/utils/inc-love-once-a-day.js';

function fakeFriend() {
	const store = {};
	return {
		love: 0,
		store,
		getPerModulesData: module => store[module.name] ?? {},
		setPerModulesData(module, data) { store[module.name] = data; },
		incLove() { this.love++; },
	};
}

test('同じ日は1回だけ上げ、日付が変わればまた上げる', () => {
	mock.timers.enable({ apis: ['Date'], now: new Date(2026, 9, 6, 12).getTime() });
	try {
		const friend = fakeFriend();
		const module = { name: 'kazutori' };

		assert.equal(incLoveOncePerDay(friend, module, 'lastWonAt'), true);
		assert.equal(incLoveOncePerDay(friend, module, 'lastWonAt'), false);
		assert.equal(friend.love, 1);
		assert.equal(friend.store.kazutori.lastWonAt, '2026/10/6');

		mock.timers.tick(1000 * 60 * 60 * 12);
		assert.equal(incLoveOncePerDay(friend, module, 'lastWonAt'), true);
		assert.equal(friend.love, 2);
	} finally {
		mock.timers.reset();
	}
});

test('モジュールのほかのデータは残す', () => {
	const friend = fakeFriend();
	const module = { name: 'guessingGame' };
	friend.store.guessingGame = { other: 1 };

	incLoveOncePerDay(friend, module, 'lastWonAt');
	assert.equal(friend.store.guessingGame.other, 1);
});
