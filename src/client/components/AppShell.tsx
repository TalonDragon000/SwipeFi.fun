import { type ReactNode, useEffect } from "react";
import type { ConnectedStandardSolanaWallet } from "@privy-io/react-auth/solana";
import { Wallet } from "lucide-react";
import { APP_NAME } from "../../domain/brand";
import { WalletMenu } from "./WalletMenu";

interface Props {
	active: "week" | "positions" | "receipts" | "account";
	onNavigate: (target: Props["active"]) => void;
	wallet?: string;
	topUpRequest?: number;
	onWallet?: () => void;
	walletReady?: boolean;
	navigationEnabled?: boolean;
	solanaWallets: ConnectedStandardSolanaWallet[];
	solanaWalletsReady: boolean;
	selectedSolanaWallet?: ConnectedStandardSolanaWallet;
	onSolanaWalletChange: (wallet: ConnectedStandardSolanaWallet) => void;
	children: ReactNode;
}

export function AppShell({
	active,
	onNavigate,
	wallet,
	topUpRequest,
	onWallet,
	walletReady = true,
	navigationEnabled = true,
	solanaWallets,
	solanaWalletsReady,
	selectedSolanaWallet,
	onSolanaWalletChange,
	children,
}: Props) {
	useEffect(() => {
		const root = document.documentElement;
		const themeColor = document.querySelector<HTMLMetaElement>(
			'meta[name="theme-color"]',
		);
		const previousChain = root.dataset.chain;
		const previousThemeColor = themeColor?.content;

		root.dataset.chain = "solana";
		if (themeColor) {
			themeColor.content = "#090B0F";
		}

		return () => {
			if (previousChain) root.dataset.chain = previousChain;
			else delete root.dataset.chain;
			if (themeColor && previousThemeColor) themeColor.content = previousThemeColor;
		};
	}, []);

	return (
		<div className="app-shell">
			<header className={navigationEnabled ? "topbar" : "topbar topbar-onboarding"}>
				<button
					type="button"
					className="brand"
					onClick={() => onNavigate("week")}
					aria-label={`${APP_NAME} home`}
				>
					SwipeFi.<span>fun</span>
				</button>
				{navigationEnabled ? (
					<nav aria-label="Primary navigation">
						{[
							["week", "Basket"],
							["positions", "Portfolio"],
							["receipts", "Activity"],
							["account", "Account"],
						].map(([id, label]) => (
							<button
								type="button"
								key={id}
								className={active === id ? "nav-link active" : "nav-link"}
								onClick={() => onNavigate(id as Props["active"])}
							>
								{label}
							</button>
						))}
					</nav>
				) : null}
				{wallet ? (
					<div className="wallet-pill">
						<WalletMenu
							wallet={wallet}
							topUpRequest={topUpRequest}
							solanaWallets={solanaWallets}
							solanaWalletsReady={solanaWalletsReady}
							selectedSolanaWallet={selectedSolanaWallet}
							onSolanaWalletChange={onSolanaWalletChange}
						/>
					</div>
				) : (
					<button
						type="button"
						className="wallet-button"
						onClick={onWallet}
						disabled={!walletReady}
						aria-label="Connect wallet with Privy"
						title="Connect wallet with Privy"
					>
						<Wallet size={17} strokeWidth={1.7} />
						Connect wallet
					</button>
				)}
			</header>
			{children}
		</div>
	);
}
