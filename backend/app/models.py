"""
Data model.

Org -> Team -> Advisor is a plain adjacency hierarchy so new teams/advisors
can be inserted with a normal INSERT, no reconfiguration or migration needed
("the org will grow" requirement).

A Call is the unit of work that moves through the pipeline's state machine:
    pending -> ingested -> transcribing -> analyzing -> scored
    (any stage can instead transition to failed, which is retriable)

CallSource + the field-mapping config (ingestion/source_configs/*.yaml) are
what make ingestion source-agnostic: a new telephony/CRM vendor is a new
config file, not new code.
"""
import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean, Column, DateTime, Enum, Float, ForeignKey, Integer, String, Text,
    UniqueConstraint,
)
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()


def gen_id() -> str:
    return uuid.uuid4().hex[:12]


class CallStatus(str, enum.Enum):
    PENDING = "pending"
    INGESTED = "ingested"
    TRANSCRIBING = "transcribing"
    ANALYZING = "analyzing"
    SCORED = "scored"
    FAILED = "failed"
    NON_SALES = "non_sales"  # terminal state for wrong-number / internal calls


class Speaker(str, enum.Enum):
    ADVISOR = "advisor"
    CUSTOMER = "customer"
    UNKNOWN = "unknown"


class TagStatus(str, enum.Enum):
    OPEN = "open"
    DISPUTED = "disputed"
    UPHELD = "upheld"
    DISMISSED = "dismissed"


class DisputeStatus(str, enum.Enum):
    PENDING = "pending"
    ACCEPTED = "accepted"   # advisor's dispute accepted -> tag dismissed
    REJECTED = "rejected"   # dispute rejected -> tag upheld


class Org(Base):
    __tablename__ = "orgs"
    id = Column(String, primary_key=True, default=gen_id)
    name = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    teams = relationship("Team", back_populates="org", cascade="all, delete-orphan")


class Team(Base):
    __tablename__ = "teams"
    id = Column(String, primary_key=True, default=gen_id)
    org_id = Column(String, ForeignKey("orgs.id"), nullable=False)
    name = Column(String, nullable=False)
    leader_name = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    org = relationship("Org", back_populates="teams")
    advisors = relationship("Advisor", back_populates="team", cascade="all, delete-orphan")


class Advisor(Base):
    __tablename__ = "advisors"
    id = Column(String, primary_key=True, default=gen_id)
    team_id = Column(String, ForeignKey("teams.id"), nullable=False)
    name = Column(String, nullable=False)
    email = Column(String, nullable=False)
    external_agent_id = Column(String, nullable=True)  # id in the telephony/CRM system
    active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    team = relationship("Team", back_populates="advisors")
    calls = relationship("Call", back_populates="advisor")


class CallSource(Base):
    """One row per vendor integration (telephony/dialer/CRM/manual folder)."""
    __tablename__ = "call_sources"
    id = Column(String, primary_key=True, default=gen_id)
    name = Column(String, nullable=False, unique=True)       # e.g. "exotel", "ozonetel", "manual_upload"
    source_type = Column(String, nullable=False)               # telephony | dialer | crm_export | file_drop
    config_path = Column(String, nullable=False)                # path to its field-mapping yaml
    created_at = Column(DateTime, default=datetime.utcnow)


