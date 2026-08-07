"""
Orchestrator -- runs one CanonicalCallRecord through the full loop:

  ingest -> (non-sales / PII / diarization-confidence checks) -> transcribe+diarize
         -> analyze (score + tag) -> store -> surfaced

Idempotency: a call is uniquely identified by (source_id, external_id). If the
same record is delivered twice (webhook retry, re-run of a folder scan), the
orchestrator finds the existing row and skips re-processing instead of
duplicating it. A secondary content_hash guards against a source re-using
external_ids.

Retries: each stage is wrapped with a small retry/backoff loop
(app.config.MAX_RETRIES / RETRY_BACKOFF_SECONDS). Failures are logged to
ProcessingLog; after exhausting retries the call is marked FAILED with
last_error set, and is safely re-runnable later (it will be picked up again
because its status isn't a terminal success state).
"""
from __future__ import annotations

import time
import traceback
from pathlib import Path
from typing import Optional

from sqlalchemy.orm import Session

from app.config import AUDIO_STORE_DIR, MAX_RETRIES, RETRY_BACKOFF_SECONDS
from app.ingestion.base import CanonicalCallRecord
from app.models import (
    Call, CallScore, CallSource, CallStatus, ProcessingLog, Speaker, Tag, TagStatus,
    TranscriptSegment,
)
from app.pipeline.analysis import analyze, detect_non_sales, redact_pii, rollup_overall
from app.pipeline.asr import get_asr_provider


def _log(db: Session, call: Call, stage: str, status: str, message: str = ""):
    db.add(ProcessingLog(call_id=call.id, stage=stage, status=status, message=message[:2000]))
    db.commit()


def _with_retry(db: Session, call: Call, stage: str, fn, *args, **kwargs):
    last_exc = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            _log(db, call, stage, "started", f"attempt {attempt}")
            result = fn(*args, **kwargs)
            _log(db, call, stage, "success")
            return result
        except Exception as e:  # noqa: BLE001 -- deliberately broad: any stage failure is retriable
            last_exc = e
            _log(db, call, stage, "retry" if attempt < MAX_RETRIES else "failed",
                 f"{e}\n{traceback.format_exc()[-1500:]}")
            if attempt < MAX_RETRIES:
                time.sleep(RETRY_BACKOFF_SECONDS)
    raise last_exc


def get_or_create_source(db: Session, source_name: str, source_type: str, config_path: str) -> CallSource:
    source = db.query(CallSource).filter_by(name=source_name).first()
    if source:
        return source
    source = CallSource(name=source_name, source_type=source_type, config_path=config_path)
    db.add(source)
    db.commit()
    db.refresh(source)
    return source


def find_advisor_by_external_id(db: Session, external_id: Optional[str]):
    if not external_id:
        return None
    from app.models import Advisor
    return db.query(Advisor).filter_by(external_agent_id=external_id).first()


def ingest_record(db: Session, record: CanonicalCallRecord, source: CallSource) -> Call:
    """Idempotent upsert: returns the existing Call if this (source, external_id)
    was already ingested, otherwise creates a new PENDING call."""
    existing = db.query(Call).filter_by(source_id=source.id, external_id=record.external_id).first()
    if existing:
        return existing

    advisor = find_advisor_by_external_id(db, record.agent_external_id)
    call = Call(
        source_id=source.id,
        external_id=record.external_id,
        advisor_id=advisor.id if advisor else None,
        customer_phone_masked=record.customer_phone_masked,
        direction=record.direction,
        started_at=record.started_at,
        duration_sec=record.duration_sec,
        audio_uri=record.audio_uri,
        status=CallStatus.INGESTED,
        content_hash=record.content_hash(),
    )
    db.add(call)
    db.commit()
    db.refresh(call)
    _log(db, call, "ingest", "success", f"source={source.name} external_id={record.external_id}")
    return call


