@echo off
echo Starting FitNova Call Intelligence Platform...
pip install -r requirements.txt
cd backend
python -c "from app.seed import seed; seed()"
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
