# Plano 01 — Foundation (M0)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** colocar de pé a fundação completa do projeto — repo Git, frontend Vite+React+TS+Tailwind 4+shadcn rodando local, Supabase conectado, Upstash provisionado, primeira Edge Function "hello" deployada e respondendo, frontend deployado em Render servindo página de "OK" e respondendo ao endpoint do Supabase. Ao final, qualquer commit no `main` resulta em deploy automático.

**Architecture:** monorepo simples (sem package.json workspace) com frontend Vite na raiz e código de backend isolado em `supabase/functions/`. Frontend é Static Site no Render; backend é Supabase (DB + Auth + Storage + Edge Functions + Realtime). Esta fase NÃO inclui auth real, UI das telas do produto, ou integração com IA/ML — só a infraestrutura mínima para que tudo aconteça depois.

**Tech Stack:**
- Node.js 20+ via pnpm (corepack)
- Vite 5 + React 18 + TypeScript 5 (modo strict)
- **Tailwind CSS 4** (CSS-only config via `@import "tailwindcss"` + `@theme`; sem `tailwind.config.ts` nem `postcss.config.js`) — confirma com TASKS.md
- shadcn/ui (componentes adicionados sob demanda)
- React Router DOM 6
- Supabase JS client + Supabase CLI (deploy remoto, sem `supabase start` local — Docker não é pré-requisito)
- Vitest + Testing Library para testes de frontend
- MCPs: `supabase-mcp-server`, `upstash`, `render`, `shadcn`, `context7`

**Documentos relacionados:**
- Spec: [docs/superpowers/specs/2026-05-26-ean2marketplace-design.md](../specs/2026-05-26-ean2marketplace-design.md)
- ADR-0001 (stack): [docs/decisions/0001-stack-tecnologico.md](../../decisions/0001-stack-tecnologico.md)
- CLAUDE.md (regras do projeto): [CLAUDE.md](../../../CLAUDE.md)

**Quando o plano estiver completo:** [docs/TASKS.md](../../TASKS.md) — marcar M0 como ✅; iniciar Plano 02 (UI Mockup).

---

## File Structure

Arquivos que serão criados neste plano:

```
Anuncios MktPlace/
├── .gitignore                          (NOVO)
├── .env.example                        (NOVO)
├── README.md                           (NOVO)
├── package.json                        (NOVO)
├── pnpm-lock.yaml                      (NOVO, autogerado)
├── tsconfig.json                       (NOVO, criado por Vite)
├── tsconfig.app.json                   (NOVO, criado por Vite; modificado para path alias)
├── tsconfig.node.json                  (NOVO, criado por Vite)
├── vite.config.ts                      (NOVO; inclui plugin Tailwind 4)
├── vitest.config.ts                    (NOVO)
├── components.json                     (NOVO, criado por shadcn init)
├── index.html                          (NOVO, criado por Vite)
├── public/
│   └── _redirects                      (NOVO) SPA fallback para o Render
├── src/
│   ├── main.tsx                        (NOVO)
│   ├── App.tsx                         (NOVO)
│   ├── index.css                       (NOVO; @import "tailwindcss" + @theme)
│   ├── lib/
│   │   ├── supabase.ts                 (NOVO)
│   │   └── utils.ts                    (NOVO, gerado por shadcn)
│   ├── pages/
│   │   ├── Home.tsx                    (NOVO)
│   │   └── NotFound.tsx                (NOVO)
│   └── test/
│       └── setup.ts                    (NOVO)
├── tests/
│   ├── App.test.tsx                    (NOVO)
│   └── supabaseClient.test.ts          (NOVO)
├── supabase/
│   ├── config.toml                     (NOVO, autogerado)
│   ├── .gitignore                      (NOVO, autogerado)
│   └── functions/
│       └── hello/
│           └── index.ts                (NOVO; usa Deno.serve nativo)
└── render.yaml                         (NOVO)
```

**Importante:** com Tailwind 4, **NÃO existem mais** `tailwind.config.ts` nem `postcss.config.js`. Toda a config vai pro CSS via `@theme`.

