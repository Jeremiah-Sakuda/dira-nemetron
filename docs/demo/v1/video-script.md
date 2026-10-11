# Demo video — the single authoritative script

This is the **only** recording script. If a shot conflicts with the live UI,
the live UI wins. Re-time, do not improvise claims.

**Target duration: 3:35–3:50** (hard limit 4:00). Do not show Gemma in this
recording unless a real voice-note capture exists and is labeled.

`make demo-video` renders a separate 72-second deterministic evidence clip
(`docs/demo/dira-demo-evidence.mp4`). It is a gallery/social asset only and
must not be submitted as the live-cloud proof; the recording below is the
Devpost video.

## Non-negotiable evidence rules

- The main workflow is **one uncut live capture**: no speed-ups, no cropping
  the runtime badge, no splicing outcomes from another run.
- **Hard re-record gate:** if the uncut segment (click to RESOLVED) exceeds
  ~110 seconds, stop and re-record the whole take.
- Abort if the badge reads `DETERMINISTIC EVIDENCE` or `CLOUD UNAVAILABLE`.
- Evidence language: **real** Google Calendar mutations; **controlled
  Firestore integrations** for recruiter availability, organization
  ownership, and the notification outbox. Never "Gmail was sent"; never imply
  Gmail Watch / Pub/Sub is exercised.
- The default 409 is a **seeded stale recruiter listing**. Say so.
- Never show: the demo token, the calendar ID string, your personal email
  (it appears in Cloud Run **audit** log rows), or the Cloud Run service's
  own Logs panel (it contains unrelated red Gemma-debugging entries).

## Browser setup — 7 tabs, in this order

| # | Tab | Parked on |
| --- | --- | --- |
| 1 | https://dira-phi.vercel.app | Home, scrolled to top |
| 2 | https://dira-phi.vercel.app/interventions | **48-Hour Shock** selected, badge `LIVE CLOUD` |
| 3 | Cloud Run service `dira-orchestrator` | **Metrics** view, scrolled to the very top so only the header strip (green check, name, region, URL) is visible. Never open its Logs panel. |
| 4 | Cloud Logging **Logs Explorer** (`console.cloud.google.com/logs/query?project=dira-agentic-2026`) | Empty query editor, ready for paste |
| 5 | Firestore → Data (`console.cloud.google.com/firestore/databases/-default-/data?project=dira-agentic-2026`) | `action_ledger` collection selected in the left column |
| 6 | Google Calendar "before" | Week of **Aug 16–22, 2026** (current week is empty by design) |
| 7 | Google Calendar "after" | Same week; you will refresh this one after the run |

| 8 | https://dira-orchestrator-oq463fciiq-uc.a.run.app/health | The raw JSON `{"ok":true,"mode":"production"}` rendered in the browser. This is the "public endpoint" beat; no terminal needed. |

(If you prefer the terminal look: open macOS Terminal — Cmd+Space, type
"Terminal" — pre-type `curl https://dira-orchestrator-oq463fciiq-uc.a.run.app/health`
and press Enter on camera. Same proof either way.)

## Pre-record checklist

- [ ] World reset to pre-test state (ask for a `/demo/reset` or use the reset
      control); Calendar "before" tab shows the clean seeded week.
- [ ] Tab 2 badge reads `LIVE CLOUD`. Abort otherwise.
- [ ] One full rehearsal run done earlier so you know the pacing, then the
      world reset again. Every run reseeds the world on trigger, so a
      rehearsal does not poison the take, but the calendar before-tab must be
      captured fresh after a reset.
- [ ] Lower-third slide ready:
      `REAL: Vertex AI · Cloud Run · Firestore · Google Calendar` /
      `CONTROLLED: recruiter · organization task · notification outbox`.
- [ ] The **No slots available** counterfactual captured separately and
      labeled `COUNTERFACTUAL RUN`.
- [ ] Zoom ~110%, notifications off, 1080p, mic checked.

## Recording script

Each beat lists where you are, what you do, and what you say.

### 0:00–0:14 — what Dira is

**Where:** Tab 1 (home). **Do:** nothing, let it sit; the moved-midterm
story and impacted commitments are on screen.

