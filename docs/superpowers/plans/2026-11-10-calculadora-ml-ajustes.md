# Calculadora ML — ajustes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Calculadora ML preenche tudo a partir do produto publicado, liga preço⇄margem, simula kits de N unidades e mostra a tabela de frete do ML.

**Architecture:** Motor puro (`src/lib/calculadora-ml.ts` + novo `src/lib/calculadora-ml-preco.ts`) ganha margem exata, imposto desconhecido, kit e um solver de preço por margem que confirma na tarifa do preço final. Uma edge nova somente leitura (`ler-anuncio-calculadora`) devolve preço vivo, modalidade e categoria do item da variação. O hook `useCalculadoraML` passa a guardar a intenção do operador (meta digitada × margem efetiva) com operações versionadas; a UI reaproveita a tabela de frete existente, corrigida para distinguir "indisponível" de zero.

**Tech Stack:** React 19 + TS, TanStack Query, vitest, Supabase Edge Functions (Deno; testes em vitest com deps injetadas), Redis.

**Spec:** `docs/superpowers/specs/2026-11-10-calculadora-ml-ajustes-design.md` (ler inteiro, incluindo "Decisões do agente" e "Contratos após revisão do Codex").

## Global Constraints

- Nenhuma escrita no ML nem no cadastro; edge nova é somente leitura. Sem migration.
- Imposto nunca presumido: origem/alíquota ausente → `aliquotaImpostoPct: null` + aviso; nunca 0 silencioso.
- Custo = `variacoes.custo`; nunca `familias.custo_centavos`.
- Frete desconhecido nunca vira 0 oficial na calculadora; `cotacoesOficiaisDaTarifa` e a tela de Revisão NÃO mudam.
- Select/toggle novo: `src/components/ui/select.tsx` ou botões; nunca `<select>` nativo.
- Kit: custo × q, peso × q, **lado menor** × q (volume somado); custos fixos/variáveis/rebate por kit, não multiplicados.
- Preço por margem: cotado em centavos (arredondar pra cima), aceito só se a margem no preço final, com tarifa relida nesse preço, for ≥ meta; ciclo → menor preço verificado; máx. 6 iterações.
- Margem pode ser negativa; teto < 100%. Guardar exata, exibir 2 casas.
- Edge alterada/criada → `supabase functions deploy <fn>` e conferir versão (CLAUDE.md). Portão de push: `pnpm preflight`.
- Git no worktree: `/usr/bin/git`.

## Review Focus

1. Trocar de produto A (com medidas) → B (sem medidas/sem origem): nenhum campo de A pode sobrar (Task 4 testa).
2. Digitar margem e, antes da resposta da API, digitar outra: só a última meta vence; a margem exibida não "pula" para a efetiva no meio (Task 5 testa).
3. API do ML falha no frete com dimensões presentes: card mostra frete desconhecido / "não confirmado", nunca R$ 0 oficial (Task 2 testa).
4. Margem inalcançável (ex.: 95% com comissão 12% + imposto 8%): sem exceção, preço "não confirmado" com melhor candidato (Task 1 testa).
5. Campo numérico com vírgula ("12,5"), vazio e colado com "R$": não lança, não vira NaN (Task 6 testa).

---

### Task 1: Motor — margem exata, imposto desconhecido, kit e solver de preço por margem

**Files:**
- Modify: `src/lib/calculadora-ml.ts`
- Create: `src/lib/calculadora-ml-preco.ts`
- Test: `src/lib/__tests__/calculadora-ml.test.ts`, Create `src/lib/__tests__/calculadora-ml-preco.test.ts`

**Interfaces:**
- Produces (em `calculadora-ml.ts`):
  - `EntradaCalculadoraML.aliquotaImpostoPct: number | null` (null = desconhecido)
  - `ResultadoModalidadeML.margemPctExata: number` (sem arredondar; `margemPct` segue arredondada)
  - `validarEntrada`: `margemAlvoPct` aceita negativo, exige finito e `< 100`
- Produces (em `calculadora-ml-preco.ts`):
  - `dimensoesDoKit(d: DimensoesProduto, q: number): DimensoesProduto`
  - `entradaDoKit(e: EntradaCalculadoraML, q: number): EntradaCalculadoraML`
  - `type CotarEm = (preco: number, entrada: EntradaCalculadoraML) => Promise<CotacoesOficiaisPorModalidade>`
  - `interface PrecoPorMargem { preco: number; cotacao: CotacoesOficiaisPorModalidade; margemPct: number; lucro: number; confirmado: boolean }`
  - `precoPorMargem(entrada: EntradaCalculadoraML, modalidade: ModalidadeML, metaPct: number, inicial: CustosModalidadeML, cotarEm: CotarEm, maxIter = 6): Promise<PrecoPorMargem | null>`

