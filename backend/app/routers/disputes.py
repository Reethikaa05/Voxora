from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models import Dispute, DisputeStatus, Tag, TagStatus
from app.schemas import DisputeCreate, DisputeResolve

router = APIRouter(prefix="/api/disputes", tags=["disputes"])


@router.post("/tags/{tag_id}")
def raise_dispute(tag_id: str, payload: DisputeCreate, db: Session = Depends(get_db)):
    tag = db.query(Tag).filter_by(id=tag_id).first()
    if not tag:
        raise HTTPException(404, "Tag not found")
    if tag.dispute:
        raise HTTPException(400, "This tag already has a dispute")

    dispute = Dispute(tag_id=tag.id, advisor_id=payload.advisor_id, reason=payload.reason)
    tag.status = TagStatus.DISPUTED
    db.add(dispute)
    db.commit()
    db.refresh(dispute)
    return {"id": dispute.id, "tag_id": tag.id, "status": dispute.status.value}


@router.get("")
def list_disputes(status: str = "pending", db: Session = Depends(get_db)):
    q = db.query(Dispute).options(joinedload(Dispute.tag))
    if status != "all":
        q = q.filter(Dispute.status == status)
    disputes = q.order_by(Dispute.created_at.desc()).all()
    return [{
        "id": d.id, "tag_id": d.tag_id, "call_id": d.tag.call_id, "tag_type": d.tag.tag_type,
        "severity": d.tag.severity, "quoted_line": d.tag.quoted_line, "reason": d.reason,
        "status": d.status.value, "created_at": d.created_at.isoformat(),
    } for d in disputes]


@router.post("/{dispute_id}/resolve")
def resolve_dispute(dispute_id: str, payload: DisputeResolve, db: Session = Depends(get_db)):
    dispute = db.query(Dispute).options(joinedload(Dispute.tag)).filter_by(id=dispute_id).first()
    if not dispute:
        raise HTTPException(404, "Dispute not found")
    if payload.status not in ("accepted", "rejected"):
        raise HTTPException(400, "status must be 'accepted' or 'rejected'")

    dispute.status = DisputeStatus(payload.status)
    dispute.resolved_by = payload.resolved_by
    dispute.resolution_note = payload.resolution_note
    from datetime import datetime
    dispute.resolved_at = datetime.utcnow()

    # This is the loop-closing step: a resolved dispute changes the tag's
    # final state, which the dashboards + risk index immediately respect.
    # In production this table is also what you'd mine weekly to refine the
    # heuristic patterns / LLM few-shot examples for tag types with a high
    # "accepted" (i.e. false-positive) rate.
    dispute.tag.status = TagStatus.DISMISSED if payload.status == "accepted" else TagStatus.UPHELD

    db.commit()
    return {"id": dispute.id, "status": dispute.status.value, "tag_status": dispute.tag.status.value}


@router.get("/false_positive_rate")
def false_positive_rate(db: Session = Depends(get_db)):
    """Per tag_type, share of resolved disputes that were accepted (i.e. the
    system was wrong). This is literally the signal you'd use to retune the
    heuristics or the LLM prompt over time."""
    from collections import defaultdict
    disputes = db.query(Dispute).options(joinedload(Dispute.tag)) \
        .filter(Dispute.status != DisputeStatus.PENDING).all()
    totals = defaultdict(lambda: {"resolved": 0, "accepted": 0})
    for d in disputes:
        t = totals[d.tag.tag_type]
        t["resolved"] += 1
        if d.status == DisputeStatus.ACCEPTED:
            t["accepted"] += 1
    return {
        tag_type: {**v, "false_positive_rate": round(v["accepted"] / v["resolved"], 2) if v["resolved"] else None}
        for tag_type, v in totals.items()
    }
