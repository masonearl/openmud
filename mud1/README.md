# mud1 – openmud's Construction AI

mud1 is openmud's construction AI. **v1** uses a RAG (Retrieval-Augmented Generation) system—accurate construction Q&A from a curated knowledge base. Optional: run **Ollama** locally for open-ended chat.

## RAG v1 (default)

- **Knowledge base:** `data/construction-qa.json` – construction Q&A with keywords
- **Retrieval:** Keyword matching (no embeddings). Fast, precise, no API keys.
- **Reserved:** "organize my desktop", "clean my downloads" → trigger backend tools (not RAG)
- **Test:** `node mud1/scripts/test-rag.js` or `node mud1/scripts/test-rag.js "pipe cost"`

## Local mode (Ollama)

Run mud1 entirely on your machine with no API keys:

1. **Install Ollama** from [ollama.com](https://ollama.com)
2. **Pull a small model** (pick one):
   ```bash
   ollama pull tinyllama    # 1.1B params, ~637MB, fastest
   ollama pull phi2         # 2.7B params, ~1.6GB, better quality
   ollama pull smollm2      # 1.7B params, good balance
   ```
3. **Start Ollama** (runs automatically after install, or `ollama serve`)
4. mud1 will use `localhost:11434` when available

## Model recommendations

| Model      | Size   | RAM   | Speed   | Quality |
|-----------|--------|-------|---------|---------|
| tinyllama | 637MB  | ~2GB  | Fastest | Basic   |
| smollm2   | ~1GB   | ~3GB  | Fast    | Good    |
| phi2      | ~1.6GB | ~4GB  | Medium  | Best    |

## Construction tuning

mud1 uses a construction-specific system prompt. To fine-tune for your workflows, edit `prompts/construction.js`.

## Project structure

```
mud1/
├── README.md
├── package.json
├── data/
│   └── construction-qa.json   # RAG knowledge base (add Q&A here)
├── src/
│   ├── ollama-client.js       # Ollama API client
│   └── rag.js                 # RAG retrieval (keyword-based)
├── scripts/
│   └── test-rag.js            # Test RAG: node mud1/scripts/test-rag.js
└── prompts/
    └── construction.js        # System prompt (for Ollama)
```
