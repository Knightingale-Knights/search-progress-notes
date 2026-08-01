const { fetchAllBubbleObjects, buildUserFirstNameMap } = require('../lib/bubbleApi');
const { ingestNote } = require('../lib/ingestNote');

// Progress notes can't be edited in Bubble, so "new since X" is just Created Date > X.
// A 26hr lookback (rather than exactly 24hrs) gives a safety overlap in case a run is
// ever late or skipped — re-ingesting an already-ingested note is harmless, since
// ingestNote() deletes and replaces that note's chunks rather than duplicating them.
const LOOKBACK_HOURS = 26;

module.exports = async function handler(req, res) {
  // Vercel Cron sends a GET request. Allow POST too for manual triggering/testing.
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const since = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();

  try {
    const notes = await fetchAllBubbleObjects('Progress Note', {
      constraints: [{ key: 'Created Date', constraint_type: 'greater than', value: since }]
    });

    if (notes.length === 0) {
      return res.status(200).json({ success: true, notesFound: 0, ingested: 0, failed: 0 });
    }

    const participantIds = notes.map((n) => n.participant);
    const nameMap = await buildUserFirstNameMap(participantIds);

    let ingested = 0;
    const failures = [];

    for (const note of notes) {
      try {
        await ingestNote({
          noteId: note._id,
          participantId: note.participant,
          participantName: nameMap[note.participant] || null,
          shiftDate: note.date || null,
          noteText: note.summary || ''
        });
        ingested++;
      } catch (err) {
        console.error(`sync-daily: failed to ingest note ${note._id}:`, err.message);
        failures.push({ noteId: note._id, error: err.message });
      }
    }

    return res.status(200).json({
      success: true,
      notesFound: notes.length,
      ingested,
      failed: failures.length,
      failures
    });
  } catch (err) {
    console.error('sync-daily error:', err);
    return res.status(502).json({ error: 'Sync failed', detail: err.message });
  }
};
