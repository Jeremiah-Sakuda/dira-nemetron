# Feedback on Nebius and NVIDIA tooling

Written during the Dira v2 build, October 2026. Each item says what we observed, how to reproduce it, and what would help. Items marked *from docs* are based on reading the official documentation for deployment scripts rather than on a live run. We say so instead of guessing at behavior.

## Nebius Token Factory

1. **The structured-output request shape is ambiguous.** *From docs.* The JSON-mode page (`docs.tokenfactory.nebius.com/ai-models-inference/json.md`) shows the raw JSON Schema passed as the `json_schema` value. It also shows the OpenAI shape `{ "name", "schema", "strict" }`. It never says which one the server requires, or whether that differs per model. Some snippets have syntax errors: missing commas, and `"response format"` written with a space. Copying them fails before the request is sent.
   - **Repro:** paste the first Python example into a file and run it.
   - **Ask:** a single canonical request per model family, a table of models that honor `strict`, and runnable snippets.
2. **Model ids are hard to confirm without an API call.** *From docs.* The Nemotron catalog page lists the models, but the exact ids, including their casing, appear only in URL-encoded playground links. The live prices page is rendered client-side.
   - **Effect:** we added `npm run models:check`, which lists `GET /v1/models` and checks every configured id before deployment.
   - **Ask:** a static, copyable id, context and price table per model.
3. **Zero data retention is an organization setting, not a request flag.** *From docs.* Dira processes personal email, so we want to refuse to send mail content unless zero retention is on. There is no documented way to check that setting through the API.
   - **Ask:** expose the organization's retention mode in a response header or an account endpoint, so a client can fail closed.
4. **Tier routing works well with the OpenAI-compatible API.** A single client with a per-call model id let us route Nano, Super and Ultra jobs and attribute usage per tier from `usage` in each response. No change requested.

## Nebius AI Cloud

5. **Serverless Jobs have no schedule.** *From docs.* The docs describe jobs as "one-off or scheduled", but `nebius ai job create` has no schedule or cron flag, and no scheduling procedure is documented. Our scripts propose launching the daily pass from cron; this job deployment has not yet been run. The former VM nightly backup cron was configured, then stopped when that VM was retired. Current background delivery uses authenticated Cloud Scheduler to Cloud Run every fifteen minutes.
   - **Ask:** a schedule field, or documentation that scheduling is out of scope.
6. **CPU-only jobs are unclear.** *From docs.* The job platform defaults to a GPU platform, and non-GPU VMs are described as supporting only the regular type. Our daily recompute needs no GPU.
   - **Ask:** state whether `cpu-d3` is a valid job platform.

## NVIDIA OpenShell

7. **The default enforcement mode is `audit`.** *From docs.* The schema sets `enforcement: audit` by default for network endpoints, which logs but allows. A policy author who copies an example without that line ships an allowlist that blocks nothing. Every endpoint in our policy sets `enforcement: enforce`.
   - **Ask:** default to `enforce`, or warn in `openshell policy set` when a policy has audit-only endpoints.
8. **The denial response for plain HTTPS is not documented.** *From docs.* MCP and WebSocket rule denials are documented as HTTP 403. For ordinary HTTPS egress the docs say `policy_denied` without a status code or body. Agent code and our demo need to recognize the denial.
   - **Ask:** document the status code and body.
9. **Denial logs are capped at 2,000 in-memory lines.** *From docs.* That is not an audit trail. Dira keeps its own durable egress audit for the broker.
   - **Ask:** an option to stream OCSF events to a file or sink.

## NVIDIA NemoClaw and Hermes

10. **MCP over HTTPS only is a good default, but it complicates local development.** *From docs.* `nemohermes <sb> mcp add` accepts only Streamable HTTP over HTTPS, and private hosts must resolve to RFC1918 or similar ranges (`host.docker.internal` is rejected). Developing a tool server on a laptop therefore needs a TLS tunnel.
    - **Ask:** a documented local-development exception, or a recipe.
11. **Custom provider variable names appear only in search snippets.** *From docs.* For an OpenAI-compatible provider such as Token Factory, the endpoint and model variable names were not on the official page we could read.
    - **Ask:** put the full non-interactive variable list on the inference options page.
12. **Hermes approvals are text replies.** *From docs.* Exec approvals in the Telegram gateway are "yes"/"no" messages the agent reads. For a personal agent that can act on email and calendars, an approval should not pass through the model. Dira therefore runs its own bot whose inline buttons carry single-use nonces checked outside any model.
    - **Ask:** a first-class, model-bypassing approval callback in NemoClaw.


## October 18 local runtime observation

13. **Onboarding bridge reachability needs a narrower diagnostic.** *Observed.* Official NemoHermes0.0.135/OpenShell0.0.116 installed inside an isolated Ubuntu24.04 ARM Colima VM with no host-directory mounts. Docker DNS/preflight worked, and the authenticated TLS gateway listened on loopback, but onboarding failed the Docker-bridge callback probe. `lsof` helped identify listeners. We did not disable TLS/JWT/network protection; an internal diagnostic relay was removed and no owner enrollment was claimed.
    - **Ask:** report expected versus actual listen interfaces/callback route and missing diagnostic prerequisites. Document a supported authenticated narrow bridge listener for this configuration.
