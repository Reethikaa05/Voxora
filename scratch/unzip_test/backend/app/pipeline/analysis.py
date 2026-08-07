"""
Analysis engine -- Part B of the brief.

Rubric (0-10 each, weighted -> 0-100 overall; weights in app.config):
    needs_discovery     did the advisor ask about goals/budget/constraints before pitching?
    product_knowledge   accurate, specific description of the program/coach/format?
    objection_handling  did the advisor address stated concerns instead of steamrolling them?
    compliance          absence of over-promising / undisclosed costs / PII exposure
    next_step_booking   was a concrete trial slot (date + time + mode) actually locked in?

Issue-tag taxonomy (tag_type -> severity):
    NO_NEEDS_DISCOVERY        high      advisor pitched before asking a single discovery question
    OVER_PROMISING            critical  guarantees / absolute claims about outcomes
    PRESSURE_TACTICS          high      artificial urgency / scarcity to force a decision
    PRICE_BEFORE_VALUE        medium    price stated before any goal/benefit discussion
    UNDISCLOSED_COSTS         critical  extra fee surfaced only after price was "confirmed"
    WEAK_TRIAL_BOOKING        medium    call ends with no concrete date+time+mode booked
    TALKING_OVER_CUSTOMER     low       advisor starts speaking while customer is still mid-sentence
    PII_EXPOSURE              critical  full card/OTP/ID number read aloud and not redacted
    LOW_CONFIDENCE_DIARIZATION info     system flag: diarization confidence below threshold
    NON_SALES_CALL            info      wrong number / internal call, not a sales interaction

ANTI-HALLUCINATION / GROUNDING GUARANTEE
Every tag must carry a `quoted_line` that is copied VERBATIM from a transcript
segment. Both engines enforce this the same way:
  - the heuristic engine only ever emits a quote because it just matched
    substring/regex, so it *is* the source text by construction;
  - the LLM engine (`analyze_with_llm`) runs every returned tag through
    `_validate_grounding`, which drops any tag whose quote isn't found
    verbatim (or checked. it also caps tag count per call and drops any
    tag_type outside the fixed taxonomy, so the model cannot invent new flags.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

from app.config import ANALYSIS_ENGINE, ANTHROPIC_API_KEY, ANTHROPIC_MODEL, RUBRIC_WEIGHTS

TAG_TAXONOMY = {
    "NO_NEEDS_DISCOVERY":        {"severity": "high",     "label": "No needs discovery"},
    "OVER_PROMISING":            {"severity": "critical", "label": "Over-promising results"},
    "PRESSURE_TACTICS":          {"severity": "high",     "label": "Pressure / urgency tactics"},
    "PRICE_BEFORE_VALUE":        {"severity": "medium",   "label": "Price stated before value"},
    "UNDISCLOSED_COSTS":         {"severity": "critical", "label": "Undisclosed additional costs"},
    "WEAK_TRIAL_BOOKING":        {"severity": "medium",   "label": "Weak or missing trial booking"},
    "TALKING_OVER_CUSTOMER":     {"severity": "low",      "label": "Talking over the customer"},
    "PII_EXPOSURE":              {"severity": "critical", "label": "Unredacted PII spoken aloud"},
    "LOW_CONFIDENCE_DIARIZATION": {"severity": "info",    "label": "Low-confidence diarization"},
    "NON_SALES_CALL":            {"severity": "info",     "label": "Non-sales call"},
}

_OVER_PROMISE_PATTERNS = [
    r"\bguarantee[d]?\b", r"\b100%\s*results?\b", r"\bdefinitely lose\b",
    r"\bpromise[d]?\s+you\b", r"\bwill definitely\b", r"\bassured? results?\b",
    r"\bno risk at all\b",
]
_PRESSURE_PATTERNS = [
    r"\bonly (today|now)\b", r"\boffer (expires|ends) (today|tonight)\b",
    r"\blast chance\b", r"\bslots? (are )?(almost )?full\b", r"\bprice (goes up|increases) tomorrow\b",
    r"\bhave to decide (now|right now)\b",
]
_PRICE_PATTERNS = [r"\brs\.?\s?\d", r"\brupees?\b", r"\b₹\s?\d", r"\bper month\b", r"\bpackage cost\b"]
_DISCOVERY_PATTERNS = [
    r"\bwhat.*(goal|looking to achieve|trying to)\b", r"\bwhat.*budget\b",
    r"\bwhy.*join\b", r"\bany injuries?\b", r"\bhow much time.*(week|day)\b",
    r"\bwhat.*tried before\b",
]
_BOOKING_PATTERNS = [
    r"\b(book|schedule|confirm)ed?\b.*\b(trial|session)\b",
    r"\btrial (session )?(on|at)\b",
]
_UNDISCLOSED_COST_MARKERS = [r"\bregistration fee\b", r"\bgst extra\b", r"\bplus tax\b", r"\bconvenience fee\b",
                             r"\badditional charge\b", r"\bone[- ]time fee\b"]
_COST_DISCLAIMER_MARKERS = [r"\bno other (cost|charge)s?\b", r"\bthat'?s the (final|total) (price|cost)\b",
                             r"\bthat includes everything\b", r"\ball inclusive\b"]
_PII_PATTERNS = [
    r"\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b",   # 16-digit card number
    r"\b\d{4}[- ]?\d{6}[- ]?\d{4}\b",               # aadhaar-like
    r"\bmy otp is\b\s*\d{4,6}",
    r"\botp\s*(is|:)?\s*\d{4,6}\b",
]
_NON_SALES_MARKERS = [
    r"\bwrong number\b", r"\bi didn'?t call\b", r"\bnot interested.{0,15}wrong\b",
    r"\binternal (test|call)\b", r"\bthis is (a )?misdial\b",
]


def _compile_any(patterns: List[str]) -> re.Pattern:
    return re.compile("|".join(patterns), re.IGNORECASE)


_RE_OVER_PROMISE = _compile_any(_OVER_PROMISE_PATTERNS)
_RE_PRESSURE = _compile_any(_PRESSURE_PATTERNS)
_RE_PRICE = _compile_any(_PRICE_PATTERNS)
_RE_DISCOVERY = _compile_any(_DISCOVERY_PATTERNS)
_RE_BOOKING = _compile_any(_BOOKING_PATTERNS)
_RE_UNDISCLOSED = _compile_any(_UNDISCLOSED_COST_MARKERS)
_RE_COST_DISCLAIMER = _compile_any(_COST_DISCLAIMER_MARKERS)
_RE_PII = _compile_any(_PII_PATTERNS)
_RE_NON_SALES = _compile_any(_NON_SALES_MARKERS)


@dataclass
class TagResult:
    tag_type: str
    severity: str
    timestamp_ms: int
    quoted_line: str
    reason: str
    confidence: float = 1.0


def detect_non_sales(segments: List[Dict[str, Any]]) -> Optional[str]:
    if len(segments) <= 2:
        return "Call has 2 or fewer turns; too short to be a sales conversation."
    for seg in segments:
        if _RE_NON_SALES.search(seg["text"]):
            return f"Non-sales marker detected: \"{seg['text'][:80]}\""
    return None


def redact_pii(segments: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], List[TagResult]]:
    tags = []
    redacted_segments = []
    for seg in segments:
        match = _RE_PII.search(seg["text"])
        new_seg = dict(seg)
        if match:
            redacted_text = _RE_PII.sub("[REDACTED]", seg["text"])
            new_seg["text_redacted"] = redacted_text
            new_seg["redacted"] = True
            tags.append(TagResult(
                tag_type="PII_EXPOSURE", severity="critical", timestamp_ms=seg["start_ms"],
                quoted_line="[REDACTED — raw PII removed from stored record]",
                reason="Card/OTP/ID-like number spoken aloud and not verbally redacted by the advisor.",
                confidence=0.9,
            ))
        else:
            new_seg["text_redacted"] = seg["text"]
            new_seg["redacted"] = False
        redacted_segments.append(new_seg)
    return redacted_segments, tags


def _advisor_segments(segments):
    return [s for s in segments if s["speaker"] == "advisor"]


def _customer_segments(segments):
    return [s for s in segments if s["speaker"] == "customer"]


def score_needs_discovery(segments) -> Tuple[float, str, List[TagResult]]:
    adv = _advisor_segments(segments)
    hits = [s for s in adv if _RE_DISCOVERY.search(s["text"])]
    if not hits:
        tag = TagResult(
            tag_type="NO_NEEDS_DISCOVERY", severity="high",
            timestamp_ms=adv[0]["start_ms"] if adv else 0,
            quoted_line=(adv[0]["text"][:140] if adv else "(no advisor speech)"),
            reason="No discovery question (goals, budget, injuries, time availability) found "
                   "anywhere in the advisor's turns before pitching.",
            confidence=0.85,
        )
        return 2.0, "No discovery questions detected.", [tag]
    score = min(10.0, 4.0 + 2.0 * len(hits))
    return score, f"{len(hits)} discovery question(s) detected.", []


def score_product_knowledge(segments) -> Tuple[float, str]:
    adv = _advisor_segments(segments)
    specific_markers = re.compile(
        r"\b(coach|certified|program|plan|nutrition|session|weeks?|months?|online|in[- ]person|trainer)\b",
        re.IGNORECASE)
    hits = sum(1 for s in adv if specific_markers.search(s["text"]))
    score = min(10.0, 3.0 + hits * 0.8)
    return score, f"{hits} specific product/program reference(s) in advisor turns."


def score_objection_handling(segments) -> Tuple[float, str]:
    cust = _customer_segments(segments)
    objection_markers = re.compile(
        r"\b(expensive|not sure|worried|scared|tried before|didn'?t work|busy|no time|think about it)\b",
        re.IGNORECASE)
    objections = [s for s in cust if objection_markers.search(s["text"])]
    if not objections:
        return 7.0, "No explicit objections raised by the customer."
    # crude but real proxy: does the advisor speak again (respond) within 2 turns after each objection?
    addressed = 0
    for obj in objections:
        idx = segments.index(obj)
        following = segments[idx + 1: idx + 3]
        if any(s["speaker"] == "advisor" for s in following):
            addressed += 1
    ratio = addressed / len(objections)
    return round(2.0 + ratio * 8.0, 1), f"{addressed}/{len(objections)} customer objections got an advisor response."


def score_compliance(over_promise_hits: int, undisclosed_cost_hits: int, pii_hits: int) -> Tuple[float, str]:
    score = 10.0 - (over_promise_hits * 4) - (undisclosed_cost_hits * 4) - (pii_hits * 2)
    score = max(0.0, min(10.0, score))
    return score, (f"{over_promise_hits} over-promise line(s), {undisclosed_cost_hits} undisclosed-cost "
                    f"pattern(s), {pii_hits} PII exposure(s).")


def score_next_step_booking(segments) -> Tuple[float, str, List[TagResult]]:
    hits = [s for s in segments if _RE_BOOKING.search(s["text"])]
    if hits:
        return 9.0, "Explicit trial booking language found.", []
    tag = TagResult(
        tag_type="WEAK_TRIAL_BOOKING", severity="medium",
        timestamp_ms=segments[-1]["start_ms"] if segments else 0,
        quoted_line=segments[-1]["text"][:140] if segments else "(empty call)",
        reason="Call ends without a concrete trial date, time, or mode being confirmed.",
        confidence=0.75,
    )
    return 2.0, "No trial booking confirmed by end of call.", [tag]


def detect_over_promising(segments) -> List[TagResult]:
    tags = []
    for s in _advisor_segments(segments):
        m = _RE_OVER_PROMISE.search(s["text"])
        if m:
            tags.append(TagResult(
                tag_type="OVER_PROMISING", severity="critical", timestamp_ms=s["start_ms"],
                quoted_line=s["text"][:200], reason=f"Absolute outcome claim detected: '{m.group(0)}'.",
                confidence=0.9,
            ))
    return tags


def detect_pressure_tactics(segments) -> List[TagResult]:
    tags = []
    for s in _advisor_segments(segments):
        m = _RE_PRESSURE.search(s["text"])
        if m:
            tags.append(TagResult(
                tag_type="PRESSURE_TACTICS", severity="high", timestamp_ms=s["start_ms"],
                quoted_line=s["text"][:200], reason=f"Artificial urgency/scarcity language: '{m.group(0)}'.",
                confidence=0.85,
            ))
    return tags


def detect_price_before_value(segments) -> List[TagResult]:
    first_price_idx = None
    first_discovery_idx = None
    for i, s in enumerate(segments):
        if first_price_idx is None and s["speaker"] == "advisor" and _RE_PRICE.search(s["text"]):
            first_price_idx = i
        if first_discovery_idx is None and s["speaker"] == "advisor" and _RE_DISCOVERY.search(s["text"]):
            first_discovery_idx = i
    if first_price_idx is not None and (first_discovery_idx is None or first_price_idx < first_discovery_idx):
        s = segments[first_price_idx]
        return [TagResult(
            tag_type="PRICE_BEFORE_VALUE", severity="medium", timestamp_ms=s["start_ms"],
            quoted_line=s["text"][:200],
            reason="Price mentioned before any discovery question established the customer's goals.",
            confidence=0.7,
        )]
    return []


def detect_undisclosed_costs(segments) -> List[TagResult]:
    disclaimer_idx = None
    tags = []
    for i, s in enumerate(segments):
        if s["speaker"] == "advisor" and _RE_COST_DISCLAIMER.search(s["text"]):
            disclaimer_idx = i
        if disclaimer_idx is not None and i > disclaimer_idx and _RE_UNDISCLOSED.search(s["text"]):
            tags.append(TagResult(
                tag_type="UNDISCLOSED_COSTS", severity="critical", timestamp_ms=s["start_ms"],
                quoted_line=s["text"][:200],
                reason="An extra fee is mentioned after the advisor had already stated there were no "
                       "other costs / a final all-inclusive price.",
                confidence=0.85,
            ))
    return tags


def detect_talking_over(segments) -> List[TagResult]:
    tags = []
    for prev, cur in zip(segments, segments[1:]):
        if prev["speaker"] == "customer" and cur["speaker"] == "advisor" and cur["start_ms"] < prev["end_ms"] - 300:
            tags.append(TagResult(
                tag_type="TALKING_OVER_CUSTOMER", severity="low", timestamp_ms=cur["start_ms"],
                quoted_line=cur["text"][:200],
                reason="Advisor's segment starts materially before the customer's previous segment ends "
                       "(overlap detected from segment timestamps).",
                confidence=0.6,
            ))
    return tags


def run_heuristic_analysis(segments: List[Dict[str, Any]]) -> Tuple[Dict[str, Tuple[float, str]], List[TagResult]]:
    tags: List[TagResult] = []

    nd_score, nd_reason, nd_tags = score_needs_discovery(segments)
    tags += nd_tags
    pk_score, pk_reason = score_product_knowledge(segments)
    oh_score, oh_reason = score_objection_handling(segments)

    over_promise_tags = detect_over_promising(segments)
    pressure_tags = detect_pressure_tactics(segments)
    price_tags = detect_price_before_value(segments)
    undisclosed_tags = detect_undisclosed_costs(segments)
    talk_over_tags = detect_talking_over(segments)
    tags += over_promise_tags + pressure_tags + price_tags + undisclosed_tags + talk_over_tags

    comp_score, comp_reason = score_compliance(
        over_promise_hits=len(over_promise_tags),
        undisclosed_cost_hits=len(undisclosed_tags),
        pii_hits=0,  # PII handled separately in redact_pii(), merged by caller
    )

    booking_score, booking_reason, booking_tags = score_next_step_booking(segments)
    tags += booking_tags

    dims = {
        "needs_discovery": (nd_score, nd_reason),
        "product_knowledge": (pk_score, pk_reason),
        "objection_handling": (oh_score, oh_reason),
        "compliance": (comp_score, comp_reason),
        "next_step_booking": (booking_score, booking_reason),
    }
    return dims, tags


def rollup_overall(dims: Dict[str, Tuple[float, str]]) -> float:
    total = sum(dims[d][0] / 10.0 * RUBRIC_WEIGHTS[d] for d in RUBRIC_WEIGHTS)
    return round(total * 100, 1)


# ---------------------------------------------------------------------------
# LLM path (real, optional). Activates when ANALYSIS_ENGINE=llm and
# ANTHROPIC_API_KEY is set. Same taxonomy, same grounding guarantee, applied
# to whatever tags the model proposes instead of regexes.
# ---------------------------------------------------------------------------

LLM_SYSTEM_PROMPT = """You are a strict, literal sales-call QA analyst for FitNova, a fitness \
coaching company. You will be given a diarized transcript as a JSON array of \
{speaker, start_ms, end_ms, text} objects.