---

## Pré-requisitos do executor

Antes de começar a Task 1, **garantir que estes itens estão prontos**. Cada um tem um comando de verificação. Se algum falhar, executar a ação remediadora antes de seguir.

- [ ] **PR-1: Node >= 20**

  Verificar:
  ```bash
  node -v
  ```
  Esperado: `v20.x.x` ou maior. Se menor, instalar via `nvm install 20 && nvm use 20` ou direto pelo site.

- [ ] **PR-2: pnpm instalado**

  Verificar:
  ```bash
  pnpm -v
  ```
  Se "command not found", ativar via corepack (já vem com Node):
  ```bash
  corepack enable
  corepack prepare pnpm@latest --activate
  pnpm -v
  ```
  Esperado: `9.x.x` ou maior.

- [ ] **PR-3: Git instalado**

  ```bash
  git --version
  ```
  Esperado: `git version 2.x`.

- [ ] **PR-4: 👤 Conta no GitHub pronta** (para criar o repo remoto na Task 10)

- [ ] **PR-5: 👤 Conta no Supabase pronta** (será usada via MCP na Task 2)

- [ ] **PR-6: 👤 Conta no Upstash pronta** (será usada via MCP na Task 3)

- [ ] **PR-7: 👤 Conta no Render pronta** (será usada via MCP na Task 10)

- [ ] **PR-8: 👤 Conta na OpenAI pronta** com crédito mínimo de $20

  Painel: <https://platform.openai.com/account/billing>. Sem crédito, chamadas falham com 429.

- [ ] **PR-9: Docker e Deno são OPCIONAIS** — este plano **NÃO** depende de `supabase start` local nem de `deno test`. Edge Function será testada via curl contra o deploy remoto (Task 9). Se você quiser desenvolvimento local, é problema seu — não está no caminho crítico deste plano.

---

## Convenções para este plano

- **Working directory:** `/Users/diego/Desktop/IA/Anuncios MktPlace`
- **Package manager:** `pnpm` (não usar npm/yarn)
- **Commits:** após cada Task, commit com prefixo padrão (`chore:`, `feat:`, `test:`, etc.)
- **TDD:** aplicado nas Tasks 7, 8, 9 (RED-GREEN-COMMIT). Tasks 5 e 6 são setup + smoke test (não TDD puro — assumido explicitamente).
- **MCPs:** usar quando indicado. Não cair em "vai no dashboard" se houver MCP.
- **Setup manuais (fora do dev env):** marcados com 👤 — pausar antes de seguir.

---

## Task 1: Inicializar repositório Git e arquivos base

**Files:**
- Create: `.gitignore`, `README.md`, `.env.example`

- [ ] **Step 1.1: Inicializar repo Git**

```bash
cd "/Users/diego/Desktop/IA/Anuncios MktPlace"
git init
git config user.name "Diego"
git config user.email "analistasistemas@gmail.com"
```

Esperado: `Initialized empty Git repository`.

- [ ] **Step 1.2: Criar `.gitignore`**

```
# Dependencies
node_modules/
.pnpm-store/

# Build outputs
dist/
build/
.vite/

# Env files (sensíveis)
.env
.env.local
.env.*.local

# Editor
.vscode/
.idea/
.DS_Store

# Logs
*.log
npm-debug.log*
pnpm-debug.log*

# Supabase
supabase/.branches
supabase/.temp

# Testes
coverage/
.nyc_output/

# OS
Thumbs.db

# OMC sessions
.omc/
```

> Importante: `.env.local` está listado **explicitamente** (não confiar só em `.env.*.local`, que não captura `.env.local`).

- [ ] **Step 1.3: Criar `.env.example`**

```
# Frontend (prefixo VITE_ obrigatório para expor ao navegador)
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=

# Backend / Edge Functions (configurar via Supabase secrets, não aqui)
# OPENAI_API_KEY=
# UPSTASH_REDIS_REST_URL=
# UPSTASH_REDIS_REST_TOKEN=
# QSTASH_TOKEN=
# QSTASH_CURRENT_SIGNING_KEY=
# QSTASH_NEXT_SIGNING_KEY=
# ML_CLIENT_ID=
# ML_CLIENT_SECRET=
```

