# Google OAuth and actual provider verification

Status (October 16): Calendar/Gmail APIs are enabled in `dira-prod`. The owner created the separate v2 OAuth client and saved its credentials privately. Backend Secret Manager version 4 is deployed on revision `dira-nemetron-backend-00009-c6h`; database, encryption, signing, inference and scheduler configuration were preserved. The selected personal account is already a test user. Owner consent and real synthetic Calendar/Gmail changes remain pending. Automatic Calendar/Gmail syncing is off.

Public verification exposed immutable redirect headers in the frontend OAuth routes: adding cookies to native `Response.redirect()` threw an exception. Commit `a5309fa` constructs mutable redirect responses for sign-in, incremental permissions and callback success/error paths. Eight OAuth regression checks reproduced the bug and passed after the fix; two existing session checks and root TypeScript checking also passed. The production frontend deployment `dpl_ELY3qQXHnti92G79fpQHQQYAjMXs` is ready. Public checks verify the saved client and exact callback, S256 PKCE, secure HttpOnly state cookie, cancellation state clearing, and 401 rejection of unauthenticated incremental permission starts. Chrome reached the personal account chooser and Google's unverified test-app warning; the owner must complete warning/consent. See [non-secret setup evidence](../evidence/2026-10-16-google-oauth-setup.json).

The shared Google Auth Platform branding currently links to legacy `dira-prod.vercel.app` privacy/terms pages. Review v2 branding and policy links before public OAuth launch; the separate client does not by itself create a separate consent brand.

## Exact client configuration

Use Google Auth Platform → Clients → Web application. Keep the v2 client separate from legacy Dira clients.

- Name: `Dira Nemotron judge demo`.
- Designate this dedicated client for an AI-powered agent. Dira uses it for owner enrollment into automated workflows; do not reuse the legacy standard web client. Google documents separate clients for standard interactive features and agent workflows in [OAuth client guidance](https://support.google.com/cloud/answer/15549257#agentic-client).
- JavaScript origin: `https://dira-nemetron.vercel.app`.
- Authorized redirect: `https://dira-nemetron.vercel.app/api/auth/google/callback`.
- Initial scopes: OpenID, email/profile, `calendar.settings.readonly`, `calendar.readonly`.
- Incremental Calendar change scope: `calendar.events`.
- Incremental mail scopes: `gmail.readonly`, then `gmail.compose`.
- Add only the chosen controlled test account while the OAuth app is in Testing.
- Put `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in ignored workspace `.env.google`, mode 0600. Merge them into the backend's Secret Manager configuration and deploy its pinned secret version. Never put these in chat, screenshots, Git, or Vercel frontend environment variables.

The user completes login, credential creation and Google consent in the browser. Configuration values above are ready for review. The callback proxy rewrites the state-cookie path to `/api/auth/google`; PKCE and signed state stay enabled.

## Controlled source-to-read-back check

1. Select a clean user-owned test account and one recipient the owner controls. Keep unrelated inbox/calendar data outside recordings and public evidence.
2. Create clearly labeled synthetic Calendar events in that account: one fixed review session and one flexible test block. Import and review only those items. Confirm their graph, owner, flexibility and source authority; enter effort estimates yourself.
3. Grant Calendar write separately. Change the source session so it overlaps the flexible block; sync the source and review the proposed repair.
4. Confirm that the broker has recorded `AWAITING_APPROVAL` and no provider mutation occurred. Approve in the authenticated web inbox. Verify schema/provenance, fresh-state feasibility, current policy verdict and durable ledger entry.
5. Read Google Calendar independently and compare provider event IDs, timestamps, modification markers and expected state. A successful API write response alone is insufficient.
6. Grant Gmail read/compose separately. Keep draft-only enabled for the first mail test. Confirm only the controlled recipient as a stored stakeholder; verify the deterministic disclosure-bearing draft by a separate Gmail read.
7. For an actual send, review the exact draft and recipient, disable draft-only through the authenticated owner setting, approve its intended workflow action, then verify the resulting message/thread and deterministic message identifier by fresh Gmail read. A model or Hermes cannot approve this.
8. Publish only synthetic/redacted metadata: timestamp, scope names, action type, policy verdict, approval source, execution/read-back status and hashed provider identifiers. Preserve private provider details outside Git. Remove test artifacts only with the owner's authorization.

Do not call the full integration verified until both actual provider paths have completed. A simulator, adapter unit test, OAuth redirect or model catalog response does not establish this result.

## Persistence limitation

An external Google OAuth app in **Testing** generally receives refresh tokens expiring after seven days when it requests Calendar/Gmail scopes. That requires reauthorization and must be addressed before promising continuous real-account operation through December 15. The no-sign-in judge replay is independent of Google OAuth.

Sources: [Google OAuth web-server flow](https://developers.google.com/identity/protocols/oauth2/web-server), [Google refresh-token limitations](https://developers.google.com/identity/protocols/oauth2#expiration).
