import { usePrivy } from "@privy-io/react-auth";
import {
	type ConnectedStandardSolanaWallet,
	useWallets as useSolanaWallets,
} from "@privy-io/react-auth/solana";
import {
	ArrowLeft,
	Bot,
	ChevronLeft,
	ChevronRight,
	ArrowRight as LucideArrowRight,
	ShoppingBasket,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	fillFeedPage,
	nextFeedExcludedAssetIds,
	shouldPrefetchNextFeed,
} from "../domain/feed-pagination";
import {
	type Candidate,
	formatTicketSizeUsd,
	type OnboardingPreferences,
} from "../domain/schemas";
import {
	ApiError,
	api,
	configureApiAuth,
	type ExecutionRecord,
	type FeedResponse,
	type PublicConfig,
	type WeeklySession,
} from "./api";
import { AccountScreen } from "./components/AccountScreen";
import { AppShell } from "./components/AppShell";
import { AssetIconProvider } from "./components/AssetMark";
import { BudgetRail, BudgetSummary } from "./components/BudgetRail";
import { ArrowRight } from "./components/Icons";
import { Confetti } from "./components/magicui/confetti";
import { Onboarding } from "./components/Onboarding";
import { PositionsScreen } from "./components/PositionsScreen";
import { ReceiptScreen } from "./components/ReceiptScreen";
import { ReviewScreen } from "./components/ReviewScreen";
import { SwipeCard } from "./components/SwipeCard";
import {
	removeLegacyPreferences,
	writeAccountPreferences,
} from "./preferences-storage";

type View = "week" | "positions" | "receipts" | "account";
type Stage = "loading" | "onboarding" | "swipe" | "review";
type DecisionFeedback = "invest" | "skip";
const LAST_EXECUTION_KEY = "investmade:last-execution";
const LAST_EXECUTION_CANDIDATES_KEY = "investmade:last-execution-candidates";
const FEED_RETRY_DELAY_MS = 900;

function rememberWarnings(
	target: Map<string, string[]>,
	response: FeedResponse,
) {
	for (const candidate of response.candidates) {
		target.set(candidate.assetId, response.feed.warnings);
	}
}

function shouldRetryFeed(error: unknown) {
	return !(
		error instanceof ApiError &&
		[
			"AUTH_REQUIRED",
			"EXECUTION_PROVIDER_CHANGED",
			"INVALID_REQUEST",
			"SESSION_NOT_FOUND",
		].includes(error.code)
	);
}

async function generateFeedWithRetry(
	sessionId: string,
	preferences: OnboardingPreferences,
) {
	try {
		return await api.generateFeed(sessionId, preferences);
	} catch (error) {
		if (!shouldRetryFeed(error)) throw error;
		await new Promise((resolve) => window.setTimeout(resolve, FEED_RETRY_DELAY_MS));
		return api.generateFeed(sessionId, preferences);
	}
}

