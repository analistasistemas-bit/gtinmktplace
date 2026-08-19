# Calculadora Mercado Livre Premium Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar no menu Viabilidade uma calculadora Mercado Livre premium, API-first, que compare Clássico e Premium, explique a decisão de compra e deixe explícita a precisão de cada estimativa.

**Architecture:** Um motor TypeScript puro concentra cálculos e vereditos. A tela consulta uma Edge Function somente leitura para sugerir categorias e reutiliza `calcular-tarifa-ml` para comissão/frete oficiais; se a API não responder ou a categoria ficar vazia, opera em modo manual degradado com aviso persistente. A página Viabilidade apenas alterna entre a análise existente e a nova calculadora.

**Tech Stack:** React 18, TypeScript, TanStack Query, Supabase Edge Functions/Deno, Tailwind, shadcn/ui, Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-18-calculadora-mercado-livre-design.md`

**Global Constraints:** Não copiar marca ou layout da Pronix; não persistir simulações; não alterar dados de tenant; categoria é opcional, mas sua ausência deve ser notificada; preservar integralmente os fluxos atuais de Planilha e GTIN; usar os contratos existentes de tarifa e estoque; nenhum segredo no cliente ou nos logs.

---

## Task 1: Motor financeiro e decisão explicável

**Owner:** Terra — implementação profunda e contratos.

**Files:**
- Create: `src/lib/calculadora-ml.ts`
- Test: `src/lib/__tests__/calculadora-ml.test.ts`

- [ ] **Step 1: Escrever os testes de cubagem e peso utilizado**

Cobrir peso cúbico `altura * largura * comprimento / 6000`, maior entre peso real e cúbico, dimensões ausentes e arredondamento apenas na apresentação.

- [ ] **Step 2: Rodar o teste e confirmar falha**

Run: `rtk npm test -- src/lib/__tests__/calculadora-ml.test.ts`
Expected: FAIL por módulo inexistente.

- [ ] **Step 3: Escrever testes da simulação Clássico/Premium**

Cobrir lucro, margem sobre faturamento, comissão, frete, impostos, custos fixos/variáveis, rebate e custo total. Usar o cenário de referência `preço=100`, `custo=50`, `fixos=5`, `variáveis=3`, `rebate=2`, `frete=16,15`, com comissões de 11,5% e 16,5%.

- [ ] **Step 4: Escrever testes de veredito e metas reversas**

Cobrir `Comprar`, `Negociar`, `Ajustar`, `Evitar` e `Dados insuficientes`; justificar o veredito com no máximo três fatores; calcular preço-alvo e custo máximo a partir da margem desejada; marcar preço-alvo baseado em cotação atual como projeção.

- [ ] **Step 5: Implementar o menor motor puro que satisfaça os testes**

Exportar tipos explícitos para entrada, custos por modalidade, proveniência (`official | partial | estimated`), resultado e veredito. Rejeitar números não finitos/negativos onde não façam sentido e nunca mascarar dados insuficientes como zero confiável.

- [ ] **Step 6: Rodar testes e typecheck direcionado**

Run: `rtk npm test -- src/lib/__tests__/calculadora-ml.test.ts`
Expected: PASS.

Run: `rtk tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 7: Commit**

```bash
rtk git add src/lib/calculadora-ml.ts src/lib/__tests__/calculadora-ml.test.ts
rtk git commit -m "feat: criar motor da calculadora Mercado Livre"
```

## Task 2: Busca segura de categoria e clientes de API

**Owner:** Terra — integração backend/API.

**Files:**
- Create: `supabase/functions/buscar-categorias-ml/index.ts`
- Create: `src/lib/categorias-ml.ts`
- Create: `src/hooks/useCategoriasML.ts`
- Test: `src/lib/__tests__/categorias-ml.test.ts`
- Modify: `supabase/config.toml`

- [ ] **Step 1: Escrever testes do cliente de categorias**

Cobrir normalização da resposta, query com menos de três caracteres sem chamada, erro legível da Edge Function e preservação de `id`, `nome` e caminho quando disponíveis.

- [ ] **Step 2: Rodar e confirmar falha**

Run: `rtk npm test -- src/lib/__tests__/categorias-ml.test.ts`
Expected: FAIL por módulo inexistente.

- [ ] **Step 3: Implementar Edge Function somente leitura**

Seguir o padrão de autenticação/organização das funções existentes, obter token ML sem expô-lo, reutilizar `_shared/ml/domain-discovery.ts`, aceitar apenas `query` validada e responder no máximo oito sugestões. Não escrever em `familias`, `variacoes`, `lotes` ou qualquer tabela de tenant.

- [ ] **Step 4: Implementar cliente e hook com debounce**

