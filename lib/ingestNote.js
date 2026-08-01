const { supabase } = require('./supabase');
const { embedBatch } = require('./embed');
const { chunkNote } = require('./chunk');

// Chunks, embeds, and stores a single progress note. Deletes any existing
// chunks for the same noteId first, so calling this again on an edited (or
// re-synced) note replaces rather than duplicates — safe to call repeatedly.
async function ingestNote({ noteId, participantId, participantName, shiftDate, noteText }) {
  if (!noteId || !participantId || !noteText) {
    throw new Error('noteId, participantId, and noteText are required');
  }

  const { error: deleteError } = await supabase
    .from('progress_note_chunks')
    .delete()
    .eq('note_id', noteId);

  if (deleteError) {
    throw new Error(`Failed to clear existing chunks: ${deleteError.message}`);
  }

  const chunks = chunkNote(noteText);

  if (chunks.length === 0) {
    return { chunksCreated: 0 };
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

  return { chunksCreated: rows.length };
}

module.exports = { ingestNote };
