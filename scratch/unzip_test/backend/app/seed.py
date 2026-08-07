"""
Seeds a small but realistic org hierarchy. Idempotent: re-running it is a
no-op if FitNova (the org) already exists.

New teams/advisors after this point are added purely through
POST /api/org/teams and POST /api/org/teams/{id}/advisors -- no code change,
matching the "org will grow" requirement.
"""
from app.database import SessionLocal, init_db
from app.models import Advisor, Org, Team

ORG_NAME = "FitNova"

TEAMS = [
    {
        "name": "Team Momentum", "leader_name": "Priya Raman",
        "advisors": [
            ("adv_001", "Rahul Verma", "rahul.verma@fitnova.com"),
            ("adv_002", "Sneha Iyer", "sneha.iyer@fitnova.com"),
            ("adv_003", "Karthik Nair", "karthik.nair@fitnova.com"),
        ],
    },
    {
        "name": "Team Ascend", "leader_name": "Farah Sheikh",
        "advisors": [
            ("adv_004", "Meera Pillai", "meera.pillai@fitnova.com"),
            ("adv_005", "Arjun Das", "arjun.das@fitnova.com"),
        ],
    },
    {
        "name": "Team Velocity", "leader_name": "Vikram Singh",
        "advisors": [
            ("adv_006", "Neha Kulkarni", "neha.kulkarni@fitnova.com"),
            ("adv_007", "Sameer Khan", "sameer.khan@fitnova.com"),
        ],
    },
]


def seed():
    init_db()
    db = SessionLocal()
    try:
        org = db.query(Org).filter_by(name=ORG_NAME).first()
        if org:
            print(f"Org '{ORG_NAME}' already exists (id={org.id}); skipping seed.")
            return org

        org = Org(name=ORG_NAME)
        db.add(org)
        db.commit()
        db.refresh(org)

        for team_def in TEAMS:
            team = Team(org_id=org.id, name=team_def["name"], leader_name=team_def["leader_name"])
            db.add(team)
            db.commit()
            db.refresh(team)
            for ext_id, name, email in team_def["advisors"]:
                db.add(Advisor(team_id=team.id, name=name, email=email, external_agent_id=ext_id))
            db.commit()

        print(f"Seeded org '{ORG_NAME}' with {len(TEAMS)} teams and "
              f"{sum(len(t['advisors']) for t in TEAMS)} advisors.")
        return org
    finally:
        db.close()


if __name__ == "__main__":
    seed()
