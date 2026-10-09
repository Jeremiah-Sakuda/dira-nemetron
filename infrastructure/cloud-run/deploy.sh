#!/usr/bin/env bash
# Deploys Dira's backend to Cloud Run (PRD §32) — one honest service.
#
# Transitional v1 infrastructure: the orchestrator uses Nemotron through
# Nebius Token Factory, with the Firestore ledger/state, real Google Calendar
# mutations, and the controlled recruiter/org integrations. The executor and
# verifier stages run in-process behind the transactional Firestore ledger
# (DEVIATIONS.md #12); max-instances=1 keeps single-writer semantics until a
# multi-worker split is needed.
#
# Requires: gcloud auth; a project with Cloud Run, Cloud Build, Artifact
# Registry (docker repo "dira"), Firestore (native), and the Google Calendar
# API enabled; the compute SA holding roles/datastore.user. Configure the
# NEBIUS_API_KEY secret through provision.sh.
set -euo pipefail

PROJECT="${DIRA_PROJECT:?set DIRA_PROJECT}"
REGION="${DIRA_REGION:-us-central1}"
NEMOTRON_MODEL="${DIRA_NEMOTRON_MODEL:-nvidia/nemotron-3-super-120b-a12b}"
SHARE_WITH="${DIRA_SHARE_CALENDAR_WITH:-}"
ALLOWED_ORIGIN="${DIRA_ALLOWED_ORIGIN:?set DIRA_ALLOWED_ORIGIN to the public dashboard origin}"
SERVICE_ACCOUNT="dira-orchestrator@${PROJECT}.iam.gserviceaccount.com"
GEMMA3N_URL="${DIRA_GEMMA3N_URL:-}"

# Gemma voice intake is optional. When configured, the orchestrator receives
# only the internal service URL and an app-scoped token; it never receives the
# Hugging Face credential used by the Gemma service itself.
GEMMA_ENV=""
GEMMA_SECRET=""
if [[ -n "$GEMMA3N_URL" ]]; then
  GEMMA_ENV=",DIRA_GEMMA3N_URL=${GEMMA3N_URL}"
  GEMMA_SECRET=",DIRA_GEMMA3N_TOKEN=dira-gemma3n-token:latest"
fi

gcloud builds submit \
  --project "$PROJECT" \
  --config infrastructure/cloud-run/cloudbuild.yaml \
  --substitutions "_SERVICE=orchestrator,_REGION=${REGION}" \
  .

gcloud run deploy dira-orchestrator \
  --project "$PROJECT" \
  --region "$REGION" \
  --image "$REGION-docker.pkg.dev/$PROJECT/dira/dira-orchestrator" \
  --allow-unauthenticated \
  --service-account "$SERVICE_ACCOUNT" \
  --max-instances 1 \
  --memory 1Gi \
  --set-env-vars "REPLAY_MODE=production,DIRA_NEMOTRON_MODEL=${NEMOTRON_MODEL},NEBIUS_TOKEN_FACTORY_BASE_URL=https://api.tokenfactory.nebius.com/v1,DIRA_SHARE_CALENDAR_WITH=${SHARE_WITH},DIRA_ALLOWED_ORIGIN=${ALLOWED_ORIGIN}${GEMMA_ENV}" \
  --set-secrets "DIRA_DEMO_TOKEN=dira-demo-token:latest,NEBIUS_API_KEY=nebius-api-key:latest${GEMMA_SECRET}"

echo
echo "Service URL:"
gcloud run services describe dira-orchestrator --project "$PROJECT" --region "$REGION" --format 'value(status.url)'

# The Vercel server-side replay proxy uses DIRA_CLOUD_RUN_URL and the same
# DIRA_DEMO_TOKEN. Never expose that token through NEXT_PUBLIC_* variables.
