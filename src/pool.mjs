// pool — extracts candidate ph1102 -> michael561 Hive-Engine transfers from
// raw Hive account-history rows, and settles a candidate only once two
// independent Hive-Engine blockchain providers confirm the exact same
// executed effect. `recordPoolDistributionEvents` only shapes settled
// distributions into durable event records in memory; persisting or reading
// them back is the caller's I/O concern, not this module's.
//
// Ported from aagaard's src/core/workerBeePoolSettlement.mts
// (self-contained; no shared dependency).

export const WORKER_BEE_POOL_DISTRIBUTION_SCHEMA = "aagaard.workerbee-pool-distribution.v1";
export const WORKER_BEE_POOL_DISTRIBUTION_CATEGORY = "aagaard.workerbee-pool-distribution-event";
export const WORKER_BEE_POOL_ACCOUNT = "ph1102";

function canonicalTimestamp(value) {
  if (typeof value !== "string") throw new TypeError("pool transfer timestamp is malformed");
  const milliseconds = Date.parse(value.endsWith("Z") ? value : `${value}Z`);
  if (!Number.isFinite(milliseconds)) throw new TypeError("pool transfer timestamp is malformed");
  return new Date(milliseconds).toISOString();
}

function canonicalQuantity(value) {
  const quantity = String(value ?? "");
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,8}))?$/u.exec(quantity);
  if (!match || (BigInt(match[1]) === 0n && !/[1-9]/u.test(match[2] ?? ""))) {
    throw new TypeError("pool transfer quantity is malformed or zero");
  }
  return quantity;
}

function canonicalSymbol(value) {
  const symbol = String(value ?? "");
  if (!/^[A-Z][A-Z0-9.]{0,9}$/u.test(symbol)) throw new TypeError("pool transfer symbol is malformed");
  return symbol;
}

/** Extract exact ph1102 -> michael561 Hive Engine transfer intentions from
 * one raw `get_account_history` row. A foreign action in the same
 * custom_json suppresses the entire carrier so a broad batch can never be
 * mistaken for the narrow yield receipt. */
/** The pool's transfers to `beneficiary` (the delegating account whose history `row` is from). */
export function workerBeePoolTransfersFromHistoryRow(row, delegatedAt, beneficiary) {
  const pair = Array.isArray(row) ? row : [];
  const historyIndex = Number(pair[0]);
  const value = pair[1];
  const operation = value?.["op"] ?? value?.["operation"];
  if (!Array.isArray(operation) || operation[0] !== "custom_json") return Object.freeze([]);
  const envelope = operation[1];
  if (envelope?.["id"] !== "ssc-mainnet-hive"
    || JSON.stringify(envelope["required_auths"]) !== JSON.stringify([WORKER_BEE_POOL_ACCOUNT])
    || JSON.stringify(envelope["required_posting_auths"]) !== JSON.stringify([])) return Object.freeze([]);
  let decoded;
  try { decoded = JSON.parse(String(envelope["json"] ?? "")); } catch { return Object.freeze([]); }
  const actions = Array.isArray(decoded) ? decoded : [decoded];
  if (actions.length === 0 || actions.some((action) => action?.["contractName"] !== "tokens" || action?.["contractAction"] !== "transfer")) return Object.freeze([]);
  const timestamp = canonicalTimestamp(value?.["timestamp"]);
  const delegatedMs = Date.parse(delegatedAt);
  if (!Number.isFinite(delegatedMs)) throw new TypeError("delegation timestamp is malformed");
  if (Date.parse(timestamp) < delegatedMs) return Object.freeze([]);
  const transactionId = String(value?.["trx_id"] ?? "");
  const hiveBlock = Number(value?.["block"]);
  if (!Number.isSafeInteger(historyIndex) || historyIndex < 0 || !Number.isSafeInteger(hiveBlock) || hiveBlock <= 0
    || !/^[0-9a-f]{40}$/u.test(transactionId)) throw new TypeError("pool transfer Hive identity is malformed");

  return Object.freeze(actions.flatMap((action, actionIndex) => {
    const payload = action["contractPayload"];
    if (payload?.["to"] !== beneficiary) return [];
    const symbol = canonicalSymbol(payload["symbol"]);
    const quantity = canonicalQuantity(payload["quantity"]);
    const memo = String(payload["memo"] ?? "");
    return [Object.freeze({
      sourceId: `hive:${transactionId}:${actionIndex}`,
      historyIndex, hiveBlock, actionIndex, timestamp, transactionId,
      from: WORKER_BEE_POOL_ACCOUNT, to: beneficiary,
      symbol, quantity, memo,
    })];
  }));
}

