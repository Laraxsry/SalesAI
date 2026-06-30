# SalesAI

An **AI sales representative** platform. Sellers feed product knowledge into the
system (text, images, video, documents, or a live software URL); the system
trains a retrieval-augmented agent and activates it as a **shareable link**. A
customer opens the link and talks to a **realtime voice agent with a visual
avatar** that can answer questions, run an **AI-driven guided tour** of the
product, and **understand the customer's shared screen**.

## Tech stack

- **Monorepo**: Turborepo + npm workspaces, JavaScript + JSDoc, ESM
- **API**: Express + Socket.IO
- **Realtime**: LiveKit (WebRTC) + `@livekit/agents` (Node) agent worker
- **LLM**: OpenAI Realtime (`gpt-realtime-2`) / chained STT->LLM->TTS (pluggable)
- **Avatar**: Tavus / Simli / HeyGen / D-ID / voice-only (strategy, dev-selected)
- **RAG**: MongoDB Atlas Vector Search (default) or Qdrant; OpenAI embeddings
- **Database**: MongoDB (Mongoose)
- **Queue**: BullMQ + Redis
- **Storage**: S3-compatible (MinIO in dev)
- **Web**: React 19 + Vite + Tailwind v4
- **Mobile**: Expo + LiveKit React Native

## Layout

```
apps/
  api/              Express + Socket.IO REST + LiveKit token issuing
  console/          Seller dashboard (ingest knowledge, build/activate agents)
  visitor/          Public customer experience (opened via share link)
  agent-worker/     LiveKit Node agent (the realtime brain)
  worker-ingestion/ BullMQ heavy jobs (transcribe, embed, crawl)
  worker-general/   BullMQ light jobs (link expiry, session cleanup)
  mobile/           Expo visitor app
packages/
  ai/ rag/ avatar/ screen/ agent/ livekit/      (core, SalesAI-specific)
  contracts/ database/ auth/ access/ realtime/   (domain + platform)
  storage/ queue/ config-env/ logger/            (infrastructure)
  ui/ tailwind-config/ validation/ utils/ testing/ sdk/
```

## Getting started

```bash
# 1. Start infra (MongoDB Atlas Local, Redis, MinIO, Qdrant, LiveKit)
npm run infra:up

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env   # then fill in OPENAI_API_KEY etc.

# 4. Create the vector search index
npm run db:indexes

# 5. Run everything in dev
npm run dev
```

## Documentation

See [`md/`](./md):

- [`00_product_vision.md`](./md/00_product_vision.md)
- [`01_architecture.md`](./md/01_architecture.md)
- [`02_ai_realtime_avatar_screen.md`](./md/02_ai_realtime_avatar_screen.md)
- [`03_data_model_and_api.md`](./md/03_data_model_and_api.md)
- Phase docs: [`md/backend`](./md/backend), [`md/web`](./md/web), [`md/mobile`](./md/mobile)
