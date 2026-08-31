import { describe, expect, it } from "vitest";
import {
	formatChartAxisUsdPrice,
	formatUsdPrice,
} from "../src/client/price-format.js";

describe("USD price formatting", () => {
	it("keeps standard prices at two decimal places", () => {
		expect(formatUsdPrice(37.43)).toBe("$37.43");
		expect(formatUsdPrice(0)).toBe("$0.00");
	});

	it("shows two significant digits for prices below one cent", () => {
		expect(formatUsdPrice(0.004732)).toBe("$0.0047");
		expect(formatUsdPrice(0.0000001)).toBe("$0.00000010");
	});

	it("uses whole dollars with spaced thousands for large chart labels", () => {
		expect(formatChartAxisUsdPrice(66_824.06)).toBe("$66 824");
		expect(formatChartAxisUsdPrice(65_097.4)).toBe("$65 097");
		expect(formatChartAxisUsdPrice(999.99)).toBe("$999.99");
	});
});
