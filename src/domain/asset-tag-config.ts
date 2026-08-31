export type AssetTagTone = "default" | "tokenized-stock" | "meme";

export interface VisibleAssetTag {
	label: string;
	source: string;
	tone: AssetTagTone;
}

export const ASSET_TAG_CONFIG = {
	labels: {
		"Base Ecosystem": "Base",
		"Ethereum Ecosystem": "Ethereum",
		"Solana Ecosystem": "Solana",
	} as Record<string, string>,
	hiddenExact: [
		"Animal",
		"Dog",
		"Robinhood Chain Stocks Ecosystem",
		"FTX Holdings",
		"Fruits",
	],
	hiddenPatterns: [/-themed/i, /\bportfolio$/i],
	priorityPatterns: [/^tokenized stocks?$/i],
	tonePatterns: {
		"tokenized-stock": /^tokenized stocks?$/i,
		meme: /^meme$/i,
	},
} as const;

export function visibleAssetTags(categories: string[]): VisibleAssetTag[] {
	return categories
		.filter((category) => !isHiddenAssetTag(category))
		.map((source, index) => ({
			index,
			label: ASSET_TAG_CONFIG.labels[source] ?? source,
			source,
			tone: assetTagTone(source),
			priority: ASSET_TAG_CONFIG.priorityPatterns.some((pattern) =>
				pattern.test(source),
			)
				? 0
				: 1,
		}))
		.sort((left, right) => left.priority - right.priority || left.index - right.index)
		.map(({ index: _index, priority: _priority, ...tag }) => tag);
}

function isHiddenAssetTag(category: string) {
	const normalized = category.trim().toLowerCase();
	return (
		ASSET_TAG_CONFIG.hiddenExact.some(
			(hidden) => hidden.toLowerCase() === normalized,
		) ||
		ASSET_TAG_CONFIG.hiddenPatterns.some((pattern) => pattern.test(category))
	);
}

function assetTagTone(category: string): AssetTagTone {
	if (ASSET_TAG_CONFIG.tonePatterns["tokenized-stock"].test(category)) {
		return "tokenized-stock";
	}
	if (ASSET_TAG_CONFIG.tonePatterns.meme.test(category)) return "meme";
	return "default";
}
