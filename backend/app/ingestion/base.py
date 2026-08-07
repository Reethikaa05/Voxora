"""
Source-agnostic ingestion.

The core idea: every vendor (telephony, dialer, CRM export, manual folder)
speaks a different JSON/CSV shape. Instead of writing a Python branch per
vendor, each vendor gets a small YAML "field map" describing where the
canonical fields live in *their* payload (dot-path lookups + optional
transforms). Adding a new vendor = adding a new YAML file, not new code.

CanonicalCallRecord is the one shape the rest of the pipeline understands.
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml


@dataclass
class CanonicalCallRecord:
    external_id: str
    source_name: str
    agent_external_id: Optional[str] = None
    customer_phone_masked: Optional[str] = None
    direction: str = "outbound"
    started_at: Optional[datetime] = None
    duration_sec: int = 0
    audio_uri: Optional[str] = None
    raw_transcript: Optional[List[Dict[str, Any]]] = None  # pre-existing diarized transcript, if the vendor has one
    extra: Dict[str, Any] = field(default_factory=dict)

    def content_hash(self) -> str:
        """Stable hash used as a secondary idempotency guard."""
        basis = f"{self.source_name}|{self.external_id}|{self.duration_sec}|{self.audio_uri or ''}"
        return hashlib.sha256(basis.encode()).hexdigest()[:16]


def _dig(payload: Dict[str, Any], dot_path: str) -> Any:
    """Resolve 'a.b.c' against a nested dict; returns None if any hop is missing."""
    node = payload
    for key in dot_path.split("."):
        if isinstance(node, dict) and key in node:
            node = node[key]
        else:
            return None
    return node


def load_field_map(config_path: Path) -> Dict[str, Any]:
    with open(config_path) as f:
        return yaml.safe_load(f)


def map_payload_to_canonical(payload: Dict[str, Any], field_map: Dict[str, Any]) -> CanonicalCallRecord:
    """
    field_map example (see source_configs/*.yaml):
        source_name: exotel
        mapping:
          external_id: CallSid
          agent_external_id: Agent.Id
          customer_phone_masked: To
          direction: Direction
          started_at: StartTime
          duration_sec: Duration
          audio_uri: RecordingUrl
    """
    m = field_map["mapping"]
    started_raw = _dig(payload, m.get("started_at", "")) if m.get("started_at") else None
    started_at = None
    if started_raw:
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%SZ"):
            try:
                started_at = datetime.strptime(started_raw, fmt)
                break
            except (ValueError, TypeError):
                continue

    raw_transcript = None
    if m.get("raw_transcript"):
        raw_transcript = _dig(payload, m["raw_transcript"])

    return CanonicalCallRecord(
        external_id=str(_dig(payload, m["external_id"])),
        source_name=field_map["source_name"],
        agent_external_id=_dig(payload, m.get("agent_external_id", "")) if m.get("agent_external_id") else None,
        customer_phone_masked=_mask_phone(_dig(payload, m.get("customer_phone_masked", ""))) if m.get("customer_phone_masked") else None,
        direction=_dig(payload, m.get("direction", "")) or "outbound",
        started_at=started_at,
        duration_sec=int(_dig(payload, m.get("duration_sec", "")) or 0),
        audio_uri=_dig(payload, m.get("audio_uri", "")) if m.get("audio_uri") else None,
        raw_transcript=raw_transcript,
        extra=payload,
    )


def _mask_phone(phone: Optional[str]) -> Optional[str]:
    if not phone:
        return phone
    digits = "".join(c for c in str(phone) if c.isdigit())
    if len(digits) < 4:
        return "***"
    return f"{'*' * (len(digits) - 4)}{digits[-4:]}"


class SourceAdapter:
    """Base interface every vendor adapter implements."""

    source_name: str = "base"

    def fetch_new_records(self) -> List[CanonicalCallRecord]:
        raise NotImplementedError

    def resolve_audio_path(self, record: CanonicalCallRecord) -> Optional[Path]:
        """Return a local filesystem path for the record's audio, downloading if needed."""
        raise NotImplementedError