- [ ] **Step 1.4: Criar `README.md`**

````markdown
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
````

- [ ] **Step 1.5: Primeiro commit**

```bash
git add .gitignore README.md .env.example
git commit -m "chore: initial repo setup with gitignore and env template"
```

---

## Task 2: Provisionar Supabase + OpenAI (serviços externos via MCP/manual)

**Files:** nenhum arquivo local — operações remotas

- [ ] **Step 2.1: Listar organizações Supabase**

Via `supabase-mcp-server`, listar organizações. Se mais de uma, pausar e perguntar a Diego qual usar.

- [ ] **Step 2.2: 👤 Confirmar organização com Diego**

- [ ] **Step 2.3: Criar projeto Supabase `ean2marketplace`**

Via `supabase-mcp-server`:
- Name: `ean2marketplace`
- Region: `sa-east-1` (São Paulo)
- Plan: `free`
- Database password: gerar forte (anotar no 1Password)

- [ ] **Step 2.4: Anotar URL + ANON_KEY**

Listar via MCP. Guardar para `.env.local` na Task 8.

- [ ] **Step 2.5: 👤 Provisionar OpenAI API key**

Diego (manual no painel <https://platform.openai.com/api-keys>):
- Criar key dedicada `ean2marketplace`
- Anotar no 1Password
- Garantir que o billing tem ao menos $20 de crédito (PR-8)

Não vai pro `.env.local` do frontend. **Vai pro Supabase como secret** no próximo step.

- [ ] **Step 2.6: Configurar OPENAI_API_KEY como secret do Supabase**

Via `supabase-mcp-server`:
- Adicionar secret `OPENAI_API_KEY` ao projeto com o valor anotado
- Edge Functions vão lê-lo via `Deno.env.get('OPENAI_API_KEY')`

> Demais secrets (Upstash, Mercado Livre) vão ser adicionados quando criados.

---

## Task 3: Provisionar Upstash (QStash + Redis via MCP)

**Files:** nenhum arquivo local

- [ ] **Step 3.1: Criar banco Redis no Upstash**

Via `upstash` MCP:
- Name: `ean2marketplace-cache`
- Region: `sa-east-1` (São Paulo, mais perto do Supabase)
- Tier: `free`

Anotar `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN`.

- [ ] **Step 3.2: Habilitar QStash**

Via `upstash` MCP:
- QStash usa a mesma conta — não precisa "criar" instância
- Anotar `QSTASH_TOKEN`
- Anotar `QSTASH_CURRENT_SIGNING_KEY` e `QSTASH_NEXT_SIGNING_KEY` (assinatura de webhooks)

- [ ] **Step 3.3: Configurar secrets do Upstash no Supabase**

Via `supabase-mcp-server`, adicionar como secrets:
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `QSTASH_TOKEN`
- `QSTASH_CURRENT_SIGNING_KEY`
- `QSTASH_NEXT_SIGNING_KEY`

---

## Task 4: Setup do frontend (Vite + React + TS)

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`, `vite.config.ts`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/index.css`

- [ ] **Step 4.1: Scaffold do projeto com pnpm + Vite**

```bash
pnpm create vite@latest . -- --template react-ts
```

Quando perguntar "Current directory is not empty", escolher `Ignore files and continue`.

- [ ] **Step 4.2: Simplificar `src/App.tsx`**

Substituir todo o conteúdo por:

```tsx
function App() {
  return (
    <div>
      <h1>EAN2Marketplace — Foundation OK</h1>
    </div>
  );
}

export default App;
```

(Estilo virá na Task 5 com Tailwind 4.)

- [ ] **Step 4.3: Limpar `src/index.css`**

Substituir todo o conteúdo por um placeholder:

```css
/* será substituído por @import "tailwindcss" na Task 5 */
```

- [ ] **Step 4.4: Deletar `src/App.css`**

```bash
rm src/App.css
```

Garantir que `src/App.tsx` não importa mais esse arquivo (já removemos na Step 4.2).

- [ ] **Step 4.5: Instalar dependências**

```bash
pnpm install
```

Esperado: `node_modules/` + `pnpm-lock.yaml` criados.

- [ ] **Step 4.6: Rodar dev server**

```bash
pnpm dev
```

Abrir `http://localhost:5173`. Deve aparecer "EAN2Marketplace — Foundation OK" sem estilo. Encerrar com `Ctrl+C`.

- [ ] **Step 4.7: Configurar path alias `@/*` em `tsconfig.app.json`**

Adicionar dentro de `compilerOptions`:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

- [ ] **Step 4.8: Atualizar `vite.config.ts` com path alias**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

(O plugin `@tailwindcss/vite` será adicionado na Task 5.)

- [ ] **Step 4.9: Instalar `@types/node`**

```bash
pnpm add -D @types/node
```

- [ ] **Step 4.10: Verificar `pnpm build`**

```bash
pnpm build
```

Esperado: `dist/` criado, sem erros.

- [ ] **Step 4.11: Commit**

```bash
git add .
git commit -m "feat: scaffold Vite + React + TypeScript with path alias"
```

---

## Task 5: Instalar Tailwind 4 + shadcn/ui

**Files:**
- Modify: `vite.config.ts`, `src/index.css`, `src/App.tsx`
- Create: `components.json`, `src/lib/utils.ts`, `src/components/ui/button.tsx`

> **Atenção:** Tailwind 4 elimina `tailwind.config.ts` e `postcss.config.js`. A config é toda em CSS via `@theme`. shadcn/ui já suporta Tailwind 4 a partir de mid-2025.

- [ ] **Step 5.1: Instalar Tailwind 4 e o plugin Vite**

```bash
pnpm add tailwindcss @tailwindcss/vite
```

Esperado: `tailwindcss@4.x` instalado.

- [ ] **Step 5.2: Atualizar `vite.config.ts` para incluir o plugin Tailwind**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

- [ ] **Step 5.3: Configurar `src/index.css` como placeholder mínimo**

> **Importante:** o `shadcn init` (Step 5.5) vai **reescrever** o CSS com a estrutura própria do Tailwind 4 (`@theme inline`, oklch colors, `@custom-variant dark`, imports `tw-animate-css`). Não vale a pena escrever o CSS detalhado aqui — seria descartado.

Substituir todo o conteúdo de `src/index.css` por:

```css
@import "tailwindcss";
```

Apenas isso. O shadcn init complementa.

- [ ] **Step 5.4: Validar visual antes do shadcn**

```bash
pnpm dev
```

Abrir `http://localhost:5173`. O texto aparece com a fonte sans-serif padrão do Tailwind (sem cores customizadas ainda). Encerrar.

- [ ] **Step 5.5: Inicializar shadcn/ui (gera o CSS de tema completo)**

```bash
pnpm dlx shadcn@latest init
```

Responder:
- Style: `Default`
- Base color: `Slate`
- CSS file: `src/index.css`
- Color variables: `yes`
- Components alias: `@/components`
- Utils alias: `@/lib/utils`
- React Server Components: `no`

Esperado:
- `components.json` criado
- `src/lib/utils.ts` criado
- `src/index.css` **reescrito** com `@import "tailwindcss"`, `@import "tw-animate-css"`, `@custom-variant dark`, `@theme inline { ... }` com variáveis oklch
- `tw-animate-css` adicionado como dep do `package.json`

> Se o init falhar com erro sobre Tailwind 4 ou shadcn não detectar v4 corretamente, fallback:
> ```bash
> pnpm dlx shadcn@canary init
> ```
> A versão canary tem suporte mais maduro a Tailwind 4.

- [ ] **Step 5.5b: Inspecionar o CSS gerado**

```bash
cat src/index.css
```

Confirmar que o arquivo contém pelo menos:
- `@import "tailwindcss";`
- `@theme inline { ... }` com variáveis `--color-*` referenciando CSS vars
- Bloco `:root { ... }` com cores em formato oklch
- Bloco `.dark { ... }` para modo escuro

Se algum desses estiver ausente, o shadcn não rodou corretamente — repetir Step 5.5 com `@canary`.

- [ ] **Step 5.6: Adicionar componente Button**

```bash
pnpm dlx shadcn@latest add button
```

Esperado: `src/components/ui/button.tsx` criado.

- [ ] **Step 5.7: Atualizar `App.tsx` para usar Button**

```tsx
import { Button } from '@/components/ui/button';

function App() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4">
      <h1 className="text-3xl font-bold tracking-tight">EAN2Marketplace</h1>
      <p className="text-muted-foreground">Foundation OK</p>
      <Button>Funciona</Button>
    </div>
  );
}

export default App;
```

- [ ] **Step 5.8: Validar visual**

```bash
pnpm dev
```

Abrir `http://localhost:5173`. Esperado: título grande, subtítulo cinza, botão Slate estilizado. Encerrar.

- [ ] **Step 5.9: Commit**

```bash
git add .
git commit -m "feat: install Tailwind 4 + shadcn/ui with Slate theme"
```

---

## Task 6: Setup Vitest + smoke test do App

**Files:**
- Create: `vitest.config.ts`, `src/test/setup.ts`, `tests/App.test.tsx`

> Esta task **não é TDD puro** — é setup da infra de testes + smoke test do que já existe. TDD genuíno (com RED real) começa na Task 7.

- [ ] **Step 6.1: Instalar dependências de teste**

```bash
pnpm add -D vitest @vitest/ui jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
```

- [ ] **Step 6.2: Criar `vitest.config.ts`**

```ts
/// <reference types="vitest" />
import { defineConfig, mergeConfig } from 'vite';
import viteConfig from './vite.config';

export default mergeConfig(viteConfig, defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['./tests/**/*.test.{ts,tsx}'],
  },
}));
```

> Reutilizando a config do Vite via `mergeConfig` — Tailwind plugin, path alias e React plugin já vêm de graça.

- [ ] **Step 6.3: Criar `src/test/setup.ts`**

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 6.4: Adicionar scripts `test` ao `package.json`**

Substituir a seção `"scripts"`:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "lint": "eslint .",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 6.5: Criar `tests/App.test.tsx` (smoke test)**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from '@/App';

describe('App (smoke)', () => {
  it('renderiza o título do EAN2Marketplace', () => {
    render(<App />);
    expect(screen.getByText('EAN2Marketplace')).toBeInTheDocument();
  });

  it('renderiza o botão "Funciona"', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: 'Funciona' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 6.6: Rodar `pnpm test` — esperar PASSAR (smoke)**

```bash
pnpm test
```

Esperado: 2 tests passed. Se falhar, corrigir antes de seguir.

- [ ] **Step 6.7: Commit**

```bash
git add .
git commit -m "test: add vitest setup with App smoke test"
```

---

## Task 7: Instalar React Router + criar rotas básicas (TDD real)

**Files:**
- Create: `src/pages/Home.tsx`, `src/pages/NotFound.tsx`
- Modify: `src/App.tsx`, `tests/App.test.tsx`

- [ ] **Step 7.1: Instalar React Router**

```bash
pnpm add react-router-dom
```

- [ ] **Step 7.2: Escrever teste falhando (RED)**

Substituir `tests/App.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '@/App';

function renderRoute(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AppRoutes />
    </MemoryRouter>
  );
}

describe('App routing', () => {
  it('renderiza Home na rota /', () => {
    renderRoute('/');
    expect(screen.getByText(/EAN2Marketplace/i)).toBeInTheDocument();
    expect(screen.getByText(/Foundation OK/i)).toBeInTheDocument();
  });

  it('renderiza NotFound em rota desconhecida', () => {
    renderRoute('/rota-que-nao-existe');
    expect(screen.getByText(/404/)).toBeInTheDocument();
    expect(screen.getByText(/Página não encontrada/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 7.3: Rodar — esperar FALHAR (RED genuíno)**

```bash
pnpm test
```

Esperado: testes falham por **`AppRoutes` não exportado de `@/App`** (import error).

- [ ] **Step 7.4: Criar `src/pages/Home.tsx`**

```tsx
import { Button } from '@/components/ui/button';

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4">
      <h1 className="text-3xl font-bold tracking-tight">EAN2Marketplace</h1>
      <p className="text-muted-foreground">Foundation OK</p>
      <Button>Funciona</Button>
    </div>
  );
}
```

- [ ] **Step 7.5: Criar `src/pages/NotFound.tsx`**

```tsx
export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-2">
      <h1 className="text-4xl font-bold">404</h1>
      <p className="text-muted-foreground">Página não encontrada</p>
    </div>
  );
}
```

- [ ] **Step 7.6: Reescrever `src/App.tsx` com Router + export `AppRoutes`**

```tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Home from '@/pages/Home';
import NotFound from '@/pages/NotFound';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}

