import { type LinkedAccount, PrivyClient } from "@privy-io/node";
import type { Request } from "express";
import { solanaAddressSchema } from "../domain/schemas.js";

export class PrivyWalletAuth {
	private readonly client: PrivyClient;

	constructor(appId: string, appSecret: string) {
		this.client = new PrivyClient({ appId, appSecret });
	}

	async actor(request: Request): Promise<ExecutionActor> {
		const token = bearerToken(request);
		const wallet = solanaAddressSchema.parse(
			request.header("x-wallet-address"),
		);
		const claims = await this.client.utils().auth().verifyAccessToken(token);
		const user = await this.client.users()._get(claims.user_id);
		return {
			...executionActorFromLinkedAccounts(user.linked_accounts, wallet),
			userId: claims.user_id,
		};
	}
}

export type ExecutionActor = {
	userId: string;
	wallet: string;
	txOrigin: string;
	chain: "SOLANA";
};

export function executionActorFromLinkedAccounts(
	accounts: LinkedAccount[],
	requestedWallet: string,
): Omit<ExecutionActor, "userId"> {
	const wallet = solanaAddressSchema.parse(requestedWallet);
	const walletLinked = accounts.some(
		(account) => isSolanaWallet(account) && account.address === wallet,
	);
	if (!walletLinked) throw new Error("SOLANA_WALLET_NOT_LINKED_TO_PRIVY_USER");
	return { wallet, txOrigin: wallet, chain: "SOLANA" };
}

export function isSolanaWallet(
	account: LinkedAccount,
): account is Extract<LinkedAccount, { type: "wallet"; chain_type: "solana" }> {
	return account.type === "wallet" && account.chain_type === "solana";
}

function bearerToken(request: Request): string {
	const authorization = request.header("authorization");
	const match = authorization?.match(/^Bearer ([^\s]+)$/i);
	if (!match?.[1]) throw new Error("PRIVY_ACCESS_TOKEN_REQUIRED");
	return match[1];
}