> "On Tuesday morning a professor moves the midterm from Friday to Wednesday.
> That one email quietly breaks the rest of a student's week: study time now
> collides with a job interview and a club deadline. Every calendar app will
> show you the collision. Dira is an autonomous agent that repairs it."

### 0:14–0:28 — this is live, not a mockup

**Where:** Tab 3 (Cloud Run, header strip only) for ~4 seconds, then Tab 8.
**Do:** switch to Tab 8, which shows the raw endpoint's JSON
`{"ok":true,"mode":"production"}` in the browser (refresh it once on camera
if you want it to feel live). Do not scroll Tab 3.

> "Everything you are about to watch runs live on Google Cloud. Here is the
> Cloud Run service, and here is its public endpoint answering in production
> mode. Gemini on Vertex AI reads the change, Firestore records every
> decision, and the calendar being edited is a real Google Calendar."

### 0:28–0:45 — before state and trigger

**Where:** Tab 6 (Calendar "before", Aug 16–22) for ~6 seconds, then Tab 2
(Interventions). **Do:** confirm **48-Hour Shock** is selected and the badge
reads `LIVE CLOUD`, then click **Trigger change and repair plan** and move
the cursor away from the button.

> "Here is the week before the change. Study blocks, an interview, and club
> work all fit. I trigger the professor's email and take my hands off the
> keyboard. There is no prewritten answer behind this button. Dira has to
> work out a repair from the commitments, deadlines, availability, and
> permissions it finds."

### 0:45–2:20 — uncut live workflow *(stay on Tab 2 the entire time)*

**Where:** Tab 2 only. The flight recorder streams line by line on this same
page, below the button; the badge stays in frame. **Do:** do not switch
tabs, do not scroll except to follow new lines, do not touch anything until
the outcome card appears. Speak over the stream as the matching lines land
(INTERPRET → FEASIBILITY → POLICY → ACTION/ERROR 409 → OBSERVE → REPLAN →
VERIFY → RESOLVED).

> "First, Gemini extracts the schedule change through a strict schema. It
> reads language. It cannot authorize actions.
>
> Dira pushes the change through its stored commitment graph and recomputes
> the week. Global slack drops from plus four point one hours to minus three
> point six. The week is now infeasible, and Dira can prove exactly why.
>
> Deterministic policy limits what it may do: only an approved interview
> slot, only the designated backup, only personal blocks marked flexible.
>
> Now watch the failure. The first listed interview slot is stale. Dira
> attempts the booking, receives a 409 conflict, and does not pretend it
> worked. I stay hands off. It refreshes the world, rules that option out,
> and replans.
>
> It books the other approved slot, hands visual QA to the designated backup,
> rebuilds the study plan, and then verifies every change by reading each
> system back. A successful API response is never taken on faith.
>
> Resolved. Slack is positive again at one point three hours, with zero
> human actions after the trigger."

### 2:20–2:35 — the repair receipt *(still Tab 2)*

**Where:** Tab 2, the outcome card that appeared under the stream. **Do:**
move the cursor across the **Protected / Changed / Recovered / Verified**
tiles, click open **Why not the other repair options?** for one beat, then
point at the small monospace line at the bottom of the card that starts with
`workflow wf-evt-…`. Triple-click it to highlight, and copy it — you need it
in the next beat.

> "This card is the repair receipt: what Dira protected, what it changed, the
> failure it recovered from, and what it re-read to verify. Open this section
> and you can see why the losing options were rejected. Most agents give you
> an answer. Dira shows its work. Keep an eye on this workflow ID."

### 2:35–3:08 — outcomes proven, tied by the workflow ID

**Do, in order:**

1. Tab 7 (Calendar "after"): refresh it, still on Aug 16–22. What visibly
   changed: the TechCorp interview now sits on **Thursday** (it started
   Wednesday evening), the workout and side-project blocks moved, and the
   study plan is rebuilt with new solver-placed blocks. The midterm event
   itself stays put on the calendar: the exam time is the professor's
   external fact, Dira repairs everything around it. ~6 seconds. (Tab 6
   remains the untouched "before" for one flip of contrast.)