export default App;
```

- [ ] **Step 7.7: Rodar — esperar PASSAR (GREEN)**

```bash
pnpm test
```

Esperado: 2 tests passed.

- [ ] **Step 7.8: Validar visual**

```bash
pnpm dev
```

Testar:
- `/` → vê Home
- `/algo` → vê 404

Encerrar.

- [ ] **Step 7.9: Commit**

```bash
git add .
git commit -m "feat: add React Router with Home and NotFound (TDD)"
```

---

## Task 8: Configurar `.env.local` + cliente Supabase (TDD)

**Files:**
- Create: `.env.local` (gitignored), `src/lib/supabase.ts`, `tests/supabaseClient.test.ts`
- Modify: `vitest.config.ts`

- [ ] **Step 8.1: Instalar `@supabase/supabase-js`**

```bash
pnpm add @supabase/supabase-js
```

- [ ] **Step 8.2: 👤 Criar `.env.local` com valores do Step 2.4**

```
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJh...
```

Verificar:
```bash
test -f .env.local && echo "OK" || echo "FALTA"
```

- [ ] **Step 8.3: Garantir Vitest carrega vars VITE_**

Vitest reutiliza a config do Vite via `mergeConfig` (Task 6, Step 6.2), e Vite já carrega `.env.local`. Para garantir, verificar que `vitest.config.ts` está usando o `mergeConfig` com `viteConfig` (deve já estar correto).

- [ ] **Step 8.4: Escrever teste falhando (RED)**

Criar `tests/supabaseClient.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { supabase } from '@/lib/supabase';

