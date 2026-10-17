# Migration and sandbox verification — October 16, 2026

**The public Vercel app now uses Cloud Run and Neon. Both Nebius VMs and their managed boot disks are deleted after verified recovery. Google OAuth and actual Calendar/Gmail changes are not yet verified.**

## Production recovery and cutover

- Quiesced the old broker before the final snapshot. Copied database and memory archives off the VM, mode 0600, outside Git. The snapshot contained zero retained accounts, ledger rows and OAuth credentials, and 18 inference reservations.
- Restored the final snapshot to Neon Free in `iad1`. The runtime uses a separate role with neither superuser nor RLS bypass and certificate-verified direct connections. Direct connections preserve the session advisory lock used by startup migrations.
- Verified seven archived private Git repositories with full Git integrity checks. They belong to expired synthetic accounts and were not recreated as active accounts.
- Seven Neon recovery/isolation/scheduler checks and five broker/approval/read-back checks passed. Two broker checks initially exceeded the local 30-second timeout; all five passed using a 120-second remote-database timeout (215.43 seconds for the suite).
- Replaced the native Cloud Run revision twice during recovery checks. Signed account state and a byte-identical private Git bundle survived. A live-model workflow's approval hold and action records also survived replacement.
- Through the public Vercel endpoint: live Super/Ultra processing held execution with zero verified actions before approval. Authenticated web approval then resolved the workflow with 13 actions verified by simulated-adapter read-back, one recovered conflict and final slack of 78 minutes. These are synthetic integrations, not actual Google changes.
- Preserved the 18 original inference reservations; the public flow added three, leaving 21 lifetime and three current rolling-day/hour calls. Admission limits remain 100 total, 20 rolling-day, 12 rolling-hour and two concurrent. Separate temporary sandbox inference calls are outside this application ledger.
- Cloud Scheduler is enabled every fifteen minutes; actual delivery logs show HTTP 200. The endpoint rejects missing/wrong credentials and caller-selected action/account input. No real connector accounts are scheduled until owner setup and opt-in.
- Public `/try` and `/evidence` returned 200 after stopping both VMs. No Vercel sign-in is required at the production alias.

Final production backend revision: `dira-nemetron-backend-00008-dq9`; image/source identifiers and backup hashes are in the [machine-readable evidence](2026-10-16-serverless-and-sandbox.json).

## Additional recovery hardening

A fresh backup of the migrated Postgres 18 database was restored into a disposable local Postgres 18 instance. It retained all 21 inference reservations, 13 verified actions, and identical Git commits, complete object graph and checked-out contents. Repacked bundle bytes differ between the Cloud and local Git implementations; semantic history/content equality was verified separately. Byte equality across identical Cloud Run revisions was also observed earlier. The disposable container was removed.

A new regression check exposed that normal Git clone drops custom references outside branch heads/tags, including imported history under `refs/imported/*`. Commit `0c19197` explicitly fetches every stored reference before saving another bundle. The regression failed before the fix and all seven memory/recovery checks passed afterward; TypeScript checking passed. The fix was deployed to the final production image and verified through the public memory-export endpoint using an independent imported commit; the synthetic fixture was deleted.

## Isolated NVIDIA runtime checks

Installed maintained NemoHermes **0.0.135**, source `7a099aeb4f6678d9b9ce6236535e7b41b03c81a2`, with OpenShell **0.0.116** on the separate Linux VM. No Google credentials were supplied. The measured image ID and effective policy hash are recorded in the evidence JSON.

| Observed check | Result |
| --- | --- |
| Dira health from the Hermes Python runtime | 200, expected response body |
| Forbidden host | Proxy CONNECT denied, matching OCSF denial |
| Disallowed method and path | 403, matching L7 denials |
| Direct public IP and metadata IP | Connections refused; no metadata body read |
| Standalone unlisted curl | CONNECT denied 403 |
| Curl spawned by allowed Python | Allowed, matching NVIDIA's executable-ancestor matching semantics; destination and L7 restrictions remain in force |
| Synthetic Skill under `/opt/hermes`, mode 0666 | Readable, workload write denied, unchanged contents |
| Landlock | ABI V2; 13 rules applied, two paths skipped; required Skill path protection measured directly |
| Nebius Super through `inference.local` | HTTP 200, 20 prompt + 50 completion tokens, finish `stop`; real provider key absent from scanned sandbox environment/config |
| Managed Dira MCP | Registered; on-wire credential resolution 200, unauthenticated control 401; native config contains only a resolver placeholder |
| MCP approval/send tools | OpenShell 403 with matching MCP-tool denial logs |
| Relayed owner change | One pending note, zero broker actions; owner confirmation still required |
| Restart | Policy hash and managed MCP credential resolution preserved |

The MCP account was an operator-provisioned **synthetic test fixture**, not evidence of Google sign-in. Its temporary token was revoked afterward; a fresh request returned 401. A conflicting REST/MCP entry on the same host was rejected during initial registration; registration succeeded after removing the overlap. [NVIDIA documents ancestor matching](https://docs.nvidia.com/openshell/latest/how-it-works/policies/schema) and [managed MCP credential custody](https://docs.nvidia.com/nemoclaw/latest/user-guide/hermes/manage-sandboxes/mcp-servers/add-an-mcp-server).

See the [selected enforcement events](2026-10-16-openshell-enforcement.txt). Direct connection refusals are recorded separately from proxy/OCSF denials. Raw host credentials, private account records and full logs remain excluded from Git.

**Scope:** this validates the separate sandbox. It does not install OpenShell around the public Cloud Run broker or leave an always-running Hermes chat service. The public app retains its deterministic broker and application egress guard. Setup templates were corrected to preserve generated runtime rules and use managed MCP; script syntax and network-narrowing output were checked. The rewritten host Skills mirror was not rerun end to end; it now verifies workload write denial before reporting success.

## Cost and remaining work

The validation VM ran for less than 29 minutes. At the previously quoted approximately $0.15/hour, that is about **$0.07**, before taxes or billing adjustments, below the approved $0.50 cap. This is an estimate, not an invoice. An automatic API stop was armed; manual stop completed before its deadline. Both VMs are confirmed stopped, and the stop watchdog exited.

After explicit owner approval, deleted both stopped VMs and their managed 80 GiB and 64 GiB boot disks. Fresh Nebius API reads return `NotFound` for all four exact resource IDs, recorded in the evidence JSON. Final database/memory backups remain privately retained off-VM. After deletion, `/try`, `/evidence`, credential-free replay completion, fresh authenticated demo state and private-memory export all passed; the new synthetic fixture was deleted afterward without model calls. An earlier demo session returned 401, so it was not treated as fresh persistence evidence. These resources no longer accrue VM compute or disk storage usage; previously accrued charges may still appear on the bill. Vercel Hobby and Neon Free are selected; Google Cloud allowances are shared by billing account and do not establish a hard zero-dollar guarantee. The old VM's nightly backup job is no longer running; final archives are local, and ongoing Neon recovery coverage is subject to its plan limits.

The separate Google web OAuth client is created and its credentials are deployed through backend Secret Manager version 4. The frontend OAuth cookie redirect bug is fixed and deployed; eight new OAuth regression checks and two existing session checks passed. Public redirect/PKCE/cookie/cancellation guards are verified. Owner consent, synthetic source changes, authenticated approval, and independent Calendar/Gmail read-back remain pending. No Google completion claim is made. The official [rules](https://nebiusglobalaihackathon.devpost.com/rules), rechecked October 16, allow runtime Token Factory use with hosting elsewhere. Submission remains due October 30 at 10 AM Pacific, with free judge access through December 15.
