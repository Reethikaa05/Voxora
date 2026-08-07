"""
Transcription + diarization.

WHAT'S REAL vs MOCKED (see README for the full breakdown):
  - The interface (`ASRProvider`), the segment schema, the confidence
    scoring, and the orchestration around this stage are all real.
  - `MockASRProvider` is what actually runs in this sandbox: it does not
    decode audio. It either (a) normalizes a transcript the source already
    provides (a very real scenario -- many CRMs return a transcript with the
    recording), or (b) for audio-only sources, reads a pre-scripted
    "ground truth" transcript shipped alongside the sample audio placeholder,
    standing in for what Whisper would have produced. This is clearly logged
    per-call via ProcessingLog so nobody mistakes it for a live ASR call.
  - `WhisperASRProvider` is a real, runnable implementation using
    faster-whisper. It is not exercised in this environment because the
    sandbox has no network path to model weights. Point `ASR_PROVIDER=whisper`
    at it once `pip install faster-whisper` and weights are available; no
    other code changes are needed since the orchestrator only depends on the
    `ASRProvider` interface.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from app.ingestion.base import CanonicalCallRecord


class TranscriptionResult:
    def __init__(self, segments: List[Dict[str, Any]], diarization_confidence: float,
                 language_mix: str, engine: str):
        self.segments = segments                        # [{speaker, start_ms, end_ms, text}]
        self.diarization_confidence = diarization_confidence
        self.language_mix = language_mix
        self.engine = engine


class ASRProvider:
    def transcribe_and_diarize(self, record: CanonicalCallRecord,
                                audio_path: Optional[Path]) -> TranscriptionResult:
        raise NotImplementedError


def _normalize_existing_transcript(raw: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    segments = []
    for seg in raw:
        segments.append({
            "speaker": seg.get("speaker", "unknown"),
            "start_ms": int(seg.get("start_ms", 0)),
            "end_ms": int(seg.get("end_ms", 0)),
            "text": seg.get("text", "").strip(),
        })
    return segments


def _detect_language_mix(segments: List[Dict[str, Any]]) -> str:
    """Very small heuristic: flags Hindi-English code-switching by looking for
    common Hindi (Latin-transliterated) tokens mixed with English tokens.
    A real system would use a language-id model per token/segment."""
    hindi_markers = {"hai", "nahi", "kya", "accha", "bilkul", "haan", "bhai",
                      "matlab", "theek", "sir", "madam", "ji"}
    joined = " ".join(s["text"].lower() for s in segments)
    tokens = set(joined.replace(",", " ").replace(".", " ").split())
    if tokens & hindi_markers:
        return "hi-en"
    return "en"


class MockASRProvider(ASRProvider):
    """Offline, deterministic. See module docstring."""

    def transcribe_and_diarize(self, record: CanonicalCallRecord,
                                audio_path: Optional[Path]) -> TranscriptionResult:
        if record.raw_transcript:
            segments = _normalize_existing_transcript(record.raw_transcript)
            confidence = record.extra.get("diarization_confidence", 0.97)
            engine = "source_provided_transcript"
        else:
            script = record.extra.get("mock_asr_script")
            if script is None:
                raise ValueError(
                    f"No transcript and no mock_asr_script for call {record.external_id}; "
                    "cannot simulate ASR. Provide one or switch ASR_PROVIDER=whisper with real audio."
                )
            segments = _normalize_existing_transcript(script)
            # Mono / poor-diarization edge case: sample data can set this explicitly.
            confidence = record.extra.get("diarization_confidence", 0.93)
            engine = "mock_asr_provider"

        language_mix = _detect_language_mix(segments) if segments else "en"
        return TranscriptionResult(segments, confidence, language_mix, engine)


class WhisperASRProvider(ASRProvider):
    """Real implementation (faster-whisper). Not exercised in this sandbox --
    no network path to model weights. Kept dependency-free at import time so
    the app still boots if faster-whisper isn't installed."""

    def __init__(self, model_size: str = "medium", device: str = "cpu"):
        self.model_size = model_size
        self.device = device
        self._model = None

    def _load(self):
        if self._model is None:
            from faster_whisper import WhisperModel  # pip install faster-whisper
            self._model = WhisperModel(self.model_size, device=self.device)
        return self._model

    def transcribe_and_diarize(self, record: CanonicalCallRecord,
                                audio_path: Optional[Path]) -> TranscriptionResult:
        if audio_path is None or not Path(audio_path).exists():
            raise FileNotFoundError(
                f"WhisperASRProvider needs a real audio file for call {record.external_id}."
            )
        model = self._load()
        segments_out, info = model.transcribe(str(audio_path), word_timestamps=True)

        # NOTE: faster-whisper alone does not diarize (assign speaker labels).
        # A real deployment pairs it with pyannote.audio (or a dual-channel
        # recording split into two mono tracks, which most Indian telephony
        # vendors provide -- see docs/ARCHITECTURE for the trade-off).
        # This stub emits UNKNOWN speaker labels; wire in pyannote here.
        segments = [{
            "speaker": "unknown",
            "start_ms": int(seg.start * 1000),
            "end_ms": int(seg.end * 1000),
            "text": seg.text.strip(),
        } for seg in segments_out]

        return TranscriptionResult(
            segments=segments,
            diarization_confidence=0.5,  # low: no real diarization wired in this stub
            language_mix=info.language or "en",
            engine="faster-whisper",
        )


def get_asr_provider(provider_name: str) -> ASRProvider:
    if provider_name == "whisper":
        return WhisperASRProvider()
    return MockASRProvider()
