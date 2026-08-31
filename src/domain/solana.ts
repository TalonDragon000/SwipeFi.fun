export const SOLANA_CLUSTER = "mainnet-beta" as const;
export const SOLANA_CHAIN = "SOLANA" as const;

export const SOLANA_USDC_MINT =
	"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" as const;
export const SOLANA_USDC_DECIMALS = 6;
export const SOLANA_NATIVE_MINT =
	"So11111111111111111111111111111111111111112" as const;

export type SolanaAsset = {
	assetId: string;
	symbol: string;
	name: string;
	kind: "CRYPTO" | "STOCK_TOKEN";
	address: string;
	decimals: number;
};

export type RegistryAsset = SolanaAsset & {
	coingeckoId?: string;
};

export const COINGECKO_COIN_IDS: Record<string, string> = {
	SOL: "solana",
	JUP: "jupiter-exchange-solana",
	AAPLx: "apple-xstock",
	NVDAx: "nvidia-xstock",
	TSLAx: "tesla-xstock",
};

/**
 * Curated launch universe. Jupiter metadata and an exact-size `/build` route
 * are revalidated before any asset is shown or prepared.
 */
export const SOLANA_ASSET_REGISTRY: Record<string, SolanaAsset> = {
	SOL: {
		assetId: "sol:mainnet:SOL",
		symbol: "SOL",
		name: "Solana",
		kind: "CRYPTO",
		address: SOLANA_NATIVE_MINT,
		decimals: 9,
	},
	JUP: {
		assetId: "sol:mainnet:JUP",
		symbol: "JUP",
		name: "Jupiter",
		kind: "CRYPTO",
		address: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
		decimals: 6,
	},
	AAPLX: {
		assetId: "sol:mainnet:AAPLx",
		symbol: "AAPLx",
		name: "Apple xStock",
		kind: "STOCK_TOKEN",
		address: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
		decimals: 8,
	},
	NVDAX: {
		assetId: "sol:mainnet:NVDAx",
		symbol: "NVDAx",
		name: "NVIDIA xStock",
		kind: "STOCK_TOKEN",
		address: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
		decimals: 8,
	},
	TSLAX: {
		assetId: "sol:mainnet:TSLAx",
		symbol: "TSLAx",
		name: "Tesla xStock",
		kind: "STOCK_TOKEN",
		address: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
		decimals: 8,
	},
};

export function solanaAssetById(assetId: string): SolanaAsset | undefined {
	return Object.values(SOLANA_ASSET_REGISTRY).find(
		(asset) => asset.assetId === assetId,
	);
}
