// One-off backfill: pulls every existing Progress Note from Bubble and ingests it.
// Run locally (not deployed to Vercel — no timeout constraints this way):
//
//   npm run backfill
//
// Requires a .env file in the project root with:
//   SUPABASE_URL=...
//   SUPABASE_SERVICE_ROLE_KEY=...
//   OPENAI_API_KEY=...
//   BUBBLE_BASE_URL=https://knightingale.com.au
//   BUBBLE_API_TOKEN=...
//
// Safe to re-run: ingestNote() replaces a note's chunks rather than duplicating them,
// so if this fails partway through, just run it again.

require('dotenv').config();

const { fetchAllBubbleObjects, buildUserFirstNameMap } = require('../lib/bubbleApi');
const { ingestNote } = require('../lib/ingestNote');

const DELAY_MS_BETWEEN_NOTES = 150; // gentle pacing to stay well under OpenAI/Supabase rate limits

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log('Fetching all progress notes from Bubble...');
  const notes = await fetchAllBubbleObjects('Progress Note');
  console.log(`Found ${notes.length} notes.`);

  console.log('Fetching participant names...');
  const participantIds = notes.map((n) => n.participant);
  const nameMap = await buildUserFirstNameMap(participantIds);

  let ingested = 0;
  let skipped = 0;
  const failures = [];

  for (let i = 0; i < notes.length; i++) {
    const note = notes[i];
    const progress = `[${i + 1}/${notes.length}]`;

    if (!note.summary || !note.summary.trim()) {
      console.log(`${progress} skipping ${note._id} — empty note text`);
      skipped++;
      continue;
    }

    try {
      const result = await ingestNote({
        noteId: note._id,
        participantId: note.participant,
        participantName: nameMap[note.participant] || null,
        shiftDate: note.date || null,
        noteText: note.summary
      });
      console.log(`${progress} ingested ${note._id} — ${result.chunksCreated} chunks`);
      ingested++;
    } catch (err) {
      console.error(`${progress} FAILED ${note._id}: ${err.message}`);
      failures.push({ noteId: note._id, error: err.message });
    }

    await sleep(DELAY_MS_BETWEEN_NOTES);
  }

  console.log('\n--- Backfill complete ---');
  console.log(`Ingested: ${ingested}`);
  console.log(`Skipped (empty): ${skipped}`);
  console.log(`Failed: ${failures.length}`);

  if (failures.length > 0) {
    console.log('\nFailed note ids (re-run the script to retry — it is safe to re-run):');
    failures.forEach((f) => console.log(`  ${f.noteId}: ${f.error}`));
  }
}

main().catch((err) => {
  console.error('Backfill script crashed:', err);
  process.exit(1);
});
