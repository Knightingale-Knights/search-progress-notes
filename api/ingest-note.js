const { ingestNote } = require('../lib/ingestNote');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { noteId, participantId, participantName, shiftDate, noteText } = req.body || {};

  try {
    const result = await ingestNote({ noteId, participantId, participantName, shiftDate, noteText });
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    console.error('ingest-note error:', err);
    return res.status(err.message.includes('required') ? 400 : 502).json({ error: 'Ingest failed', detail: err.message });
  }
};
