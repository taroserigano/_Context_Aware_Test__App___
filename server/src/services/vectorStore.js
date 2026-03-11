import { getEmbeddingsModel } from "./llmClient.js";

function cosineSimilarity(a, b) {
  let dot = 0,
    normA = 0,
    normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * In-memory vector store using OpenAI embeddings + cosine similarity.
 * Drop-in replaceable with FAISS for production scale.
 */
export class VectorStore {
  constructor() {
    this.vectors = [];
    this.documents = [];
  }

  async addDocuments(docs) {
    const embedModel = getEmbeddingsModel();
    const texts = docs.map((d) => d.text);
    const vecs = await embedModel.embedDocuments(texts);
    for (let i = 0; i < docs.length; i++) {
      this.vectors.push(vecs[i]);
      this.documents.push(docs[i]);
    }
  }

  async search(query, k = 3) {
    if (this.documents.length === 0) return [];
    const embedModel = getEmbeddingsModel();
    const queryVec = await embedModel.embedQuery(query);
    const scored = this.documents.map((doc, i) => ({
      doc,
      score: cosineSimilarity(queryVec, this.vectors[i]),
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, Math.min(k, scored.length));
  }
}

export async function computeSimilarity(text1, text2) {
  const embedModel = getEmbeddingsModel();
  const [vec1, vec2] = await Promise.all([
    embedModel.embedQuery(text1),
    embedModel.embedQuery(text2),
  ]);
  return cosineSimilarity(vec1, vec2);
}
