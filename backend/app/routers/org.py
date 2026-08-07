from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Advisor, Org, Team

router = APIRouter(prefix="/api/org", tags=["org"])


class TeamCreate(BaseModel):
    name: str
    leader_name: str


class AdvisorCreate(BaseModel):
    name: str
    email: str
    external_agent_id: str = None


@router.get("/tree")
def org_tree(db: Session = Depends(get_db)):
    org = db.query(Org).first()
    if not org:
        raise HTTPException(404, "No org configured")
    return {
        "org": {"id": org.id, "name": org.name},
        "teams": [{
            "id": t.id, "name": t.name, "leader_name": t.leader_name,
            "advisors": [{"id": a.id, "name": a.name, "email": a.email, "active": a.active}
                         for a in t.advisors],
        } for t in org.teams],
    }


@router.post("/teams")
def create_team(payload: TeamCreate, db: Session = Depends(get_db)):
    """New team, no code/schema change required -- org growth requirement."""
    org = db.query(Org).first()
    if not org:
        raise HTTPException(404, "No org configured")
    team = Team(org_id=org.id, name=payload.name, leader_name=payload.leader_name)
    db.add(team)
    db.commit()
    db.refresh(team)
    return {"id": team.id, "name": team.name, "leader_name": team.leader_name}


@router.post("/teams/{team_id}/advisors")
def create_advisor(team_id: str, payload: AdvisorCreate, db: Session = Depends(get_db)):
    team = db.query(Team).filter_by(id=team_id).first()
    if not team:
        raise HTTPException(404, "Team not found")
    advisor = Advisor(team_id=team.id, name=payload.name, email=payload.email,
                       external_agent_id=payload.external_agent_id)
    db.add(advisor)
    db.commit()
    db.refresh(advisor)
    return {"id": advisor.id, "name": advisor.name, "email": advisor.email}
