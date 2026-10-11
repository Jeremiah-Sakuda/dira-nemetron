# Security & policy boundaries

## Threat model: the inbox is hostile

Emails are untrusted input that can contain instructions aimed at the AI
layer. Defense is layered and — critically — the decisive layers are
deterministic code the model cannot influence:

1. **Structured extraction only.** The interpreter's output must validate
   against a strict zod schema (`InterpretationResultSchema`). Free text
   never reaches the planner.
2. **Structural entity resolution.** A mutation may only reference a stored
   commitment id; anything else is rejected regardless of stated confidence.
3. **Sender authority.** A mutation is only accepted when the sender is a
   stored participant of the commitment, or the owner confirmed them as its
   authority (a user-provenance OWNED_BY edge) in a matching domain. A perfectly-formed
   "your interview is cancelled" from `spoof@evil.demo` dies here —
   covered by the eval corpus and integration tests.
4. **Confidence gate.** Below-threshold interpretations stop in
   WAITING_REVIEW; nothing executes.
5. **Provenance.** No candidate action is executable without tracing its
   authority to stored evidence (a recruiter-offered slot, a DELEGATABLE_TO
   edge, user policy). Denied unconditionally otherwise (PRD §22).
6. **Policy gate.** Deterministic verdicts; REQUIRE_APPROVAL and DENY can
   never transition into an executable action (property-tested, invariant 6).
7. **Scoped tools.** The engine holds narrow per-account adapters, not raw
   credentials, and every model output is data, never an instruction.
8. **Model plans are compiled, not trusted.** Ultra's repair plans cite typed
   provenance references that a deterministic compiler resolves against stored
   facts. The model cannot supply a recipient address, a message body, a duration
   or an executable action.

An email can therefore *inform* Dira, but the blast radius of a malicious one
is bounded by what a legitimate one could do — and never exceeds the policy
table.

## Credentials and tenancy

**Sessions and tokens:**
- Google OAuth uses state plus PKCE and a signed HttpOnly session cookie.
- OAuth tokens are encrypted with AES-256-GCM. Refresh tokens never leave the server.
- Scopes are granted one connector at a time: Calendar read, Calendar write, Gmail read, and Gmail drafting (`gmail.compose` plus read-back).

**Tenancy:**
- Every tenant table uses forced Postgres row-level security, with the account set transaction-locally.
- The app connects as a non-superuser role, because superusers bypass row-level security. CI runs the integration suite under that role.
- Demo sessions are ordinary accounts of kind `demo`, so they are isolated the same way.

**Secret handling:**
- Hermes tokens and Telegram nonces and link codes are stored only as SHA-256 hashes.
- Telegram webhooks must carry the configured secret-token header.

## Outbound actions

- **Recipients** must be stored stakeholders of the commitment the message concerns, at the stored address. Policy enforces this, and the mail adapter checks it again.
- **Bodies** are templates over stored facts, never model text. Every message says Dira sent it on the owner's behalf.
- **Draft-only** is the default for real accounts.
- **Deterministic Message-IDs** let a crashed send be recovered by searching for its id instead of sending again.
- **Approvals** are revalidated against freshly read state and the current policy version before anything runs.

## Network boundary

The broker's process-wide fetch guard allows only the hosts Dira needs. Anything else gets a synthetic 403 and an audit row (`dira_egress_audit`). Each Hermes sandbox runs under an OpenShell default-deny policy with `enforcement: enforce` (`infrastructure/openshell`).

## Auditability (PRD §48)

Every workflow persists: the triggering event, interpreted mutation, impact
records, violations, every candidate plan with its rejection reason, policy
verdicts per action, ledger transitions with timestamps, external responses,
verification reads, and final feasibility. No hidden chain-of-thought is
logged — only structured, inspectable decisions.