- [ ] **Step 1: Testes que falham** em `calculadora-ml.test.ts`:
  - `aliquotaImpostoPct: null` → `modalidades.classico === null` e `veredito.tipo === 'Dados insuficientes'` com fator contendo `"imposto"`.
  - `margemAlvoPct: -10` não lança; `margemAlvoPct: 100` lança `RangeError`.
  - preço 30, custos que dão lucro 10 → `margemPctExata` = 33.333… (`toBeCloseTo(100/3, 6)`), `margemPct === 33.33`.
  - preço que dá prejuízo → `margemPctExata < 0`, sem exceção.
- [ ] **Step 2:** `pnpm test src/lib/__tests__/calculadora-ml.test.ts` → FAIL.
- [ ] **Step 3:** Implementar. `aliquotaImpostoPct === null` → `calcularModalidade` devolve `null`; `calcularVeredito` recebe flag e devolve `'Dados insuficientes'` com `'Informe a alíquota de imposto (origem do produto não definida).'`. `validarPercentual` não serve para margem: criar validação própria.
- [ ] **Step 4: Testes que falham** em `calculadora-ml-preco.test.ts`:
  - `dimensoesDoKit({alturaCm:15,larguraCm:5,comprimentoCm:5,pesoKg:0.13}, 3)` → `{alturaCm:15,larguraCm:15,comprimentoCm:5,pesoKg:0.39}` (empate no menor: multiplica o primeiro na ordem altura→largura→comprimento); volume = 3× o original.
  - `entradaDoKit(e, 2)`: `custoProduto` ×2, `custosFixos/custosVariaveis/rebate` iguais, `dimensoes` = `dimensoesDoKit`; sem dimensões → `dimensoes` undefined.
  - `precoPorMargem` com `cotarEm` fixo (12% + R$0 fixa, frete 0, imposto 0, custo 1, meta 33): devolve `preco` em centavos com `margemPct >= 33` e `confirmado: true` (o caso 1,49→32,89% do Codex deve resultar em 1,50).
  - Comissão por faixa (12% abaixo de R$100, 11% a partir de R$100) fazendo oscilar: devolve o **menor** preço verificado que cumpre a meta.
  - Meta 95% com comissão 12% e imposto 8%: devolve `confirmado: false` (ou `null` se nenhum preço foi cotado), sem lançar.
  - `cotarEm` devolvendo frete `null`: `confirmado: false`.
- [ ] **Step 5:** `pnpm test src/lib/__tests__/calculadora-ml-preco.test.ts` → FAIL.
- [ ] **Step 6:** Implementar. Algoritmo no padrão de `precoProprioEstavel` (`supabase/functions/_shared/preco/sugerir.ts:107`): candidato = `ceil100(base / (1 − (pctComissão + imposto)/100 − meta/100))` com `base = custo + taxaFixa + frete + fixos + variáveis − rebate`; denominador ≤ 0 → parar o laço; a cada candidato `cotarEm(p, entrada)` → `calcularSimulacaoML({...entrada, precoVenda: p}, cot).modalidades[modalidade]`; guardar como "seguro" se `margemPctExata >= meta − 1e-9`; parar em ponto fixo, ciclo ou `maxIter`. Retorno: menor seguro (`confirmado: true`); senão o visitado de maior margem (`confirmado: false`); nenhum visitado → `null`. `cotarEm` lançou → devolve o menor seguro se houver, senão relança.
- [ ] **Step 7:** `pnpm test src/lib/__tests__` → PASS (incluindo os testes antigos; ajustar só onde `aliquotaImpostoPct` virou nullable).
- [ ] **Step 8:** Commit `feat(calculadora): margem exata, imposto desconhecido, kit e preço por margem`.

### Task 2: Frete desconhecido na calculadora (B1)

**Files:**
- Modify: `src/hooks/useCalculadoraML.ts` (`cotacaoOficialComFreteConfirmado`)
- Test: `src/hooks/__tests__/useCalculadoraML.test.tsx`

