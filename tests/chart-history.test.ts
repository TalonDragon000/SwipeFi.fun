import { describe, expect, it } from "vitest";
import type { AssetHistoryResponse } from "../src/client/api.js";
import {
	chartDateLabels,
	chartPriceTicks,
	isHistoryPeriodAvailable,
} from "../src/client/chart-history.js";

function history(days: number): AssetHistoryResponse {
	const start = Date.UTC(2026, 6, 20) / 1000;
	return {
		period: "ALL",
		source: "coingecko",
		points: [
			{ timestamp: start, price: 100 },
			{ timestamp: start + (days * 24 * 60 * 60) / 2, price: 75 },
			{ timestamp: start + days * 24 * 60 * 60, price: 50 },
		],
	};
}

describe("chart history UX", () => {
	it("formats only the two endpoint dates for each timeframe", () => {
		const sevenDays = history(7);
		expect(chartDateLabels({ ...sevenDays, period: "1W" })).toEqual([
			"Jul 20",
			"Jul 27",
		]);
		expect(chartDateLabels({ ...sevenDays, period: "1M" })).toEqual([
			"Jul 20",
			"Jul 27",
		]);
		expect(chartDateLabels({ ...sevenDays, period: "1Y" })).toEqual([
			"Jul 2026",
			"Jul 2026",
		]);
		expect(chartDateLabels({ ...sevenDays, period: "ALL" })).toEqual([
			"Jul 2026",
			"Jul 2026",
		]);
		expect(
			chartDateLabels({
				...sevenDays,
				period: "1D",
				points: [
					{
						timestamp: new Date(2026, 6, 27, 0, 45).getTime() / 1000,
						price: 100,
					},
					{
						timestamp: new Date(2026, 6, 28, 0, 45).getTime() / 1000,
						price: 94.91,
					},
				],
			}),
		).toEqual(["Jul 27 at 12:45 AM", "Jul 28 at 12:45 AM"]);
	});

	it("builds four evenly spaced price ticks from high to low", () => {
		expect(chartPriceTicks([64.7, 152.3, 93.9])).toEqual([
			152.3, 123.1, 93.9, 64.7,
		]);
	});

	it("disables ranges longer than a new token's available history", () => {
		const sevenDays = history(7);

		expect(isHistoryPeriodAvailable("1D", sevenDays)).toBe(true);
		expect(isHistoryPeriodAvailable("1W", sevenDays)).toBe(true);
		expect(isHistoryPeriodAvailable("1M", sevenDays)).toBe(false);
		expect(isHistoryPeriodAvailable("1Y", sevenDays)).toBe(false);
		expect(isHistoryPeriodAvailable("ALL", sevenDays)).toBe(true);
	});

	it("keeps timeframe controls available when coverage is still loading or temporarily unavailable", () => {
		expect(isHistoryPeriodAvailable("1M", undefined)).toBe(true);
		expect(
			isHistoryPeriodAvailable("1M", {
				period: "ALL",
				source: "unavailable",
				points: [],
			}),
		).toBe(true);
	});
});
