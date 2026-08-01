# progress-notes-search

Chunked, embedded, semantically searchable progress notes — same pattern as Policy Ai, applied to progress notes instead of policy docs. Separate system from the existing `progress-notes` repo (incident flagging) and `progress-note-quality-agent` (submission quality gate) — this one is read-side Q&A over historical notes.

## How it works

1. **Ingest** — whenever a progress note is created or edited in Bubble, call `/api/ingest-note`. It chunks the note (splitting on timestamp boundaries where present, ~900 chars per chunk with slight overlap), embeds each chunk with OpenAI, and stores them in Supabase.
2. **Query** — a user asks a question via a Bubble chat UI. Bubble passes the question plus the list of participant IDs that user is allowed to see. The endpoint embeds the question, finds the most relevant chunks *only among those participants*, and asks Claude to answer using just those excerpts.

Permissions are enforced at the database query level (via `allowed_participant_ids` in the SQL function), not just filtered afterward — so a user can never see a chunk from a participant outside their allowed list, regardless of how the question is phrased.

## Setup

**1. Supabase** — run `sql/schema.sql` in the SQL editor of the same Supabase project used for Policy Ai / Klarra (it creates its own table, so no conflict).

**2. Environment variables** (Vercel project settings):

```
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
```

Use the **service role** key (not the anon key) since this runs server-side and needs to bypass row-level security — Supabase RLS isn't used here; permission scoping happens via the `allowed_participant_ids` parameter instead.

**3. Deploy**:

```bash
npm install
vercel deploy
```

## Endpoints

### `POST /api/ingest-note`

```json
{
  "noteId": "<bubble progress note unique id>",
  "participantId": "<bubble participant unique id>",
  "participantName": "David",
  "shiftDate": "2026-07-30",
  "noteText": "0900: Arrived..."
}
```

Deletes any existing chunks for that `noteId` first, so calling this again on an edited note replaces rather than duplicates. Returns `{ success: true, chunksCreated: N }`.

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

**Ingest (backend workflow, runs on note create AND edit):**

1. Trigger: "Progress Note is created" (New) and "Progress Note is modified" (Changes) — or a single backend workflow both call, scheduled/triggered as your existing note-save flow does.
2. API Connector call to `/api/ingest-note` with `noteText` = the note's field, `participantId`/`participantName`/`shiftDate` from the related Participant and Shift.

**Query (chat UI, same pattern as Policy Ai popup):**

1. Before calling `/api/query-notes`, compute the current user's allowed participant list — e.g. `Current User's assigned participants each item's unique id` (adjust to whatever your actual field/relationship is called).
2. Pass that list as `allowedParticipantIds` and the chat input as `question`.
3. Display `Result's answer` in the chat log. If you want to show which notes it drew from, `Result's sources` is a list you can show in a RepeatingGroup underneath.

## Backfilling existing notes

For notes that already exist in Bubble before this goes live, you'll want a one-off backfill: loop through existing Progress Notes (e.g. via a Bubble "Schedule API workflow on a list") and call `/api/ingest-note` for each. Worth rate-limiting this (e.g. one every second or two) to stay under OpenAI/Supabase rate limits on a large backfill.
