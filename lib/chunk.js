// Splits a progress note into overlapping chunks for embedding.
//
// Progress notes are usually a series of timestamped entries (e.g. "0900: ..."
// or "9:00AM: ..."). We try to split on those boundaries first so a chunk
// never cuts a single entry in half, then group consecutive entries up to a
// target size, with a small overlap so context isn't lost at chunk edges.
// If no timestamp pattern is found (freeform narrative notes), we fall back
// to paragraph splitting.

const TARGET_CHARS = 900;
const OVERLAP_ENTRIES = 1;

const TIMESTAMP_LINE = /(?=(?:^|\n)\s*\d{3,4}\s?(?:AM|PM)?\s*[:\-])/gi;

function splitIntoEntries(noteText) {
  const trimmed = noteText.trim();

  const parts = trimmed.split(TIMESTAMP_LINE).map((p) => p.trim()).filter(Boolean);

  if (parts.length > 1) {
    return parts;
  }

  // Fallback: split on blank lines (paragraphs)
  return trimmed
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function chunkNote(noteText) {
  const entries = splitIntoEntries(noteText);

  if (entries.length === 0) {
    return [];
  }

  const chunks = [];
  let current = [];
  let currentLength = 0;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    current.push(entry);
    currentLength += entry.length;

    const isLast = i === entries.length - 1;

    if (currentLength >= TARGET_CHARS || isLast) {
      chunks.push(current.join('\n'));

      // start next chunk with overlap from the tail of this one
      const overlapStart = Math.max(0, current.length - OVERLAP_ENTRIES);
      current = isLast ? [] : current.slice(overlapStart);
      currentLength = current.reduce((sum, e) => sum + e.length, 0);
    }
  }

  return chunks.filter(Boolean);
}

module.exports = { chunkNote };
