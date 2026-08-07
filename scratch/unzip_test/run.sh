#!/usr/bin/env bash
# One-command demo runner for FitNova Call Intelligence.
# Installs deps (if needed), seeds the org, starts the API + dashboard,
# then runs the pipeline over the sample calls.
set -e

cd "$(dirname "$0")"

echo "==> Installing Python dependencies..."
pip install -q -r requirements.txt

cd backend

echo "==> Seeding org hierarchy (idempotent)..."
python -c "from app.seed import seed; seed()"

echo "==> Starting API + dashboard on http://localhost:8000 ..."
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 &
SERVER_PID=$!
trap "kill $SERVER_PID 2>/dev/null" EXIT

sleep 2

echo "==> Running the pipeline over sample_data/calls/ (ingest -> transcribe -> analyze -> store)..."
curl -s -X POST http://localhost:8000/api/ingest/run \
  -H "Content-Type: application/json" \
  -d '{"source_name":"manual_upload"}' | python -m json.tool

echo ""
echo "=================================================================="
echo " FitNova Call Intelligence is running:  http://localhost:8000"
echo " Click 'Run pipeline' in the sidebar any time to re-run ingestion."
echo " Press Ctrl+C to stop."
echo "=================================================================="

wait $SERVER_PID