**Interfaces:**
- Consumes: `provenienciaDaTarifa(tarifa)` de `src/lib/tarifa.ts` (falha fechado: sem campo = `estimated`).
- Produces: `cotacaoCalculadora(tarifa: Tarifa, temDimensoes: boolean, taxas: TaxasManuaisML): CotacoesOficiaisPorModalidade` (exportada do hook, usada pelas Tasks 5 e 7).

- [ ] **Step 1: Testes que falham:** tarifa com dimensões e `proveniencia: 'estimated', frete: 0` → `cotacao.classico.frete === null` (sem frete manual confirmado) e card sem selo oficial; `proveniencia: 'partial'` → frete mantido, `proveniencia: 'partial'`; `'official'` → igual a hoje.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** Implementar `cotacaoCalculadora`: `official` → `cotacoesOficiaisDaTarifa`; `partial` → mesma com `proveniencia: 'partial'`; `estimated` → `frete: freteManualConfirmado(taxas)` e `proveniencia: 'estimated'`. Sem dimensões → comportamento atual (`partial` + frete manual). Não tocar `src/lib/tarifa.ts`.
- [ ] **Step 4:** rodar → PASS. **Step 5:** Commit `fix(calculadora): frete indisponível não vira zero oficial`.

### Task 3: Edge `ler-anuncio-calculadora` (somente leitura)

**Files:**
- Create: `supabase/functions/ler-anuncio-calculadora/index.ts`, `supabase/functions/ler-anuncio-calculadora/processar.ts`
- Create: `supabase/functions/ler-anuncio-calculadora/__tests__/processar.test.ts` (vitest, deps injetadas — padrão de `status-publicados/__tests__/processar.test.ts`)
- Modify: `supabase/config.toml` (bloco da função, `verify_jwt` igual ao de `tabela-frete-ml`)
- Create: `src/lib/anuncio-calculadora.ts` (cliente)

**Interfaces:**
- Request: `POST { codigo_pai: string, variacao_codigo: string }`; auth `requireUserOrg`; conexão via `resolverConexao(admin, orgId, 'mercado_livre')` + `getValidAccessTokenConexao` (copiar de `tabela-frete-ml/index.ts`).
- Response (`AnuncioCalculadora`, mesmo shape no cliente, camelCase no TS):
  ```ts
  { publicado: boolean; itemId: string | null; preco: number | null; precoOriginal: number | null;
    fontePreco: 'sale_price' | 'items' | null; salePriceFalhou: boolean;
    modalidade: 'classico' | 'premium' | null;   // gold_special → classico, gold_pro → premium, outro → null
    categoriaId: string | null; categoriaNome: string | null;
    categoriaFonte: 'item' | 'cadastro' | null; motivo?: string }
  ```
- Cliente: `fetchAnuncioCalculadora(codigoPai: string, variacaoCodigo: string): Promise<AnuncioCalculadora>`; erro HTTP → lança.

- [ ] **Step 1: Testes que falham** (`processar.test.ts`), todos filtrando `org_id`:
  - variação com linha em `anuncios_externos_itens` (`variacao_id` da variação, `retirado=false`, `item_externo_id` não nulo) → usa esse item.
  - sem item UP → usa `anuncios_externos.item_externo_id` da família, canal ML, status publicado, `criado_em desc`.
  - sem nenhum item → `publicado: false`, `categoriaId` = `familias.categoria_ml_id`, `categoriaFonte: 'cadastro'`.
  - `/sale_price` ok com promoção → `preco` = valor pago, `precoOriginal` = regular, `fontePreco: 'sale_price'`.
  - `/sale_price` null → `preco` = `price` do `/items`, `fontePreco: 'items'`, `salePriceFalhou: true`.
  - `listing_type_id: 'gold_pro'` → `modalidade: 'premium'`; `category_id` do item → `categoriaFonte: 'item'`.
  - `/items` falha → `publicado: true`, `preco: null`, `motivo` preenchido, categoria do cadastro.
- [ ] **Step 2:** `pnpm test supabase/functions/ler-anuncio-calculadora` → FAIL.
- [ ] **Step 3:** Implementar `processar.ts` com deps `{ db, lerItem(token, id), lerSalePrice(token, id), lerCategoriaNome(id) }`. `lerItem` = `GET /items/{id}?attributes=price,listing_type_id,category_id` (timeout 5 s, nunca lança: devolve null). `lerSalePrice` = `lerSalePriceML` existente. Nome da categoria: `GET /categories/{id}` público, falha → null. `index.ts` só faz auth/conexão/JSON (sem cache).
- [ ] **Step 4:** testes → PASS; `pnpm lint:functions && pnpm check:functions` → sem erros.
- [ ] **Step 5:** Implementar `src/lib/anuncio-calculadora.ts` (fetch autenticado como `calcularTarifaML`).
- [ ] **Step 6:** Commit `feat(edge): ler-anuncio-calculadora — preço vivo, modalidade e categoria (somente leitura)`.

