# Technical Writeup · Voxora (FitNova Call Intelligence)

> 🌐 **Live Deployed Application**: [https://voxora-a0ss.onrender.com](https://voxora-a0ss.onrender.com)  
> 🐙 **Official GitHub Repository**: [https://github.com/Reethikaa05/Voxora](https://github.com/Reethikaa05/Voxora)

---

### Scoring rubric
Five dimensions, each 0-10, rolled into a weighted 0-100 overall score
(`backend/app/config.py::RUBRIC_WEIGHTS`):

| Dimension | Weight | What it measures |
|---|---|---|
| `needs_discovery` | 25% | Did the advisor ask about goals/budget/injuries/time before pitching? |
| `product_knowledge` | 15% | Specific, accurate references to the program/coach/format, not generic filler |
| `objection_handling` | 20% | When the customer raises a concern, does the advisor actually respond to it? |
| `compliance` | 25% | Absence of over-promising, undisclosed costs, exposed PII |
| `next_step_booking` | 15% | Was a concrete trial date+time+mode actually locked in? |

Compliance and discovery are weighted highest on purpose: they're the two
things the brief says directly hurt trust (mis-selling, weak discovery), and
the two a Team Leader can least afford to miss. Roll-ups to team/org level
are plain averages of `overall` per call -- simple and legible over a
sophisticated Bayesian shrinkage estimate, which would be the natural
upgrade once call volume per advisor is large enough for outliers to matter.

### Issue-tag taxonomy
Ten tag types, each with a fixed severity (`critical > high > medium > low`,
plus an `info` tier for system-level flags that aren't advisor mistakes):
`NO_NEEDS_DISCOVERY`, `OVER_PROMISING`, `PRESSURE_TACTICS`,
`PRICE_BEFORE_VALUE`, `UNDISCLOSED_COSTS`, `WEAK_TRIAL_BOOKING`,
`TALKING_OVER_CUSTOMER`, `PII_EXPOSURE`, `LOW_CONFIDENCE_DIARIZATION`
(system), `NON_SALES_CALL` (system). Full definitions in
`backend/app/pipeline/analysis.py` module docstring.

Each tag carries `timestamp_ms`, a verbatim `quoted_line`, a `reason`, and a
`confidence`. A per-call, severity-weighted **risk index** (severity points
÷ call count) is what the org/team/advisor dashboards actually sort by --
a single call with one `critical` tag should outrank five calls with one
`low` tag each, and a plain tag *count* would get that backwards.

### Reliable tagging -- how hallucination is actually prevented
This is the part of the brief I spent the most design effort on, because
"stop the model inventing flags" is the crux of whether anyone would trust
this system.

- **Heuristic engine (what runs today):** every tag is emitted *because* a
  regex matched a literal substring of the transcript. The quote isn't
  generated after the fact and checked -- it *is* the matched text. There is
  no possible hallucination path in this engine, by construction. The
  trade-off is recall: it's English-pattern-only (see "where it would
  fail" below) and it will miss anything phrased outside its patterns.
- **LLM engine (real, optional path via `ANALYSIS_ENGINE=llm` +
  `ANTHROPIC_API_KEY`):** the model is given a strict system prompt (fixed
  tag_type enum, JSON-only, one instruction repeated three ways: *quote must
  be copied character-for-character*) and its output is **not trusted at
  face value**. `_validate_grounding()` re-checks every returned tag against
  the actual transcript before it's ever persisted:
  - drops any `tag_type` outside the fixed taxonomy (the model cannot invent
    a new flag type),
  - drops any tag whose `quoted_line` does not appear verbatim in some
    segment's text (the model cannot fabricate a quote),
  - dedupes `(tag_type, quote)` pairs,
  - hard-caps 20 tags per call regardless of what's returned.

  This means the grounding guarantee lives in *code that runs after the
  LLM*, not in prompt-following alone -- the actual defensible line here
  is "we don't trust the model to police itself; we police it."

### Edge cases -- what breaks a real pipeline, and the handling for each
| Edge case | Handling |
|---|---|
| Mono recording / poor diarization | `diarization_confidence` is stored per call. Below 0.85 it gets an `info`-severity `LOW_CONFIDENCE_DIARIZATION` tag and is visually flagged in the call view, so a human knows to sanity-check the transcript before trusting the scores. (See `call_005` in the sample data.) |
| Heavy Hindi-English code-switching / other languages | `language_mix` is detected per call (`_detect_language_mix`) and surfaced in the UI. **Known limitation, stated plainly:** the heuristic tagging patterns are English-only, so a Hindi-English call like `call_005` will under-tag (e.g. it won't catch a Hindi-phrased discovery question). The LLM path handles this far better -- Claude reads code-switched text natively -- which is the real argument for turning it on in production rather than a nice-to-have. |
| Non-sales calls (wrong number, internal) | `detect_non_sales()` checks call length and a small marker-phrase list before any scoring happens; the call is tagged `NON_SALES_CALL` and short-circuited to a terminal state without ever being scored or shown in advisor averages. (`call_004`.) |
| PII that must be redacted | `redact_pii()` runs *before* segments are ever persisted or scored: card-number-, Aadhaar-like-, and OTP-shaped patterns are replaced with `[REDACTED]` in the stored transcript, and the original match triggers a `critical` `PII_EXPOSURE` tag without ever writing the raw number to the database or the tag's own `quoted_line`. (`call_006`.) |
| Hallucinated / false-positive tags | Grounding validation (above) for the LLM path; for both engines, the **dispute workflow** is the human-in-the-loop backstop -- see `call_009`, built specifically to demonstrate a defensible-but-debatable heuristic flag and its resolution. |
| Vendor API failures, retries, idempotency | `pipeline/orchestrator.py::_with_retry` wraps every stage (transcribe / analyze / store) with bounded retries and backoff, logging each attempt to `ProcessingLog`. Idempotency is enforced at ingest: `(source_id, external_id)` is a unique constraint, so re-delivering the same webhook or re-scanning the same folder finds the existing `Call` row and skips reprocessing instead of duplicating it (verified in the demo: running `/api/ingest/run` twice processes 0 calls the second time). A `content_hash` is a secondary guard for sources that might reuse `external_id`s. |

## C. Data & storage

### Input / output shape
Input: a `CanonicalCallRecord` (see `ingestion/base.py`) -- the one shape
every vendor payload gets mapped into via its field-map config. Output per
call: a diarized transcript (`TranscriptSegment` rows), five dimension
scores + one overall score (`CallScore` rows), zero or more grounded issue
tags (`Tag` rows), and a full processing audit trail (`ProcessingLog` rows)
-- rich enough that the dashboards never need to re-derive anything, they
just aggregate what's already stored.

### Where things live
SQLite for the take-home (`backend/data/fitnova.db`, created on first run,
zero external services needed). The application code never touches SQLite
directly -- it's all through SQLAlchemy's engine -- so the production move to
Postgres is `DATABASE_URL=postgresql://...` and nothing else. Audio itself
would live in object storage (S3/GCS) in production, referenced by
`Call.audio_uri`; this demo keeps a placeholder file locally since no audio
is actually decoded (see README).

### Org model that scales without reconfiguration
`Org -> Team -> Advisor` is a plain adjacency hierarchy (`models.py`).
Adding a team or an advisor is a normal `INSERT` via `POST /api/org/teams`
or `POST /api/org/teams/{id}/advisors` -- no migration, no code change, no
manual reconfiguration, which is exactly what "the org will grow" asks for.
`Advisor.external_agent_id` is the join key back to whatever ID the
telephony/CRM vendor uses for that agent, so a new vendor doesn't require
re-mapping advisors either, as long as the vendor's agent ID is populated
per advisor.

## Trade-offs and what I chose not to build

- **Chose SQLite over Postgres** for the take-home: correct schema, wrong
  engine for production scale, but it means `run.sh` has zero setup
  friction, which felt like the right trade for a 48-hour reviewable
  prototype. One env var away from Postgres.
- **Chose a heuristic analysis engine as the default**, with a real,
  runnable-but-unexercised LLM path behind a flag, rather than mocking the
  LLM call itself. I'd rather ship an engine that's fully deterministic and
  provably non-hallucinating (heuristic) as the default, and be explicit
  that the smarter engine (LLM) exists and is real code, than fake an LLM
  response and call it "AI-powered."
- **Did not build a live telephony webhook receiver.** The field-map config
  pattern and a second vendor YAML (`exotel_webhook.yaml`) prove the
  ingestion layer is source-agnostic without needing a real Exotel account
  and public webhook endpoint for a take-home.
- **Did not build authentication / role-based access control.** The
  dashboards distinguish Org / Team / Advisor *views*, but there's no login
  -- anyone can navigate to any view. In production this is a hard
  requirement (an advisor should not see another advisor's calls); I scoped
  it out to spend the time budget on the pipeline and analysis engine
  instead, which is where the brief's grading weight clearly sits.
- **Did not build audio playback in the UI.** The transcript view shows
  text with timestamps but doesn't scrub a waveform, because no real audio
  is ever decoded in this environment (see README).
- **Objection-handling scoring is a genuinely crude proxy** ("did the
  advisor speak again within 2 turns of a customer objection") -- it
  rewards *responding*, not responding *well*. It's honestly the weakest
  heuristic in the rubric and the first thing I'd hand to the LLM engine in
  production, where "did the advisor address the substance of the
  objection" is actually answerable.

## Where this would fail in production

- **Any transcript phrased outside the regex patterns' vocabulary** slips
  through the heuristic engine untagged -- it has no semantic
  understanding, only pattern matching. `call_005`'s Hindi-English discovery
  question is a deliberate example: a real discovery question happened, and
  the English-only heuristic still raises `NO_NEEDS_DISCOVERY` because it
  can't read it. This is the single strongest argument in this whole
  submission for turning on the LLM engine in production.
- **Diarization confidence is currently a number the mock ASR is told to
  report**, not a real acoustic measurement — a real ASR/diarization stack
  (Whisper + pyannote, or vendor dual-channel audio) would need to compute
  this from actual speaker-separation quality.
- **The objection-handling heuristic** (above) would misscore an advisor who
  responds instantly but dismissively, and a real deployment would surface
  that gap quickly through the dispute rate on that dimension.
- **No load/scale testing.** The retry/backoff wrapper and idempotent
  ingest are correct in shape but untested at the volume of "hundreds of
  advisors, thousands of calls a week" the brief describes -- at that
  volume, the pipeline would want to move from synchronous per-call
  processing (as built) to a queue (e.g. calls land in a queue on ingest,
  workers pull and process them), which is a natural next step the current
  orchestrator design doesn't preclude but also doesn't implement.
