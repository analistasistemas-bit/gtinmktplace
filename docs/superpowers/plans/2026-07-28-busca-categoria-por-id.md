# Category ID Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aceitar IDs como `MLB270264` no seletor de categorias da Revisão.

**Architecture:** Interceptar queries no formato de ID no módulo de descoberta do Mercado Livre, validar o ID na API oficial e devolver o mesmo contrato já consumido pela interface. Consultas textuais permanecem inalteradas.

**Tech Stack:** TypeScript, Supabase Edge Functions, Vitest, API de Categorias do Mercado Livre.

## Global Constraints

- Não adicionar dependências.
- Não alterar a interface visual.
- Não aplicar a categoria automaticamente; o operador confirma clicando no resultado.

---

### Task 1: Busca direta por ID

**Files:**
- Modify: `supabase/functions/_shared/ml/domain-discovery.ts`
- Test: `supabase/functions/_shared/ml/__tests__/domain-discovery.test.ts`

**Interfaces:**
- Consumes: query textual recebida por `buscarCategoriaPreditor(token, query)`.
- Produces: `buscarCategoriaDireta(query, fetchFn)` retornando `CategoriaCandidata[] | null`.

- [ ] **Step 1: Write the failing test**

Adicionar testes que chamem `buscarCategoriaDireta('mlb270264', fakeFetch)` e esperem:

```ts
[{
  domainId: '',
  domainName: '',
  categoriaId: 'MLB270264',
  categoriaNome: 'Outros',
}]
```

Também verificar que `buscarCategoriaDireta('colchete gancho', fakeFetch)` retorna `null` sem chamar a API.

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run supabase/functions/_shared/ml/__tests__/domain-discovery.test.ts`

Expected: FAIL porque `buscarCategoriaDireta` ainda não existe.

- [ ] **Step 3: Write minimal implementation**

Implementar a detecção `^MLB\d+$`, consultar `/categories/{ID}`, validar `id` e `name`, normalizar o resultado e chamar essa função antes do cache/preditor textual.

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run supabase/functions/_shared/ml/__tests__/domain-discovery.test.ts`

Expected: PASS.

- [ ] **Step 5: Validate and publish**

Executar o teste focal, TypeScript, commit, merge em `main`, push, deploy de `atributos-familia` e teste manual com `MLB270264`.
