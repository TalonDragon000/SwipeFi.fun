import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "../api";

const TICKER_LOGO_CDN = "https://cdn.tickerlogos.com";
const LOGO_DEV_PUBLISHABLE_KEY = "pk_Vd4Z_uMzQJCMUA21nk_6Gw";

const STOCK_LOGO_DOMAINS: Record<string, string> = {
	CRCL: "circle.com",
	CRWV: "coreweave.com",
	RDDT: "reddit.com",
	SPCX: "spacex.com",
};

const AssetIconsContext = createContext<Record<string, string>>({});

export function AssetIconProvider({ children }: { children: ReactNode }) {
	const [icons, setIcons] = useState<Record<string, string>>({});

	useEffect(() => {
		let mounted = true;
		api
			.assetIcons()
			.then(({ icons: next }) => {
				if (mounted) setIcons(next);
			})
			.catch(() => undefined);
		return () => {
			mounted = false;
		};
	}, []);

	return (
		<AssetIconsContext.Provider value={icons}>{children}</AssetIconsContext.Provider>
	);
}

function AssetLogo({
	iconUrl,
	domain,
	symbol,
}: {
	iconUrl?: string;
	domain?: string;
	symbol: string;
}) {
	type LogoSource = "provided" | "logoDev" | "allinvest" | "letter";
	const fallbackSource: LogoSource = symbol === "WETH" ? "letter" : "logoDev";
	const initialSource: LogoSource = iconUrl ? "provided" : fallbackSource;
	const [source, setSource] = useState<LogoSource>(initialSource);

	useEffect(
		() => setSource(iconUrl ? "provided" : fallbackSource),
		[iconUrl, fallbackSource],
	);

	const imageUrl =
		source === "provided"
			? iconUrl
			: source === "logoDev"
				? `https://img.logo.dev/ticker/${encodeURIComponent(symbol.toUpperCase())}?token=${LOGO_DEV_PUBLISHABLE_KEY}&size=128&format=png&theme=light&retina=true&fallback=404`
				: source === "allinvest" && domain
					? `${TICKER_LOGO_CDN}/${domain}`
					: undefined;

	if (!imageUrl)
		return (
			<span aria-hidden="true">
				{symbol === "WETH" ? "◆" : symbol.slice(0, 1)}
			</span>
		);

	return (
		<img
			src={imageUrl}
			alt={`${symbol} logo`}
			onError={() =>
				setSource(
					source === "provided" && symbol !== "WETH"
						? "logoDev"
						: source === "logoDev" && domain
							? "allinvest"
							: "letter",
				)
			}
		/>
	);
}

export function AssetMark({
	symbol,
	iconUrl,
	size = "md",
}: {
	symbol: string;
	iconUrl?: string;
	size?: "sm" | "md" | "lg";
}) {
	const domain = STOCK_LOGO_DOMAINS[symbol];
	const registeredIconUrl = useContext(AssetIconsContext)[symbol];
	const resolvedIconUrl = iconUrl ?? registeredIconUrl;

	return (
		<span className={`asset-mark asset-${symbol.toLowerCase()} asset-mark-${size}`}>
			<AssetLogo
				key={`${resolvedIconUrl ?? ""}:${domain ?? ""}`}
				iconUrl={resolvedIconUrl}
				domain={domain}
				symbol={symbol}
			/>
		</span>
	);
}
