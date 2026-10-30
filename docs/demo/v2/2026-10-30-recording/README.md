# Dira demo recording — October 30, 2026

## Files

- `dira-demo-gemini-2m40.mp4`: the narrated export, 2:40, 1920 × 1080, 30 fps, H.264/AAC. Narration uses Gemini 2.5 Flash TTS, voice Kore, through Google Cloud Vertex AI.
- `dira-demo-gemini-2m40.vtt` / `.srt`: chapter-aligned English captions for the narrated export; cue timings within each chapter are approximate.
- `dira-gemini-narration.wav`: the separate fitted narration track.
- `gemini-narration.json`: model, voice, chapter timings, reported token usage and estimated TTS cost.
- `gemini-media-check.json`: narrated export metadata, decode, audio levels and original-video preservation checks.
- `dira-demo-silent-2m40.mp4`: 2:40, 1920 × 1080, 30 fps, H.264. No audio track, music, or generated narration.
- `voiceover-script.md`: the agreed narration, divided into eight timed chapters.
- `voiceover-guide.vtt`: optional timing guide for that script. It describes the intended narration; it is not a transcript of audio in the silent file.
- `timeline.json`: source cuts, reframing, chapter times, and disclosure information.
- `preview.jpg`: a frame from the exported video.
- `screen-recording-proof.txt`: synthetic flight-record evidence from this run.
- `egress-denied.png`: the actual recorded public app displaying the audited denial.
- `media-check.json`: export metadata and decode check.

## Narration

Gemini generated the agreed script as eight chapters. Each chapter is fitted to the original scene boundaries with pitch-preserving tempo adjustment, consistent speech volume and short gaps between chapters. The recorded video frames are copied directly from the silent master. Gemini supplies video narration; the app's demonstrated inference remains Nemotron on Nebius Token Factory.

The generation and mixing commands use the owner's existing `gcloud` login. Reproduce with `scripts/narrate-demo-gemini.py` and `scripts/mix-demo-narration.py`; pass the intended Cloud project explicitly. Saved takes are reused on reruns.

## Optional: add your own voice

Import the MP4 into your video editor and keep its start at 0:00. Record the script one chapter at a time, using the chapter boundaries in the script. Add only your recorded narration, then export as H.264 MP4 at 1920 × 1080. Keep the complete video below three minutes. Import the VTT as an optional caption starting point and adjust its timings to match your actual speech.

## What was recorded

Actual Chrome screen footage of the public Vercel deployment, using a fresh synthetic demo account. The professor's schedule-change email led to three conflicts and negative slack. Nemotron Super interpreted the email and Ultra proposed structured repairs through Nebius Token Factory. The labeled adversarial proposal was rejected. Execution paused for the owner's approval. A simulated unavailable interview slot produced a 409, followed by replanning, thirteen verified actions, and +1.3 hours of slack. The interview remained explicitly awaiting its counterparty. The final host probe produced an audited application-level HTTP 403.

The calendar, mailbox, interview slots, people, and approval account in this recording are simulations. Token Factory inference is real. No personal Google data or real messages are shown or sent. The winning repair is deterministic; the trace shows Ultra's subsequent stale-slot proposal being rejected. OpenShell/NemoClaw does not enforce the network boundary around the hosted app; this limitation remains visible and is included in the script.

The edit shortens waits, holds some frames for narration, and enlarges selected portions of the actual footage for legibility. The footer identifies simulations and real inference throughout, and labels shortened waits and narration holds. The final URL panel and chapter titles are editorial overlays. Settings and Rules are shown as feature views; this fresh demo account has no confirmed reusable rules.

## Publication status

The narrated export is prepared locally. This recording has not been uploaded or submitted. `docs/submission/youtube-upload.md` contains the prepared public title and description.
