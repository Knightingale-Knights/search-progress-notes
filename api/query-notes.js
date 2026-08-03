const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('../lib/supabase');
const { embed } = require('../lib/embed');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MATCH_COUNT = 8;

const SYSTEM_PROMPT = `You answer questions from Knightingale staff about participant progress notes, using only the note excerpts provided to you below. These excerpts have already been filtered to participants the asker is permitted to see.

Rules:
- Answer only from the provided excerpts. If they don't contain the answer, say so plainly — don't guess or use outside knowledge.
- Always mention which participant(s) and roughly when (date) your answer is drawn from.
- If excerpts from multiple participants are relevant, address each separately and clearly.
- Keep the answer concise and direct — a support coordinator scanning quickly should get the point immediately.
- Do not fabricate details not present in the excerpts.`;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { question, allowedParticipantIds: rawAllowedIds } = req.body || {};

  if (!question || typeof question !== 'string' || !question.trim()) {
    return res.status(400).json({ error: 'question (string) is required' });
  }

  // Bubble's API Connector doesn't reliably serialize a dynamic list into a hand-written
  // JSON array in the body template, so accept either a real array or a comma-separated
  // string (Bubble handles the latter natively) and normalize here.
  let allowedParticipantIds;
  if (Array.isArray(rawAllowedIds)) {
    allowedParticipantIds = rawAllowedIds;
  } else if (typeof rawAllowedIds === 'string') {
    allowedParticipantIds = rawAllowedIds
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
  } else {
    allowedParticipantIds = [];
  }

  if (allowedParticipantIds.length === 0) {
    return res.status(400).json({ error: 'allowedParticipantIds (non-empty array or comma-separated string) is required' });
  }

  try {
    const queryEmbedding = await embed(question);

    const { data: matches, error: matchError } = await supabase.rpc('match_progress_note_chunks', {
      query_embedding: queryEmbedding,
      allowed_participant_ids: allowedParticipantIds,
      match_count: MATCH_COUNT
    });

    if (matchError) {
      throw new Error(`Search failed: ${matchError.message}`);
    }

    if (!matches || matches.length === 0) {
      return res.status(200).json({
        answer: "I couldn't find anything relevant in the notes for the participants you have access to.",
        sources: []
      });
    }

    const context = matches
      .map(
        (m, i) =>
          `[${i + 1}] Participant: ${m.participant_name || m.participant_id} | Date: ${m.shift_date || 'unknown'}\n${m.chunk_text}`
      )
      .join('\n\n---\n\n');

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Question: ${question}\n\nNote excerpts:\n\n${context}`
        }
      ]
    });

    const answerBlock = response.content.find((block) => block.type === 'text');

    const sources = matches.map((m) => ({
      noteId: m.note_id,
      participantId: m.participant_id,
      participantName: m.participant_name,
      shiftDate: m.shift_date,
      similarity: m.similarity
    }));

    return res.status(200).json({
      answer: answerBlock ? answerBlock.text : '',
      sources
    });
  } catch (err) {
    console.error('query-notes error:', err);
    return res.status(502).json({ error: 'Query failed', detail: err.message });
  }
};
