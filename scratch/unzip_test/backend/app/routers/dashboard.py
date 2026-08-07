from collections import defaultdict
from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session, joinedload

from app.config import SEVERITY_WEIGHT
from app.database import get_db
from app.models import Advisor, Call, CallScore, CallStatus, Tag, Team

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


def _scored_calls(db: Session, team_id: Optional[str] = None, advisor_id: Optional[str] = None):
    q = db.query(Call).options(joinedload(Call.scores), joinedload(Call.tags),
                                joinedload(Call.advisor).joinedload(Advisor.team)) \
        .filter(Call.status == CallStatus.SCORED)
    if advisor_id:
        q = q.filter(Call.advisor_id == advisor_id)
    if team_id:
        q = q.join(Advisor).filter(Advisor.team_id == team_id)
    return q.all()


def _overall(call: Call) -> Optional[float]:
    return next((s.score for s in call.scores if s.dimension == "overall"), None)


def _dim_avgs(calls):
    sums = defaultdict(float)
    counts = defaultdict(int)
    for c in calls:
        for s in c.scores:
            if s.dimension != "overall":
                sums[s.dimension] += s.score
                counts[s.dimension] += 1
    return {d: round(sums[d] / counts[d], 2) for d in sums if counts[d]}


def _tag_distribution(calls):
    dist = defaultdict(int)
    for c in calls:
        for t in c.tags:
            if t.status.value != "dismissed":
                dist[t.tag_type] += 1
    return dict(sorted(dist.items(), key=lambda kv: -kv[1]))


def _risk_index(calls) -> float:
    """Weighted count of open/upheld tags by severity, normalized per call --
    a single number Team Leaders / the Sales Director can sort by."""
    if not calls:
        return 0.0
    total = 0
    for c in calls:
        for t in c.tags:
            if t.status.value in ("open", "disputed", "upheld") and t.severity in SEVERITY_WEIGHT:
                total += SEVERITY_WEIGHT[t.severity]
    return round(total / len(calls), 2)


@router.get("/org")
def org_overview(db: Session = Depends(get_db)):
    calls = _scored_calls(db)
    overalls = [_overall(c) for c in calls if _overall(c) is not None]
    avg_overall = round(sum(overalls) / len(overalls), 1) if overalls else None

    teams = db.query(Team).all()
    team_rows = []
    for t in teams:
        t_calls = [c for c in calls if c.advisor and c.advisor.team_id == t.id]
        t_overalls = [_overall(c) for c in t_calls if _overall(c) is not None]
        team_rows.append({
            "team_id": t.id, "team_name": t.name, "leader_name": t.leader_name,
            "advisor_count": len(t.advisors),
            "call_count": len(t_calls),
            "avg_score": round(sum(t_overalls) / len(t_overalls), 1) if t_overalls else None,
            "risk_index": _risk_index(t_calls),
        })
    team_rows.sort(key=lambda r: (r["avg_score"] is None, -(r["avg_score"] or 0)))

    return {
        "total_calls_scored": len(calls),
        "avg_overall_score": avg_overall,
        "dimension_averages": _dim_avgs(calls),
        "tag_distribution": _tag_distribution(calls),
        "risk_index": _risk_index(calls),
        "teams": team_rows,
        "score_trend": _trend(calls),
    }


@router.get("/team/{team_id}")
def team_overview(team_id: str, db: Session = Depends(get_db)):
    calls = _scored_calls(db, team_id=team_id)
    team = db.query(Team).filter_by(id=team_id).first()
    advisors = team.advisors if team else []

    advisor_rows = []
    for a in advisors:
        a_calls = [c for c in calls if c.advisor_id == a.id]
        a_overalls = [_overall(c) for c in a_calls if _overall(c) is not None]
        advisor_rows.append({
            "advisor_id": a.id, "advisor_name": a.name,
            "call_count": len(a_calls),
            "avg_score": round(sum(a_overalls) / len(a_overalls), 1) if a_overalls else None,
            "risk_index": _risk_index(a_calls),
            "open_tag_count": sum(1 for c in a_calls for t in c.tags if t.status.value in ("open", "disputed")),
        })
    advisor_rows.sort(key=lambda r: (r["avg_score"] is None, -(r["avg_score"] or 0)))

    overalls = [_overall(c) for c in calls if _overall(c) is not None]
    return {
        "team": {"id": team.id, "name": team.name, "leader_name": team.leader_name} if team else None,
        "call_count": len(calls),
        "avg_score": round(sum(overalls) / len(overalls), 1) if overalls else None,
        "dimension_averages": _dim_avgs(calls),
        "tag_distribution": _tag_distribution(calls),
        "risk_index": _risk_index(calls),
        "advisors": advisor_rows,
        "score_trend": _trend(calls),
    }


@router.get("/advisor/{advisor_id}")
def advisor_overview(advisor_id: str, db: Session = Depends(get_db)):
    calls = _scored_calls(db, advisor_id=advisor_id)
    advisor = db.query(Advisor).filter_by(id=advisor_id).first()
    overalls = [_overall(c) for c in calls if _overall(c) is not None]

    return {
        "advisor": {"id": advisor.id, "name": advisor.name, "team_id": advisor.team_id} if advisor else None,
        "call_count": len(calls),
        "avg_score": round(sum(overalls) / len(overalls), 1) if overalls else None,
        "dimension_averages": _dim_avgs(calls),
        "tag_distribution": _tag_distribution(calls),
        "risk_index": _risk_index(calls),
        "score_trend": _trend(calls),
        "recent_calls": [{
            "call_id": c.id, "started_at": c.started_at.isoformat() if c.started_at else None,
            "overall_score": _overall(c), "tag_count": len(c.tags),
        } for c in sorted(calls, key=lambda c: c.created_at, reverse=True)[:10]],
    }


def _trend(calls):
    """Chronological (started_at) list of overall scores -- powers the line chart."""
    rows = []
    for c in sorted(calls, key=lambda c: c.started_at or c.created_at):
        overall = _overall(c)
        if overall is not None:
            rows.append({
                "call_id": c.id,
                "date": (c.started_at or c.created_at).strftime("%Y-%m-%d"),
                "score": overall,
            })
    return rows
