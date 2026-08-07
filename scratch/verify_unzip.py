import zipfile
import os
import shutil
import subprocess

test_dir = 'scratch/unzip_test'
if os.path.exists(test_dir):
    shutil.rmtree(test_dir)
os.makedirs(test_dir, exist_ok=True)

zip_file = 'FitNova_Call_Intelligence_Submission.zip'
print(f"Testing extraction of {zip_file}...")

with zipfile.ZipFile(zip_file, 'r') as zf:
    zf.extractall(test_dir)

items = os.listdir(test_dir)
print("Extracted items:", items)

required_files = [
    'run.sh', 'requirements.txt', 'README.md', 'Procfile',
    'render.yaml', 'Dockerfile', 'backend', 'frontend',
    'sample_data', 'docs', 'screenshot'
]

missing = [f for f in required_files if f not in items]
if missing:
    print("❌ Missing files:", missing)
else:
    print("ALL 11 required top-level files/folders are PRESENT in the zip!")

# Test 1-command startup import inside unzipped folder
test_script = "import sys, os; sys.path.insert(0, 'backend'); from app.main import app; print('SUCCESS: FastAPI App Loaded Cleanly!')"
res = subprocess.run(['python', '-c', test_script], cwd=test_dir, capture_output=True, text=True)

print("STDOUT:", res.stdout.strip())
print("STDERR:", res.stderr.strip())
print("Exit Code:", res.returncode)
