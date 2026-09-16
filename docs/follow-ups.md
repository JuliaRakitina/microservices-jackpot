# Follow-ups in dependency order

1. **Deployment identity:** separate broker/service credentials and ACLs, TLS/mTLS, rotation and managed secrets before leaving a trusted local network.
2. **Recovery operations:** authenticated failure inspection, audited operator actions and reconciliation reports. No automatic refund until cancellation/settlement ordering is designed and tested.
3. **Data lifecycle:** retention/archival only after replay horizons are defined; ledger exports, backup/restore drills and migration upgrade scenarios.
4. **Availability:** multi-node broker and database failover tests. Local restart recovery does not establish HA.
5. **Capacity evidence:** benchmark the serialized pool reproducibly, then decide whether independent pools are justified. No invented throughput figures.
6. **Identity operations:** distributed rate limits, account recovery and fully tested sessions/token revocation if requirements demand them.

Legacy-data import, old API compatibility, regulated gaming, real-money integrations, frontend and cloud orchestration are outside this deliverable.
