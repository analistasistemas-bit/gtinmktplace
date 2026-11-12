# Kit vinculado — Fatia 1 (texto, "Você recebe", promoção, visual) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O dialog "Criar kit vinculado" cita a quantidade na descrição, mostra "Você recebe por venda" recalculado ao mudar o preço, mostra promoção ativa/futura da base e ganha o visual do kit com variação.

**Architecture:** Só front + 1 ajuste de gate numa edge de leitura. Lógica pura em `src/lib/` (testável sem DOM); componente novo `RecebeKit` (versão de peça única do `SimuladorKit`) reusa `DetalheRecebe`, `calcularTarifaML`, `useAliquotas`. Nada toca a publicação comum (isso é a Fatia 2).

**Tech Stack:** React + TS, vitest + Testing Library, TanStack Query, Deno edge (Supabase).

**Spec:** `docs/superpowers/specs/2026-11-12-kit-vinculado-evolucao-design.md` (Fatia 1)

## Global Constraints
- Dropdown = `src/components/ui/select.tsx`, nunca `<select>` nativo.
- Alíquota só com `aliquotas.confirmada` (ADR-0086); nunca presumir 8/16. Origem desconhecida → `null`.
- Cotação não oficial (`provenienciaDaTarifa(t).proveniencia !== 'official'`) = indisponível; nunca exibir estimativa como exata.
- Preço digitado ainda não cotado → nunca mostrar o lucro do preço anterior (debounce 500 ms, `centavos(precoCotado) === centavos(preco)`).
- `familias.custo_centavos` nunca é custo de produto; usar `base.custo` (`variacoes.custo`).
- Frete usa as dimensões **editadas** do kit e peso = `base.pesoGramas × n`.
- Promoção é só informativa: nunca grava, nunca replica no kit. Falha do ML → "indisponível", sem erro.
- Testes: `pnpm test <arquivo>`; antes do push `pnpm preflight`. Edge alterada → deploy CLI e conferir versão.
- Roteamento de modelos: Tasks 1–5 = sonnet; Task 6 = sonnet com skill ui-ux-pro-max; plano revisado por Fable 5.2 antes de executar; diff por task = Grok 4.7 high.

## Review Focus
- Base sem custo (`custo: null`) → "Você recebe" sem lucro, kit segue sem bloquear? (Decisão: bloqueia lucro, não bloqueia criar; mostra aviso.)
- Preço 0/vazio → sem cotação, sem "Calculando" eterno.
- Origem `null` ou alíquota não confirmada → aviso "imposto fora da conta" + exige "Seguir mesmo assim".
- Vários tamanhos marcados (2, 4, 6): confirmação é por kit; um kit pendente bloqueia "Criar e publicar".
- Base em Revisão (sem `ml_item_id`): promoção some sem erro.
- Altura = `9.8 × 6` não pode virar `58.800000000000004` no input.

---

### Task 1: Descrição abre citando N + altura sem ruído de ponto flutuante
**Files:** Modify `src/lib/kit.ts` (`descricaoDoKit`), `src/components/kit/preview-kit.tsx:47` · Test `src/lib/__tests__/kit.test.ts`, `src/components/kit/__tests__/preview-kit.test.tsx`
**Interfaces:** Produces: `descricaoDoKit(descricaoBase, n, tituloBase): string` (mesma assinatura) — o resultado SEMPRE começa com `Kit com ${unidadesPt(n)} de ${tituloBase.trim()}.\n\n`, idempotente (não duplica se já começa com "Kit com").
- [ ] **Step 1: Testes** em `kit.test.ts`: (a) `descricaoDoKit('Ampola capilar.', 6, 'Ampola 3 em 1 10ml')` `.startsWith('Kit com 6 unidades de Ampola 3 em 1 10ml.\n\n')`; (b) aplicar `descricaoDoKit` duas vezes sobre o resultado → só uma ocorrência de `Kit com 6 unidades de`; (c) descrição base vazia → começa com a abertura e mantém a seção "O QUE VOCÊ RECEBE". Em `preview-kit.test.tsx`: `valorInicialPreview({...BASE, alturaCm: 9.8}, 't', 'd', 6).alturaCm === 58.8`.
- [ ] **Step 2:** `pnpm test src/lib/__tests__/kit.test.ts src/components/kit/__tests__/preview-kit.test.tsx` → FAIL.
- [ ] **Step 3:** Em `descricaoDoKit`, no `return`, prefixar a abertura se `!/^\s*Kit com\b/i.test(desc)`. Em `valorInicialPreview`: `alturaCm: Math.round((base.alturaCm ?? 0) * n * 100) / 100`.
- [ ] **Step 4:** mesmos testes → PASS; rodar `pnpm test src/components/kit` inteiro (testes antigos que fixam o início da descrição devem ser ajustados só no que muda).
- [ ] **Step 5:** `git commit -m "feat(kit): descrição abre com a quantidade; altura sem ruído de ponto flutuante"`

