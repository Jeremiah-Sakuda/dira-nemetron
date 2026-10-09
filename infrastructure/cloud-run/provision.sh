#!/usr/bin/env bash
# One-time Google Cloud provisioning for the Dira production demo.
set -euo pipefail

PROJECT="${DIRA_PROJECT:?set DIRA_PROJECT to the dedicated Dira GCP project}"
REGION="${DIRA_REGION:-us-central1}"
SERVICE_ACCOUNT="dira-orchestrator@${PROJECT}.iam.gserviceaccount.com"

gcloud services enable \
  artifactregistry.googleapis.com \
  calendar-json.googleapis.com \
  cloudbuild.googleapis.com \
  firestore.googleapis.com \
  run.googleapis.com \
  secretmanager.googleapis.com \
  --project "$PROJECT"

if ! gcloud artifacts repositories describe dira \
  --project "$PROJECT" --location "$REGION" >/dev/null 2>&1; then
  gcloud artifacts repositories create dira \
    --project "$PROJECT" --location "$REGION" \
    --repository-format docker --description "Dira Cloud Run images"
fi

if ! gcloud iam service-accounts describe "$SERVICE_ACCOUNT" \
  --project "$PROJECT" >/dev/null 2>&1; then
  gcloud iam service-accounts create dira-orchestrator \
    --project "$PROJECT" --display-name "Dira orchestrator"
fi

for ROLE in roles/datastore.user roles/logging.logWriter; do
  gcloud projects add-iam-policy-binding "$PROJECT" \
    --member "serviceAccount:${SERVICE_ACCOUNT}" \
    --role "$ROLE" --condition=None >/dev/null
done

if ! gcloud firestore databases describe --database='(default)' \
  --project "$PROJECT" >/dev/null 2>&1; then
  gcloud firestore databases create --database='(default)' \
    --project "$PROJECT" --location "$REGION" --type=firestore-native
fi

if ! gcloud secrets describe dira-demo-token --project "$PROJECT" >/dev/null 2>&1; then
  : "${DIRA_DEMO_TOKEN:?set DIRA_DEMO_TOKEN before first-time provisioning}"
  printf '%s' "$DIRA_DEMO_TOKEN" | gcloud secrets create dira-demo-token \
    --project "$PROJECT" --replication-policy automatic --data-file=-
fi

gcloud secrets add-iam-policy-binding dira-demo-token \
  --project "$PROJECT" \
  --member "serviceAccount:${SERVICE_ACCOUNT}" \
  --role roles/secretmanager.secretAccessor >/dev/null

if ! gcloud secrets describe nebius-api-key --project "$PROJECT" >/dev/null 2>&1; then
  : "${NEBIUS_API_KEY:?set NEBIUS_API_KEY before first-time Token Factory provisioning}"
  printf '%s' "$NEBIUS_API_KEY" | gcloud secrets create nebius-api-key \
    --project "$PROJECT" --replication-policy automatic --data-file=-
fi

gcloud secrets add-iam-policy-binding nebius-api-key \
  --project "$PROJECT" \
  --member "serviceAccount:${SERVICE_ACCOUNT}" \
  --role roles/secretmanager.secretAccessor >/dev/null

echo "Dira legacy service prerequisites and Token Factory credentials are ready in ${PROJECT}/${REGION}."
