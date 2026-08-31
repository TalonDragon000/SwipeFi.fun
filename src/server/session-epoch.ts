import { randomUUID } from "node:crypto";
import type { InvestmentCadence } from "../domain/epoch.js";
import { cadenceEpoch } from "../domain/epoch.js";

export function sessionEpochId(
	cadence: InvestmentCadence,
	mode: { demoMode: boolean; localLiveExecution: boolean },
	nonce: string = randomUUID(),
) {
	const epochId = cadenceEpoch(cadence);
	return mode.demoMode || mode.localLiveExecution
		? `${epochId}:basket:${nonce}`
		: epochId;
}
