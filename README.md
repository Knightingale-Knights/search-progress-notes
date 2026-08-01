# progress-notes-search

Chunked, embedded, semantically searchable progress notes — same pattern as Policy Ai, applied to progress notes instead of policy docs. Separate system from the existing `progress-notes` repo (incident flagging) and `progress-note-quality-agent` (submission quality gate) — this one is read-side Q&A over historical notes.

## How it works

1. **Ingest** — whenever a progress note is created in Bubble, call `/api/ingest-note`. It chunks the note (splitting on timestamp boundaries where present, ~900 chars per chunk with slight overlap), embeds each chunk with OpenAI, and stores them in Supabase.
2. **Backfill** — a one-off local script pulls every existing note out of Bubble and ingests it, so historical notes are searchable too.
3. **Daily sync** — a Vercel Cron job runs once a day and ingests any note created since the last run, so new notes stay searchable without manual intervention.
4. **Query** — a user asks a question via a Bubble chat UI. Bubble passes the question plus the list of participant IDs that user is allowed to see. The endpoint embeds the question, finds the most relevant chunks *only among those participants*, and asks Claude to answer using just those excerpts.

Permissions are enforced at the database query level (via `allowed_participant_ids` in the SQL function), not just filtered afterward — so a user can never see a chunk from a participant outside their allowed list, regardless of how the question is phrased.

Progress notes can't be edited in Bubble once submitted, so ingestion is create-only — there's no edit-sync case to handle.

## Setup

**1. Supabase** — run `sql/schema.sql` in the SQL editor of the same Supabase project used for Policy Ai / Klarra (it creates its own table, so no conflict).

**2. Environment variables** (Vercel project settings, and a local `.env` file for the backfill script):

```
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
BUBBLE_BASE_URL=https://knightingale.com.au
BUBBLE_API_TOKEN=...
```

Use the **service role** Supabase key (not the anon key) since this runs server-side and needs to bypass row-level security — Supabase RLS isn't used here; permission scoping happens via the `allowed_participant_ids` parameter instead.

**3. Deploy**:

```bash
npm install
vercel deploy
```

Vercel will pick up `vercel.json` automatically and schedule the daily cron.

## Endpoints

### `POST /api/ingest-note`

Called by Bubble whenever a new progress note is created.

```json
{
  "noteId": "<bubble progress note unique id>",
  "participantId": "<bubble user unique id — the participant field is a User>",
  "participantName": "David",
  "shiftDate": "2026-07-30",
  "noteText": "0900: Arrived..."
}
```

Deletes any existing chunks for that `noteId` first, so it's safe to call more than once on the same note. Returns `{ success: true, chunksCreated: N }`.

### `GET|POST /api/sync-daily`

Triggered automatically by Vercel Cron once a day (see `vercel.json` — currently `0 16 * * *` UTC, i.e. ~2-3am Melbourne time depending on daylight saving). Pulls notes with `Created Date` in the last 26 hours (a 2-hour overlap beyond the 24-hour cadence as a safety margin — harmless since re-ingesting an already-ingested note just replaces its chunks) and ingests any it finds. Can also be triggered manually by visiting the URL or calling it, for testing.

### `POST /api/query-notes`

```json
{
  "question": "Has David mentioned knee pain recently?",
  "allowedParticipantIds": ["participant_id_1", "participant_id_2", "..."]
}
```

Returns:

```json
{
  "answer": "Yes — on 28 July, David mentioned...",
  "sources": [
    { "noteId": "...", "participantId": "...", "participantName": "David", "shiftDate": "2026-07-28", "similarity": 0.83 }
  ]
}
```

## Wiring into Bubble

**Ingest (backend workflow, runs on note create):**

1. Trigger: "Progress Note is created" (New).
2. API Connector call to `/api/ingest-note` with `noteText` = the note's `summary` field, `participantId` = the note's `participant` field's unique id, `shiftDate` = the note's `date` field, `noteId` = the note's unique id.

**Query (chat UI, same pattern as Policy Ai popup):**

1. Before calling `/api/query-notes`, compute the current user's allowed participant list — e.g. `Current User's assigned participants each item's unique id` (adjust to whatever your actual field/relationship is called).
2. Pass that list as `allowedParticipantIds` and the chat input as `question`.
3. Display `Result's answer` in the chat log. If you want to show which notes it drew from, `Result's sources` is a list you can show in a RepeatingGroup underneath.

## Backfilling existing notes

Run once, locally, after setup:

```bash
npm install
npm run backfill
```

This pulls every existing Progress Note from Bubble (paginated automatically) and ingests each one, with a small delay between notes to stay under OpenAI/Supabase rate limits. It logs progress as it goes and prints a summary of any failures at the end — safe to re-run if it fails partway through, since re-ingesting a note just replaces its chunks rather than duplicating them.

For a very large note history, expect roughly 1 note every ~1-2 seconds once embedding time is factored in — budget accordingly (e.g. a few thousand notes could take an hour or more).
