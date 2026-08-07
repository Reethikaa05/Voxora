"""
Central configuration.

Everything that differs between "demo / take-home mode" and "production mode"
lives here as an environment variable with a sane default, so the rest of the
codebase never hardcodes a provider choice. See README.md -> "Real vs Mocked".
"""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent  # backend/
PROJECT_ROOT = BASE_DIR.parent                       # fitnova/

DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)

# --- Storage -----------------------------------------------------------
# SQLite for the take-home so `run.sh` works with zero external services.
# Swapping to Postgres in production is a one-line change because we only
# ever talk to SQLAlchemy's engine, never to sqlite3 directly.
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{DATA_DIR / 'fitnova.db'}")

# --- ASR / diarization ---------------------------------------------------
# "mock"   -> deterministic, offline, scripted transcripts (used for the demo,
#             since this sandbox has no network path to model weights or a
#             paid ASR vendor).
# "whisper"-> real local transcription via faster-whisper, if installed and
#             model weights are reachable.
ASR_PROVIDER = os.getenv("ASR_PROVIDER", "mock")

# --- Analysis engine -------------------------------------------------------
# "heuristic" -> rule/pattern based tagging + scoring, fully offline, fully
#                deterministic (default for the demo).
# "llm"       -> calls Claude with a structured-output prompt. Activates
#                automatically if ANTHROPIC_API_KEY is set AND
#                ANALYSIS_ENGINE=llm.
ANALYSIS_ENGINE = os.getenv("ANALYSIS_ENGINE", "heuristic")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6")

# --- Pipeline behaviour ------------------------------------------------
MAX_RETRIES = int(os.getenv("PIPELINE_MAX_RETRIES", "3"))
RETRY_BACKOFF_SECONDS = float(os.getenv("PIPELINE_RETRY_BACKOFF_SECONDS", "1.5"))

# --- Rubric weights (must sum to 1.0) -----------------------------------
RUBRIC_WEIGHTS = {
    "needs_discovery": 0.25,
    "product_knowledge": 0.15,
    "objection_handling": 0.20,
    "compliance": 0.25,
    "next_step_booking": 0.15,
}

# Severity -> numeric weight used for the "risk index" roll-up per advisor/team
SEVERITY_WEIGHT = {
    "critical": 4,
    "high": 3,
    "medium": 2,
    "low": 1,
}

AUDIO_STORE_DIR = DATA_DIR / "audio"
AUDIO_STORE_DIR.mkdir(exist_ok=True)
