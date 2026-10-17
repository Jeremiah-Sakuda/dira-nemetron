# Google OAuth and actual provider verification

Status (October 16): **Actual Calendar verification passed.** The owner completed sign-in and separate Calendar-events consent. Two synthetic events were created and independently read back. A real source change flowed through deployed sync, authenticated graph review, deterministic feasibility/policy, durable approval hold, authenticated web approval, broker execution and independent Google read-back. One action is `VERIFIED`, workflow `RESOLVED`; a separate operator GET confirmed the flexible block moved to 12:00–13:00 while the fixed meeting remained at 11:00–12:00. No broker mutation occurred before approval. [Actual Calendar evidence](../evidence/2026-10-16-google-calendar-live.json).

Live verification exposed and fixed the OAuth redirect cookie error, unsupported deadline-feed SQL function, absent Calendar-only overlap repair, unstable sub-minute horizon rebasing and browser-timezone focus-hour labels. Regression coverage: 3 scratch-database, 27 planner/constraint/replay and 13 web checks; root TypeScript checking and production builds passed. Backend `dira-nemetron-backend-00012-h5k`, frontend `dpl_BsYGdRGbRZQDU7Q1G3RwWdZMM5fA`. Credentials remain backend-only in Secret Manager version 4.

**Actual Gmail draft verification also passed.** The owner completed read/compose consent. A labeled operator-provisioned synthetic plan completed authenticated web approval, fresh feasibility/policy revalidation, broker draft creation and independent Gmail read-back. Recipient and complete body matched, the disclosure was present, `DRAFT` was present and `SENT` absent. A separate recovery approval reused the original draft without duplication. This verifies the outbound draft path, not Gmail inbox interpretation or sending. [Actual Gmail evidence](../evidence/2026-10-16-google-gmail-live.json).

The first real draft exposed Gmail replacing RFC `Message-ID`. The old verifier stopped safely at `REPLAN_REQUIRED`; the repair uses a durable provider receipt with fresh GET, a preserved idempotency header and bounded targeted recovery search. Exact recipient/body checks reject extra recipients, CC/BCC and partial body matches. Seventeen focused checks and root TypeScript checking passed. Current backend: `dira-nemetron-backend-00013-j4w`, source `1e58853`. Event-repair revalidation is recorded in durable flight records; its approval object does not currently carry the schedule-request path's evidence hash. Recovery search depends on provider indexing; do not claim universal exactly-once mail delivery.

Draft-only remains enabled and Google background sync stays off. Two synthetic Gmail drafts remain for owner inspection. The two marked Calendar events were deleted, independently confirmed cancelled, and their fixture commitments marked dropped; the synthetic self-addressed test contact was removed. The shared Google consent brand still links to legacy privacy/terms pages and needs review before public OAuth launch.

Setup was reorganized into Connections, Focus hours and Review commitments, with separate permission cards and optional disclosures. Desktop and 390-pixel mobile layouts were visually checked; tab keyboard navigation and zero horizontal overflow were verified. Frontend `dpl_dapViiBiKYZakHGrJmXvcfabnp86`, source `86674f6`, is live. [Synthetic desktop preview](../evidence/ui/2026-10-16-setup-desktop.jpg), [mobile preview](../evidence/ui/2026-10-16-setup-mobile.jpg).

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
7. For an actual send, separately authorize the exact recipient and message, review the draft, disable draft-only through the authenticated owner setting, approve its intended workflow action, then verify the provider message, labels and complete content by fresh Gmail read. A model or Hermes cannot approve this. Sending was not part of the completed test.
8. Publish only synthetic/redacted metadata: timestamp, scope names, action type, policy verdict, approval source, execution/read-back status and hashed provider identifiers. Preserve private provider details outside Git. Remove test artifacts only with the owner's authorization.

Do not call the full integration verified until both actual provider paths have completed. A simulator, adapter unit test, OAuth redirect or model catalog response does not establish this result.

## Persistence limitation

An external Google OAuth app in **Testing** generally receives refresh tokens expiring after seven days when it requests Calendar/Gmail scopes. That requires reauthorization and must be addressed before promising continuous real-account operation through December 15. The no-sign-in judge replay is independent of Google OAuth.

Sources: [Google OAuth web-server flow](https://developers.google.com/identity/protocols/oauth2/web-server), [Google refresh-token limitations](https://developers.google.com/identity/protocols/oauth2#expiration).
