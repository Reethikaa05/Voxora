# System Design -- FitNova Call Intelligence

See [`diagram.mmd`](diagram.mmd) for the full pipeline diagram (paste into
[mermaid.live](https://mermaid.live) or view it in any Mermaid-aware Markdown
viewer / VS Code).

## Walkthrough

### 1. Ingestion (source-agnostic by design)
FitNova may run Exotel today, add Ozonetel next quarter, and still get
CRM exports from a third vendor for a legacy pod. Rather than branching on
vendor in code, every source gets a small **field-map YAML**
(`backend/app/ingestion/source_configs/*.yaml`) that says where the
canonical fields (`external_id`, `agent_external_id`, `customer_phone`,
`started_at`, `duration_sec`, `audio_uri`, and optionally a pre-existing
`transcript`) live in *that vendor's* payload shape, using dot-path lookups.

Adding a new vendor is **a new YAML file, not new code**. See
`ingestion/base.py::map_payload_to_canonical` and
`ingestion/source_configs/exotel_webhook.yaml` for a second, illustrative
vendor mapping that plugs into the exact same code path as the demo's
`manual_upload.yaml`.

The demo ships a `FolderDropAdapter` (`ingestion/file_adapter.py`) that reads
`sample_data/calls/*.json` -- this doubles as a realistic "nightly CRM
export dropped in a folder/SFTP/S3 bucket" scenario, which is just as common
at FitNova as live telephony webhooks. Swapping the *transport* (folder vs.
S3 vs. webhook receiver) only touches `_list_payload_files`; the mapping and
everything downstream is untouched.

### 2. Transcription and diarization
`pipeline/asr.py` defines an `ASRProvider` interface. Two implementations:
- `MockASRProvider` -- what actually runs in this sandbox (see README for why).
- `WhisperASRProvider` -- a real `faster-whisper` implementation, ready to
  run once weights are reachable; the orchestrator only depends on the
  interface, so switching providers is one environment variable
  (`ASR_PROVIDER=whisper`), zero other code changes.

Each source can also **already provide a transcript** (many CRMs do) -- the
canonical record carries an optional `raw_transcript`, and the ASR stage
short-circuits to just normalizing it instead of re-transcribing.

### 3. Analysis
`pipeline/analysis.py`. Scores 5 rubric dimensions and raises grounded issue
tags. Two engines behind one interface (`analyze()`): a heuristic
pattern-matching engine (what runs today) and a real Claude-based structured
-output engine (`ANALYSIS_ENGINE=llm` + `ANTHROPIC_API_KEY`). See
[`WRITEUP.md`](WRITEUP.md) for the full rubric, taxonomy, and
anti-hallucination design.

### 4. Storage
SQLite for the take-home (zero external services, `run.sh` just works). The
app only ever talks to SQLAlchemy's engine, so `DATABASE_URL=postgresql://...`
is the entire migration to Postgres in production. Schema in
`backend/app/models.py`: `Org -> Team -> Advisor` hierarchy, `Call` as the
pipeline's unit of work with a state machine, `TranscriptSegment`,
`CallScore`, `Tag`, `Dispute`, and a `ProcessingLog` audit trail. Full
reasoning in [`WRITEUP.md`](WRITEUP.md) Part C.

### 5. Surfacing (dashboards)
One SPA, three altitudes, because the brief asked for all three to be kept
in mind:
- **Org health** (Sales Director): org-wide average, risk index, team
  leaderboard, tag distribution, score trend.
- **Team view** (Team Leader): same shape, scoped to one team, plus an
  advisor leaderboard to know who to coach first.
- **Advisor view** (Advisor): personal average, trend, recent calls -- a
  mirror, not a scoreboard.
- **Call detail**: diarized transcript with tagged lines highlighted inline,
  rubric scores, tag cards with quote + reason + confidence, and a dispute
  button.
- **Dispute queue** (Team Leader): resolves contested flags and shows a
  false-positive-rate table per tag type.

### 6. Feedback loop
An advisor disputes a tag with a reason. A Team Leader accepts (tag ->
`dismissed`) or rejects (tag -> `upheld`) it in `/api/disputes`. This isn't
just a UI nicety -- `GET /api/disputes/false_positive_rate` aggregates
resolved disputes per `tag_type`, which is exactly the signal you'd use
weekly to retune the heuristic patterns or the LLM's few-shot examples for
whichever tag type is over-firing. The loop is genuinely closed, not
decorative: dismissing a tag immediately changes the call's risk index and
every dashboard that rolls it up.

## Where automation adds the most value (and why, in priority order)

1. **Transcription + diarization.** Zero human review happens today because
   nobody has time to listen to hundreds of calls a week. Automating this is
   the precondition for everything else -- it's what turns an unreviewable
   audio archive into searchable, taggable text. Highest leverage, first
   priority.
2. **Grounded issue tagging.** The brief's own framing -- mis-selling and
   weak discovery going unnoticed until a complaint -- is a *tagging*
   problem, not a scoring problem. A single `OVER_PROMISING` or
   `UNDISCLOSED_COSTS` flag on a call is more actionable to a Team Leader
   than a numeric score is; scores are for trend-spotting, tags are for
   same-day coaching. This is why the tagging engine has more design effort
   than the scoring rubric in this build.
3. **Org/team/advisor roll-ups.** Once tags and scores exist, aggregation is
   cheap and is what makes the system usable by a Sales Director who will
   never open a single transcript.
4. **The dispute loop.** Lowest priority to build first, but not optional:
   an automated QA system that advisors don't trust will get worked around.
   Making false positives visible and correctable (and *measuring* the
   false-positive rate) is what keeps the system credible enough to actually
   change behavior.

Ingestion itself is comparatively low-effort per vendor once the field-map
pattern exists -- which is exactly why it was designed to be config, not
code, in the first place.
