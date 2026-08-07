from pathlib import Path

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.config import ASR_PROVIDER, PROJECT_ROOT
from app.database import get_db
from app.ingestion.file_adapter import FolderDropAdapter
from app.models import Call, CallStatus
from app.pipeline.orchestrator import get_or_create_source, ingest_record, process_call
from app.schemas import IngestTriggerRequest

router = APIRouter(prefix="/api/ingest", tags=["ingest"])

SOURCE_CONFIGS_DIR = Path(__file__).resolve().parent.parent / "ingestion" / "source_configs"
SAMPLE_CALLS_DIR = PROJECT_ROOT / "sample_data" / "calls"


@router.post("/run")
def run_ingest(req: IngestTriggerRequest, db: Session = Depends(get_db)):
    """
    Runs the whole loop end to end for every not-yet-seen record in
    sample_data/calls/: ingest (idempotent) -> transcribe/diarize -> analyze
    -> score/tag -> store. Safe to call repeatedly -- already-scored calls
    are skipped, and previously-failed calls are retried.
    """
    config_path = SOURCE_CONFIGS_DIR / f"{req.source_name}.yaml"
    if not config_path.exists():
        return {"error": f"No field-map config for source '{req.source_name}' at {config_path}"}

    adapter = FolderDropAdapter(watch_dir=SAMPLE_CALLS_DIR, config_path=config_path)
    source = get_or_create_source(db, adapter.source_name, "file_drop", str(config_path))

    asr_provider_name = req.asr_provider or ASR_PROVIDER

    records = adapter.fetch_new_records()
    results = []
    for record in records:
        call = ingest_record(db, record, source)
        if call.status in (CallStatus.SCORED, CallStatus.NON_SALES):
            results.append({"external_id": record.external_id, "call_id": call.id,
                             "status": call.status.value, "skipped": True})
            continue
        audio_path = adapter.resolve_audio_path(record)
        call = process_call(db, call, record, asr_provider_name, audio_path)
        results.append({"external_id": record.external_id, "call_id": call.id,
                         "status": call.status.value, "skipped": False,
                         "error": call.last_error})

    return {
        "source": adapter.source_name,
        "records_seen": len(records),
        "results": results,
    }


@router.get("/status")
def ingest_status(db: Session = Depends(get_db)):
    counts = {}
    for status in CallStatus:
        counts[status.value] = db.query(Call).filter_by(status=status).count()
    return {"counts": counts, "total": db.query(Call).count()}
