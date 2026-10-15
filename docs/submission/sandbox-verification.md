# NemoClaw/OpenShell validation handoff

Status: the separate 4 vCPU / 16 GiB / 64 GiB Ubuntu 24.04 VM is stopped. Its SSH public key is attached. On October 15 the owner authorized this isolated VM for validation, capped at **$0.50** from the existing Cloud balance, followed by stopping it. Nebius CLI `0.12.291` is installed locally; owner sign-in and a timed API stop must be ready before starting. The judge VM runs application/broker egress protection, not OpenShell network enforcement. Installation, sandbox startup, inference routing and actual network checks remain pending.

## Bounded execution

Use the existing validation VM within the owner's approved cap. Verify the current hourly quote and establish a timed API stop with enough margin before starting; a local guest shutdown is insufficient because the instance recovery policy can restart it. Use a short validation window rather than consuming the full allowance. Record its new public address after start. Use the maintained NVIDIA NemoClaw release; record exact NemoClaw/OpenShell versions, image digests and policy hash. Install from NVIDIA's official source, without any Dira/Google credentials in the agent filesystem. Onboard Hermes against `https://api.tokenfactory.nebius.com/v1` using the existing host-held Token Factory key. Supply it through host environment/stdin, never argv or logs.

Use the installed CLI's current help and matching version documentation. The checked-in setup script and policy are starting templates, not proof of a working sandbox. Register Dira's read/report MCP through managed `nemohermes <sandbox> mcp add ... --env DIRA_HERMES_TOKEN`; it creates a binary-scoped policy and OpenShell credential placeholder. Inspect with managed MCP status. Preserve the generated policy's filesystem paths and runtime binary rules when tightening it. A failed generic `curl` alone does not establish that Hermes can or cannot reach MCP.

## Required evidence matrix

| Check | Required observed result |
| --- | --- |
| Sandbox running | Exact runtime/version, active policy hash, enforcement mode |
| Allowed Dira route | Managed status probe succeeds from the Hermes runtime; response is from Dira |
| Host-held inference | Actual Super response through `inference.local`; provider key absent from sandbox environment, config and files |
| Outside collector | HTTPS attempt from the allowed agent runtime is denied; matching OpenShell enforcement log |
| Direct public IP / alternative binary | Attempts denied unless specifically authorized; record DNS and proxy behavior |
| Cloud metadata | `169.254.169.254` cannot be reached; no credentials or metadata body is collected |
| Method/tool controls | Disallowed HTTP methods/MCP tools fail with logged enforcement |
| Approval boundary | Hermes cannot approve or call a mutation tool; the broker requires authenticated owner approval |
| Filesystem | Mirrored Skills can be read but cannot be overwritten by the agent |
| Restart | Policy, attached providers and credential custody survive restart; repeat positive and negative checks |

Record target, runtime binary, exit/status, bounded response metadata and log correlation. Distinguish policy `audit` (logs but allows) from `enforce` (blocks). Do not use an application-level 403 as evidence of OpenShell network isolation.

Stop the VM in Nebius after collecting results and verify console state **Stopped**. Preserve private logs/snapshots and publish only redacted evidence. A successful test on this VM does not activate OpenShell on the judge VM or establish a production multi-account deployment.

References checked October 13: [Hermes quickstart](https://docs.nvidia.com/nemoclaw/latest/user-guide/hermes/get-started/quickstart), [managed MCP and credentials](https://docs.nvidia.com/nemoclaw/latest/user-guide/hermes/manage-sandboxes/mcp-servers/add-an-mcp-server), [NVIDIA policy example](https://github.com/NVIDIA/OpenShell/blob/main/examples/sandbox-policy-quickstart/policy.yaml).

October 15 operational references: [official Nebius CLI installation and user sign-in](https://docs.nebius.com/cli/install), [instance recovery policy and guest shutdown](https://docs.nebius.com/terraform-provider/reference/resources/compute_v1alpha1_instance).
