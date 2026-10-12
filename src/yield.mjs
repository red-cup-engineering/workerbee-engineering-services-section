// yield — plans converting a fleet account's liquid WORKERBEE into
// productive BEE-mining power (self-stake, then delegate the same bounded
// quantity to the ph1102 no-fee pool), and the pure reconciliation helpers
// used to confirm an already-broadcast batch really executed as planned.
// Nothing in this module signs or broadcasts a transaction: `planWorkerBeeYield`
// only encodes the `custom_json` operation it would take.

import { decimalUnits as units, formatUnits as format, rationalUnits } from "@red-cup-engineering/exact-number-data-service/decimal-string";
import { engineCustomJson, tokens } from "@red-cup-engineering/hive-blockchain-client-service/engine.mjs";
import { parseEngineOrderBook } from "@red-cup-engineering/hive-blockchain-client-service/market.mjs";
import { marketSellWalk } from "@red-cup-engineering/gaming/market";
import { gradedFromParts, gradedSign, gradedValue } from "@red-cup-engineering/exact-number-data-service/graded";

const SYMBOL = "WORKERBEE";
const POOL_ACCOUNT = "ph1102";
const POOL_ID = "BEE:WORKERBEE";

/** The one WORKERBEE yield batch: self-stake `quantity` (at most 10.00000) and delegate the same
 * quantity to the no-fee BEE pool, active authority. The planner builds it; the fleet signer
 * admits exactly this shape. */
export function workerBeeYieldIntent(account, quantity) {
  const quantityUnits = units(String(quantity), 5);
  if (!/\.[0-9]{5}$/.test(String(quantity)) || quantityUnits <= 0n || quantityUnits > 1_000_000n) throw new Error("WORKERBEE yield quantity must be a positive 5-decimal amount of at most 10.00000");
  return engineCustomJson(account, [tokens.stake({ symbol: SYMBOL, quantity, to: account }), tokens.delegate({ symbol: SYMBOL, quantity, to: POOL_ACCOUNT })]);
}

// What selling `quantityUnits` (at `quantityPrecision`) into the displayed bids would realize, in
// SWAP.HIVE units; null when the bids cannot fill it.
function depthProceeds(quantityUnits, quantityPrecision, bids) {
  const walked = marketSellWalk(parseEngineOrderBook(bids, [], "TOKEN"), gradedFromParts(quantityUnits, 10n ** BigInt(quantityPrecision), "TOKEN"));
  if (gradedSign(walked.shortfall) > 0) return null;
  const units8 = (value) => rationalUnits(gradedValue(value), 8, { rounding: "toward-zero" });
  return Object.freeze({ proceeds: units8(walked.cost), levels: walked.levels, floorPrice: walked.worst ? format(units8(walked.worst), 8) : null });
}

const AGREEMENT_FIELDS = ["account", "symbol", "token", "balance", "delegation", "pendingRows", "pool", "books"];

/** Two independently observed WORKERBEE states are the same economic
 * evidence when every field the plan reads from agrees (observedAt may
 * differ). */
export function statesAgree(left, right) {
  return AGREEMENT_FIELDS.every((field) => JSON.stringify(left[field]) === JSON.stringify(right[field]));
}

/**
 * Plan self-staking then delegating the full observed liquid WORKERBEE
 * balance to the ph1102 mining pool. Refuses (never throws) whenever the
 * observed contract terms, pending movements, balance, or bid depth do not
 * exactly match this fleet's previously confirmed policy, or the liquid
 * balance exceeds the hard 10.00000 WORKERBEE signer cap.
 */
