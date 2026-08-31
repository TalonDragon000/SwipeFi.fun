import { useEffect, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import type { ConnectedStandardSolanaWallet } from "@privy-io/react-auth/solana";
import { UserPill } from "@privy-io/react-auth/ui";
import { Popover } from "radix-ui";
import {
	Check,
	ChevronDown,
	Copy,
	ExternalLink,
	LogOut,
	Settings,
	Wallet,
} from "lucide-react";
import { ChainMark } from "./ChainMark";

export function WalletMenu({
	wallet,
	topUpRequest = 0,
	solanaWallets,
	solanaWalletsReady,
	selectedSolanaWallet,
	onSolanaWalletChange,
}: {
	wallet: string;
	topUpRequest?: number;
	solanaWallets: ConnectedStandardSolanaWallet[];
	solanaWalletsReady: boolean;
	selectedSolanaWallet?: ConnectedStandardSolanaWallet;
	onSolanaWalletChange: (wallet: ConnectedStandardSolanaWallet) => void;
}) {
	const { logout } = usePrivy();
	const privyAccountTriggerRef = useRef<HTMLDivElement>(null);
	const [menuOpen, setMenuOpen] = useState(false);
	const [copied, setCopied] = useState(false);

	useEffect(() => {
		if (!topUpRequest) return;
		void copyWallet();
	}, [topUpRequest]);

	async function disconnectAndLogout() {
		await Promise.allSettled(
			solanaWallets.map((candidate) => candidate.disconnect()),
		);
		await logout();
	}

	function openPrivyAccount() {
		setMenuOpen(false);
		window.requestAnimationFrame(() => {
			const trigger = privyAccountTriggerRef.current?.querySelector("button");
			if (!trigger) return;
			trigger.tabIndex = -1;
			trigger.click();
		});
	}

	async function copyWallet() {
		await navigator.clipboard.writeText(wallet);
		setCopied(true);
		window.setTimeout(() => setCopied(false), 1_500);
	}

	return (
		<>
			<Popover.Root open={menuOpen} onOpenChange={setMenuOpen}>
				<Popover.Trigger asChild>
					<button
						type="button"
						className="wallet-menu-trigger"
						aria-label={`Open wallet menu for ${wallet}`}
					>
						<Wallet aria-hidden="true" />
						{shortAddress(wallet)}
						<ChevronDown className="wallet-menu-chevron" aria-hidden="true" />
					</button>
				</Popover.Trigger>
				<Popover.Portal>
					<Popover.Content
						className="wallet-menu-content"
						sideOffset={8}
						align="end"
						collisionPadding={12}
					>
						<div className="wallet-menu-heading">
							<span>Solana wallet</span>
							<strong>{shortAddress(wallet)}</strong>
						</div>
						<div className="wallet-chain-badge">
							<ChainMark />
							<span>Solana Mainnet</span>
						</div>
						<label className="wallet-menu-wallet-select">
							<span>Signing wallet</span>
							<select
								value={selectedSolanaWallet?.address ?? ""}
								disabled={!solanaWalletsReady || !solanaWallets.length}
								onChange={(event) => {
									const selected = solanaWallets.find(
										(candidate) => candidate.address === event.target.value,
									);
									if (selected) onSolanaWalletChange(selected);
								}}
							>
								{solanaWallets.map((candidate) => (
									<option value={candidate.address} key={candidate.address}>
										{shortAddress(candidate.address)}
									</option>
								))}
							</select>
						</label>
						<a
							className="wallet-menu-action primary"
							href={`https://explorer.solana.com/address/${wallet}`}
							target="_blank"
							rel="noreferrer"
						>
							<ExternalLink aria-hidden="true" />
							View on Solana Explorer
						</a>
						<button
							type="button"
							className="wallet-menu-action"
							onClick={openPrivyAccount}
						>
							<Settings aria-hidden="true" />
							Account settings
						</button>
						<button
							type="button"
							className="wallet-menu-action"
							onClick={() => void copyWallet()}
						>
							{copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
							{copied ? "Address copied" : "Copy address"}
						</button>
						<div className="wallet-menu-separator" />
						<button
							type="button"
							className="wallet-menu-action danger"
							onClick={() => void disconnectAndLogout()}
						>
							<LogOut aria-hidden="true" />
							Log out
						</button>
						<Popover.Arrow className="wallet-menu-arrow" />
					</Popover.Content>
				</Popover.Portal>
			</Popover.Root>

			<div
				ref={privyAccountTriggerRef}
				className="privy-account-trigger-bridge"
				aria-hidden="true"
			>
				<UserPill expanded={false} size={40} ui={{ minimal: true, background: "secondary" }} />
			</div>
		</>
	);
}

function shortAddress(address: string) {
	return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}
