// Type declarations for @red-cup-engineering/workerbee-services-section/yield.

export interface WorkerBeeTokenTerms {
  readonly issuer: string;
  readonly precision: number;
  readonly stakingEnabled: boolean;
  readonly delegationEnabled: boolean;
  readonly unstakingCooldownDays: number;
  readonly undelegationCooldownDays: number;
  readonly numberTransactions: number;
}

export interface WorkerBeeBalance {
  readonly liquid: string;
  readonly stake: string;
  readonly delegationsOut: string;
  readonly pendingUnstake: string;
  readonly pendingUndelegations: string;
}

export interface WorkerBeeBid {
  readonly account: string;
  readonly price: string;
  readonly quantity: string;
  readonly txId: string;
  readonly expiration: number;
}

export interface WorkerBeePoolTerms {
  readonly id: string;
  readonly minedToken: string;
  readonly lotteryWinners: number;
  readonly lotteryIntervalHours: number;
  readonly lotteryAmount: string;
  readonly active: boolean;
  readonly tokenMiners: readonly Readonly<{ symbol: string; multiplier: number }>[];
  readonly totalPower: string;
  readonly poolAccountPower: string;
}

export interface WorkerBeeYieldState {
  readonly account: string;
  readonly symbol: string;
  readonly observedAt: string;
  readonly token: WorkerBeeTokenTerms;
  readonly balance: WorkerBeeBalance;
  readonly delegation: Readonly<{ to: string; quantity: string }>;
  readonly pendingRows: Readonly<{ unstakes: number; undelegations: number }>;
  readonly pool: WorkerBeePoolTerms;
  readonly books: Readonly<{ beeBids: readonly WorkerBeeBid[]; workerBeeBids: readonly WorkerBeeBid[] }>;
}

export type WorkerBeeYieldPlan =
  | {
      readonly kind: "stake-delegate";
      readonly quantity: string;
      readonly recipient: string;
      readonly lockTerms: Readonly<{ unstakingCooldownDays: number; releaseTransactions: number; undelegationCooldownDays: number }>;
      readonly expectedYield: Readonly<{
        derivation: string;
        weeklyBeeFloor: string;
        annualBeeFloor: string;
        annualSwapHiveAtBidFloor: string;
        annualBeeExitLevels: number;
        annualBeeFloorPrice: string | null;
        positionSwapHiveAtBidFloor: string;
        positionExitLevels: number;
        positionFloorPrice: string | null;
        annualYieldBps: number;
      }>;
      readonly operation: readonly unknown[];
    }
  | { readonly kind: "refuse"; readonly reason: string };

export interface WorkerBeeEngineTransactionInfo {
  readonly node: string;
  readonly transactionIds: readonly string[];
  readonly blockNumber: number;
  readonly logs: Readonly<{ events: readonly unknown[] }>;
}

export declare function stakeOperation(account: string, symbol: string, quantity: string, to?: string): readonly unknown[];
export declare function delegateOperation(account: string, symbol: string, quantity: string, to: string): readonly unknown[];
export declare function batchOperations(account: string, operations: readonly (readonly unknown[])[]): readonly unknown[];
export declare function statesAgree(left: WorkerBeeYieldState, right: WorkerBeeYieldState): boolean;
export declare function planWorkerBeeYield(state: WorkerBeeYieldState): WorkerBeeYieldPlan;
export declare function normalizeEngineTransactionInfo(result: unknown, node?: string, candidate?: string): WorkerBeeEngineTransactionInfo;