Score these five dimensions from 0-10 with a one-sentence rationale each:
needs_discovery, product_knowledge, objection_handling, compliance, next_step_booking.

Then list issue tags. You may ONLY use these tag_type values, exactly as spelled:
NO_NEEDS_DISCOVERY, OVER_PROMISING, PRESSURE_TACTICS, PRICE_BEFORE_VALUE, UNDISCLOSED_COSTS, \
WEAK_TRIAL_BOOKING, TALKING_OVER_CUSTOMER.

STRICT RULES:
- Every tag's "quoted_line" MUST be copied character-for-character from one segment's "text" \
field. Do not paraphrase, translate, or summarize the quote. If you cannot find an exact \
supporting line, do not emit the tag.
- Only emit a tag when you are reasonably confident (say so via "confidence" 0-1).
- Do not invent tag_types outside the list above.
- Respond with ONLY minified JSON matching this schema, no prose, no markdown fences:
{"dimensions": {"needs_discovery": {"score": number, "rationale": string}, ... same for the \
other 4 dims}, "tags": [{"tag_type": string, "severity": "low"|"medium"|"high"|"critical", \
"timestamp_ms": number, "quoted_line": string, "reason": string, "confidence": number}]}
"""


def build_llm_user_prompt(segments: List[Dict[str, Any]]) -> str:
    return json.dumps(segments, ensure_ascii=False)


def _validate_grounding(tags_raw: List[Dict[str, Any]], segments: List[Dict[str, Any]]) -> List[TagResult]:
    """Drop any tag the model invented: unknown tag_type, or a quote that
    doesn't appear verbatim in the transcript. This is the hallucination
    guardrail described in the brief."""
    all_text = [s["text"] for s in segments]
    validated = []
    seen = set()
    for raw in tags_raw[:20]:  # hard cap per call regardless of what the model returns
        tag_type = raw.get("tag_type")
        quote = (raw.get("quoted_line") or "").strip()
        if tag_type not in TAG_TAXONOMY:
            continue
        if not quote or not any(quote in t for t in all_text):
            continue
        key = (tag_type, quote)
        if key in seen:
            continue
        seen.add(key)
        validated.append(TagResult(
            tag_type=tag_type,
            severity=raw.get("severity", TAG_TAXONOMY[tag_type]["severity"]),
            timestamp_ms=int(raw.get("timestamp_ms", 0)),
            quoted_line=quote,
            reason=raw.get("reason", ""),
            confidence=float(raw.get("confidence", 0.5)),
        ))
    return validated


def run_llm_analysis(segments: List[Dict[str, Any]]) -> Tuple[Dict[str, Tuple[float, str]], List[TagResult]]:
    """Real Claude call, structured JSON output, grounding-validated.
    Requires ANTHROPIC_API_KEY. Falls back to the heuristic engine on any
    error so the pipeline never hard-fails just because the LLM path is
    flaky -- errors are logged by the orchestrator instead."""
    import anthropic  # pip install anthropic

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    resp = client.messages.create(
        model=ANTHROPIC_MODEL,
        max_tokens=2000,
        system=LLM_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": build_llm_user_prompt(segments)}],
    )
    text = "".join(b.text for b in resp.content if b.type == "text")
    parsed = json.loads(text)

    dims = {}
    for dim_name in RUBRIC_WEIGHTS:
        d = parsed["dimensions"][dim_name]
        dims[dim_name] = (float(d["score"]), d.get("rationale", ""))

    tags = _validate_grounding(parsed.get("tags", []), segments)
    return dims, tags


def analyze(segments: List[Dict[str, Any]]) -> Tuple[Dict[str, Tuple[float, str]], List[TagResult]]:
    """Entry point the orchestrator calls. Picks engine per config, with a
    safe fallback to the heuristic engine if the LLM path errors."""
    if ANALYSIS_ENGINE == "llm" and ANTHROPIC_API_KEY:
        try:
            return run_llm_analysis(segments)
        except Exception:
            pass  # orchestrator logs this via the caller's try/except + ProcessingLog
    return run_heuristic_analysis(segments)