class Call(Base):
    __tablename__ = "calls"
    id = Column(String, primary_key=True, default=gen_id)

    # idempotency: (source_id, external_id) must be unique so re-delivery of
    # the same webhook/file never creates a duplicate call.
    source_id = Column(String, ForeignKey("call_sources.id"), nullable=False)
    external_id = Column(String, nullable=False)

    advisor_id = Column(String, ForeignKey("advisors.id"), nullable=True)
    customer_phone_masked = Column(String, nullable=True)
    direction = Column(String, default="outbound")
    started_at = Column(DateTime, nullable=True)
    duration_sec = Column(Integer, default=0)

    audio_uri = Column(String, nullable=True)          # if the source only gives audio
    raw_transcript_uri = Column(String, nullable=True)  # if the source already gives a transcript

    status = Column(Enum(CallStatus), default=CallStatus.PENDING)
    retry_count = Column(Integer, default=0)
    last_error = Column(Text, nullable=True)

    diarization_confidence = Column(Float, nullable=True)  # <1.0 -> flagged as low-confidence
    language_mix = Column(String, nullable=True)            # e.g. "en", "hi-en"
    pii_redacted = Column(Boolean, default=False)

    content_hash = Column(String, nullable=True)  # dedupe guard even if external_id is missing/reused

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    advisor = relationship("Advisor", back_populates="calls")
    segments = relationship("TranscriptSegment", back_populates="call", cascade="all, delete-orphan",
                             order_by="TranscriptSegment.start_ms")
    scores = relationship("CallScore", back_populates="call", cascade="all, delete-orphan")
    tags = relationship("Tag", back_populates="call", cascade="all, delete-orphan")
    logs = relationship("ProcessingLog", back_populates="call", cascade="all, delete-orphan",
                         order_by="ProcessingLog.created_at")

    __table_args__ = (
        UniqueConstraint("source_id", "external_id", name="uq_source_external_id"),
    )


class TranscriptSegment(Base):
    __tablename__ = "transcript_segments"
    id = Column(String, primary_key=True, default=gen_id)
    call_id = Column(String, ForeignKey("calls.id"), nullable=False)
    speaker = Column(Enum(Speaker), default=Speaker.UNKNOWN)
    start_ms = Column(Integer, default=0)
    end_ms = Column(Integer, default=0)
    text = Column(Text, nullable=False)
    redacted = Column(Boolean, default=False)

    call = relationship("Call", back_populates="segments")


class CallScore(Base):
    """One row per rubric dimension for a call, plus an 'overall' row."""
    __tablename__ = "call_scores"
    id = Column(String, primary_key=True, default=gen_id)
    call_id = Column(String, ForeignKey("calls.id"), nullable=False)
    dimension = Column(String, nullable=False)  # needs_discovery | product_knowledge | ... | overall
    score = Column(Float, nullable=False)         # 0-10 per-dimension, 0-100 for overall
    rationale = Column(Text, nullable=True)

    call = relationship("Call", back_populates="scores")


class Tag(Base):
    __tablename__ = "tags"
    id = Column(String, primary_key=True, default=gen_id)
    call_id = Column(String, ForeignKey("calls.id"), nullable=False)
    tag_type = Column(String, nullable=False)
    severity = Column(String, nullable=False)  # low | medium | high | critical
    timestamp_ms = Column(Integer, nullable=True)
    quoted_line = Column(Text, nullable=False)
    reason = Column(Text, nullable=False)
    confidence = Column(Float, default=1.0)
    status = Column(Enum(TagStatus), default=TagStatus.OPEN)
    created_at = Column(DateTime, default=datetime.utcnow)

    call = relationship("Call", back_populates="tags")
    dispute = relationship("Dispute", back_populates="tag", uselist=False, cascade="all, delete-orphan")


class Dispute(Base):
    __tablename__ = "disputes"
    id = Column(String, primary_key=True, default=gen_id)
    tag_id = Column(String, ForeignKey("tags.id"), nullable=False, unique=True)
    advisor_id = Column(String, ForeignKey("advisors.id"), nullable=False)
    reason = Column(Text, nullable=False)
    status = Column(Enum(DisputeStatus), default=DisputeStatus.PENDING)
    resolved_by = Column(String, nullable=True)
    resolution_note = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    resolved_at = Column(DateTime, nullable=True)

    tag = relationship("Tag", back_populates="dispute")


class ProcessingLog(Base):
    """Audit trail for every pipeline stage attempt -> debuggability + idempotency proof."""
    __tablename__ = "processing_logs"
    id = Column(String, primary_key=True, default=gen_id)
    call_id = Column(String, ForeignKey("calls.id"), nullable=False)
    stage = Column(String, nullable=False)   # ingest | transcribe | diarize | analyze | store
    status = Column(String, nullable=False)  # started | success | retry | failed
    message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    call = relationship("Call", back_populates="logs")
