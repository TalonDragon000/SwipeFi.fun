import { describe, expect, it } from "vitest";
import { calculatePortfolioSnapshot } from "../src/client/portfolio.js";

describe("calculatePortfolioSnapshot", () => {
  it("weights CoinGecko history by each wallet balance", () => {
    const snapshot = calculatePortfolioSnapshot([
      {
        rawBalance: "1000000000000000000",
        decimals: 18,
        currentPriceUsd: 10,
        history: {
          period: "1M",
          source: "coingecko",
          points: [
            { timestamp: 1, price: 8 },
            { timestamp: 2, price: 10 }
          ]
        }
      },
      {
        rawBalance: "2000000",
        decimals: 6,
        currentPriceUsd: 5,
        history: {
          period: "1M",
          source: "coingecko",
          points: [
            { timestamp: 1, price: 4 },
            { timestamp: 2, price: 5 }
          ]
        }
      }
    ]);

    expect(snapshot.currentValueUsd).toBe(20);
    expect(snapshot.changeUsd).toBe(4);
    expect(snapshot.changePercent).toBe(25);
    expect(snapshot.points).toEqual([
      { timestamp: 1, value: 16 },
      { timestamp: 2, value: 20 }
    ]);
  });

  it("keeps holdings without CoinGecko history at their current value", () => {
    const snapshot = calculatePortfolioSnapshot([
      {
        rawBalance: "1",
        decimals: 0,
        currentPriceUsd: 10,
        history: {
          period: "1M",
          source: "coingecko",
          points: [
            { timestamp: 1, price: 8 },
            { timestamp: 2, price: 10 }
          ]
        }
      },
      {
        rawBalance: "2",
        decimals: 0,
        currentPriceUsd: 5
      }
    ]);

    expect(snapshot.points[0]?.value).toBe(18);
    expect(snapshot.currentValueUsd).toBe(20);
    expect(snapshot.changePercent).toBeCloseTo(11.111, 3);
  });

  it("normalizes the historical path to the current live quote", () => {
    const snapshot = calculatePortfolioSnapshot([
      {
        rawBalance: "1",
        decimals: 0,
        currentPriceUsd: 20,
        history: {
          period: "1M",
          source: "demo",
          points: [
            { timestamp: 1, price: 10 },
            { timestamp: 2, price: 12 }
          ]
        }
      }
    ]);

    expect(snapshot.points[0]?.value).toBeCloseTo(16.667, 3);
    expect(snapshot.points[1]?.value).toBe(20);
  });

  it("returns no change when graph history is unavailable", () => {
    expect(
      calculatePortfolioSnapshot([
        { rawBalance: "5000000", decimals: 6, currentPriceUsd: 2 }
      ])
    ).toEqual({
      currentValueUsd: 10,
      changeUsd: null,
      changePercent: null,
      points: []
    });
  });
});
