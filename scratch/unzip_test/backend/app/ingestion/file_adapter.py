"""
Folder-drop adapter: watches a directory of JSON payloads (one call each).

This is what the demo uses (sample_data/calls/*.json), and it is also the
realistic shape for "nightly CRM export dropped in S3/SFTP" -- a very common
FitNova scenario alongside live telephony webhooks. Swapping the *transport*
(local folder vs S3 vs SFTP) only changes `_list_payload_files`; the mapping
logic is untouched because it goes through the same field-map config.
"""
import json
from pathlib import Path
from typing import List, Optional

from app.ingestion.base import (
    CanonicalCallRecord, SourceAdapter, load_field_map, map_payload_to_canonical,
)


class FolderDropAdapter(SourceAdapter):
    def __init__(self, watch_dir: Path, config_path: Path):
        self.watch_dir = Path(watch_dir)
        self.field_map = load_field_map(config_path)
        self.source_name = self.field_map["source_name"]

    def _list_payload_files(self) -> List[Path]:
        if not self.watch_dir.exists():
            return []
        return sorted(self.watch_dir.glob("*.json"))

    def fetch_new_records(self) -> List[CanonicalCallRecord]:
        records = []
        for path in self._list_payload_files():
            with open(path) as f:
                payload = json.load(f)
            record = map_payload_to_canonical(payload, self.field_map)
            record.extra["_source_file"] = str(path)
            records.append(record)
        return records

    def resolve_audio_path(self, record: CanonicalCallRecord) -> Optional[Path]:
        if not record.audio_uri:
            return None
        # In the demo, audio_uri is a relative path inside sample_data/.
        candidate = Path(record.audio_uri)
        if candidate.is_absolute() and candidate.exists():
            return candidate
        rel = self.watch_dir.parent / record.audio_uri
        return rel if rel.exists() else None
