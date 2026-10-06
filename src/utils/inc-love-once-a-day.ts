import type Friend from '@/friend.js';
import type Module from '@/module.js';
import getDate from '@/utils/get-date.js';

/**
 * 親愛度を、1日に1回だけ上げる(リバーシの対局や挨拶と同じ)。
 * その日に上げたかどうかは、モジュールごとのデータの key に、日付で残す。
 * @returns 上げたら true
 */
export function incLoveOncePerDay(friend: Friend, module: Module, key: string): boolean {
	const today = getDate();
	const data = friend.getPerModulesData(module);
	if (data[key] == today) return false;

	data[key] = today;
	friend.setPerModulesData(module, data);
	friend.incLove();
	return true;
}
