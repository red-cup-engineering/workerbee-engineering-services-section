# WorkerBee Services Section

<!-- 561-group-standards:badges:start -->
[![Red Cup Engineering](https://img.shields.io/badge/561%20Group-Red%20Cup%20Engineering-c0392b)](https://github.com/red-cup-engineering)
[![License: MIT](https://img.shields.io/badge/license-MIT-c0392b)](LICENSE)
[![Indigenous data: CARE](https://img.shields.io/badge/Indigenous%20data-CARE-4b6f44)](https://github.com/red-cup-engineering/.github/blob/main/GOVERNANCE.md)
[![Tips welcome](https://img.shields.io/badge/tips-welcome-d4a017)](https://github.com/561-group/.github/blob/main/TIPS.md)
<!-- 561-group-standards:badges:end -->

WORKERBEE is a Hive-Engine token whose only productive use is mining BEE
through Hive-Engine's `mining` contract: an account stakes WORKERBEE, then
delegates it to a mining pool account (this fleet uses the no-fee `ph1102`
pool), and the pool periodically distributes mined BEE back to its
delegators. This service plans that stake-and-delegate conversion and
settles the pool's resulting distributions.

## What this service does

- `src/yield.mjs`'s `planWorkerBeeYield` — given an observed WORKERBEE
  contract state, balance, pending-release rows, pool terms, and live BEE
  and WORKERBEE order-book bids, plans self-staking and delegating the
  full liquid balance to the pool in one batched `custom_json`. It refuses
  (never throws) if the token's contract terms or the pool's mining terms
  have drifted from what this fleet has previously confirmed, a pending
  unstake/undelegation exists, no liquid balance remains, the balance
  exceeds a hard 10.00000 WORKERBEE signer cap, or the live bid books
  cannot value both the annual expected BEE output and the full WORKERBEE
  position at full integrated depth. `statesAgree` confirms two
  independent observations are the same evidence.
- `normalizeEngineTransactionInfo` — Hive Engine returns one row for a
  single call and an array of child rows for a batched custom_json; this
  normalizes both shapes without discarding per-child identity, so a
  successful first leg of a batch is never mistaken for the whole batch
  having executed.
- `src/pool.mjs`'s `workerBeePoolTransfersFromHistoryRow` — extracts
  candidate `ph1102 -> michael561` Hive-Engine transfers from a raw Hive
  account-history row, narrowly: a foreign action anywhere in the same
  custom_json suppresses the entire carrier, so a broad batch (one this
  fleet did not construct) can never be mistaken for the pool's own narrow
  yield distribution.
- `reconcileWorkerBeePoolDistribution` — a candidate transfer becomes
  `settled` only when two independent Hive-Engine blockchain providers
  expose the exact same executed effect (sender, contract call, payload,
  and a single matching `tokens.transfer` event); disagreement or a single
  witness leaves it unsettled.
- `recordPoolDistributionEvents` — shapes settled distributions into
  durable event records with a `sourceId`-derived, deterministic
  `eventId`. It performs no file or network I/O and keeps no state between
  calls; a caller that wants append-only, idempotent persistence
  de-duplicates on that `eventId` itself.

`stakeOperation`/`delegateOperation`/`batchOperations` only *encode*
Hive-Engine `custom_json` operations; nothing in this package signs or
broadcasts one.

## What this service deliberately does not do

It never unstakes, undelegates, transfers, or trades WORKERBEE or BEE — the
only action this package can plan is the one bounded stake-then-delegate
batch. It also invents no valuation for a settled distribution
(`recordPoolDistributionEvents`' event records carry
`valuation: { swapHive: null }` explicitly, rather than a guessed price),
and it never signs or broadcasts.

## Migration status

Ported from `aagaard`'s `scripts/workerbee-yield.mjs` (the pure planning
and normalization functions; the script's HTTP polling, key-file
verification, and broadcaster subprocess call stayed in aagaard) and, in
full, `aagaard`'s `src/core/workerBeePoolSettlement.mts` — except its
`readWorkerBeePoolDistributions`, which in aagaard unconditionally throws
("distributions must be re-collected from Hive Engine; local projections
are retired") and was not ported since it does nothing a caller could use.
`recordPoolDistributionEvents` here also differs from aagaard's
`recordWorkerBeePoolDistributions`/`readWorkerBeePoolDistributions` pair
in one deliberate way: aagaard's version took a `dataDir` parameter but
did no actual file I/O with it (a stale signature from before local
projections were retired) and aagaard's own test for it currently fails —
`node --test test/workerBeePoolSettlement.test.mts` in aagaard fails one
of four tests, expecting a second recording call to return zero new events
with no de-duplication mechanism to produce that. This module's version
drops the unused `dataDir` parameter and is documented, and tested, as the
pure shaping step it actually is: repeat calls on the same input reproduce
the same `eventId` so a caller can de-duplicate, rather than claiming
idempotency it cannot provide on its own.

`stakeOperation`, `delegateOperation`, and `batchOperations` duplicate a
small slice of aagaard's shared
`src/integrations/hive-engine/hiveEngineOps.mjs` encoder rather than
depending on aagaard's package from a sibling section — see the parent
section's README for that duplication and the extraction it should
eventually become.

## Verification

```sh
npm test
```
