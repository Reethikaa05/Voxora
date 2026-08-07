Write-Host "Starting FitNova Call Intelligence Platform..." -ForegroundColor Green
pip install -r requirements.txt
Set-Location backend
python -c "from app.seed import seed; seed()"
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