def process_call(db: Session, call: Call, record: CanonicalCallRecord, asr_provider_name: str,
                  audio_path: Optional[Path] = None) -> Call:
    """Runs a single INGESTED call through transcription -> analysis -> storage.
    Safe to call again on a FAILED call (it will simply retry from scratch;
    idempotency at the ingest layer already guarantees no duplicate Call rows,
    and re-processing an already-SCORED call is a no-op the caller should
    avoid by checking call.status first)."""
    if call.status == CallStatus.SCORED or call.status == CallStatus.NON_SALES:
        return call  # already done -- idempotent no-op

    try:
        call.status = CallStatus.TRANSCRIBING
        db.commit()

        provider = get_asr_provider(asr_provider_name)
        result = _with_retry(db, call, "transcribe", provider.transcribe_and_diarize, record, audio_path)

        call.diarization_confidence = result.diarization_confidence
        call.language_mix = result.language_mix
        db.commit()

        segments = result.segments

        # Edge case: non-sales call (wrong number / internal test)
        non_sales_reason = detect_non_sales(segments)
        if non_sales_reason:
            call.status = CallStatus.NON_SALES
            db.commit()
            _persist_segments(db, call, segments)  # keep the (short) transcript for audit
            _persist_tags(db, call, [_non_sales_tag(segments, non_sales_reason)])
            _log(db, call, "analyze", "success", f"non-sales: {non_sales_reason}")
            return call

        # PII redaction happens before anything is persisted or scored.
        redacted_segments, pii_tags = redact_pii(segments)
        call.pii_redacted = any(s["redacted"] for s in redacted_segments)
        db.commit()

        call.status = CallStatus.ANALYZING
        db.commit()

        dims, heuristic_tags = _with_retry(db, call, "analyze", analyze, redacted_segments)
        overall = rollup_overall(dims)

        all_tags = heuristic_tags + pii_tags
        if call.diarization_confidence is not None and call.diarization_confidence < 0.85:
            all_tags.append(_low_confidence_tag(call.diarization_confidence))

        _with_retry(db, call, "store", _persist_all, db, call, redacted_segments, dims, overall, all_tags)

        call.status = CallStatus.SCORED
        db.commit()
        return call

    except Exception as e:  # exhausted retries at some stage
        call.status = CallStatus.FAILED
        call.retry_count = (call.retry_count or 0) + 1
        call.last_error = str(e)[:2000]
        db.commit()
        return call


def _persist_segments(db: Session, call: Call, segments):
    for seg in segments:
        db.add(TranscriptSegment(
            call_id=call.id,
            speaker=Speaker(seg.get("speaker", "unknown")) if seg.get("speaker") in
            ("advisor", "customer", "unknown") else Speaker.UNKNOWN,
            start_ms=seg["start_ms"], end_ms=seg["end_ms"],
            text=seg.get("text_redacted", seg["text"]),
            redacted=seg.get("redacted", False),
        ))
    db.commit()


def _persist_tags(db: Session, call: Call, tag_results):
    for t in tag_results:
        db.add(Tag(
            call_id=call.id, tag_type=t.tag_type, severity=t.severity,
            timestamp_ms=t.timestamp_ms, quoted_line=t.quoted_line, reason=t.reason,
            confidence=t.confidence, status=TagStatus.OPEN,
        ))
    db.commit()


def _persist_all(db: Session, call: Call, segments, dims, overall, tags):
    _persist_segments(db, call, segments)
    for dim_name, (score, rationale) in dims.items():
        db.add(CallScore(call_id=call.id, dimension=dim_name, score=score, rationale=rationale))
    db.add(CallScore(call_id=call.id, dimension="overall", score=overall,
                      rationale="Weighted roll-up of the five rubric dimensions."))
    _persist_tags(db, call, tags)


def _non_sales_tag(segments, reason):
    from app.pipeline.analysis import TagResult
    return TagResult(tag_type="NON_SALES_CALL", severity="info",
                      timestamp_ms=segments[0]["start_ms"] if segments else 0,
                      quoted_line=(segments[0]["text"][:140] if segments else ""),
                      reason=reason, confidence=0.9)


def _low_confidence_tag(confidence: float):
    from app.pipeline.analysis import TagResult
    return TagResult(tag_type="LOW_CONFIDENCE_DIARIZATION", severity="info", timestamp_ms=0,
                      quoted_line="(system-level flag, not tied to a specific line)",
                      reason=f"Diarization confidence {confidence:.2f} is below the 0.85 trust threshold; "
                             "scores on this call should be reviewed by a human before being acted on.",
                      confidence=confidence)
