import assert from "node:assert/strict";
import test from "node:test";

import { recordPoolDistributionEvents, reconcileWorkerBeePoolDistribution, workerBeePoolTransfersFromHistoryRow } from "../src/pool.mjs";

const DELEGATED_AT = "2026-07-22T06:31:42.000Z";
const TX = "a".repeat(40);

function historyRow(timestamp = "2026-07-22T07:00:00") {
  return [42, { block: 108_350_000, trx_id: TX, timestamp, op: ["custom_json", { id: "ssc-mainnet-hive",
    required_auths: ["ph1102"], required_posting_auths: [], json: JSON.stringify({ contractName: "tokens", contractAction: "transfer",
      contractPayload: { symbol: "BEE", to: "michael561", quantity: "0.02500000", memo: "" } }) }] }];
}

function engineResult(quantity = "0.02500000") {
  return {
    blockNumber: 61_400_000, refHiveBlockNumber: 108_350_000, transactionId: TX, sender: "ph1102", contract: "tokens", action: "transfer",
    payload: JSON.stringify({ symbol: "BEE", to: "michael561", quantity, memo: "", isSignedWithActiveKey: true }),
    logs: JSON.stringify({ events: [{ contract: "tokens", event: "transfer", data: { from: "ph1102", to: "michael561", symbol: "BEE", quantity } }] }),
  };
}

test("pool transfer parsing binds source, beneficiary, delegation time, and narrow action", () => {
  const candidates = workerBeePoolTransfersFromHistoryRow(historyRow(), DELEGATED_AT, "michael561");
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].sourceId, `hive:${TX}:0`);
  assert.equal(candidates[0].quantity, "0.02500000");
  assert.equal(workerBeePoolTransfersFromHistoryRow(historyRow("2026-07-22T06:00:00"), DELEGATED_AT, "michael561").length, 0);
  const foreign = structuredClone(historyRow());
  foreign[1].op[1].json = JSON.stringify([
    { contractName: "tokens", contractAction: "transfer", contractPayload: { symbol: "BEE", to: "michael561", quantity: "0.02500000" } },
    { contractName: "market", contractAction: "sell", contractPayload: {} },
  ]);
  assert.equal(workerBeePoolTransfersFromHistoryRow(foreign, DELEGATED_AT, "michael561").length, 0);
});

test("expected yield becomes settled only with two exact execution witnesses", () => {
  const candidate = workerBeePoolTransfersFromHistoryRow(historyRow(), DELEGATED_AT, "michael561")[0];
  assert.throws(() => reconcileWorkerBeePoolDistribution(candidate, [{ provider: "one", result: engineResult() }]), /fewer than two/u);
  assert.throws(() => reconcileWorkerBeePoolDistribution(candidate, [
    { provider: "one", result: engineResult() },
    { provider: "two", result: engineResult("0.02400000") },
  ]), /fewer than two/u);
  const settled = reconcileWorkerBeePoolDistribution(candidate, [{ provider: "one", result: engineResult() }, { provider: "two", result: engineResult() }]);
  assert.equal(settled.status, "settled");
  assert.deepEqual(settled.confirmationProviders, ["one", "two"]);
});

test("settlement events carry a stable sourceId-derived identity and no invented valuation", () => {
  const candidate = workerBeePoolTransfersFromHistoryRow(historyRow(), DELEGATED_AT, "michael561")[0];
  const settled = reconcileWorkerBeePoolDistribution(candidate, [{ provider: "one", result: engineResult() }, { provider: "two", result: engineResult() }]);
  const events = recordPoolDistributionEvents([settled], "2026-07-22T07:05:00.000Z");
  assert.equal(events.length, 1);
  assert.equal(events[0].valuation.swapHive, null);
  assert.equal(events[0].recordedAt, "2026-07-22T07:05:00.000Z");
  // Recording is a pure shaping step with no store of its own: calling it
  // again on the same settled distribution reproduces the same eventId, so
  // a caller doing its own append-only persistence can de-duplicate on it.
  const again = recordPoolDistributionEvents([settled], "2026-07-22T09:00:00.000Z");
  assert.equal(again[0].eventId, events[0].eventId);
});

test("unsettled distributions are never recorded as events", () => {
  const candidate = workerBeePoolTransfersFromHistoryRow(historyRow(), DELEGATED_AT, "michael561")[0];
  assert.deepEqual(recordPoolDistributionEvents([{ ...candidate, status: "pending" }]), []);
});
