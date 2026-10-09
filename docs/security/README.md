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
   stored participant of the commitment or holds domain authority
   (professor → academic, recruiter → career). A perfectly-formed
   "your interview is cancelled" from `spoof@evil.demo` dies here —
   covered by the eval corpus and integration tests.
4. **Confidence gate.** Below-threshold interpretations stop in
   WAITING_REVIEW; nothing executes.
5. **Provenance.** No candidate action is executable without tracing its
   authority to stored evidence (a recruiter-offered slot, a DELEGATABLE_TO
   edge, user policy). Denied unconditionally otherwise (PRD §22).
6. **Policy gate.** Deterministic verdicts; REQUIRE_APPROVAL and DENY can
   never transition into an executable action (property-tested, invariant 6).
7. **Scoped tools.** The agent holds narrow adapters, not credentials. The
   calendar adapter can move events on one calendar; it cannot read email.

An email can therefore *inform* Dira, but the blast radius of a malicious one
is bounded by what a legitimate one could do — and never exceeds the policy
table.

## Credentials

Production uses the Cloud Run service account through application default
credentials for Vertex AI, Firestore, and Calendar; no service-account key
file exists. The demo mutation token lives in Secret Manager. Local
live-model mode may use `GEMINI_API_KEY` through an untracked environment
file. The default replay needs no credential.

The Vercel browser never receives the demo token. A same-origin Next.js route
adds it on the server when proxying to Cloud Run. Production mutation and
evaluation routes require a constant-time token match; `/runs/latest` is also
protected. CORS is restricted to `DIRA_ALLOWED_ORIGIN`. Public `/health` and
`/status` responses contain only mode/readiness/count data, never the Calendar
ID, token, or raw workflow content.

The v2 personal-account path uses Google OAuth state plus PKCE, a signed
HttpOnly session cookie, and encrypted OAuth-token records (AES-256-GCM).
Refresh tokens remain server-side. Account, workflow, event, state, ledger,
and credential tables use forced Postgres row-level security with the account
context set transaction-locally. The database connection must use a dedicated
non-superuser role; PostgreSQL superusers can bypass row-level policies.
Google setup currently requests read-only Calendar access. Calendar mutation
scopes and per-user repair execution remain unimplemented.

## Auditability (PRD §48)

Every workflow persists: the triggering event, interpreted mutation, impact
records, violations, every candidate plan with its rejection reason, policy
verdicts per action, ledger transitions with timestamps, external responses,
verification reads, and final feasibility. No hidden chain-of-thought is
logged — only structured, inspectable decisions.