### Task 2: BaseParaKit ganha `familiaId`, `origem`, `listingType`
**Files:** Modify `src/lib/kit.ts` (interface `BaseParaKit`), `src/pages/Publicados.tsx:185` (`baseParaKit(f, precoAtual)`) e seu chamador, `src/components/familia-expanded.tsx:58` · Test `src/components/kit/__tests__/preview-kit.test.tsx` (BASE passa a incluir os campos)
**Interfaces:** Produces: `BaseParaKit.familiaId: string`, `.origem: 'nacional' | 'importado' | null`, `.listingType: 'gold_special' | 'gold_pro'`. Consumed by Tasks 4 e 5.
- [ ] **Step 1:** Adicionar os 3 campos (obrigatórios) à interface e ao `BASE` dos testes (`familiaId: 'fam-1'`, `origem: 'nacional'`, `listingType: 'gold_special'`); `pnpm tsc --noEmit` → FAIL nos 2 construtores.
- [ ] **Step 2:** Em `Publicados.tsx` passar o `listingType` do item (`'premium'`→`'gold_pro'`, senão `'gold_special'`) como 3º parâmetro de `baseParaKit` (localizar o chamador; item tem `.listingType`). Em `familia-expanded.tsx` (família ainda em Revisão): `listingType: 'gold_special'`. Ambos: `familiaId: f.id`, `origem: f.origem ?? null`.
- [ ] **Step 3:** Verificar em `supabase/functions/criar-kit-vinculado/processar.ts` qual tipo de anúncio o kit herda; se divergir de `base.listingType`, usar o que a edge grava e anotar no commit.
- [ ] **Step 4:** `pnpm tsc --noEmit` e `pnpm test src/components/kit` → PASS. Commit `refactor(kit): BaseParaKit expõe familiaId, origem e listingType`.

### Task 3: Lógica pura de "Você recebe" do kit vinculado
**Files:** Create `src/lib/kit-recebe.ts` · Modify `src/lib/kit-variacao-simulacao.ts` (só `export` em `resumoDaTarifa`) · Test `src/lib/__tests__/kit-recebe.test.ts`
**Interfaces:** Consumes: `resumoDaTarifa(t: Tarifa, tipo, preco, custo, rotulo, aliquotaPct): ResumoLucro`, `provenienciaDaTarifa`, `aliquotaDoKit`. Produces:
```ts
export type EstadoRecebe = 'sem_preco' | 'sem_custo' | 'calculando' | 'indisponivel' | 'prejuizo' | 'ok';
export interface SimulacaoRecebe { estado: EstadoRecebe; resumo: ResumoLucro | null; semAliquota: boolean; precisaConfirmar: boolean }
export function simularRecebe(p: { preco: number; precoEmDia: boolean; custo: number | null; tipo: 'gold_special'|'gold_pro'; aliquotaPct: number | null; tarifa: Tarifa | null | undefined }): SimulacaoRecebe
```
Regras: `!(preco>0)`→`sem_preco`; `custo==null`→`sem_custo` (precisaConfirmar false, sem resumo); `tarifa===undefined || !precoEmDia`→`calculando`; tarifa null/não oficial→`indisponivel` (precisaConfirmar true); `resumo.lucro<0`→`prejuizo`; senão `ok`. `precisaConfirmar = estado==='prejuizo' || estado==='indisponivel' || semAliquota` (semAliquota = `aliquotaPct==null`; só vale em ok/prejuizo/indisponivel).
- [ ] **Step 1: Testes** (um por regra acima, com `Tarifa` fabricada como em `kit-variacao-simulacao.test.ts`): ok com lucro positivo e `aliquotaPct=8`; prejuízo (`custo` maior que `recebe`) → `precisaConfirmar`; `aliquotaPct=null` + ok → `semAliquota && precisaConfirmar`; `precoEmDia=false` → `calculando` e `resumo===null`; tarifa `null` → `indisponivel`; `custo=null` → `sem_custo`; `preco=0` → `sem_preco`.
- [ ] **Step 2:** `pnpm test src/lib/__tests__/kit-recebe.test.ts` → FAIL. **Step 3:** implementar + exportar `resumoDaTarifa`. **Step 4:** PASS + `pnpm test src/lib/__tests__/kit-variacao-simulacao.test.ts` PASS. **Step 5:** commit `feat(kit): simularRecebe (Você recebe do kit vinculado)`.

