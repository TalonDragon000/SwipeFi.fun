import { describe, expect, it } from "vitest";
import { unitPriceUsdFromQuote } from "../src/domain/price.js";

describe("unitPriceUsdFromQuote", () => {
  it("derives an output-token USD price from an exact USDG quote", () => {
    expect(unitPriceUsdFromQuote("10000000", "3113000000000000", 18)).toBe("3212.335367");
  });

  it("rejects a quote with no output", () => {
    expect(() => unitPriceUsdFromQuote("10000000", "0", 18)).toThrow("QUOTE_PRICE_UNAVAILABLE");
  });
});