### Task 4: Prefill atômico ao escolher produto (B2)

**Files:**
- Modify: `src/hooks/useCalculadoraML.ts` (`selecionarProduto`, `preencherProduto`)
- Test: `src/hooks/__tests__/useCalculadoraML.test.tsx`

**Interfaces:**
- Consumes: `fetchAnuncioCalculadora` (Task 3); `useAliquotas` (`src/hooks/useConfiguracoes.ts`); `aliquotaDoKit(origem, aliquotas)` (`src/lib/kit-variacao-simulacao.ts`); `ProdutoEstoqueResumo.origem`.
- Produces no retorno do hook: `modalidadeAtiva: ModalidadeML`, `modalidadeTravada: boolean` (true = veio do anúncio), `setModalidadeAtiva(m)`, `avisosProduto: string[]`, `categoriaNome: string | null`.

- [ ] **Step 1: Testes que falham:**
  - produto publicado (mock da Task 3: preço 20, `gold_special`, categoria MLB200339) → `entrada.precoVenda === 20`, `categoriaId === 'MLB200339'`, `modalidadeAtiva === 'classico'`, `modalidadeTravada === true`, imposto = alíquota nacional da org.
  - troca A (dimensões, origem nacional) → B (sem dimensões, origem `''`) → `entrada.dimensoes === undefined`, `aliquotaImpostoPct === null`, aviso contendo `"origem"`.
  - não publicado → `precoVenda` = `variacoes.preco`, `modalidadeTravada === false`, aviso `"preço do cadastro"`.
  - `salePriceFalhou` → aviso `"promoção"`; leitura falhou (`preco: null`) → preço do cadastro + aviso `"não foi possível ler o preço no ar"`.
  - resposta de A chegando depois da seleção de B → ignorada (sequência).
  - "Produto avulso" (null) → limpa os campos do produto e destrava a modalidade.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** Implementar: buscar variações e anúncio em paralelo; montar a entrada nova **inteira** (custo, preço, dimensões, categoria, imposto) e aplicar num único `setEntrada`; ausente = limpo (`custoProduto: 0`, `dimensoes: undefined`, `aliquotaImpostoPct: null`). Alíquotas ainda carregando → `null` + aviso. Promoção → aviso informativo com o preço "de".
- [ ] **Step 4:** rodar → PASS. **Step 5:** Commit `feat(calculadora): produto publicado preenche preço vivo, categoria, imposto e modalidade`.

### Task 5: Preço ⇄ margem ligados (I3)

**Files:**
- Modify: `src/hooks/useCalculadoraML.ts`
- Test: `src/hooks/__tests__/useCalculadoraML.test.tsx`

**Interfaces:**
- Consumes: `precoPorMargem` (Task 1), `cotacaoCalculadora` (Task 2), `modalidadeAtiva` (Task 4).
- Produces: `editarPreco(v: number)`, `editarMargem(v: number)`, `margemExibida: number | null`, `metaStatus: 'ok' | 'calculando' | 'nao_confirmada'`, `ultimoEditado: 'preco' | 'margem'`. Remove `validarNaApi`, `cotacaoMeta`, `validacaoMeta`, `erroMeta` (o solver já confirma na API).

