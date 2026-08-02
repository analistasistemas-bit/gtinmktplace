# Telegram Explicit Save Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer Chat ID e Bot token persistirem somente após clique explícito em “Salvar configurações”.

**Architecture:** Manter o estado local existente no componente e remover a persistência dos eventos de desfoque. Derivar se há alterações locais para controlar o novo botão, reutilizando a mutação existente.

**Tech Stack:** React 18, TypeScript, Testing Library, Vitest.

## Global Constraints

- Um único botão salva Chat ID e Bot token juntos.
- O interruptor Ativo continua salvando imediatamente.
- Nenhuma dependência nova e nenhuma refatoração fora do componente.

---

### Task 1: Salvamento explícito da configuração

**Files:**
- Create: `src/components/__tests__/config-telegram.test.tsx`
- Modify: `src/components/config-telegram.tsx`

**Interfaces:**
- Consumes: `useTelegramConfig()` e `useSalvarTelegramConfig()` existentes.
- Produces: botão acessível `Salvar configurações`, habilitado somente quando Chat ID ou token tiver alteração local.

- [ ] **Step 1: Write the failing test**

Renderizar `ConfigTelegram`, editar e desfocar Chat ID e token, confirmar que a mutação não foi chamada, clicar em `Salvar configurações` e confirmar o envio de `{ chatId: 'novo-chat', ativo: true, botToken: 'novo-token' }`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/components/__tests__/config-telegram.test.tsx`
Expected: FAIL porque o botão `Salvar configurações` ainda não existe e os eventos de desfoque chamam a mutação.

- [ ] **Step 3: Write minimal implementation**

Remover os dois `onBlur`, derivar `temAlteracoes = chatId !== (cfg?.chatId ?? '') || Boolean(botToken.trim())` e adicionar o botão que chama `persistir({ chatId, botToken: botToken.trim() || undefined })`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/components/__tests__/config-telegram.test.tsx`
Expected: PASS.

- [ ] **Step 5: Validate types and commit**

Run: `pnpm build`
Expected: PASS sem erros TypeScript ou Vite.

Commit: `feat: require explicit save for Telegram config`
