# EAN2Marketplace

Sistema interno que transforma planilhas de produtos em anúncios no Mercado Livre, usando IA como copywriter especializado em aviamentos.

## Documentação

Toda documentação em [`docs/`](docs/). Comece por [docs/README.md](docs/README.md) e [CLAUDE.md](CLAUDE.md).

## Stack

React 18 + TypeScript + Vite + Tailwind 4 + shadcn/ui | Supabase | Render | Upstash QStash + Redis | OpenAI GPT-4o-mini + Vision | Mercado Livre API

## Desenvolvimento

```bash
pnpm install
pnpm dev          # frontend local
pnpm test         # vitest
pnpm build        # build de produção
```

Variáveis de ambiente: copie `.env.example` para `.env.local` e preencha.