export function App({ config }: { config: PublicConfig }) {
	const {
		authenticated,
		getAccessToken,
		login,
		ready: privyReady,
		user,
	} = usePrivy();
	const { wallets: solanaWallets, ready: solanaWalletsReady } =
		useSolanaWallets();
	const [view, setView] = useState<View>("week");
	const [stage, setStage] = useState<Stage>("onboarding");
	const [session, setSession] = useState<WeeklySession>();
	const [feed, setFeed] = useState<FeedResponse>();
	const [preferences, setPreferences] = useState<OnboardingPreferences>();
	const [index, setIndex] = useState(0);
	const [selectedIds, setSelectedIds] = useState<string[]>([]);
	const [assetInfoOpen, setAssetInfoOpen] = useState(false);
	const [settlement, setSettlement] = useState<ExecutionRecord>();
	const [receiptCandidates, setReceiptCandidates] = useState<Candidate[]>([]);
	const [error, setError] = useState("");
	const [decisionFeedback, setDecisionFeedback] = useState<DecisionFeedback>();
	const [loadingMore, setLoadingMore] = useState(false);
	const [feedExhausted, setFeedExhausted] = useState(false);
	const [topUpRequest, setTopUpRequest] = useState(0);
	const decisionTimer = useRef<number | undefined>(undefined);
	const prefetchedFeed = useRef<
		| {
				key: string;
				result: Promise<FeedResponse | undefined>;
		  }
		| undefined
	>(undefined);
	const warningsByAssetId = useRef(new Map<string, string[]>());
	const selectedSolanaWallet =
		solanaWallets.find(
			(candidate) => candidate.address === preferences?.solanaExecutionWallet,
		) ?? solanaWallets[0];
	const wallet = selectedSolanaWallet?.address ?? "";

	useEffect(() => {
		configureApiAuth({
			getAccessToken,
			getWalletAddress: () => wallet || undefined,
			getWalletChain: () => "SOLANA",
		});
		return () => configureApiAuth(undefined);
	}, [getAccessToken, wallet]);

	useEffect(() => {
		removeLegacyPreferences();
	}, []);

	useEffect(() => {
		if (!wallet) return;
		const executionId = localStorage.getItem(lastExecutionKey(wallet));
		if (!executionId) return;
		setReceiptCandidates(readReceiptCandidates(wallet));
		let cancelled = false;
		api
			.execution(executionId)
			.then(async (record) => {
				if (cancelled) return;
				setSettlement(record);
				if (record.status !== "SUBMITTED") return;
				const reconciled = await api.reconcile(executionId);
				if (!cancelled) setSettlement(reconciled);
			})
			.catch(() => {
				localStorage.removeItem(lastExecutionKey(wallet));
			});
		return () => {
			cancelled = true;
		};
	}, [wallet]);

	const loadSession = useCallback(
		async (preferences: OnboardingPreferences) => {
			const sessionSolanaWallet =
				solanaWallets.find(
					(candidate) =>
						candidate.address === preferences.solanaExecutionWallet,
				) ?? solanaWallets[0];
			configureApiAuth({
				getAccessToken,
				getWalletAddress: () => sessionSolanaWallet?.address,
				getWalletChain: () => "SOLANA",
			});
			const prefetch = prefetchedFeed.current;
			const minimumLoader = new Promise((resolve) =>
				window.setTimeout(resolve, 1000),
			);
			setError("");
			setView("week");
			setStage("loading");
			setPreferences(preferences);
			setSession(undefined);
			setFeed(undefined);
			setIndex(0);
			setSelectedIds([]);
			setFeedExhausted(false);
			try {
				if (authenticated) await api.savePreferences(preferences);
				const [opened, prefetched] = await Promise.all([
					api.openSession(
						preferences.cadence,
						preferences.executionProvider,
						preferences.activeChain,
						preferences.feedRankingProvider,
					),
					prefetch?.key === JSON.stringify(preferences)
						? prefetch.result
						: undefined,
				]);
				const generated =
					prefetched ?? (await generateFeedWithRetry(opened.id, preferences));
				await minimumLoader;
				prefetchedFeed.current = undefined;
				rememberWarnings(warningsByAssetId.current, generated);
				setSession(opened);
				setFeed({
					...generated,
					candidates: fillFeedPage(generated.candidates),
				});
				setIndex(0);
				setSelectedIds([]);
				setFeedExhausted(false);
				scrollToTop();
				setStage("swipe");
			} catch (caught) {
				await minimumLoader;
				setError(
					caught instanceof Error ? caught.message : "Could not open session",
				);
				scrollToTop();
				setStage("swipe");
			}
		},
		[authenticated, getAccessToken, solanaWallets],
	);

	const prefetchFeed = useCallback((preferences: OnboardingPreferences) => {
		const key = JSON.stringify(preferences);
		if (prefetchedFeed.current?.key === key) return;
		prefetchedFeed.current = {
			key,
			result: api
				.openSession(
					preferences.cadence,
					preferences.executionProvider,
					preferences.activeChain,
					preferences.feedRankingProvider,
				)
				.then((opened) => api.generateFeed(opened.id, preferences))
				.catch(() => undefined),
		};
	}, []);

	useEffect(() => {
		if (authenticated && user?.id && preferences) {
			writeAccountPreferences(user.id, preferences);
		}
	}, [authenticated, preferences, user?.id]);

	useEffect(() => {
		if (!privyReady || authenticated) return;
		setView("week");
		setStage("onboarding");
		setSession(undefined);
		setFeed(undefined);
		warningsByAssetId.current.clear();
		setPreferences(undefined);
		setIndex(0);
		setSelectedIds([]);
		setSettlement(undefined);
		setReceiptCandidates([]);
		setError("");
		setDecisionFeedback(undefined);
		setFeedExhausted(false);
	}, [authenticated, privyReady]);

	useEffect(
		() => () => {
			if (decisionTimer.current) window.clearTimeout(decisionTimer.current);
		},
		[],
	);

	const candidates = feed?.candidates ?? [];
	const current = candidates[index];
	const currentFeedCard = current
		? feed?.feed.cards.find((card) => card.assetId === current.assetId)
		: undefined;
	const currentWarnings = current
		? (warningsByAssetId.current.get(current.assetId) ??
			feed?.feed.warnings ??
			[])
		: [];
	const nextAssetId = candidates[index + 1]?.assetId;
	const selected = selectedIds
		.map((assetId) =>
			candidates.find((candidate) => candidate.assetId === assetId),
		)
		.filter((candidate): candidate is Candidate => Boolean(candidate));
	const ticketSizeUsd = preferences?.ticketSizeUsd ?? 10;
	const periodLimitUsd = preferences?.periodLimitUsd ?? 100;
	const selectedTotalUsd = selected.length * ticketSizeUsd;
	const canAddCurrent = selectedTotalUsd + ticketSizeUsd <= periodLimitUsd;

	useEffect(() => {
		if (!nextAssetId) return;
		void Promise.all([
			api.assetHistory(nextAssetId, "ALL"),
			api.assetHistory(nextAssetId, "1M"),
		]).catch(() => undefined);
	}, [nextAssetId]);

	const recoverReviewSession = useCallback(async () => {
		if (!preferences) throw new Error("PREFERENCES_REQUIRED");
		const opened = await api.openSession(
			preferences.cadence,
			preferences.executionProvider,
			preferences.activeChain,
			preferences.feedRankingProvider,
		);
		const generated = await api.generateFeed(opened.id, preferences);
		const available = new Set(
			generated.candidates.map((candidate) => candidate.assetId),
		);
		const retained = selectedIds.filter((assetId) => available.has(assetId));
		const assetIds = retained.length
			? retained
			: generated.candidates.slice(0, 1).map((candidate) => candidate.assetId);
		if (!assetIds.length)
			throw new Error("NO_ELIGIBLE_CANDIDATES_FOR_PREFERENCES");
		setSession(opened);
		rememberWarnings(warningsByAssetId.current, generated);
		setFeed({
			...generated,
			candidates: fillFeedPage(generated.candidates),
		});
		setSelectedIds(assetIds);
		return { sessionId: opened.id, assetIds };
	}, [preferences, selectedIds]);

	const loadMoreCandidates = useCallback(async () => {
		if (!feed || !preferences || !session || loadingMore || feedExhausted)
			return;
		setLoadingMore(true);
		try {
			const next = await api.generateFeed(
				session.id,
				preferences,
				nextFeedExcludedAssetIds(feed),
			);
			rememberWarnings(warningsByAssetId.current, next);
			const nextCandidates = fillFeedPage(next.candidates);
			setFeed((currentFeed) => {
				if (!currentFeed) return next;
				const rankOffset = currentFeed.feed.cards.length;
				return {
					...next,
					candidates: [...currentFeed.candidates, ...nextCandidates],
					feed: {
						...next.feed,
						cards: [
							...currentFeed.feed.cards,
							...next.feed.cards.map((card, cardIndex) => ({
								...card,
								rank: rankOffset + cardIndex + 1,
							})),
						],
					},
				};
			});
		} catch (caught) {
			if (
				caught instanceof ApiError &&
				caught.code !== "NO_ELIGIBLE_CANDIDATES_FOR_PREFERENCES"
			) {
				console.error("Could not load the next feed page", caught);
			}
			setFeedExhausted(true);
		} finally {
			setLoadingMore(false);
		}
	}, [feed, feedExhausted, loadingMore, preferences, session]);

	useEffect(() => {
		if (
			!feed?.hasMore ||
			feedExhausted ||
			loadingMore ||
			!shouldPrefetchNextFeed(index, candidates.length)
		) {
			return;
		}
		void loadMoreCandidates();
	}, [
		candidates.length,
		feed,
		feedExhausted,
		index,
		loadMoreCandidates,
		loadingMore,
	]);

	useEffect(() => {
		const nextCandidate = candidates[index + 1];
		if (!nextCandidate) return;
		void api.assetHistory(nextCandidate.assetId, "1M").catch(() => undefined);
	}, [candidates, index]);

	function decide(add: boolean) {
		if (!current) return;
		if (add && !selectedIds.includes(current.assetId) && canAddCurrent) {
			setSelectedIds((ids) => [...ids, current.assetId]);
		}
		setIndex((value) => Math.min(value + 1, candidates.length));
	}

	function animateDecision(add: boolean) {
		if (!current || decisionFeedback || (add && !canAddCurrent)) return;
		setDecisionFeedback(add ? "invest" : "skip");
		decisionTimer.current = window.setTimeout(() => {
			decide(add);
			setDecisionFeedback(undefined);
			decisionTimer.current = undefined;
		}, 300);
	}

	function remove(assetId: string) {
		setSelectedIds((ids) => ids.filter((id) => id !== assetId));
		setFeedExhausted(false);
	}

	function navigate(target: View) {
		if (!authenticated || stage === "onboarding") return;
		scrollToTop();
		setView(target);
		if (target === "week" && stage === "loading" && feed) setStage("swipe");
	}

	const applySolanaWallet = useCallback(
		async (solanaWallet: ConnectedStandardSolanaWallet) => {
			if (!preferences) return;
			const next: OnboardingPreferences = {
				...preferences,
				solanaExecutionWallet: solanaWallet.address,
			};
			prefetchedFeed.current = undefined;
			setSettlement(undefined);
			setSelectedIds([]);
			setFeed(undefined);
			setPreferences(next);
			configureApiAuth({
				getAccessToken,
				getWalletAddress: () => solanaWallet.address,
				getWalletChain: () => "SOLANA",
			});
			await loadSession(next);
		},
		[getAccessToken, loadSession, preferences],
	);

	return (
		<AssetIconProvider>
			<AppShell
				active={view}
				onNavigate={navigate}
				wallet={wallet}
				onWallet={() =>
					login({
						loginMethods: ["wallet", "email"],
						walletChainType: "solana-only",
					})
				}
				walletReady={privyReady && solanaWalletsReady}
				navigationEnabled={authenticated && stage !== "onboarding"}
				topUpRequest={topUpRequest}
				solanaWallets={solanaWallets}
				solanaWalletsReady={solanaWalletsReady}
				selectedSolanaWallet={selectedSolanaWallet}
				onSolanaWalletChange={(selected) => {
					void applySolanaWallet(selected);
				}}
			>
				{stage === "onboarding" ? (
					<Onboarding
						config={config}
						onComplete={loadSession}
						onPrefetch={prefetchFeed}
						privyReady={privyReady && solanaWalletsReady}
					/>
				) : view === "receipts" ? (
					<ReceiptScreen
						record={settlement}
						selected={receiptCandidates.length ? receiptCandidates : selected}
						feed={feed}
						demoMode={config.demoMode}
						onResume={async () => {
							if (!settlement) return;
							const reconciled = await api.reconcile(
								settlement.plan.executionId,
							);
							setSettlement(reconciled);
						}}
						onViewPortfolio={() => {
							scrollToTop();
							setView("positions");
						}}
						onStartNextBasket={() => {
							if (preferences) {
								void loadSession(preferences);
								setView("week");
							}
						}}
					/>
				) : view === "positions" ? (
					<PositionsScreen
						candidates={Array.from(
							new Map(
								candidates.map((candidate) => [candidate.assetId, candidate]),
							).values(),
						)}
						wallet={wallet}
						demoMode={config.demoMode}
						solanaWallet={selectedSolanaWallet}
					/>
				) : view === "account" && preferences ? (
					<AccountScreen
						wallet={wallet}
						preferences={preferences}
						developerMode={config.executionMode === "local-live"}
						executionProviders={config.executionProviders}
						feedRankingProviders={config.feedRankingProviders}
						onResetDemoWeek={async () => {
							await loadSession(preferences);
							setView("week");
						}}
						onSave={async (next) => {
							if (user?.id) writeAccountPreferences(user.id, next);
							prefetchedFeed.current = undefined;
							setSettlement(undefined);
							await loadSession(next);
							setView("week");
						}}
					/>
				) : stage === "review" && session && feed ? (
					<ReviewScreen
						session={session}
						feed={feed}
						selected={selected}
						onRemove={remove}
						onBack={() => {
							scrollToTop();
							setStage("swipe");
						}}
						onSettled={(record) => {
							setSettlement(record);
							setReceiptCandidates(
								executionCandidates(
									record,
									selected,
									wallet ? readReceiptCandidates(wallet) : [],
								),
							);
							setView("receipts");
						}}
						onSessionExpired={recoverReviewSession}
						onExecutionInvalidated={() => {
							setSettlement(undefined);
							if (wallet) {
								localStorage.removeItem(lastExecutionKey(wallet));
								localStorage.removeItem(lastExecutionCandidatesKey(wallet));
							}
						}}
						onStartAnotherBasket={() => {
							if (preferences) void loadSession(preferences);
						}}
						onTopUp={() => setTopUpRequest((request) => request + 1)}
						ticketSizeUsd={ticketSizeUsd}
						periodLimitUsd={periodLimitUsd}
						wallet={wallet}
						liveExecution={config.executionMode !== "demo"}
						solanaWallet={selectedSolanaWallet}
						onExecutionChange={(record) => {
							setSettlement(record);
							const snapshot = executionCandidates(
								record,
								selected,
								wallet ? readReceiptCandidates(wallet) : [],
							);
							setReceiptCandidates(snapshot);
							if (wallet) {
								localStorage.setItem(
									lastExecutionKey(wallet),
									record.plan.executionId,
								);
								if (snapshot.length === record.plan.quotes.length) {
									localStorage.setItem(
										lastExecutionCandidatesKey(wallet),
										JSON.stringify(snapshot),
									);
								}
							}
						}}
					/>
				) : (
					<main className="swipe-page">
						<section className="swipe-workspace">
							<header className="page-heading">
								<h1>Build your basket</h1>
								<p>Swipe right to add left to skip.</p>
							</header>
							{error ? (
								<div className="fatal-state">
									<h2>Session unavailable</h2>
									<p>{error}</p>
									<button
										type="button"
										onClick={() => {
											if (preferences) void loadSession(preferences);
										}}
										disabled={!preferences}
									>
										Try again
									</button>
								</div>
							) : stage === "loading" || !feed ? (
								<div className="loading-state">
									<div className="feed-loader" role="img" aria-label="0G">
										<b>0G</b>
									</div>
									<h2>Building your personal feed</h2>
									<p>
										{config.executionMode === "live" ? (
											"Eligible assets. Privately ranked. TEE-verified."
										) : config.executionMode === "local-live" ? (
											<span className="feed-providers">
												<span className="feed-providers-label">
													feed providers:
												</span>
												<span className="feed-provider">
													<img
														src="/assets/providers/0g-black.svg"
														alt=""
														aria-hidden="true"
													/>
													0G
												</span>
												<i aria-hidden="true">·</i>
												<span className="feed-provider">CoinGecko</span>
											</span>
										) : (
											"Demo assets. Bounded ranking. No broadcast."
										)}
									</p>
								</div>
							) : current ? (
								<>
									<div className="card-stage">
										<button
											type="button"
											className="gesture gesture-skip"
											onClick={() => animateDecision(false)}
											aria-label="Skip asset"
											disabled={Boolean(decisionFeedback)}
										>
											<ArrowLeft />
											<span>
												Skip<small>Swipe left</small>
											</span>
										</button>
										<SwipeCard
											candidate={current}
											reason={currentFeedCard?.reason ?? current.reason}
											ticketSizeUsd={ticketSizeUsd}
											feedback={decisionFeedback}
											infoOpen={assetInfoOpen}
											onInfoOpenChange={setAssetInfoOpen}
											onSwipe={animateDecision}
										/>
										<button
											type="button"
											className="gesture gesture-add"
											onClick={() => animateDecision(true)}
											aria-label={`Add ${ticketSizeUsd} USDC`}
											disabled={Boolean(decisionFeedback) || !canAddCurrent}
										>
											<LucideArrowRight />
											<span>
												Add<small>Swipe right</small>
											</span>
										</button>
									</div>
									{currentWarnings.length ? (
										<aside className="ai-warnings" aria-label="0G warnings">
											<Bot aria-hidden="true" />
											<ul>
												{currentWarnings.map((warning) => (
													<li key={warning}>{warning}</li>
												))}
											</ul>
										</aside>
									) : null}
									<BudgetSummary
										selectedCount={selected.length}
										ticketSizeUsd={ticketSizeUsd}
										periodLimitUsd={periodLimitUsd}
										className="mobile-budget-summary"
									/>
									<div
										className={`card-actions${selected.length ? " has-selection" : ""}`}
									>
										<button
											type="button"
											className="button button-skip"
											onClick={() => animateDecision(false)}
											disabled={Boolean(decisionFeedback)}
										>
											<ChevronLeft aria-hidden="true" /> Skip
										</button>
										<button
											type="button"
											className="button button-outline"
											onClick={() => {
												scrollToTop();
												setStage("review");
											}}
											disabled={!selected.length}
										>
											Review basket ({selected.length}) <ShoppingBasket />
										</button>
										<button
											type="button"
											className="button button-primary"
											onClick={() => animateDecision(true)}
											disabled={Boolean(decisionFeedback) || !canAddCurrent}
										>
											Add {ticketSizeUsd} USDC{" "}
											<ChevronRight aria-hidden="true" />
										</button>
									</div>
								</>
							) : loadingMore ? (
								<div className="loading-state loading-more">
									<div className="feed-loader" role="img" aria-label="0G">
										<b>0G</b>
									</div>
									<h2>Finding more assets…</h2>
									<p>Your selected basket stays ready to review.</p>
								</div>
							) : (
								<div className="feed-complete">
									{selected.length ? (
										<Confetti
											className="completion-confetti"
											options={{
												gravity: 0.9,
												particleCount: 120,
												spread: 90,
												startVelocity: 36,
											}}
										/>
									) : null}
									<h2>That’s the feed.</h2>
									<p>
										{selected.length
											? `${formatTicketSizeUsd(selected.length * ticketSizeUsd)} USDC is ready for review.`
											: config.executionMode === "demo"
												? "You skipped every card. Your USDC stays in your wallet."
												: "No more executable routes are available right now. Your USDC stays in your wallet."}
									</p>
									<button
										type="button"
										className="button button-primary"
										disabled={!selected.length}
										onClick={() => {
											scrollToTop();
											setStage("review");
										}}
									>
										Review basket ({selected.length}) <ShoppingBasket />
									</button>
								</div>
							)}
						</section>
						<BudgetRail
							selected={selected}
							onRemove={remove}
							ticketSizeUsd={ticketSizeUsd}
							periodLimitUsd={periodLimitUsd}
							executionProvider={
								preferences?.executionProvider ??
								session?.executionProvider ??
								"JUPITER"
							}
						/>
						<section className="evidence-detail">
							<div className="feed-method-copy">
								<h2>How your feed earns your trust</h2>
								<p>
									{config.executionMode === "demo"
										? "Your rules shape the feed. Demo mode applies them to market fixtures."
										: "Your rules shape the feed. CoinGecko powers card prices; executable routes are checked at review."}
								</p>
								<ol className="feed-pipeline">
									<li>
										<strong>1 · Your rules</strong>
										<span>Cadence, cap, ticket, risk, and asset mix.</span>
									</li>
									<li>
										<strong>2 · Market data</strong>
										<span>
											{config.executionMode === "demo"
												? "Fixture prices exercise the same card flow."
												: "Batched CoinGecko prices and cached chart history."}
										</span>
									</li>
									<li>
										<strong>
											3 ·{" "}
											{preferences?.feedRankingProvider === "DETERMINISTIC"
												? "Deterministic rank"
												: "Private 0G rank"}
										</strong>
										<span>
											{feed?.proof.teeVerified
												? "0G ranks only verified candidates inside a TEE."
												: "Local ranking uses the same bounded input and output schema."}
										</span>
									</li>
									<li>
										<strong>4 · You approve</strong>
										<span>
											Policy rechecks the route. Your wallet signs last.
										</span>
									</li>
								</ol>
							</div>
							{feed ? (
								<details className="feed-proof">
									<summary>
										View proof <ArrowRight />
									</summary>
									<dl>
										<div>
											<dt>Privacy</dt>
											<dd>
												{feed.proof.teeVerified
													? "TEE verified"
													: "Local run · not TEE verified"}
											</dd>
										</div>
										<div>
											<dt>Model</dt>
											<dd>{feed.proof.model}</dd>
										</div>
										<div>
											<dt>Provider</dt>
											<dd>
												{feed.proof.teeVerified ? (
													<a
														href="https://pc.0g.ai/models/0gm-1.0-35b-a3b-sia"
														target="_blank"
														rel="noreferrer"
													>
														0G ↗
													</a>
												) : feed.proof.effectiveProvider === "DETERMINISTIC" ? (
													"Deterministic"
												) : (
													"Local fixture"
												)}
											</dd>
										</div>
										<div>
											<dt>Input</dt>
											<dd>{shortProof(feed.proof.inputCommitment)}</dd>
										</div>
										<div>
											<dt>Output</dt>
											<dd>{shortProof(feed.proof.outputCommitment)}</dd>
										</div>
									</dl>
								</details>
							) : (
								<span className="feed-proof-loading">Preparing proof…</span>
							)}
						</section>
					</main>
				)}
			</AppShell>
		</AssetIconProvider>
	);
}