describe('Supabase client', () => {
  it('é uma instância válida do supabase-js', () => {
    expect(supabase).toBeDefined();
    expect(typeof supabase.from).toBe('function');
    expect(typeof supabase.auth).toBe('object');
  });

  it('está configurado com VITE_SUPABASE_URL do env', () => {
    expect(import.meta.env.VITE_SUPABASE_URL).toMatch(/^https:\/\//);
    expect(import.meta.env.VITE_SUPABASE_ANON_KEY).toBeTruthy();
  });
});
```

- [ ] **Step 8.5: Rodar — esperar FALHAR (RED)**

```bash
pnpm test tests/supabaseClient.test.ts
```

Esperado: falha porque `@/lib/supabase` não existe.

- [ ] **Step 8.6: Implementar `src/lib/supabase.ts`**

```ts
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Supabase env vars ausentes: VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY são obrigatórios. Verifique o .env.local.'
  );
}

export const supabase: SupabaseClient = createClient(url, anonKey);
```

- [ ] **Step 8.7: Rodar — esperar PASSAR (GREEN)**

```bash
pnpm test
```

Esperado: todos os testes passam.

- [ ] **Step 8.8: Commit**

```bash
git add .
git commit -m "feat: add Supabase JS client singleton (TDD)"
```

---

## Task 9: Setup Supabase CLI local + Edge Function "hello"

**Files:**
- Create: `supabase/config.toml` (autogerado), `supabase/.gitignore` (autogerado), `supabase/functions/hello/index.ts`

> Esta task **não usa Docker nem Deno local**. Testamos a Edge Function via `curl` contra o deploy remoto.

- [ ] **Step 9.1: Instalar Supabase CLI como devDep**

```bash
pnpm add -D supabase
pnpm supabase --version
```

Esperado: versão >= 1.150.

- [ ] **Step 9.2: Inicializar Supabase no projeto**

```bash
pnpm supabase init
```

Quando perguntar:
- VSCode settings: `no`
- Deno settings: `no` (não vamos testar Deno local)

Esperado: criado `supabase/config.toml` e `supabase/.gitignore`.

- [ ] **Step 9.3: Linkar projeto local ao remoto**

```bash
pnpm supabase link --project-ref <SUPABASE_PROJECT_REF>
```

> `<SUPABASE_PROJECT_REF>` é a parte antes de `.supabase.co` na URL do projeto (Step 2.4).

Vai pedir database password (Step 2.3). Coletar do 1Password.

- [ ] **Step 9.4: Criar Edge Function `hello`**

```bash
pnpm supabase functions new hello
```

Esperado: criado `supabase/functions/hello/index.ts` com boilerplate.

- [ ] **Step 9.5: Substituir conteúdo de `supabase/functions/hello/index.ts`**

```ts
// Edge Function: hello
// Smoke test que valida que Supabase está deployando funções corretamente.

