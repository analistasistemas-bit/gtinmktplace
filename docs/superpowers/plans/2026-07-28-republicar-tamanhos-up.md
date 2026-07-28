# Republicar Tamanhos UP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir e republicar a família 02854309 com três tamanhos distinguíveis no Mercado Livre.

**Architecture:** O payload plano classifica rótulos `TAM` como atributo personalizado `Tamanho`. Uma recuperação preservadora pausa os itens UP atuais, limpa apenas os vínculos externos e devolve a família à Revisão; a publicação normal cria novamente os três itens.

**Tech Stack:** TypeScript, React, Vitest, Supabase Edge Functions e Mercado Livre User Products.

## Global Constraints

- Nenhuma família, variação ou imagem pode ser apagada na recuperação.
- A pausa remota deve ser confirmada antes de limpar vínculos locais.
- Cores reais continuam usando `COLOR`.
- Não adicionar dependências.

---

### Task 1: Diferenciar tamanhos no payload plano

**Files:**
- Modify: `supabase/functions/_shared/canais/contrato.ts`
- Modify: `supabase/functions/_shared/ml/publicar.ts`
- Test: `supabase/functions/_shared/ml/__tests__/publicar.test.ts`

**Interfaces:**
- Consumes: `VariacaoInput.cor`.
- Produces: atributo `{ name: 'Tamanho', value_name: 'TAM 01' }` para rótulo de tamanho.

- [ ] Adicionar teste que espera atributo personalizado no item plano.
- [ ] Executar o teste e confirmar falha por receber `COLOR`.
- [ ] Implementar a classificação mínima `TAM`/`TAMANHO`.
- [ ] Executar os testes e confirmar verde.

### Task 2: Recuperação preservadora

**Files:**
- Modify: `supabase/functions/remover-publicado/processar.ts`
- Modify: `supabase/functions/remover-publicado/index.ts`
- Modify: `src/lib/excluir.ts`
- Modify: `src/hooks/useRemoverPublicado.ts`
- Modify: `src/pages/Publicados.tsx`
- Test: `supabase/functions/remover-publicado/__tests__/processar.test.ts`

**Interfaces:**
- Consumes: `preservar_familia: true`.
- Produces: itens remotos pausados, família preservada em Revisão e vínculos ML removidos.

- [ ] Adicionar teste que exige preservar família/variações/imagens e limpar vínculos.
- [ ] Executar e confirmar a falha do comportamento atual de exclusão.
- [ ] Implementar o ramo preservador após a mesma mini-saga de pausa.
- [ ] Expor “Corrigir e republicar” na linha publicada.
- [ ] Executar os testes e confirmar verde.

### Task 3: Publicar e verificar

**Files:**
- Validate all changed files.

**Interfaces:**
- Consumes: família recuperada na Revisão.
- Produces: três User Products com seletor `Tamanho`.

- [ ] Executar testes focais, TypeScript e `git diff --check`.
- [ ] Commitar, integrar na `main`, push e deploy das funções alteradas.
- [ ] Acionar “Corrigir e republicar” para `02854309`.
- [ ] Publicar novamente e confirmar três tamanhos no Mercado Livre.
