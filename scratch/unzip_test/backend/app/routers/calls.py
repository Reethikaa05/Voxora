from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models import Advisor, Call, CallScore, Tag, Team

router = APIRouter(prefix="/api/calls", tags=["calls"])


def _call_summary(call: Call, db: Session):
    advisor = call.advisor
    team = advisor.team if advisor else None
    overall = next((s.score for s in call.scores if s.dimension == "overall"), None)
    open_tags = [t for t in call.tags if t.status.value in ("open", "disputed")]
    return {
        "call_id": call.id,
        "external_id": call.external_id,
        "advisor_id": advisor.id if advisor else None,
        "advisor_name": advisor.name if advisor else "Unassigned",
        "team_id": team.id if team else None,
        "team_name": team.name if team else None,
        "status": call.status.value,
        "started_at": call.started_at.isoformat() if call.started_at else None,
        "duration_sec": call.duration_sec,
        "overall_score": overall,
        "tag_count": len(open_tags),
        "top_severity": _top_severity(open_tags),
        "diarization_confidence": call.diarization_confidence,
        "language_mix": call.language_mix,
        "pii_redacted": call.pii_redacted,
    }


def _top_severity(tags):
    order = {"critical": 4, "high": 3, "medium": 2, "low": 1, "info": 0}
    if not tags:
        return None
    return max((t.severity for t in tags), key=lambda s: order.get(s, 0))


@router.get("")
def list_calls(team_id: Optional[str] = None, advisor_id: Optional[str] = None,
               status: Optional[str] = None, tag_type: Optional[str] = None,
               limit: int = 100, db: Session = Depends(get_db)):
    q = db.query(Call).options(joinedload(Call.advisor).joinedload(Advisor.team),
                                joinedload(Call.scores), joinedload(Call.tags))
    if advisor_id:
        q = q.filter(Call.advisor_id == advisor_id)
    if team_id:
        q = q.join(Advisor).filter(Advisor.team_id == team_id)
    if status:
        q = q.filter(Call.status == status)
    calls = q.order_by(Call.created_at.desc()).limit(limit).all()

    if tag_type:
        calls = [c for c in calls if any(t.tag_type == tag_type for t in c.tags)]

    return [_call_summary(c, db) for c in calls]


@router.get("/{call_id}")
def get_call(call_id: str, db: Session = Depends(get_db)):
    call = db.query(Call).options(
        joinedload(Call.segments), joinedload(Call.scores), joinedload(Call.tags).joinedload(Tag.dispute),
        joinedload(Call.advisor).joinedload(Advisor.team),
    ).filter(Call.id == call_id).first()
    if not call:
        raise HTTPException(404, "Call not found")

    advisor = call.advisor
    team = advisor.team if advisor else None

    return {
        "call_id": call.id,
        "external_id": call.external_id,
        "status": call.status.value,
        "advisor": {"id": advisor.id, "name": advisor.name} if advisor else None,
        "team": {"id": team.id, "name": team.name} if team else None,
        "started_at": call.started_at.isoformat() if call.started_at else None,
        "duration_sec": call.duration_sec,
        "diarization_confidence": call.diarization_confidence,
        "language_mix": call.language_mix,
        "pii_redacted": call.pii_redacted,
        "last_error": call.last_error,
        "segments": [{
            "id": s.id, "speaker": s.speaker.value, "start_ms": s.start_ms, "end_ms": s.end_ms,
            "text": s.text, "redacted": s.redacted,
        } for s in sorted(call.segments, key=lambda s: s.start_ms)],
        "scores": [{
            "dimension": s.dimension, "score": s.score, "rationale": s.rationale,
        } for s in call.scores],
        "tags": [{
            "id": t.id, "tag_type": t.tag_type, "severity": t.severity, "timestamp_ms": t.timestamp_ms,
            "quoted_line": t.quoted_line, "reason": t.reason, "confidence": t.confidence,
            "status": t.status.value,
            "dispute": ({
                "id": t.dispute.id, "reason": t.dispute.reason, "status": t.dispute.status.value,
                "resolution_note": t.dispute.resolution_note,
            } if t.dispute else None),
        } for t in call.tags],
        "logs": [{
            "stage": log.stage, "status": log.status, "message": log.message,
            "created_at": log.created_at.isoformat(),
        } for log in call.logs],
    }