interface HelloResponse {
  message: string;
  timestamp: string;
}

Deno.serve((_req) => {
  const body: HelloResponse = {
    message: 'EAN2Marketplace foundation OK',
    timestamp: new Date().toISOString(),
  };

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
```

> Usamos `Deno.serve` nativo (Supabase Edge Runtime atual), sem import deprecated de `https://deno.land/std/.../server.ts`.

- [ ] **Step 9.6: Deploy da Edge Function**

```bash
pnpm supabase functions deploy hello --no-verify-jwt
```

Esperado: log "Deployed Function hello to https://<ref>.supabase.co/functions/v1/hello".

- [ ] **Step 9.7: Testar deploy com curl**

```bash
curl -s https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/hello | jq
```

Esperado: JSON com `message: "EAN2Marketplace foundation OK"` e `timestamp` ISO.

(Se `jq` não estiver instalado, use sem o pipe.)

- [ ] **Step 9.8: Commit**

```bash
git add .
git commit -m "feat: add hello Edge Function deployed to Supabase"
```

---

## Task 10: Push pro GitHub + setup do Render deploy

**Files:**
- Create: `render.yaml`, `public/_redirects`

- [ ] **Step 10.1: Criar `public/_redirects` para SPA fallback**

```
/* /index.html 200
```

> Este arquivo é mais robusto que `routes` no `render.yaml` para SPA fallback. Render reconhece automaticamente.

- [ ] **Step 10.2: Criar `render.yaml`**

```yaml
services:
  - type: web
    name: ean2marketplace-frontend
    runtime: static
    rootDir: .
    buildCommand: pnpm install && pnpm build
    staticPublishPath: ./dist
    pullRequestPreviewsEnabled: false
    envVars:
      - key: VITE_SUPABASE_URL
        sync: false
      - key: VITE_SUPABASE_ANON_KEY
        sync: false
```

- [ ] **Step 10.3: Commit dos arquivos de deploy**

```bash
git add render.yaml public/_redirects
git commit -m "chore: add render.yaml blueprint and SPA redirects"
```

- [ ] **Step 10.4: 👤 Diego cria repo GitHub e linka**

Pausar para Diego:
1. Criar repo `ean2marketplace` (privado) no GitHub
2. Adicionar como remoto:

```bash
git remote add origin git@github.com:<usuario>/ean2marketplace.git
git branch -M main
git push -u origin main
```

- [ ] **Step 10.5: Criar Static Site no Render via MCP**

Via `render` MCP, criar Static Site:
- Connect to: o repo `ean2marketplace` do GitHub
- Branch: `main`
- Auto-deploy: enabled
- Build/publish: vêm do `render.yaml`
- Env vars: configurar `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` com os valores do Step 2.4

- [ ] **Step 10.6: Aguardar primeiro deploy**

Via `render` MCP, polling de status. Aguardar `succeeded`.

- [ ] **Step 10.7: Smoke test em produção**

```bash
curl -I https://<seu-app>.onrender.com/
```

Esperado: `HTTP/2 200` ou similar.

Abrir no navegador: a Home deve aparecer estilizada (título, subtítulo, botão).

Testar fallback SPA:
```bash
curl -I https://<seu-app>.onrender.com/algo-que-nao-existe
```

Esperado: `HTTP/2 200` (não 404 — o `_redirects` faz o fallback).

---

## Task 11: Atualizar TASKS.md e ROADMAP.md marcando M0 ✅

**Files:**
- Modify: `docs/TASKS.md`, `docs/ROADMAP.md`

- [ ] **Step 11.1: Marcar todas as sub-tasks de M0 como ✅**

Em `docs/TASKS.md`, na seção "🏁 M0 — Setup inicial", trocar todos os ⬜ para ✅. Ajustar contagem no resumo do topo.

- [ ] **Step 11.2: Atualizar "Última atualização" do TASKS.md**

Topo do arquivo: trocar a data para a atual.

- [ ] **Step 11.3: Atualizar "Estado geral" do ROADMAP.md**

Em `docs/ROADMAP.md`, trocar para `🟢 M0 concluído, pronto para M1`.

- [ ] **Step 11.4: Commit**

```bash
git add docs/TASKS.md docs/ROADMAP.md
git commit -m "docs: mark M0 as complete"
git push
```

---

## Task 12: Validação final do plano (critérios de saída do M0)

**Files:** nenhum

- [ ] **Step 12.1: Checklist objetivo**

Verificar que TODOS os itens passam:

- [ ] `git status` mostra working tree clean
- [ ] `pnpm test` passa todos os testes
- [ ] `pnpm build` completa sem erros
- [ ] `pnpm dev` serve o site com Home + 404 funcionando
- [ ] `https://<seu-app>.onrender.com/` responde com a Home estilizada
- [ ] `https://<seu-app>.onrender.com/algo` responde com 404 (fallback SPA via `_redirects`)
- [ ] `https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/hello` retorna JSON com `message` e `timestamp`
- [ ] Supabase project criado, secrets `OPENAI_API_KEY`, `UPSTASH_*` e `QSTASH_*` configurados
- [ ] Upstash Redis + QStash provisionados
- [ ] Render Static Site com auto-deploy ativo
- [ ] App Mercado Livre Developers criado por Diego (trilho paralelo — confirmar status)

- [ ] **Step 12.2: Anunciar conclusão e propor Plano 02**

Mensagem ao Diego: "Plano 01 (Foundation) concluído. M0 ✅ no TASKS/ROADMAP. Pronto para iniciar Plano 02 (UI Mockup) — quer que eu escreva agora?"

---

## Notas para quem executa este plano

- **Erros comuns:**
  - `pnpm dlx shadcn init` perguntando sobre Tailwind config — se reclamar de incompatibilidade com v4, tentar `pnpm dlx shadcn@canary init`
  - `pnpm supabase link` pedindo password — usar a senha gerada no Step 2.3
  - Render deploy falhando em `pnpm install` — verificar que o `package.json` está commitado e o build command está exato

- **Setup parallel track (Diego deve iniciar HOJE):**
  - Criar app no portal [Mercado Livre Developers](https://developers.mercadolibre.com.br/)
  - Pode levar semanas até aprovação para produção
  - Sandbox é liberado quase imediatamente; OAuth pode ser testado contra sandbox no M4

- **O que NÃO está neste plano (planos seguintes):**
  - Auth real (login/cadastro): Plano 03
  - Telas de UI do produto (Dashboard, Upload, Revisão): Plano 02
  - Schema do banco: Plano 03
  - Integração com IA: Plano 04
  - Integração ML: Plano 05

- **Estimativa:** 1-2 dias concentrados, ou 3-4 dias com interrupções.
