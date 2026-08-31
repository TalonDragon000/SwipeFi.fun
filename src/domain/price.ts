import { SOLANA_USDC_DECIMALS } from "./solana.js";

/**
 * Derives the USD value of one output-token unit from an exact USDC input quote.
 */
export function unitPriceUsdFromQuote(
  amountInBaseUnits: string,
  amountOutBaseUnits: string,
  outputDecimals: number
): string {
  const amountOut = BigInt(amountOutBaseUnits);
  if (amountOut <= 0n) throw new Error("QUOTE_PRICE_UNAVAILABLE");

  const outputScale = 10n ** BigInt(outputDecimals);
  const usdScale = 10n ** BigInt(SOLANA_USDC_DECIMALS);
  const priceBaseUnits = (BigInt(amountInBaseUnits) * outputScale) / amountOut;
  const whole = priceBaseUnits / usdScale;
  const fractional = (priceBaseUnits % usdScale)
    .toString()
    .padStart(SOLANA_USDC_DECIMALS, "0")
    .replace(/0+$/, "");

  return fractional ? `${whole}.${fractional}` : whole.toString();
}