export function planWorkerBeeYield(state) {
  const token = state.token; const balance = state.balance; const pool = state.pool;
  if (!/^[a-z][a-z0-9.-]{2,15}$/.test(String(state.account ?? "")) || state.symbol !== SYMBOL) return Object.freeze({ kind: "refuse", reason: "policy identity mismatch" });
  if (token?.issuer !== "steem-tokens" || token.precision !== 5 || token.stakingEnabled !== true || token.delegationEnabled !== true
    || token.unstakingCooldownDays !== 63 || token.undelegationCooldownDays !== 7 || token.numberTransactions !== 9
    || Object.keys(token).sort().join(",") !== ["delegationEnabled", "issuer", "numberTransactions", "precision", "stakingEnabled", "undelegationCooldownDays", "unstakingCooldownDays"].sort().join(",")) return Object.freeze({ kind: "refuse", reason: "WORKERBEE contract terms changed" });
  const miner = Array.isArray(pool?.tokenMiners) && pool.tokenMiners.length === 1 ? pool.tokenMiners[0] : null;
  if (pool.id !== POOL_ID || pool.minedToken !== "BEE" || pool.active !== true || pool.lotteryWinners !== 10
    || pool.lotteryIntervalHours !== 1 || pool.lotteryAmount !== "10.00000000"
    || miner?.symbol !== SYMBOL || miner.multiplier !== 1 || Object.keys(miner).sort().join(",") !== "multiplier,symbol") return Object.freeze({ kind: "refuse", reason: "BEE mining pool terms changed" });
  if (state.pendingRows.unstakes !== 0 || state.pendingRows.undelegations !== 0
    || units(balance.pendingUnstake, 5) !== 0n || units(balance.pendingUndelegations, 5) !== 0n) return Object.freeze({ kind: "refuse", reason: "WORKERBEE has a pending release movement" });
  const quantityUnits = units(balance.liquid, 5);
  if (quantityUnits === 0n) return Object.freeze({ kind: "refuse", reason: "no liquid WORKERBEE remains" });
  if (quantityUnits > 1_000_000n) return Object.freeze({ kind: "refuse", reason: "liquid WORKERBEE exceeds the signer cap of 10.00000" });
  if (!Array.isArray(state.books?.beeBids) || !Array.isArray(state.books?.workerBeeBids)) return Object.freeze({ kind: "refuse", reason: "live BEE or WORKERBEE bid evidence is absent" });
  const totalPowerUnits = units(pool.totalPower, 5);
  if (totalPowerUnits === 0n) return Object.freeze({ kind: "refuse", reason: "BEE mining power is zero" });
  const weeklyLotteries = 168n / BigInt(pool.lotteryIntervalHours);
  const weeklyBeeUnits = quantityUnits * units(pool.lotteryAmount, 8) * weeklyLotteries / totalPowerUnits;
  const annualBeeUnits = weeklyBeeUnits * 52n;
  const beeExit = depthProceeds(annualBeeUnits, 8, state.books.beeBids);
  const workerBeeExit = depthProceeds(quantityUnits, 5, state.books.workerBeeBids);
  if (!beeExit || !workerBeeExit) return Object.freeze({ kind: "refuse", reason: "displayed bids cannot value both the annual BEE output and full WORKERBEE position" });
  const annualSwapHiveUnits = beeExit.proceeds; const positionBidValueUnits = workerBeeExit.proceeds;
  const annualYieldBps = positionBidValueUnits === 0n ? 0 : Number(annualSwapHiveUnits * 10_000n / positionBidValueUnits);
  const quantity = format(quantityUnits, 5);
  return Object.freeze({
    kind: "stake-delegate", quantity, recipient: POOL_ACCOUNT,
    lockTerms: Object.freeze({ unstakingCooldownDays: 63, releaseTransactions: 9, undelegationCooldownDays: 7 }),
    expectedYield: Object.freeze({
      derivation: "q/totalPower * lotteryAmount * 168 lotteries/week; both legs integrated across complete displayed bid depth",
      weeklyBeeFloor: format(weeklyBeeUnits, 8), annualBeeFloor: format(annualBeeUnits, 8),
      annualSwapHiveAtBidFloor: format(annualSwapHiveUnits, 8), annualBeeExitLevels: beeExit.levels, annualBeeFloorPrice: beeExit.floorPrice,
      positionSwapHiveAtBidFloor: format(positionBidValueUnits, 8), positionExitLevels: workerBeeExit.levels, positionFloorPrice: workerBeeExit.floorPrice, annualYieldBps,
    }),
    operation: workerBeeYieldIntent(state.account, quantity),
  });
}