2. Tab 4 (Logs Explorer): use the **query editor pane** (the multi-line
   `Show query` box), not the top search bar — the search bar wraps your
   text in a SEARCH() clause that won't match. Delete everything in the
   editor, then type `jsonPayload.run="` + the workflow ID you copied from
   the outcome card (the `wf-evt-…` string) + `"`. Set the **time range**
   picker (top right) to **Last 1 hour** — a stale custom range returns
   "No data found" even when the entry exists. Press **Run query**. Click the expand arrow on the entry whose summary says
   **workflow finished**; the expanded `jsonPayload` shows the Gemini model
   and latency. ~12 seconds. This is the Logs Explorer tab, not the Cloud
   Run service's Logs panel.
3. Tab 5 (Firestore): in `action_ledger`, the document IDs begin with the
   same workflow ID — click one, point at its `workflowId` and
   `status: VERIFIED` fields. Then click the `recruiter_confirmed`
   collection (the booking) and `org_tasks` (the reassigned owner), and
   `outbound_messages` (the notification record). ~12 seconds.

> "The real calendar changed and was independently re-read. In Cloud Logging,
> filtering by that same workflow ID finds this exact run on the server, with
> the Gemini model and latency. In Firestore, the same ID sits on the
> confirmed booking, the reassigned task, the notification record, and a
> ledger entry that ends in VERIFIED. The recruiter, organization, and
> notification systems are controlled Firestore stand-ins and are labeled
> that way. The calendar is real."

**On-screen lower third during this beat:**

```text
REAL: Vertex AI · Cloud Run · Firestore · Google Calendar
CONTROLLED: recruiter availability · organization task · notification outbox
```

### 3:08–3:20 — safe counterfactual *(pre-captured clip)*

**Where:** cut to the separately captured clip: Tab 2 with the
**No slots available** scenario selected, triggered the same way, ending in
the safe-stop outcome. Label it `COUNTERFACTUAL RUN` in the edit.

> "One more run, this time with every approved interview slot removed. Dira
> stops and says why, instead of inventing an appointment. A different world
> produces a different plan."

**Caption:** `NO APPROVED SLOT → SAFE STOP, NOT FABRICATED SUCCESS`

### 3:20–3:45 — architecture and close

**Where:** the architecture diagram (GitHub tab or a local image), then cut
back to Tab 2's resolved outcome card for the final line.

> "The design rule is simple: Gemini interprets, deterministic code decides.
> Feasibility, permissions, and planning are computed, property-tested, and
> replayable. Firestore makes every action durable and idempotent, and
> independent verifiers confirm the world actually changed.
>
> Dira does not remind you that your week broke. It repairs it, and hands you
> the proof. One thing changes. Everything adapts."

## Final recording checklist

- [ ] `LIVE CLOUD` visible from click through `RESOLVED`; segment uncut and
      ≤ ~110 seconds.
- [ ] The 409, observe, replan, verify, and positive slack are readable.
- [ ] Raw `.run.app` `/health` response shown (browser Tab 8 or terminal).
- [ ] Workflow ID visibly identical on the outcome card, the Logs Explorer
      entry, and the Firestore ledger document.
- [ ] Calendar before/after shown on the seeded Aug 16–22 week; the
      controlled-integration disclosure spoken **and** displayed.
- [ ] No token, calendar ID, personal email, or Cloud Run Logs panel on
      screen at any point.
- [ ] English, under 4:00 (captured ≤ 3:55), uploaded **public/unlisted** to
      YouTube or Vimeo; link tested signed-out; URL pasted into the Devpost
      text before submitting.

## Claims to keep precise

- "Seeded stale-listing race," not "spontaneous live outage."
- "No human intervention after the trigger," not "no human action."
- "Gemini interprets," never "Gemini decides/authorizes."
- "Notification record/outbox," never "Gmail was sent."
- "Controlled Firestore integration," never "recruiter API" or a production
  connector.
- Gemma is CPU-fallback; it does not appear in this video without a real
  captured voice-note run, and is never called GPU-backed.
