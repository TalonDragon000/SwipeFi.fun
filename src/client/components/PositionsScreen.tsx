import {
	type ConnectedStandardSolanaWallet,
	useSignTransaction,
} from "@privy-io/react-auth/solana";
import { FilePen, HandCoins, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import type { Candidate } from "../../domain/schemas";
import { api, type ExitPreparation } from "../api";
import { formatBaseUnits } from "../price-format";
import { AssetMark } from "./AssetMark";
import { Check } from "./Icons";

const usdFormatter = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	maximumFractionDigits: 2,
});

export function PositionsScreen({
	candidates,
	wallet,
	demoMode,
	solanaWallet,
}: {
	candidates: Candidate[];
	wallet: string;
	demoMode: boolean;
	solanaWallet?: ConnectedStandardSolanaWallet;
}) {
	const { signTransaction } = useSignTransaction();
	const [balances, setBalances] = useState<Record<string, string>>({});
	const [indexedPortfolio, setIndexedPortfolio] = useState<Candidate[]>([]);
	const [portfolioLoading, setPortfolioLoading] = useState(false);
	const [prepared, setPrepared] = useState<Record<string, ExitPreparation>>({});
	const [status, setStatus] = useState<Record<string, string>>({});
	const [error, setError] = useState("");

	useEffect(() => {
		if (demoMode || !wallet) return;
		let cancelled = false;
		setPortfolioLoading(true);
		setError("");
		setIndexedPortfolio([]);
		setBalances({});
		api
			.solanaPortfolio(wallet)
			.then((portfolio) => {
				if (cancelled) return;
				const knownByMint = new Map(
					candidates.map((candidate) => [candidate.contract, candidate]),
				);
				const assets = portfolio.tokens.map((token): Candidate => {
					const known = knownByMint.get(token.mint);
					return known
						? {
								...known,
								assetId: token.assetId,
								iconUrl: token.iconUrl ?? known.iconUrl,
								marketPriceUsd: token.priceUsd ?? known.marketPriceUsd,
								marketDataSource: token.priceUsd
									? "alchemy"
									: known.marketDataSource,
								marketDataUpdatedAt:
									token.priceUpdatedAt ?? known.marketDataUpdatedAt,
							}
						: {
								chain: "SOLANA",
								assetId: token.assetId,
								symbol: token.symbol,
								name: token.name,
								kind: "CRYPTO",
								contract: token.mint,
								decimals: token.decimals,
								eligible: true,
								marketHealthy: true,
								permissionAllowed: true,
								marketPriceUsd: token.priceUsd,
								marketDataSource: "alchemy",
								marketDataUpdatedAt: token.priceUpdatedAt,
								iconUrl: token.iconUrl,
								primaryClassification: "UNKNOWN",
								classificationConfidence: "LOW",
								tags: [],
								riskFlags: [],
								classificationEvidence: ["Alchemy wallet portfolio"],
								crowdScoreBps: 0,
								reason: "Detected in the connected wallet by Alchemy.",
								evidenceIds: ["alchemy-portfolio"],
							};
				});
				setIndexedPortfolio(assets);
				setBalances(
					Object.fromEntries(
						portfolio.tokens.map((token) => [
							token.assetId,
							token.balanceBaseUnits,
						]),
					),
				);
			})
			.catch((caught) => {
				if (!cancelled) {
					setError(
						caught instanceof Error
							? caught.message
							: "Could not read Solana balances.",
					);
				}
			})
			.finally(() => {
				if (!cancelled) setPortfolioLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [candidates, demoMode, wallet]);

	const positionCandidates = indexedPortfolio;
	const portfolioValueUsd = positionCandidates.reduce(
		(total, candidate) =>
			total +
			(Number(balances[candidate.assetId] ?? "0") / 10 ** candidate.decimals) *
				Number(candidate.marketPriceUsd ?? candidate.quote?.unitPriceUsd ?? 0),
		0,
	);

	async function prepare(candidate: Candidate) {
		const amount = balances[candidate.assetId] ?? "0";
		if (BigInt(amount) <= 0n) return;
		setError("");
		setStatus((current) => ({
			...current,
			[candidate.assetId]: "Preparing fresh quote…",
		}));
		try {
			const result = await api.prepareExit(candidate.assetId, amount);
			setPrepared((current) => ({ ...current, [candidate.assetId]: result }));
			setStatus((current) => ({
				...current,
				[candidate.assetId]: "Ready for wallet confirmation",
			}));
		} catch (caught) {
			setStatus((current) => ({ ...current, [candidate.assetId]: "" }));
			setError(
				caught instanceof Error ? caught.message : "Could not prepare exit.",
			);
		}
	}

	async function confirm(candidate: Candidate) {
		const exit = prepared[candidate.assetId];
		if (!exit?.solanaTransaction || !solanaWallet) return;
		setError("");
		setStatus((current) => ({
			...current,
			[candidate.assetId]: "Settling transaction…",
		}));
		try {
			const { signedTransaction } = await signTransaction({
				transaction: base64ToBytes(
					exit.solanaTransaction.unsignedTransactionBase64,
				),
				wallet: solanaWallet,
				chain: "solana:mainnet",
				options: {
					uiOptions: {
						description: `Exit ${candidate.symbol} to USDC through Jupiter.`,
						buttonText: `Sign ${candidate.symbol} exit`,
					},
				},
			});
			await api.submitSolanaExit(
				candidate.assetId,
				bytesToBase64(signedTransaction),
			);
			let settled = false;
			for (let attempt = 0; attempt < 40; attempt += 1) {
				const result = await api.solanaExitStatus(candidate.assetId);
				if (result.status === "SETTLED") {
					settled = true;
					break;
				}
				if (result.status === "FAILED") throw new Error("Solana exit failed.");
				await new Promise((resolve) =>
					window.setTimeout(resolve, attempt < 12 ? 500 : 1_500),
				);
			}
			if (!settled) throw new Error("Solana exit is still pending.");
			setStatus((current) => ({
				...current,
				[candidate.assetId]: "Exit settled",
			}));
			setBalances((current) => ({ ...current, [candidate.assetId]: "0" }));
		} catch (caught) {
			setError(
				caught instanceof Error ? caught.message : "Exit confirmation failed.",
			);
			setStatus((current) => ({ ...current, [candidate.assetId]: "" }));
		}
	}

	return (
		<main className="positions-page">
			<header className="positions-heading">
				<div>
					<h1>Portfolio</h1>
					<p>
						Live wallet balances from Alchemy. USD prices are shown when
						available.
					</p>
				</div>
			</header>
			<section className="portfolio-summary">
				<div className="portfolio-summary-meta">
					<span>Portfolio value</span>
					<div className="portfolio-summary-value-row">
						<strong>{usdFormatter.format(portfolioValueUsd)}</strong>
					</div>
				</div>
			</section>
			{demoMode ? (
				<div className="positions-empty">
					Demo mode does not invent wallet balances or settlement. Start live
					mode with a funded wallet to prepare an exit.
				</div>
			) : portfolioLoading ? (
				<div
					className="positions-empty positions-loading"
					role="status"
					aria-live="polite"
				>
					<LoaderCircle aria-hidden="true" />
					Loading wallet holdings…
				</div>
			) : (
				<section className="positions-list">
					{positionCandidates.map((candidate) => {
						const rawBalance = balances[candidate.assetId] ?? "0";
						const exit = prepared[candidate.assetId];
						const actionStatus = status[candidate.assetId] ?? "";
						const settled = actionStatus === "Exit settled";
						const quoteLoading = actionStatus === "Preparing fresh quote…";
						const transactionSettling =
							actionStatus === "Settling transaction…";
						const actionBusy = quoteLoading || transactionSettling;
						const actionLabel = settled
							? `${candidate.symbol} exit settled`
							: quoteLoading
								? `Preparing ${candidate.symbol} quote`
								: transactionSettling
									? `Settling ${candidate.symbol} transaction`
									: exit
										? `Confirm ${candidate.symbol} sale`
										: `Sell ${candidate.symbol}`;
						const balance = formatPositionBalance(
							BigInt(rawBalance),
							candidate.decimals,
						);
						const rawUnitPrice =
							candidate.marketPriceUsd ?? candidate.quote?.unitPriceUsd;
						const holdingValue =
							rawUnitPrice !== undefined
								? usdFormatter.format(
										(Number(rawBalance) / 10 ** candidate.decimals) *
											Number(rawUnitPrice),
									)
								: "Price unavailable";
						const unitPrice =
							rawUnitPrice !== undefined
								? usdFormatter.format(Number(rawUnitPrice))
								: "Price unavailable";
						return (
							<article className="position-row" key={candidate.assetId}>
								<AssetMark
									symbol={candidate.symbol}
									iconUrl={candidate.iconUrl}
									size="sm"
								/>
								<div className="position-copy">
									<div className="position-primary">
										<b>{candidate.name}</b>
										<b>{holdingValue}</b>
									</div>
									<div className="position-secondary">
										<small>{unitPrice}</small>
										<small>
											{balance} {candidate.symbol}
										</small>
									</div>
								</div>
								<button
									type="button"
									className="button button-sell"
									aria-label={actionLabel}
									title={actionLabel}
									disabled={BigInt(rawBalance) <= 0n || settled || actionBusy}
									onClick={() =>
										exit ? confirm(candidate) : prepare(candidate)
									}
								>
									{settled ? (
										<Check aria-hidden="true" />
									) : actionBusy ? (
										<LoaderCircle
											className="button-spinner"
											aria-hidden="true"
										/>
									) : exit ? (
										<FilePen aria-hidden="true" />
									) : (
										<HandCoins aria-hidden="true" />
									)}
								</button>
								{exit && !settled && (
									<small className="position-status">
										{formatBaseUnits(exit.quote.minimumAmountOut, 6)} USDC
										minimum · quote is active for 60 seconds
									</small>
								)}
								{status[candidate.assetId] &&
									status[candidate.assetId] !==
										"Ready for wallet confirmation" && (
										<small className="position-status">
											{status[candidate.assetId]}
										</small>
									)}
							</article>
						);
					})}
				</section>
			)}
			{error && (
				<p className="error-message" role="alert">
					{error}
				</p>
			)}
		</main>
	);
}

function formatPositionBalance(value: bigint, decimals: number) {
	const formatted = formatBaseUnits(value, decimals);
	const [whole, fraction = ""] = formatted.split(".");
	const firstNonZero = fraction.search(/[1-9]/);
	const visibleDecimals =
		value > 0n && whole === "0" && firstNonZero >= 4
			? Math.min(fraction.length, firstNonZero + 2)
			: 4;
	const compactFraction = fraction
		.slice(0, visibleDecimals)
		.replace(/0+$/, "");
	return compactFraction ? `${whole}.${compactFraction}` : whole;
}

function base64ToBytes(value: string) {
	const binary = window.atob(value);
	return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function bytesToBase64(value: Uint8Array) {
	let binary = "";
	for (const byte of value) binary += String.fromCharCode(byte);
	return window.btoa(binary);
}
