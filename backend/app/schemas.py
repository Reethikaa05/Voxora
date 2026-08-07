from typing import Optional

from pydantic import BaseModel


class DisputeCreate(BaseModel):
    advisor_id: str
    reason: str


class DisputeResolve(BaseModel):
    resolved_by: str
    status: str  # "accepted" | "rejected"
    resolution_note: Optional[str] = None


class IngestTriggerRequest(BaseModel):
    source_name: str = "manual_upload"
    asr_provider: Optional[str] = None  # defaults to app.config.ASR_PROVIDER
