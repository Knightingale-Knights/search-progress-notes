const OpenAI = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function embed(text) {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text
  });

  return response.data[0].embedding;
}

async function embedBatch(texts) {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: texts
  });

  return response.data.map((d) => d.embedding);
}

module.exports = { embed, embedBatch };