- [ ] **Step 1: Testes que falham:**
  - `editarPreco(25)` → `margemExibida` = `margemPctExata` da modalidade ativa a R$25.
  - `editarMargem(38)` → `metaStatus === 'calculando'`, `margemExibida === 38` durante a espera; ao resolver, `precoVenda` = preço do solver e cotação publicados **juntos**, `metaStatus === 'ok'`.
  - `editarMargem(30)` e logo `editarMargem(40)` com a primeira resolvendo por último → preço final = o da meta 40.
  - solver `confirmado: false` → `metaStatus === 'nao_confirmada'`, preço = melhor candidato.
  - alterar custo/imposto/medidas/modalidade depois de `editarMargem` → preço mantido, `ultimoEditado === 'preco'`, margem recalculada.
  - sem categoria → `editarMargem` usa a cotação manual (sem API) e marca `'nao_confirmada'`.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** Implementar: estado `metaSolicitada`, `ultimoEditado`, sequência própria do solver. `cotarEm = (p, e) => calcularTarifaML(p, categoriaId, dimensoesDaTarifa(e.dimensoes), 0).then(t => cotacaoCalculadora(t!, !!e.dimensoes, taxas))` (tarifa null → lançar). `inicial` = cotação vigente da modalidade ativa. Publicar `precoVenda` + tarifa num único `setState`, sem disparar o effect de recotação por cima (marcar a chave da cotação como já obtida). `margemExibida` = `ultimoEditado === 'margem' ? metaSolicitada : resultado.modalidades[ativa]?.margemPctExata ?? null`. `entrada.margemAlvoPct` passa a espelhar `metaSolicitada` só para o veredito.
- [ ] **Step 4:** rodar → PASS. **Step 5:** Commit `feat(calculadora): preço e margem ligados pela modalidade ativa`.

### Task 6: UI — campos numéricos, modalidade, margem viva e central de decisão

**Files:**
- Modify: `src/components/calculadora-ml/formulario-calculadora-ml.tsx`, `src/components/calculadora-ml/resultado-calculadora-ml.tsx`, `src/components/calculadora-ml/calculadora-ml.tsx`, `src/components/calculadora-ml/busca-categoria-ml.tsx`
- Test: `src/components/calculadora-ml/__tests__/calculadora-ml.test.tsx`, `src/pages/__tests__/Viabilidade.test.tsx` (ajustar)

**Interfaces:**
- Consumes: tudo que as Tasks 4–5 expõem no hook.
- Produces: `parseNumeroBR(texto: string): number | null` em `formulario-calculadora-ml.tsx` (exportada para teste).

- [ ] **Step 1: Testes que falham:**
  - `parseNumeroBR('12,5') === 12.5`, `('1.234,56') === 1234.56`, `('R$ 3,04') === 3.04`, `('') === null`, `('abc') === null`.
  - nenhum `input[type=number]` na calculadora; foco em "Preço de venda" seleciona o texto (`selectionStart === 0 && selectionEnd === value.length`).
  - produto publicado: seletor de modalidade desabilitado mostrando "Clássico (do anúncio)"; produto avulso: habilitado e muda `modalidadeAtiva`.
  - campo "Margem (%)" mostra `margemExibida` com 2 casas; `metaStatus 'nao_confirmada'` → texto "não confirmado".
  - categoria preenchida pelo produto aparece com nome + ID; avisos de `avisosProduto` renderizados com `role="status"`.
  - central de decisão sem botão "Validar preço projetado na API" e sem a frase "atinge a meta de 0%".
- [ ] **Step 2:** rodar `pnpm test src/components/calculadora-ml src/pages/__tests__/Viabilidade.test.tsx` → FAIL.
- [ ] **Step 3:** Implementar. `CampoNumero`: `type="text"`, `inputMode="decimal"`, rascunho local de texto (formatado pt-BR quando não focado), `onFocus={e => e.currentTarget.select()}`, `onChange` → `parseNumeroBR`, null não propaga. Rótulo "Margem-alvo (%)" vira "Margem (%)", com `onChange` → `editarMargem`; preço → `editarPreco`. Modalidade: toggle de dois botões (ou `ui/select`) no topo de "Compra e venda". `BuscaCategoriaML` ganha prop `nome?: string` exibida ao lado do ID. Veredito: frases usam a margem efetiva; com `ultimoEditado === 'preco'` não citar meta.
- [ ] **Step 4:** rodar → PASS. **Step 5:** Commit `feat(calculadora): campos sem setas, modalidade e margem viva na tela`.

### Task 7: Quadro de kits 1 · 2 · 3 · N

**Files:**
- Create: `src/hooks/useKitsCalculadora.ts`, `src/components/calculadora-ml/quadro-kits.tsx`
- Modify: `src/components/calculadora-ml/calculadora-ml.tsx`
- Test: Create `src/hooks/__tests__/useKitsCalculadora.test.tsx`, `src/components/calculadora-ml/__tests__/quadro-kits.test.tsx`

