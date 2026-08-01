const { supabase } = require('../lib/supabase');
const { embedBatch } = require('../lib/embed');
const { chunkNote } = require('../lib/chunk');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { noteId, participantId, participantName, shiftDate, noteText } = req.body || {};

  if (!noteId || !participantId || !noteText) {
    return res.status(400).json({ error: 'noteId, participantId, and noteText are required' });
  }

  try {
    // Remove any existing chunks for this note first, so edits don't leave stale duplicates.
    const { error: deleteError } = await supabase
      .from('progress_note_chunks')
      .delete()
      .eq('note_id', noteId);

    if (deleteError) {
      throw new Error(`Failed to clear existing chunks: ${deleteError.message}`);
    }

    const chunks = chunkNote(noteText);

    if (chunks.length === 0) {
      return res.status(200).json({ success: true, chunksCreated: 0, note: 'Note text was empty after chunking' });
    }

    const embeddings = await embedBatch(chunks);

    const rows = chunks.map((chunkText, i) => ({
      note_id: noteId,
      participant_id: participantId,
      participant_name: participantName || null,
      shift_date: shiftDate || null,
      chunk_index: i,
      chunk_text: chunkText,
      embedding: embeddings[i]
    }));

    const { error: insertError } = await supabase.from('progress_note_chunks').insert(rows);

    if (insertError) {
      throw new Error(`Failed to insert chunks: ${insertError.message}`);
    }

    return res.status(200).json({ success: true, chunksCreated: rows.length });
  } catch (err) {
    console.error('ingest-note error:', err);
    return res.status(502).json({ error: 'Ingest failed', detail: err.message });
  }
};