### Task 4: Componente `RecebeKit` + integração no preview e no dialog
**Files:** Create `src/components/kit/recebe-kit.tsx` · Modify `src/components/kit/preview-kit.tsx`, `src/components/kit/dialog-criar-kit.tsx` · Test `src/components/kit/__tests__/recebe-kit.test.tsx`, `dialog-criar-kit.test.tsx`
**Interfaces:** Consumes: `simularRecebe` (T3), `BaseParaKit` (T2), `DetalheRecebe` (props `r, preco, original, listingType, variasCores, rotuloPreco`), `calcularTarifaML(preco, categoria, dim, aliquotaPct)`, `useAliquotas`, `aliquotaDoKit`. Produces:
```tsx
export function RecebeKit(p: { n: number; base: BaseParaKit; value: KitPreviewValue; categoriaMlId: string | null; onPodeSeguir: (pode: boolean) => void }): JSX.Element
```
`PreviewKit` ganha props `categoriaMlId: string | null` e `onPodeSeguir: (pode: boolean) => void`, e renderiza `<RecebeKit>` logo abaixo do bloco preço/desconto/GTIN. `categoriaMlId` vem do dialog (`categoriaOverride?.categoriaMlId ?? base.categoriaMlId`) — a tarifa tem de seguir a categoria trocada.
- [ ] **Step 1: Testes** `recebe-kit.test.tsx` (mockar `calcularTarifaML` e `useAliquotas` como os testes do `simulador-kit`): (a) renderiza "Você recebe por venda" com o recebe cotado; (b) mudar `value.preco` → mostra "Calculando…" e **não** o valor antigo até passar 500 ms (`vi.useFakeTimers`), depois chama `calcularTarifaML` com o preço novo e mostra o novo valor; (c) cotação usa dimensões editadas (`alturaCm` do `value`) e `pesoGramas = base.pesoGramas × n`; (d) prejuízo/`aliquotaPct` nula → aparece "Seguir mesmo assim" e `onPodeSeguir(false)` até marcar; marcar → `onPodeSeguir(true)`; mudar o preço desmarca (padrão `chaveConta` do `SimuladorKit`); (e) `custo=null` → texto de custo faltando, `onPodeSeguir(true)` (não bloqueia criar). Em `dialog-criar-kit.test.tsx`: com 2 tamanhos marcados e um deles em prejuízo não confirmado, "Criar e publicar" fica desabilitado.
- [ ] **Step 2:** FAIL. **Step 3:** implementar espelhando `src/components/kit-variacao/simulador-kit.tsx` (debounce `ESPERA_DIGITACAO_MS=500`, `useQuery` único com `queryKey: ['tarifa', categoria, precoCotado, h, l, c, peso, aliquotaPct ?? 0]`, `staleTime` 6 h, `retry:false`, `enabled: !!categoria && precoCotado>0 && aliquotasQ.isFetched`; confirmação por `chaveConta`). No dialog: `const [podeSeguir, setPodeSeguir] = useState<Record<number, boolean>>({})`, `podeCriar` passa a exigir `tamanhosMarcados.every(n => podeSeguir[n] !== false)`; resetar ao abrir/desmarcar.
- [ ] **Step 4:** `pnpm test src/components/kit` PASS. **Step 5:** commit `feat(kit): Você recebe por venda no kit vinculado`.

