# Queue jobs plan

BullMQ job plan for Hanuja asynchronous workflows.

## Candidate jobs
- payment callback processing
- shipment status sync
- delivery confirmation timer check
- payout eligibility scan
- payout batch creation
- refund deduction application
- search index updates
- media cleanup and backfill

## Rules
- job payloads must be idempotent where possible
- finance jobs must be auditable
- retry policy must be explicit for payment and payout workflows
