# Event status model

Defines event and status semantics for the Hanuja domain.

## Key points
- statuses are not interchangeable with events
- `delivery_confirmed` is the payout timer start condition
- state transitions must be explicit and validated
- admin override events should be distinguishable from normal automated transitions

## Candidate entities
- order
- shipment
- return
- refund
- payout
- seller ledger entry

## Required outputs
- allowed transitions
- triggering actor or system
- side effects
- audit log requirement