**Interfaces:**
- Consumes: `entradaDoKit`, `precoPorMargem` (Task 1); `cotacaoCalculadora` (Task 2); `modalidadeAtiva`, `resultado`, `entrada` do hook.
- Produces: `useKitsCalculadora(args: { entrada: EntradaCalculadoraML; modalidade: ModalidadeML; metaPct: number | null; quantidadeN: number; resultadoUnidade: ResultadoModalidadeML | null; taxas: TaxasManuaisML }): ColunaKit[]` com `ColunaKit = { quantidade: number; preco: number | null; precoUnitario: number | null; frete: number | null; comissao: number | null; lucro: number | null; status: 'ok' | 'calculando' | 'nao_confirmado' | 'sem_dados' }`.

- [ ] **Step 1: Testes que falham:**
  - quantidades = `[1,2,3]` + N quando N ∉ {1,2,3}; N = 5 → 4 colunas.
  - coluna 1 = `resultadoUnidade` sem chamar API.
  - coluna 2 chama `cotarEm` com custo ×2 e `dimensoesDoKit(…, 2)`; `precoUnitario = preco / 2`.
  - sem categoria ou sem dimensões → colunas ≥ 2 com `status: 'sem_dados'`, frete null.
  - edições rápidas → debounce 400 ms e só a última rodada publica.
  - componente: input "Quantidade no kit (N)" inteiro ≥ 1 (0 ou vazio → 1); linha "Custos fixos, variáveis e rebate considerados por kit."; "não confirmado" visível na coluna correspondente.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** Implementar; meta = `margemExibida` da Task 5. Colunas ≥ 2 rodam o solver em paralelo.
- [ ] **Step 4:** rodar → PASS. **Step 5:** Commit `feat(calculadora): quadro de kits com frete e margem por quantidade`.

### Task 8: Tabela de frete — indisponível ≠ zero, e na calculadora

**Files:**
- Modify: `supabase/functions/_shared/ml/tabela-frete.ts`, `supabase/functions/tabela-frete-ml/index.ts`, `src/lib/tabela-frete.ts`, `src/components/tabela-frete-viabilidade.tsx`, `src/components/calculadora-ml/calculadora-ml.tsx`
- Test: `supabase/functions/_shared/ml/__tests__/tabela-frete.test.ts`, `src/components/__tests__/` (criar `tabela-frete-viabilidade.test.tsx` se não existir)

**Interfaces:**
- Produces: `TabelaFrete.celulas: (number | null)[][]` (null = indisponível), no shared e no cliente.

- [ ] **Step 1: Testes que falham:**
  - `montarTabelaFrete` com fetch que devolve `{ valor: 0, proveniencia: 'estimated' }` numa célula → essa célula `null`; `official` com 0 → `0`.
  - edge: tabela com alguma célula `null` → não grava no Redis com TTL de 24h (TTL 5 min); completa → 24h; chave `tabela-frete:v2:`.
  - UI: `null` → "—" com `title="Indisponível no Mercado Livre"`; `0` → "R$ 0,00"; legenda "— = o Mercado Livre não respondeu esta faixa".
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** Implementar trocando `buscarFreteVendedor` por `buscarFreteVendedorComProveniencia` no default de `montarTabelaFrete`. Na calculadora, renderizar `<TabelaFreteViabilidade categoriaMlId={categoriaId} analiseConcluida />` no fim da página; sem categoria → texto "Informe a categoria para ver a tabela de frete do Mercado Livre.".
- [ ] **Step 4:** rodar `pnpm test` (suite toda) → PASS. **Step 5:** Commit `fix(frete): tabela distingue faixa indisponível de frete zero; exibida na calculadora`.

### Task 9: Docs, preflight e deploy

**Files:**
- Modify: `docs/decisions/0126-calculadora-mercado-livre-premium.md` (seção "Emenda 2026-11-10"), `docs/TASKS.md`, `docs/reference/edge-functions.md`

- [ ] **Step 1:** Emenda no ADR-0126: prefill pelo item da variação, preço⇄margem com confirmação na tarifa, kit (lado menor × q), frete desconhecido só na calculadora, tabela de frete com célula indisponível, edge `ler-anuncio-calculadora`. Registrar a edge em `edge-functions.md` e a entrega em `TASKS.md`.
- [ ] **Step 2:** `pnpm preflight` → verde.
- [ ] **Step 3:** Commit `docs: emenda ADR-0126 e referência da edge ler-anuncio-calculadora`.
- [ ] **Step 4 (após merge na main, não antes):** `supabase functions deploy ler-anuncio-calculadora tabela-frete-ml` e conferir versão nova com `supabase functions list`.
