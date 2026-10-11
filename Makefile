# Dira — one-command entry points for judges and developers.
# Everything here runs credential-free: no Google OAuth, no cloud project needed.

.PHONY: install demo-replay demo-variations replay-20x demo-video test typecheck ci web eval-repair-fixture test-postgres

install:
	npm install

# The golden 48-Hour Shock workflow, end to end, with the injected 409 failure.
demo-replay:
	npm run demo:replay

# Same workflow across the runtime-variation matrix (exam time, slot outages, ...).
demo-variations:
	npm run demo:variations

# Reliability evidence: 20 consecutive deterministic replays.
replay-20x:
	npm run demo:replay:20x

# v1 artifact: a 72-second captioned walkthrough generated only from checked-in
# deterministic results (docs/demo/v1). The v2 video follows docs/demo/video-script.md.
demo-video:
	bash scripts/render-demo-video.sh

test:
	npm test

typecheck:
	npm run typecheck

ci: typecheck test replay-20x

# Repair-proposer gates without credentials (prints only; never writes evidence).
eval-repair-fixture:
	npm run eval:repair -- --fixture

# Postgres integration tests against a disposable database owned by a NON-superuser role.
test-postgres:
	npm run test:postgres

web:
	npm --workspace apps/web run dev
