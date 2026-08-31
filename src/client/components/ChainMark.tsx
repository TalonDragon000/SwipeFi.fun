export function ChainMark({
	size = 20,
}: {
	size?: number;
}) {
	return (
		<img
			className="chain-mark chain-mark-solana"
			src="/assets/chains/solana.svg"
			width={size}
			height={size}
			alt=""
			aria-hidden="true"
		/>
	);
}