Usar `supabase.functions.invoke`, TanStack Query, `staleTime` razoável e estado de erro recuperável. O hook não deve disparar para campo vazio/curto.

- [ ] **Step 5: Registrar configuração da função**

Adicionar somente a seção necessária em `supabase/config.toml`, preservando o padrão de `verify_jwt` do projeto.

- [ ] **Step 6: Validar**

Run: `rtk npm test -- src/lib/__tests__/categorias-ml.test.ts supabase/functions/_shared/ml/__tests__/domain-discovery.test.ts`
Expected: PASS.

Run: `rtk tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 7: Commit**

```bash
rtk git add supabase/functions/buscar-categorias-ml/index.ts supabase/config.toml src/lib/categorias-ml.ts src/hooks/useCategoriasML.ts src/lib/__tests__/categorias-ml.test.ts
rtk git commit -m "feat: adicionar busca segura de categorias ML"
```

## Task 3: Orquestração da simulação e proveniência

**Owner:** Terra — estado, integração e resiliência.

**Files:**
- Create: `src/hooks/useCalculadoraML.ts`
- Test: `src/hooks/__tests__/useCalculadoraML.test.tsx`
- Modify: `src/lib/tarifa.ts`

**Dependencies:** Tasks 1 and 2.

- [ ] **Step 1: Escrever testes do fluxo API-first**

Cobrir cotação oficial com categoria, ausência de categoria com taxas manuais e aviso, falha da API mantendo a simulação manual, nova cotação ao mudar preço/categoria/dimensões e descarte de resposta obsoleta.

- [ ] **Step 2: Rodar e confirmar falha**

Run: `rtk npm test -- src/hooks/__tests__/useCalculadoraML.test.tsx`
Expected: FAIL por hook inexistente.

- [ ] **Step 3: Ajustar o contrato do cliente de tarifa sem quebrar consumidores**

Expor os metadados necessários de Clássico/Premium e frete, mantendo compatibilidade com `calcularTarifaML` existente. Não duplicar fórmula oficial no frontend.

- [ ] **Step 4: Implementar o hook**

Centralizar entrada editável, produto opcional, categoria, cotação, proveniência e resultado calculado. Reutilizar `fetchProdutosEstoqueResumo`/`QK.produtosEstoqueResumo`; selecionar produto apenas preenche campos disponíveis e todos permanecem editáveis. Debounce da cotação e ação explícita `Validar na API` para metas projetadas.

- [ ] **Step 5: Validar**

Run: `rtk npm test -- src/hooks/__tests__/useCalculadoraML.test.tsx src/lib/__tests__/calculadora-ml.test.ts`
Expected: PASS.

Run: `rtk tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 6: Commit**

```bash
rtk git add src/hooks/useCalculadoraML.ts src/hooks/__tests__/useCalculadoraML.test.tsx src/lib/tarifa.ts
rtk git commit -m "feat: orquestrar simulacao ML API-first"
```

## Task 4: Interface premium da calculadora

**Owner:** Luna — implementação de interface bem delimitada.

**Files:**
- Create: `src/components/calculadora-ml/calculadora-ml.tsx`
- Create: `src/components/calculadora-ml/formulario-calculadora-ml.tsx`
- Create: `src/components/calculadora-ml/resultado-calculadora-ml.tsx`
- Create: `src/components/calculadora-ml/busca-categoria-ml.tsx`
- Test: `src/components/calculadora-ml/__tests__/calculadora-ml.test.tsx`

**Dependencies:** Tasks 1–3.

- [ ] **Step 1: Ler `impeccable/reference/craft-floor.md` e a especificação**

Aplicar o sistema visual existente do PubliAI, com hierarquia clara, sem reproduzir a estética Pronix.

- [ ] **Step 2: Escrever testes de comportamento visível**

Cobrir aviso de categoria opcional, troca Clássico/Premium em tela estreita, comparação simultânea em desktop, proveniência, estado de loading/erro, produto opcional e explicação do veredito.

- [ ] **Step 3: Rodar e confirmar falha**

Run: `rtk npm test -- src/components/calculadora-ml/__tests__/calculadora-ml.test.tsx`
Expected: FAIL por componentes inexistentes.

- [ ] **Step 4: Implementar formulário**

Campos: produto opcional, categoria sugerida pela API, custo, preço, comissões manuais de fallback, impostos, custos fixos/variáveis, rebate, dimensões, peso e frete manual. Notificar junto ao campo e no resumo quando a categoria estiver vazia.

- [ ] **Step 5: Implementar resultados premium**

