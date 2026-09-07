# Plano de Implementação: Banner de Instalação PWA

**Data:** 2026-09-07  
**Branch:** `feat/pwa-install-prompt`  
**Worktree:** `.worktrees/pwa-install-prompt`  
**Referência:** ADR-0153 (PWA instalável), Mockup Beta Wallet fornecido pelo usuário.

---

## 1. Visão Geral e Decisões de Design

1. **Visual:** Dark card fixo no canto inferior direito (`bottom-4 right-4 z-50`), responsivo para mobile (`bottom-4 left-4 right-4 max-w-sm ml-auto`), tema escuro com cantos arredondados (`rounded-xl`), borda sutil, sombra, ícone do app (`/maskable-192.png`), título "Instalar PubliAI", subtítulo "Instale nosso app para uma experiência mais rápida e acesso offline", botão de ação branco com ícone de download (Lucide `Download`), e botão "✕" para dispensar.
2. **Cooldown de 7 dias:** Ao clicar no "✕", salva timestamp no `localStorage` sob a chave `pwa_install_dismissed_until`. Enquanto o tempo atual for menor que esse timestamp, o banner não reaparece.
3. **Suporte ao iOS / Safari:** Como o iOS não suporta o evento `beforeinstallprompt`, detectamos dispositivos iOS e exibimos o banner. Ao clicar no botão "Instalar", abre-se um Dialog orientando os dois passos:
   1. Toque no ícone Compartilhar (⎋) na barra do Safari.
   2. Role para baixo e selecione "Adicionar à Tela de Início" (⊞).
4. **Modo Standalone:** Se `window.matchMedia('(display-mode: standalone)').matches` ou `navigator.standalone` for verdadeiro, o banner nunca é exibido.
5. **Integração com `pwa-store`:** Estende a store Zustand existente para manter `deferredPrompt`, `isInstallDismissed`, `promptInstall`, `dismissInstallPrompt`.

---

## 2. Estrutura de Arquivos

- `src/types/before-install-prompt.d.ts`: Tipagem para o evento `BeforeInstallPromptEvent`.
- `src/lib/pwa-install.ts`: Funções puras para detecção de iOS, Standalone e Cooldown no localStorage.
- `src/lib/__tests__/pwa-install.test.ts`: Testes unitários para as funções utilitárias.
- `src/stores/pwa-store.ts`: Extensão do store com lógica de instalação.
- `src/stores/__tests__/pwa-store.test.ts`: Testes unitários do store.
- `src/components/install-prompt-banner.tsx`: Componente React visual do banner e modal iOS.
- `src/components/__tests__/install-prompt-banner.test.tsx`: Testes do componente com Vitest e React Testing Library.
- `src/App.tsx`: Montagem global do `InstallPromptBanner`.

---

## 3. Tarefas de Execução (TDD)

### Task 1: Tipagem do evento `BeforeInstallPromptEvent`
- Criar `src/types/before-install-prompt.d.ts`.
- Validar com `tsc --noEmit`.

### Task 2: Utilitários `pwa-install.ts` (TDD)
- Criar teste `src/lib/__tests__/pwa-install.test.ts` (RED).
- Implementar `src/lib/pwa-install.ts` com `isIOS`, `isStandalone`, `isCooldownActive`, `setDismissCooldown` (GREEN).
- Validar testes.

### Task 3: Extensão de `pwa-store.ts` (TDD)
- Adicionar testes de instalação em `src/stores/__tests__/pwa-store.test.ts` (RED).
- Adicionar propriedades e actions em `src/stores/pwa-store.ts` (GREEN).
- Validar testes.

### Task 4: Componente `InstallPromptBanner` (TDD)
- Criar testes em `src/components/__tests__/install-prompt-banner.test.tsx` (RED).
- Implementar `src/components/install-prompt-banner.tsx` (GREEN).
- Validar testes e renderização.

### Task 5: Montagem no `App.tsx` e Verificação Integrada
- Importar e montar `<InstallPromptBanner />` no `App.tsx`.
- Executar suite de testes completa e lint.
