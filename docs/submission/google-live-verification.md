# Google OAuth and actual provider verification

Status: Calendar/Gmail APIs are enabled in `dira-prod`. The deployed OAuth client fields are empty. Google Cloud console login and creation/configuration of a web OAuth client are pending; no real Calendar or Gmail changes have been verified.

## Exact client configuration

Use Google Auth Platform → Clients → Web application. Keep the v2 client separate from legacy Dira clients.

- Name: `Dira Nemotron judge demo`.
- JavaScript origin: `https://dira-nemetron.vercel.app`.
- Authorized redirect: `https://dira-nemetron.vercel.app/api/auth/google/callback`.
- Initial scopes: OpenID, email/profile, `calendar.settings.readonly`, `calendar.readonly`.
- Incremental Calendar change scope: `calendar.events`.
- Incremental mail scopes: `gmail.readonly`, then `gmail.compose`.
- Add only the chosen controlled test account while the OAuth app is in Testing.
- Put `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in ignored `infrastructure/nebius/dira.env`, mode 0600. Never put these in chat, screenshots, Git, or the web container.

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