Exibir veredito acionável, lucro, margem, decomposição de custos, proveniência, meta reversa, sensibilidade curta e fatores explicativos. Desktop com formulário à esquerda e resultado sticky à direita; mobile em coluna única com seletor Clássico/Premium.

- [ ] **Step 6: Acessibilidade e estados**

Labels reais, navegação por teclado, foco visível, mensagens com `aria-live`, contraste adequado e nenhum significado comunicado apenas por cor.

- [ ] **Step 7: Validar**

Run: `rtk npm test -- src/components/calculadora-ml/__tests__/calculadora-ml.test.tsx`
Expected: PASS.

Run: `rtk tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 8: Commit**

```bash
rtk git add src/components/calculadora-ml
rtk git commit -m "feat: criar interface premium da calculadora ML"
```

## Task 5: Integrar no menu Viabilidade

**Owner:** Luna — integração de página e regressão.

**Files:**
- Modify: `src/pages/Viabilidade.tsx`
- Test: `src/pages/__tests__/Viabilidade.test.tsx`

**Dependencies:** Task 4.

- [ ] **Step 1: Escrever teste de navegação sem regressão**

Cobrir as abas superiores `Análise de mercado` e `Calculadora ML`, abertura da calculadora e preservação das opções internas Planilha/GTIN da análise existente.

- [ ] **Step 2: Rodar e confirmar falha**

Run: `rtk npm test -- src/pages/__tests__/Viabilidade.test.tsx`
Expected: FAIL até a nova navegação existir.

- [ ] **Step 3: Integrar com o menor diff**

Adicionar o seletor de modo no topo e montar `CalculadoraML` apenas quando selecionado. Não alterar regras, uploads ou histórico da análise atual.

- [ ] **Step 4: Validar regressão**

Run: `rtk npm test -- src/pages/__tests__/Viabilidade.test.tsx src/lib/__tests__/viabilidade.test.ts`
Expected: PASS.

Run: `rtk tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 5: Commit**

```bash
rtk git add src/pages/Viabilidade.tsx src/pages/__tests__/Viabilidade.test.tsx
rtk git commit -m "feat: integrar calculadora ao menu Viabilidade"
```

## Task 6: Validação funcional, visual e de qualidade

**Owner:** Sol — integração, revisão e aceite final.

**Files:**
- Modify only files proven necessary by validation.
- Create: `DESIGN.md` only if the finish documenter confirms the repository lacks an equivalent design-system record.

**Dependencies:** Tasks 1–5.

- [ ] **Step 1: Revisar o diff contra a especificação**

Confirmar categoria opcional com aviso, API-first/fallback, comparação Clássico/Premium, veredito, metas reversas, sensibilidade, proveniência, ausência de persistência e zero mutações de tenant.

- [ ] **Step 2: Rodar detector Impeccable uma única vez**

Run: `rtk proxy node /Users/diego/.agents/skills/impeccable/scripts/detect.mjs --json src/pages/Viabilidade.tsx src/components/calculadora-ml`
Expected: nenhuma violação bloqueante; corrigir apenas achados concretos.

- [ ] **Step 3: Executar validação automatizada completa**

Run: `rtk npm test`
Expected: PASS.

Run: `rtk lint`
Expected: PASS.

Run: `rtk npm run build`
Expected: PASS.

- [ ] **Step 4: Preparar ambiente local sem expor segredos**

Garantir `.env.local` no worktree (symlink para o checkout principal é permitido), iniciar Vite e primeiro verificar console/rede antes de alterar código em caso de tela vazia.

- [ ] **Step 5: Validar visualmente em desktop**

Abrir `/viabilidade`, navegar para `Calculadora ML`, testar cenário oficial e fallback manual, verificar sticky, hierarquia, comparação, loading/erro e capturar screenshot.

- [ ] **Step 6: Validar visualmente em mobile**

Usar viewport estreito, confirmar coluna única, seletor Clássico/Premium, ausência de overflow horizontal, teclado/foco e capturar screenshot.

- [ ] **Step 7: Revisão independente**

Enviar a especificação, lista de arquivos, resultados dos testes e screenshots para um agente revisor fresco sem contexto herdado. Corrigir achados P0/P1 e repetir apenas validações afetadas.

- [ ] **Step 8: Auditoria de segurança e cálculos**

Confirmar que a função de categorias é somente leitura, que o `org_id` vem da autenticação, que tokens não chegam ao cliente/log e que os exemplos numéricos batem com o motor.

- [ ] **Step 9: Commit final de correções/documentação**

```bash
rtk git add -A
rtk git commit -m "test: validar calculadora ML premium"
```

- [ ] **Step 10: Evidência de aceite**

Registrar no handoff: commits, comandos e resultados, cenários visualmente validados, limitações conhecidas e caminhos dos screenshots.