### Task 5: Promoção ativa/futura da base
**Files:** Modify `supabase/functions/preco-avulso-kit/index.ts` (gate), `src/components/kit/recebe-kit.tsx` (ou `preview-kit.tsx`) · Create `src/hooks/usePromocaoBaseKit.ts` · Test `supabase/functions/preco-avulso-kit/__tests__/` (gate), `src/components/kit/__tests__/recebe-kit.test.tsx`
**Decisão (desvio revisável da spec):** em vez de edge nova, relaxar o gate de `preco-avulso-kit` para `kit_variacao` **ou** `estoque` (a edge é só leitura, escopada por org; evita duplicar ~80 linhas). 
**Interfaces:** Consumes: `fetchPrecoAvulsoKit(familiaBaseId): Promise<Map<sku, PrecoPeca>>` (`src/lib/kit-variacao-edge.ts:13`), `PromocoesFuturas` e `diaMes` (`referencia-avulso.tsx`). Produces: `usePromocaoBaseKit(familiaId: string, ativo: boolean): { promocao: PrecoPeca | null; lendo: boolean; indisponivel: boolean }` (1 SKU: `[...map.values()][0] ?? null`; `staleTime` 60 s; falha → `indisponivel`).
UI (dentro do `RecebeKit`, acima do card): se `promocao.promocao != null` → "Base em promoção: R$ X até dd/mm (normal R$ Y)"; se `futuras.length>0` → `<PromocoesFuturas pecas={[{ rotulo: 'Produto-base', normal, futuras, indisponivel: futurasIndisponivel }]} />`; `indisponivel` → "promoção da base indisponível" (texto cinza, não bloqueia). Base sem `ml_item_id` (retorno sem preço) → não renderiza nada.
- [ ] **Step 1: Testes:** edge: org com módulo `estoque` e sem `kit_variacao` → 200; org sem nenhum → 403. UI: mock `fetchPrecoAvulsoKit` com promoção ativa e futura → ambos textos aparecem; rejeição → "indisponível" e `onPodeSeguir` não é afetado.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS. **Step 5:** commit `feat(kit): promoção ativa/futura da base no kit vinculado`. Deploy: `supabase functions deploy preco-avulso-kit` e conferir versão ativa (só depois do merge; passo separado do push, conforme CLAUDE.md).

### Task 6: Identidade visual de criação de kits
**Files:** Modify `src/components/kit/dialog-criar-kit.tsx`, `preview-kit.tsx`, `recebe-kit.tsx`; ler `src/components/kit-variacao/dialog-criar-kit-variacao.tsx` como referência · Test `dialog-criar-kit.test.tsx` (comportamento, não classes)
- [ ] **Step 1:** Invocar a skill **ui-ux-pro-max** e fixar a direção: o dialog do kit vinculado usa a mesma linguagem do kit com variação (pílulas de etapa "1. Tamanhos · 2. Anúncio", títulos de seção, cartão "Você recebe por venda", avisos amarelos). Extrair para componentes compartilhados em `src/components/kit/` só o que os dois dialogs já repetem (ex.: cabeçalho de etapas) — sem refatorar o kit com variação além de trocar o import, e só se os testes dele continuarem verdes.
- [ ] **Step 2:** Aplicar; manter acessibilidade (labels, `aria-label` existentes que os testes usam, foco visível, contraste no tema escuro).
- [ ] **Step 3:** Validação visual com print real (Playwright, skill playwright-cli, sessão isolada; ver memória "Validar UI em sessão isolada"): dialog com kit de 6 em tema escuro, 1 e 2 tamanhos, estados prejuízo e sem promoção. Anexar prints ao relatório.
- [ ] **Step 4:** `pnpm test src/components/kit` e `pnpm test src/components/kit-variacao` PASS. Commit `feat(kit): visual do kit vinculado alinhado ao kit com variação`.

### Task 7: Documentação e fechamento da fatia
- [ ] Adendo no ADR-0151 (descrição com N, "Você recebe", promoção informativa, gate relaxado em `preco-avulso-kit`); registrar em `docs/TASKS.md` e `obsidian-vault/` conforme skill `docs-update-checklist`. `git fetch` antes de numerar qualquer ADR novo.
- [ ] `pnpm preflight` verde → push da branch → CI verde → merge fast-forward sob pedido do Diego → deploy `preco-avulso-kit` + conferir versão → deletar branch/worktree. Pull `--ff-only` no checkout principal.

## Self-Review
Spec Fatia 1: descrição (T1), Você recebe + recálculo (T3–T4), promoção (T5), visual (T6), origem/listingType (T2). Tipos: `BaseParaKit` (T2) consumido em T4/T5; `simularRecebe` (T3) consumido em T4. Fatias 2 e 3 ficam fora (planos próprios).
