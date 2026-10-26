# Isolated staging coordinator service

This template is not installed or enabled. It is not a deployment authorization.

The service runs `scripts/film-coordinator-service.mjs`, which serially discovers at most four runs and permits at most twelve ticks per run per pass, then waits thirty seconds. Existing database leases, approvals, pricing, spending caps and worker gates remain authoritative. A disabled server response stops the process. HTTP/schema/ownership uncertainty stops with a failure exit; `Restart=no` deliberately prevents automatic replay until an operator investigates.

The required `.env.film-coordinator` file is absent by default. `scripts/systemd/film-coordinator.env.example` sets both gates to zero and uses staging loopback port 3055. The existing worker secret is inherited from `.env.local`; do not copy secrets into the unit, command line, examples, logs or source control. Keep any actual override file owned appropriately and mode 0600.

Before separately authorized activation:

1. Verify the source/build, bounded model pricing, approved project cap, provider access, canonical media origins, and actual staging worker configuration.
2. Inspect every queued run. Do not activate against stale or unexplained paid work.
3. Install this unit only for the isolated staging working directory and prepare the required private override file. Keep gates zero until explicit approval covers real generation and maximum spending.
4. Validate with `systemd-analyze verify` and a no-generation synthetic rehearsal. The application server must independently allow coordination; service overrides cannot bypass its gates.
5. Only after approval, activate and monitor the first representative run. Do not automatically deploy or point this unit at production.

SIGTERM/SIGINT aborts the current fetch or idle wait. The service has a twenty-second stop deadline. Stopping the coordinator does not assert that an already-submitted provider job was cancelled or refunded; inspect its durable status and use the project's pause/cancel controls. Lease expiry and job idempotency protect later ownership changes. Do not restart after an ambiguous failure without checking persisted job state.

This service does not supply missing prices/providers, approve final review, start final export automatically, or mark a film run complete. Those remain separate implementation gates.
