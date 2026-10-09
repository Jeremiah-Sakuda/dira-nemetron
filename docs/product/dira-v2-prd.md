Dira v2 PRD: Personal AI Track
Oct 8, 2026 · @Jeremiah Somoine · Nebius x NVIDIA Global AI Hackathon, deadline Oct 30, 2026
Summary
Dira v2 turns the August hackathon build into a personal agent a real person can sign into, connect to their own calendar, deadline feeds and inbox, and leave running. It keeps the rule that made v1 credible (the model proposes, deterministic code disposes) and widens what the model proposes: Nemotron now builds the commitment graph and generates repair plans, while the validator, cost function and policy gate still decide what runs. Everything that was seeded, mocked or single-tenant is replaced with real sources, real recipients and real users.
The Personal AI track asks for five things: always-on, private, persistent memory, reusable skills, and tools the user chooses. v2 maps each to a concrete feature: a 5-minute poller on an always-on Nebius VM, an OpenShell sandbox per account with an egress allowlist, the commitment graph as a user-owned file, corrections captured as rules and stored as Hermes Skills, and per-connector scopes the user grants one at a time. Hermes Agent, deployed through NemoClaw, is the chat surface the user talks to; Dira is the tool server it calls.
The one-line pitch: Dira tracks what you have promised and to whom, notices when an upstream change breaks a promise, and repairs it within limits you set, telling the affected person before they have to ask.
Problem and user
The user is anyone who owes things to other people and whose week depends on dates they do not control. What they drop is rarely a forgotten task. It is a promise to someone else that broke because something upstream moved, and they found out when the other person asked.
Calendars, to-do apps and trackers store each item on its own. Nothing holds the links between items (this QA must finish before that deck freezes; this interview needs three hours of recovery after that exam; this client draft needs two days after the data lands), so nothing notices the cascade when one date shifts. v1 proved the cascade can be modeled and repaired. v2 makes that available to a person who is not the author.
Two personas share the same engine and differ only in sources and vocabulary:

Student leader
Busy professional
Upstream authority
Professor, recruiter, advisor
Manager, client, partner team
Where deadlines live
LMS feed, syllabus emails
Tracker (Jira, Asana, Linear), email threads
Promises owed
Org deliverables, team tasks, interviews
Client deliverables, reviews, handoffs
Typical cascade
Exam moves → study blocks → interview buffer → org QA
Data delivery slips → analysis → client draft → review meeting
First deployment
Yes: the author's own semester
Second: same adapters, tracker feed instead of LMS feed
Students go first because the author is one, the sources are open (every major LMS exports a calendar feed), and the demo persona can be fully synthetic. The professional persona is the impact argument: the same product with a tracker feed connected. The demo shows the student scenario end to end and the professional scenario as a second connected account, so judges see the engine is not tied to a semester.
What v1 is today
v1 is a strong engine wrapped in a demo. The repair loop, feasibility solver, policy gate, action ledger and verification are real and tested (77 tests, property and chaos suites, 20/20 replay). Almost everything around them is seeded or doubled.
Area
v1 state
What a product needs
Users
One hardcoded userId, one global Firestore world, one timezone (−5h baked into time.ts)
Accounts, per-user state, user timezone, absolute timestamps
Commitment graph
Hand-authored fixture: 15 commitments, 13 edges, 5 people
Built from the user's real calendar, LMS and email, confirmed by the user
Email intake
2 seeded inbox messages in Firestore; Gmail watch is a scripted seam
Gmail OAuth per user, polled every 5 minutes
Calendar
Real Google Calendar API, but a service-account calendar shared to a demo account
The user's own calendar via OAuth
Recruiter scheduling
Firestore double with pre-approved slots
Parse slot offers from real email; reply to book
Org tasks and delegation
Firestore double
Real recipient via email or messaging, provenance from a stored edge
Outbound messages
Firestore outbox, nothing sends
Real send under policy, draft-for-approval by default
Model
Gemini 3.5 Flash on Vertex, one call (interpretation only)
Nemotron on Token Factory, routed by job
Voice
Optional Gemma 3n service, CPU fallback
NVIDIA ASR (Parakeet) on Nebius
Policy
18 rules in a switch; display table lists rules with no code behind them
Rules as per-user data, editable, every listed rule enforced
Approvals
REQUIRE_APPROVAL verdict exists, no UI to act on it
Approval inbox
Memory and skills
None; nothing learned across runs
Corrections become rules the planner reads
Trigger
Shared demo token, /demo/trigger, manual
Always-on: watch plus scheduled sweep
Web app
Read-only evidence dashboard
Onboarding, graph review list, approvals inbox, policy settings, Hermes chat
Goals and non-goals
Goals, in priority order:
1. A stranger can sign in, connect their own sources, and get a repair they did not script. Nothing in the judged path is seeded unless the user picks the demo persona.
2. Every Personal AI track requirement is a visible feature, not a sentence in the README.
3. Nemotron does the work the deterministic engines cannot: extraction from messy sources, edge proposal, generating repair plans for cascades no hand-written candidate type covers, explanation, and stakeholder messaging.
4. The v1 safety properties survive: a model output still cannot authorize an action, every mutation is still verified by re-reading the external system, and crash-resume still works.
5. Dira does more than move calendar events. It delegates, asks for extensions, books from offered slots, and keeps stakeholders informed, each under policy.
Non-goals for this submission:
• Multi-user negotiation (two Dira instances bargaining). Single user, many stakeholders.
• Browser automation or form filling. Dira acts through APIs and messages only.
• Payments, purchases, or any money-moving action.
• Building profiles of the people in the user's life. People are modeled only as stakeholders on commitments (name, contact, authority domain, delegation edges). No relationship memory, no inferred facts about them.
• Mobile app. The web app must work on a phone, nothing more.
Accounts and onboarding
Sign-in is Google OAuth, because Calendar and Gmail scopes come from the same consent and most students already live there. Each account gets its own DomainState, its own OpenShell policy, and its own storage partition. Timezone comes from the user's Google Calendar settings and replaces the hardcoded offset; times become absolute ISO timestamps with horizon minutes derived at solve time.
Onboarding is five steps and should take under ten minutes:
1. Connect Calendar (read and write) and pick which calendars count as "my time".
2. Paste a deadline feed URL: an LMS calendar feed (Canvas, Blackboard, Moodle, Brightspace), Asana's calendar export, or any other iCal feed. Dira pulls assignments, exams, tasks and due dates. Canvas REST with a user token is the richer option for students.
3. Connect Gmail. Google offers no label-limited scope, so Dira requests gmail.readonly and filters to a label or query the user chooses inside the action broker (default: senders the user marks as authorities in step 4, plus the user's own org domain). The compose scope is requested only if the user turns on messaging in step 5.
4. Review the graph Dira proposes (see Building the graph), including who holds authority over each commitment and how much effort each one needs. Confirm, edit, or delete each commitment and edge. Nothing enters the graph unconfirmed.
5. Set the initial policy: whether messaging is on, which stakeholders may be messaged, what Dira may do alone, what needs approval. Defaults are conservative: calendar moves within the user's own blocks are autonomous, and anything that contacts a person needs approval, with one exception (replying to a slot the counterparty offered).
The demo persona is an account with pre-connected synthetic sources. Judges pick it from the sign-in page and skip steps 1 to 3, but still see steps 4 and 5 so the confirm-and-policy experience is the same.
Acceptance: a new account with real sources reaches a confirmed graph of at least 10 commitments and 5 edges without the author's involvement.
Real intake sources
Every source that was a Firestore collection in v1 becomes an adapter against a real system. The ToolSet interfaces stay; only the implementations change, and they now run in the action broker outside the sandbox (see Privacy and security). Each adapter keeps its verify* read so the ledger can confirm external truth.
Source
v2 adapter
What it produces
Trigger
Google Calendar
User OAuth, held by the action broker
Events as kind: event commitments; free windows as availability
Incremental sync (sync tokens) every 5 minutes from the VM's scheduler; push channel in P1
Deadline feed
iCal (Canvas, Blackboard, Moodle, Brightspace, Asana, any iCal) or Canvas REST with a user token
Assignments, exams and tasks as kind: effort with deadlines; course or project as a SHARES_RESOURCE_WITH group
Polled every 30 minutes; a diff against the last snapshot emits deadline_change and new_commitment events
Gmail
User OAuth (gmail.readonly), filtered in the broker to the user's label or query
RawEmailEvent for the interpreter, same path as v1
history.list every 5 minutes; users.watch in P1 (it needs Google Pub/Sub)
Chat
Messages the user sends Hermes
A chat_note event, owner-restricted like v1 voice notes
On message
Voice note
Browser recording in the web app
Transcript as a voice_note event, owner-restricted as in v1
On submit
Manual
Web form
Commitment with source: manual
On submit
The LMS feed and a tracker feed go through the same adapter; only the domain tag (academic vs career) differs. Tracker support is claimed only where it exists: Asana exports iCal natively, Jira needs a Marketplace app, and Linear is unconfirmed, so the README says "Asana, or any iCal feed." Chat and voice notes can only change commitments the user owns. A chat claim that moves a commitment someone else has authority over ("my midterm moved") goes to the inbox for one-tap confirmation instead of applying directly.
Two rules carry over from v1 and apply to every source: content is untrusted until the interpreter passes schema, sender-authority and confidence gates; and no source can write to the graph directly. Everything goes through handleEvent.
Source checks with Tavily. When an email or feed item cites an externally published date (a career fair, an application portal deadline, a conference CFP), Dira calls Tavily to fetch the public page and compares the date before any repair runs on it. A mismatch stops the workflow in WAITING_REVIEW with both dates shown. Fetched pages are untrusted text and pass the same schema gate as email. This extends v1's rule that external truth wins: Dira does not act on a date it cannot source. Authenticated pages (an LMS course site) are out of reach for Tavily and are not claimed.
Always-on. A scheduler on the always-on VM polls Gmail and Calendar every 5 minutes and deadline feeds every 30. Each poll emits events into the same handleEvent path. Once a night it also launches a Serverless Job that re-anchors elapsed time (closing v1's known slack-accounting gap) and recomputes feasibility over the whole horizon. Nebius Serverless Jobs have no built-in schedule, so the VM is the clock and the Job does the heavy batch work. If anything is violated, the repair loop runs the same way an event would.
Acceptance: a professor's email produces a repair plan, and an approval request if one is needed, within 10 minutes of arriving, with no human trigger. A Canvas due-date change does the same within 40 minutes.
Building the graph from real data
v1's hardest-to-fake asset was its graph, and it was typed by hand. v2 has Nemotron propose the graph and the user confirm it. This is the single largest new model surface and the clearest answer to "what does Nemotron do here."
The builder runs in three passes:
1. Extraction (Nemotron 3 Nano). From each calendar event, LMS item and email, produce a structured Commitment draft: title, domain, kind, time fields, required effort estimate, flexibility, criticality, stakeholders. Nano runs once per item, so it has to be cheap. Output is schema-validated with the existing zod types.
2. Edge proposal (Nemotron 3 Ultra). Given the full draft set and the course roster, propose typed edges with a one-line reason each: REQUIRES_PREPARATION (exam ← study blocks), REQUIRES_BUFFER (exam → interview), MUST_PRECEDE (deck freeze → presentation), DELEGATABLE_TO (only when an email or org record names a backup), SHARES_RESOURCE_WITH (same course or same week). Ultra sees everything at once, which is what edge inference needs.
3. Confirmation (user). Each proposed commitment and edge appears in a review list with the reason and the source it came from. Confirm, edit, or reject. Authority and effort get their own fields in the review. Authority (who can move this commitment: the instructor, the recruiter, the manager) has to come from the user, because deadline feeds carry no roster and v1's sender gate rejects email from anyone without it. Effort matters because Nano's guess for a problem set feeds straight into Global Slack, and a wrong estimate makes the slack number fiction. Rejected proposals are stored so the builder stops re-proposing them.
Two constraints make this safe. A proposed edge has confidence and provenance fields and is inert until confirmed: propagation ignores unconfirmed edges. And a DELEGATABLE_TO edge can never be proposed from inference alone; it needs a source (an email naming the person, an org record, or the user typing it).
After onboarding the builder keeps running incrementally. A new syllabus email or LMS item goes through the same three passes, and the confirmation step becomes an item in the approvals inbox.
Acceptance: on the author's real semester, the builder proposes at least 80% of the commitments the author would have entered by hand, and no edge enters propagation without confirmation.
Repair actions beyond the calendar
v1 had seven action types, and the ones that touched people (book a slot, delegate, notify) wrote to Firestore doubles. v2 keeps the types, makes each one real, and adds the two that students actually need: asking for an extension and renegotiating a promise. Every action still needs provenance, still goes through the policy gate, and still gets verified after execution.
Action
What it does in v2
Provenance it needs (typed reference)
Default verdict
MOVE / CREATE / DELETE_CALENDAR_EVENT
Mutates the user's own calendar
commitment: whose flexibility allows it
ALLOW within own flexible blocks; REQUIRE_APPROVAL for anything with a participant
BOOK_SLOT
Replies to the offer email choosing one slot and places a tentative hold. Verified when the reply is in Sent; the commitment then waits in AWAITING_COUNTERPARTY until the counterparty confirms, which arrives as a normal event
msg: a stored message from the counterparty listing that slot
ALLOW_AND_NOTIFY, the one person-contacting action allowed by default, because the counterparty asked for the reply
DELEGATE_TASK
Emails the backup with the task, the deadline and why, cc the user
edge: a confirmed DELEGATABLE_TO edge on that commitment
REQUIRE_APPROVAL the first time per person and commitment
REQUEST_EXTENSION (new)
Drafts an email to the authority on the commitment asking to move a deadline, with the reason derived from the cascade
commitment: with a confirmed authority person and flexibility other than FIXED
REQUIRE_APPROVAL, always
RENEGOTIATE (new)
Tells a stakeholder a promised date will slip and offers the new one
commitment: the user owes to that person
REQUIRE_APPROVAL; the user can relax it per person
SEND_NOTIFICATION
Informs a stakeholder of a change that affects them
commitment: the recipient is a stakeholder on
REQUIRE_APPROVAL; the user can relax it per person
Where plans come from. v1's planner enumerates four candidate types (rebook a slot, delegate, move a donor block, rebuild study blocks), all designed around the 48-Hour Shock. A real semester produces cascades none of those cover, and the loop would stop in WAITING_REVIEW almost every time. v2 keeps the enumerated candidates and adds Nemotron 3 Ultra as a second candidate source. Given the violations, the affected subgraph, current availability and the user's rules, Ultra proposes up to five plans written in the typed action vocabulary above, each action citing the stored fact that would authorize it.
Every Ultra proposal is structured data only: action types, target commitment ids, slot or time values, and typed provenance references (msg:, edge:, rule:, commitment:). It contains no recipient address and no message body. Recipients come from the target commitment's stakeholders, and bodies are drafted later by Super from a deterministic brief. Each proposal then goes through validatePlan, the cost function and the policy gate. v1's policy only checked that provenance was non-empty; v2 resolves every reference against the store and denies the action if one is missing, points at a different commitment, or names a recipient who is not a stakeholder. A plan that fails is dropped and logged with the reason. The model widens the search; deterministic code still picks and authorizes. The eval reports two numbers that go in the README: the share of Ultra proposals that pass validation, and the share of resolved repairs whose winning plan came from Ultra rather than enumeration.
Acceptance for the proposer: across the v1 variation matrix plus five new scenarios outside the four enumerated types, every scenario reaches RESOLVED or a WAITING_REVIEW with a stated reason, and no Ultra-proposed action executes without passing policy.
The drafting model is Nemotron 3 Super: it writes the email body from a structured brief (who, what moved, why, what is proposed) and never decides whether to send. Drafts show in the approvals inbox with the brief beside them so the user can see what the model was told.
Messaging needs gmail.compose, which Google defines as both drafting and sending, so there is no draft-only scope. Draft-only is a per-user policy setting instead: with it on, every message action writes to Gmail Drafts and the ledger records DRAFTED rather than SENT. The scope is requested only when the user turns messaging on.
Acceptance: the 48-Hour Shock scenario runs end to end against a real Gmail account and a real calendar, with the recruiter reply, the delegation email and the extension request all visible in Sent or Drafts.
Approvals inbox and user-editable policies
v1 could return REQUIRE_APPROVAL and then had nowhere to put it. v2 adds the inbox and makes policy per-user data.
Approvals inbox. One list, newest first. Each item shows: the triggering event and its source, the cascade (which commitments broke and by how much), the proposed plan with cost, and the specific actions awaiting approval. The user can approve, edit (change a date, pick a different slot, reword a draft), or reject. Approve resumes the plan from a new AWAITING_APPROVAL ledger state, but first Dira re-reads external state and re-runs feasibility and policy; if the world moved while the plan waited, it replans instead of executing a stale plan. Reject marks the plan invalid and triggers a replan excluding that action. Edits are captured as corrections (see Memory and skills). Items also carry a one-paragraph explanation of why this plan, written by Super from the flight record. The inbox is reachable two ways: the authenticated web app, and a chat message with Approve and Reject buttons. A button press goes to a plain webhook handler that checks a one-time nonce; it never passes through Hermes or any model, so no model can approve anything.
Policies as data. The 18 rules in policy-engine stay as the enforcement code, but each gets a per-user setting with a verdict override and optional scope: delegate-explicitly-delegatable → ALLOW for Maya, REQUIRE_APPROVAL for everyone else; default-move-requires-approval → ALLOW for blocks tagged personal. The display table and the enforcement code become the same table. The three display-only rules from v1 (spend money, miss class, disclose information) become real: spend money and disclose information are hard DENY with no override, and miss class becomes a user-set rule over academic commitments with kind: event.
Fenced zones. The user can mark a Gmail label, a calendar, or a person as off-limits. Fenced items are never read into the graph, never used as provenance, and never contacted. Enforcement sits where it can actually hold. The action broker refuses any Gmail message carrying a fenced label and any send to a fenced person. A fenced calendar is also blocked at the sandbox, because the calendar id appears in the broker's request path and OpenShell's method-and-path rules can match it. Gmail requests carry no label in the path, so label fences are enforced in the broker only, and the PRD does not claim otherwise.
Daily summary. At 07:00 user time, one message (email, or chat through Hermes): what Dira did overnight, what is waiting for approval, current Global Slack. This is the one message that sends without approval.
Acceptance: a plan with one REQUIRE_APPROVAL action pauses in AWAITING_APPROVAL, appears in the inbox and as a chat message as soon as the plan is ready, revalidates against fresh reads when approved, and ends in a verified state that matches the approved plan. An approval attempted through Hermes has no tool to call and changes nothing.
Memory and reusable skills
v1 learned nothing between runs. v2 has two kinds of memory, both stored as files the user owns and can read.
The graph is the memory. The commitment graph, confirmed edges, people and policy settings live in a per-user git repository (plain JSON and Markdown) that Dira commits to on every change. The user can clone it, diff it, edit it by hand, and delete it. Postgres holds the action ledger and a working copy for the UI. The repo is the source of truth for the graph, rules and policy; the ledger is operational state, not user memory. This is the "data under your control" requirement made literal.
Corrections become rules. When the user edits or rejects a proposed action in the approvals inbox, Dira captures the delta as a candidate rule: the action type, the attribute that changed, and the new value. Nemotron 3 Super turns the delta into a one-line rule in the user's words ("Don't schedule study blocks before 9 AM", "Always keep Thursday evenings free", "Prefer moving the side project over moving workouts") and asks the user to confirm it. Confirmed rules are stored as planner preferences with a scope (all, domain, commitment, person) and an effect (forbid, prefer with a cost delta, or require). The planner's cost function reads them on the next run, so a correction on Monday changes the plan Dira proposes on Wednesday.
Skills. Confirmed rules are mirrored from the memory repo into Hermes as Skills, the format NVIDIA's NemoClaw blueprint uses, so they survive sandbox redeploys through NemoClaw snapshots. A skill bundles related rules plus a default policy and can be exported and imported. exam-week, recruiting-season and conference-prep ship as examples. Importing is a confirmation step, never a silent apply. The mirror is one-way and read-only: Hermes's skills directory is not writable by Hermes, and its automatic skill creation is turned off, so the mirror cannot drift from the repo. The planner reads rules from the repo through Dira's own interface, so a skill can shape cost and preference but can never authorize an action.
What Dira deliberately does not remember: anything about the people in the user's life beyond name, contact, authority domain and delegation edges. No profile pages, no inferred traits, no history of their messages. The graph schema has no fields for facts about people, so Dira cannot store them, and the memory repo makes that checkable. Hermes keeps its own MEMORY.md, so the same limit has to hold there. Hermes never receives raw email or calendar content, only what Dira's tools return. The user's own chat messages can still contain names, so SOUL.md instructs Hermes not to store facts about people, and MEMORY.md is visible and editable in Settings. That part is instruction plus visibility, not enforcement, and the PRD says so.
Acceptance: a rejected repair followed by the same trigger produces a different plan that respects the captured rule, with the rule visible in the memory repo's commit history.
Privacy and security
Dira runs on one always-on Nebius VM that hosts an NVIDIA OpenShell gateway, with one sandbox per account. v2 runs two: the author's and the demo persona's. NemoClaw is a reference stack for one trusted operator on one host, so this matches what it supports; a multi-tenant hosted service is out of scope. The orchestrator and Hermes run inside the sandbox. A small action broker runs outside it. Three properties follow, and each one shows up in the product.
1. No model can authorize an action. Nemotron proposes; the validator and policy engine decide. The action broker then re-runs the policy check outside the sandbox and refuses any REQUIRE_APPROVAL action that lacks a user approval record. Approval records come only from the authenticated web session or the chat-button webhook with its one-time nonce, never from a model. Even a fully compromised sandbox cannot execute an unapproved action.
2. Credentials stay outside the sandbox. The broker holds the user's Google OAuth tokens and exposes narrow endpoints (read messages, move an event, send a reply). The sandbox calls the broker, never Google directly, so a hijacked prompt has no token to steal. If OpenShell's provider mechanism can inject Google OAuth tokens itself, the broker can shrink, but the design does not depend on it.
3. Egress is an allowlist. The sandbox may reach Token Factory, Tavily, the broker, the deadline feed URL the user pasted, and the one messaging channel connected to Hermes. Anything else returns a 403, recorded as a BLOCKED flight line. Because the broker's paths are Dira's own, OpenShell's method-and-path rules can also block broker calls for a fenced calendar.
Indirect prompt injection. Email, feed items, Tavily pages and chat text are all untrusted, and all of them pass the same schema gate before anything reads them as data. The defenses do not depend on the model resisting an injected instruction. Ultra's plans contain no free-text recipients or bodies. Every provenance reference is resolved against the store. Recipients must be stakeholders on the target commitment. New commitments and edges need user confirmation. And Hermes has no tool that approves, confirms, or sends anything: its tools are report_change, list_approvals (summaries plus links), explain_plan and show_slack.
User-facing controls, all in Settings: the list of granted scopes with a revoke button each; fenced zones (labels, calendars, people); data retention (flight records older than N days are deleted); export (download the memory repo as a zip); and delete account, which removes the sandbox, the repo, the broker's tokens and the Postgres partition.
Stakeholder privacy: Dira contacts a person only when they are on a commitment the user owns and policy allows it, and every outbound message identifies itself as sent by Dira on the user's behalf. Replies from stakeholders enter as events and are read only for the commitment they concern.
Inference privacy: every model call goes to Token Factory, which advertises zero-retention inference. The README cites Nebius's retention terms, and the build confirms the setting before any real mail is processed.
Acceptance: an email carrying hidden instructions to forward the inbox to an outside address produces no outbound message (policy denies the recipient), any attempt to reach the outside host returns 403 at the proxy, and the flight record shows both lines. A fenced calendar's events never enter the graph, and the proxy log shows the blocked broker path.
The try-it path
The rules require a working URL, and the Design criterion rewards a complete product over a proof of concept. Two paths from the same sign-in page:
Demo persona. One click, no OAuth. A synthetic student account with a pre-built graph (the 48-Hour Shock world, expanded to a full week) and a text box where the judge drops a trigger email. Each session gets its own calendar and its own message tag, created through the API in the demo project's Google account, so concurrent judges never touch each other's runs. A verification panel shows before-and-after state from fresh API reads rather than an embedded Gmail view. Demo stakeholders are addresses inside the demo account, and the broker refuses any other recipient. A second, professional persona with an Asana feed is P1.
Your own account. Google sign-in, the five onboarding steps, and the first repair whenever the next real trigger arrives, or sooner by telling Hermes in chat ("my ECE midterm moved to Wednesday"). This is the path the author uses daily and the one that makes the Potential Impact case: it works on a semester nobody scripted.
Where the design effort goes. Two surfaces get the polish: the approvals inbox (web and chat) and the morning summary. Onboarding, settings and the graph review list are functional and plain. Judges may never open the URL, so these two surfaces carry the Design score in the video, and five half-finished screens would read worse than two finished ones.
The v1 evidence surfaces (deterministic replay, 20x reliability, variation matrix) stay reachable from an Evidence page, labeled as engine proofs. The live path is the product; the replay is how a skeptic checks it without credentials.
Acceptance: a judge with no setup reaches a completed repair with verified mutations in under three minutes from the sign-in page.
Architecture on Nebius and NVIDIA
One always-on Nebius VM hosts the OpenShell gateway, the action broker, Postgres and the scheduler. Inside each sandbox, Hermes is the conversational front end and the orchestrator routes Nemotron calls by job through Token Factory. Serverless Jobs run the batch work the scheduler launches. The deterministic core (propagation, feasibility, validation, policy, ledger, verifier) makes no model calls of its own: it receives Nemotron's proposals (graph edges, repair plans, drafts) and decides which, if any, run. The broker then checks that decision again before anything touches the outside world.
Job
Model
Why this tier
Event triage (is this email about a commitment at all?)
Nemotron 3 Nano
Runs on every message; must be cheap
Commitment extraction from calendar, feed and email items
Nemotron 3 Nano
Per-item, schema-bound, high volume during onboarding
Event interpretation (v1's one model call: mutation, entity resolution)
Nemotron 3 Super
Needs reasoning about graph context but runs often
Hermes conversation (chat turns into Dira tool calls)
Nemotron 3 Super
Frequent, needs reliable tool calling
Drafting stakeholder messages from a structured brief
Nemotron 3 Super
Quality matters, volume is low
Repair explanation for the approvals inbox
Nemotron 3 Super
Prose from a flight record; no search over options
Turning a correction into a rule
Nemotron 3 Super
Short, occasional
Edge proposal across the whole draft graph
Nemotron 3 Ultra
Sees all items at once; onboarding and syllabus changes only
Repair plan generation (structured candidates for the validator)
Nemotron 3 Ultra
Searches over the violated subgraph, availability and rules together; runs only when feasibility goes negative
Voice-note transcription
NVIDIA Parakeet (or Canary) on a Serverless Endpoint
Open NVIDIA ASR replaces Gemma 3n
Nebius services and what each one does:
• Token Factory: all Nemotron inference, through the OpenAI-compatible endpoint, reached only via the OpenShell proxy. Structured outputs enforced with the same zod schemas as v1. Every repair records tokens and latency per tier, and the README publishes cost per repair split across Nano, Super and Ultra.
• Nebius Compute VM: the always-on host for the OpenShell gateway and sandboxes, the action broker, Postgres, the scheduler, and the MCP tool server Hermes calls.
• Serverless Jobs: the nightly re-anchor and full recompute, and onboarding graph builds for large accounts. Jobs have no built-in schedule, so the VM's scheduler launches them.
• Serverless Endpoints: the ASR model.
• NemoClaw and Hermes Agent: NemoClaw deploys Hermes inside each sandbox. Hermes is the chat surface (the web app plus one messaging channel). It calls Dira's MCP tools report_change, list_approvals, explain_plan and show_slack, and none of them can approve, confirm or send. Snapshots carry sandbox state across redeploys.
• Tavily: source checks on publicly published dates, called from inside the sandbox through the proxy.
What changes in the repo: interpreter.ts gains a NemotronModelClient behind the existing ModelClient interface. New packages: graph-builder (the three-pass builder) and repair-proposer (structured Ultra candidates into the existing validatePlan). New services: broker (OAuth tokens, adapters, a second policy check, approval records) and mcp (Dira's tools for Hermes). policy-engine resolves typed provenance references, checks recipients against stakeholders, and reads per-user overrides. action-ledger gains AWAITING_APPROVAL with revalidation on resume. The Firestore stores are replaced by Postgres. adapters/recruiter and adapters/organization are deleted and replaced by email-based BOOK_SLOT and DELEGATE_TASK. apps/web gains onboarding, the approvals inbox, settings and a graph review list. infrastructure/ targets the Nebius VM instead of Cloud Run.
Model calls leave the sandbox through the proxy, but no action does. Every action goes through the broker, which holds the tokens, re-checks policy, and executes a REQUIRE_APPROVAL action only with an approval record that came from the user rather than a model.
Prioritization
P0 is what makes it a product someone can try and clears every track requirement. P1 makes it score higher. P2 is after the deadline. The order inside P0 is build order: each item is testable on its own and the demo gets stronger after each one. The sandbox, the broker, the security core and the memory repo sit at items 3 to 5 on purpose. They are what makes this a Personal AI entry, and what keeps the model from authorizing anything, so they cannot be what gets cut.
P0: ship or no entry
1. Nemotron on Token Factory replaces Gemini in interpreter.ts; the 8-case eval corpus passes on Nemotron 3 Super. (Stage One depends on this.)
2. Accounts, Postgres in place of Firestore, user timezone, absolute timestamps.
3. Nebius VM with an OpenShell sandbox per account and an egress allowlist, plus the action broker outside it holding OAuth tokens and re-running policy.
4. Security core: typed provenance references resolved against the store, recipients restricted to stakeholders, and an AWAITING_APPROVAL ledger state that revalidates on resume.
5. Memory repo (per-user git) and correction-to-rule capture.
6. Calendar (sync tokens) and Gmail (gmail.readonly, history.list) through the broker; deadline feed adapter; the 5-minute scheduler.
7. Graph builder: Nano extraction, Ultra edge proposal, review list with authority and effort confirmation.
8. Ultra repair proposer emitting structured actions only, with the validation-rate eval.
9. Approvals inbox in the web app plus nonce-checked chat buttons; policies as per-user data.
10. Real BOOK_SLOT (sent-verified, tentative hold, AWAITING_COUNTERPARTY), DELEGATE_TASK, SEND_NOTIFICATION, with draft-only as a policy setting.
11. Hermes via NemoClaw as the chat surface, with read-and-report tools only; rules mirrored as read-only Hermes Skills.
12. Nightly Serverless Job recompute and the 07:00 summary.
13. Demo persona with a per-session calendar and message tag; hosted URL; README with the routing cost report; video under three minutes.
P1: raises the score
• Tavily source checks on publicly published dates, with fetched pages passing the same schema gate as email. Also makes the entry eligible for Best Use of Tavily (see Submission plan).
• REQUEST_EXTENSION and RENEGOTIATE actions with Super-drafted emails.
• Second demo persona (professional, Asana feed).
• Parakeet ASR on a Serverless Endpoint replacing Gemma 3n voice intake.
• Skills as exportable bundles with three shipped examples.
• Canvas REST adapter (richer than the iCal feed: submission status, rubric weights).
• Calendar push channel to the VM, so calendar repairs start within seconds. Gmail users.watch needs Google Pub/Sub, so it stays optional behind the 5-minute poll.
P2: after Oct 30
• Multi-user negotiation between two Dira instances.
• Native mobile app; Slack and Teams as stakeholder channels.
Cut from v1
• Firestore recruiter and org doubles are deleted, not kept behind a flag. Keeping them invites a judge to ask which path the demo used.
• Firestore itself is replaced by Postgres on the VM, so the runtime no longer depends on Google Cloud for state. Google remains only as the user's own Calendar and Gmail.
• The Vercel-proxied DIRA_DEMO_TOKEN path goes away with accounts.
• Cloud Run, Vertex and the Gemini client are removed from the default build. The deterministic replay and its fixture stay for the Evidence page.
Submission plan
Video, under three minutes. The rules say less than three minutes, so the cut runs 2:50. It opens on the cascade, not on onboarding: the cascade is the idea judges have not seen, and onboarding is the least visual part of the product. The beats, in order, each tied to a judging criterion:
1. 0:00 to 0:30, the cascade: a professor's email lands, the graph lights up the commitments it breaks, and Global Slack drops below zero. One line of voiceover names the problem for students and for professionals. (Quality of the Idea.)
2. 0:30 to 1:10, the repair: Super interprets and Ultra proposes structured plans. A labeled adversarial proposal (an action citing a message that does not exist, addressed to an outside recipient) is injected on screen and rejected by the validator and policy. Policy pauses a delegation; the user taps Approve on a phone, and the approval goes straight to the broker without passing through any model. Another action gets edited in the web inbox. The flight record shows each Token Factory call with its tier and latency. (Technological Implementation.)
3. 1:10 to 1:45, the actions land: the booking reply in Sent with a tentative hold, the delegation email at the backup, the calendar moved, each one verified by a fresh read. Then the injection test: an email with hidden instructions to forward the inbox to an outside address produces no send, and the attempt to reach that host gets a 403 at the proxy. Both flight lines are on screen. (Privacy and security, a track requirement.)
4. 1:45 to 2:15, memory: the edited action became a rule, shown as a commit in the memory repo and as a Hermes Skill; the next trigger produces a plan that respects it. (Track requirement.)
5. 2:15 to 2:40, a real account: sign in with a clean second Google account (no classmates' or professors' details on public YouTube), connect a calendar and a feed, and confirm the graph Dira proposes, including authority and effort. Short on purpose. (Design.)
6. 2:40 to 2:50, the morning summary arriving in chat, and the one-line close.
Devpost description. Lead with the split between what Nemotron proposes and what code authorizes, backed by the validation-rate number and the injection test. The tier routing comes later and briefly: the track brief already suggests Nano, Super and Ultra, so leading with it reads as following instructions rather than as an idea.
The "significantly updated" explanation. Tag the commit submitted to the Google hackathon as v1-google-agentic, keep it on a frozen branch, and link a compare view in the Devpost text. The written explanation lists: model and inference moved to Nemotron on Token Factory; single-tenant demo replaced by accounts with OAuth; four Firestore doubles replaced by real adapters or deleted; graph builder, approvals inbox, policy settings, memory repo and sandbox all new; infrastructure moved to Nebius. The deterministic core is named as the part that carried over, with its tests as proof it still holds.
Evidence to keep from v1. The 20x deterministic replay, the property tests and the chaos suite all still run and still prove the core. v2 adds three artifacts. First, a Nemotron eval run (docs/evidence/nemotron-eval.json): the v1 corpus plus repair scenarios outside the four enumerated types, with per-tier latency, the share of Ultra proposals that pass validation, and the share of winning plans that came from Ultra. Second, a routing cost report: tokens and dollars per repair, split by Nano, Super and Ultra. Third, an injection proof: the proxy log and flight record for the adversarial-email case, showing the denied recipient and the blocked host.
Feedback submission. Written as the build goes, in docs/submission/nebius-feedback.md: what worked and what did not in Token Factory structured output, Serverless Jobs scheduling per user, NemoClaw onboarding, OpenShell policy authoring. The Most Valuable Feedback prize is judged on completeness and viability, so specifics with reproduction steps beat opinions.
Hosting through judging. The demo URL must stay up and free through Dec 15. Pin the judged deployment to a release tag and run the author's personal instance on a separate deployment so daily use never changes what judges see.
Bonus awards. Each project can win one overall or track award plus one bonus award, so a bonus stacks with a main prize but two bonuses do not stack on the same project. Two are reachable:
• Best Use of Tavily ($3,000, one winner): open only to entries that make a functional runtime call to Tavily, which the P1 source checks provide. Three of the listed judges are from Tavily.
• Boston City Winner ($500, 20 winners across 20 cities): open to entrants who attend the Boston Builders & Brews event and select Boston on the submission form. It applies to all of an entrant's submissions, so if Countertrace and Dira are both entered, one can target Tavily and the other the city award.
Open decisions
[x] Hermes Agent: decided, use it, without authority. Hermes is the chat surface because the track names it and NVIDIA's NemoClaw blueprint is built around it. Its tools only read and report. Approvals never pass through it.
[x] Nemotron tiers. Nano, Super and Ultra are all listed on Token Factory. Confirm exact model ids and context limits on day one.
[ ] Google-only sign-in for v2, or email plus Google? Google-only is simplest and matches the Calendar and Gmail scopes. It excludes Outlook users entirely for now.
[ ] Where the memory repo lives. Options: on the VM with a download and clone link, or a GitHub repo the user owns that Dira pushes to with a scoped token. The second is more visibly "your data" but adds a GitHub dependency to onboarding.
[ ] Postgres: Nebius managed service or on the VM. On the VM is one less service; managed is one less thing to back up.
[ ] Draft-only default. Leaning: on by default for real accounts (every message lands in Drafts until the user trusts it), off on the demo persona so the full loop shows.
[ ] Which Hermes messaging channel. Telegram is the one NemoClaw's docs walk through, and its inline buttons send callbacks to a webhook, which is what makes nonce-checked approval possible outside the model.
[ ] Keep the name Dira for v2, or rename? Keeping Dira carries the v1 evidence and Devpost history and makes the "significantly updated" explanation easier. Renaming signals the scope change.
[ ] Professional persona in the video or not. Adds the impact case but costs about 20 seconds and a second synthetic world. A synthetic persona reads as synthetic, so if it goes in, it gets one beat rather than a full scenario.
[ ] Which bonus each project targets. Tavily or Boston City Winner for Dira, the other for Countertrace, depending on which one has a natural Tavily call and whether you attend Builders & Brews.
Risks
Risk
Why it matters
Mitigation
Indirect prompt injection
Email, feed items, Tavily pages and chat text can all carry instructions aimed at the models
Ultra emits structured actions only; provenance references are resolved against the store; recipients must be stakeholders; Hermes has no approve, confirm or send tools; the broker re-checks policy outside the sandbox. The injection test runs in the eval and appears in the video
Google OAuth "Testing" status
Apps in Testing get refresh tokens that expire after 7 days, which breaks always-on for real users and for judges in December
Set the consent screen to "In production" while unverified: users see a warning screen (gmail.readonly is a restricted scope) and the app is capped at 100 users, but tokens do not expire. The demo persona avoids OAuth entirely
University Workspace blocks
BU's Google Workspace admins may block unverified third-party apps from Gmail scopes
Test onboarding with a bu.edu account on day one; if blocked, document personal Gmail as the supported path for students
Ultra proposes bad plans
A model-generated plan could cite provenance that does not exist or target the wrong commitment
The same validator and policy gate as enumerated candidates; unresolved references are denied; enumerated candidates remain as a fallback
Stale approvals
An approval can arrive hours after the plan, against a calendar that has moved
AWAITING_APPROVAL revalidates feasibility and policy against fresh reads before anything executes, and replans if the world changed
Ultra latency
The largest model sits on the critical path from trigger to plan
Ultra runs only when feasibility goes negative; explanations moved to Super; acceptance targets are in minutes, not seconds; the flight record shows latency per call
NemoClaw and OpenShell maturity
Both are early preview; NemoClaw targets one trusted operator on one host, and Google OAuth injection by OpenShell is unconfirmed
One VM, one sandbox per account; the broker holds tokens regardless; the orchestrator runs with or without the sandbox, so the sandbox is a deployment layer, not a code dependency
Nemotron structured output quality
The interpreter's zod schema is strict; weaker JSON adherence than Gemini raises retries and lowers confidence
Run the 8-case corpus on day one; use Token Factory's structured-output mode; keep the fixture model client for the Evidence page
Hermes memory
Hermes writes its own memory, and the user's chat can contain names
It never receives raw email; SOUL.md forbids storing facts about people; MEMORY.md is visible and editable in Settings; skill auto-creation is off. The PRD presents this as instruction plus visibility, not enforcement
Scope
Thirteen P0 items, one builder, other hackathons in the same month
P0 order is build order; Hermes (item 11) can fall back to the web inbox and quick-add if it slips, at some cost to track fit
Demo isolation
Concurrent judges on one demo account could see or overwrite each other's runs
A calendar and a message tag per session, created through the API; the verification panel reads only that session's calendar and tag
Credits through Dec 15
Judges may run the demo in December; inference and Serverless Jobs cost credits
Confirm Builder Program credit expiry; set a per-account token budget; the deterministic replay needs no credits
Stakeholder emails from the demo
A judge triggering DELEGATE_TASK on the demo persona must not email a real person
Demo stakeholders are addresses inside the demo account; the broker refuses any other recipient