function confirmedEngineEffect(candidate, result) {
  const rows = Array.isArray(result) ? result : [result];
  const expectedId = rows.length === 1 ? candidate.transactionId : `${candidate.transactionId}-${candidate.actionIndex}`;
  const row = rows.find((entry) => String(entry?.["transactionId"] ?? "") === expectedId);
  if (!row || row["sender"] !== candidate.from || row["contract"] !== "tokens" || row["action"] !== "transfer"
    || Number(row["refHiveBlockNumber"]) !== candidate.hiveBlock) return null;
  let payload; let logs;
  try {
    payload = typeof row["payload"] === "string" ? JSON.parse(row["payload"]) : row["payload"];
    logs = typeof row["logs"] === "string" ? JSON.parse(row["logs"]) : row["logs"];
  } catch { return null; }
  if (payload?.["to"] !== candidate.to || payload?.["symbol"] !== candidate.symbol
    || payload?.["quantity"] !== candidate.quantity || String(payload?.["memo"] ?? "") !== candidate.memo
    || payload?.["isSignedWithActiveKey"] !== true) return null;
  if (Array.isArray(logs?.["errors"]) && logs["errors"].length > 0) return null;
  const events = Array.isArray(logs?.["events"]) ? logs["events"] : [];
  const exact = events.filter((event) => event["contract"] === "tokens" && event["event"] === "transfer"
    && JSON.stringify(event["data"]) === JSON.stringify({ from: candidate.from, to: candidate.to, symbol: candidate.symbol, quantity: candidate.quantity }));
  const block = Number(row["blockNumber"]);
  if (events.length !== 1 || exact.length !== 1 || !Number.isSafeInteger(block) || block <= 0) return null;
  return Object.freeze({ block, identity: JSON.stringify({ payload, event: exact[0] }) });
}

/** A transfer becomes realized pool yield only when two independent Hive
 * Engine blockchain providers expose the exact executed effect. */
export function reconcileWorkerBeePoolDistribution(candidate, observations) {
  const confirmations = observations.flatMap((observation) => {
    const effect = confirmedEngineEffect(candidate, observation.result);
    return effect ? [{ provider: observation.provider, ...effect }] : [];
  });
  if (confirmations.length < 2) throw new Error("fewer than two Hive Engine providers confirm the exact pool distribution");
  if (new Set(confirmations.map((entry) => `${entry.block}:${entry.identity}`)).size !== 1) {
    throw new Error("Hive Engine providers contradict the pool distribution effect");
  }
  return Object.freeze({ ...candidate, status: "settled", hiveEngineBlock: confirmations[0].block, confirmationProviders: Object.freeze(confirmations.map((entry) => entry.provider).sort()) });
}

/** Shape settled distributions into durable event records. This function
 * does no file or network I/O and keeps no state between calls — a caller
 * that wants append-only, idempotent persistence supplies that itself
 * (e.g. by de-duplicating on `distribution.sourceId` before writing). */
export function recordPoolDistributionEvents(distributions, recordedAt = new Date().toISOString()) {
  const at = new Date(recordedAt).toISOString();
  return Object.freeze(distributions
    .filter((distribution) => distribution.status === "settled" && distribution.from === WORKER_BEE_POOL_ACCOUNT)
    .map((distribution) => Object.freeze({
      workerBeePoolDistributionSchema: WORKER_BEE_POOL_DISTRIBUTION_SCHEMA,
      eventId: `urn:workerbee-services-section:pool-distribution:${distribution.sourceId}`,
      recordedAt: at,
      distribution,
      valuation: Object.freeze({ swapHive: null, reason: "distribution-asset-not-independently-valued" }),
    })));
}