function scrollToTop() {
	window.scrollTo({ top: 0, behavior: "auto" });
}

function shortProof(value: string) {
	return `${value.slice(0, 11)}…${value.slice(-6)}`;
}

function lastExecutionKey(wallet: string) {
	return `${LAST_EXECUTION_KEY}:${wallet.toLowerCase()}`;
}

function lastExecutionCandidatesKey(wallet: string) {
	return `${LAST_EXECUTION_CANDIDATES_KEY}:${wallet.toLowerCase()}`;
}

function readReceiptCandidates(wallet: string) {
	try {
		const value = JSON.parse(
			localStorage.getItem(lastExecutionCandidatesKey(wallet)) ?? "[]",
		);
		return Array.isArray(value) ? (value as Candidate[]) : [];
	} catch {
		return [];
	}
}

function executionCandidates(
	record: ExecutionRecord,
	current: Candidate[],
	fallback: Candidate[],
) {
	const quotes = new Map(
		record.plan.quotes.map((quote) => [quote.assetId, quote]),
	);
	const withQuotes = (candidates: Candidate[]) =>
		candidates.flatMap((candidate) => {
			const quote = quotes.get(candidate.assetId);
			return quote ? [{ ...candidate, quote }] : [];
		});
	const selected = withQuotes(current);
	if (selected.length === record.plan.quotes.length) return selected;
	return withQuotes(fallback);
}
