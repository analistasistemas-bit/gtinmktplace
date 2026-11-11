# Calculadora ML — ajustes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Calculadora ML preenche tudo a partir do produto publicado, liga preço⇄margem, simula kits de N unidades e mostra a tabela de frete do ML.

**Architecture:** Motor puro (`src/lib/calculadora-ml.ts` + novo `src/lib/calculadora-ml-preco.ts`) ganha margem exata, imposto desconhecido, kit e um solver de preço por margem que confirma na tarifa do preço final. O SKU → item ML já vem resolvido por org na RPC `variacoes_estoque_produto` (`VariacaoComSaldo.mlItemId`); uma edge nova somente leitura (`ler-anuncio-calculadora`) lê preço vivo, modalidade e categoria desse item. O hook `useCalculadoraML` passa a um `useReducer` com **revisão única** que invalida toda operação assíncrona antiga e publica entrada + cotação + modalidade de uma vez. A UI reaproveita a tabela de frete existente, corrigida para distinguir "indisponível" de zero.

**Tech Stack:** React 19 + TS, TanStack Query v5, vitest, Supabase Edge Functions (Deno; testes em vitest com deps injetadas), Redis.

**Spec:** `docs/superpowers/specs/2026-11-10-calculadora-ml-ajustes-design.md` (ler inteiro, incluindo "Decisões do agente" e "Contratos após revisão do Codex").

## Global Constraints

- Nenhuma escrita no ML nem no cadastro; a edge nova só faz `GET` no ML. Sem migration.
- Toda consulta da edge filtra `org_id` do chamador; item que não pertence à org → 404.
- Imposto nunca presumido: origem/alíquota ausente → `aliquotaImpostoPct: null` + aviso; nunca 0 silencioso.
- Custo = `variacoes.custo`; nunca `familias.custo_centavos`.
- Frete só conta como conhecido se a tarifa for `official` (via `provenienciaDaTarifa`) ou o operador confirmou frete manual. `partial`/`estimated` sem frete manual → frete `null`. `cotacoesOficiaisDaTarifa` e a tela de Revisão NÃO mudam.
- Kit: custo × q, peso × q, **lado menor** × q (volume somado); custos fixos/variáveis/rebate por kit, não multiplicados.
- Preço por margem: centavos arredondados pra cima; só "confirmado" se, no preço final e com a tarifa relida nesse preço, `margemPctExata >= meta` **e** a modalidade não for `estimated` e frete ≠ null.
- Margem: finita, `< 100`, pode ser negativa. Guardar exata, exibir 2 casas.
- Modalidade: vem do anúncio quando publicado, mas continua editável (o rótulo indica "do anúncio").
- **Cada commit compila:** `pnpm exec tsc -b` verde ao fim de toda task (consumidores ajustados na mesma task).
- Git no worktree: `/usr/bin/git`. Portão de push: `pnpm preflight`.

## Review Focus

1. Trocar de produto A (com medidas) → B (sem medidas/sem origem): nenhum campo de A sobra (Task 4).
2. Respostas intercaladas: cotação comum, solver e prefill antigos chegando depois de uma edição nova nunca sobrescrevem (Task 5).
3. Medidas abaixo do piso / falha de frete no ML: frete desconhecido e "não confirmado", nunca R$ 0 nem selo oficial (Task 2).
4. Meta inalcançável numa faixa mas alcançável em outra (comissão 12%→11%): solver encontra (Task 1).
5. Campo numérico com vírgula, vazio e colado com "R$": não lança, não vira NaN; imposto vazio = desconhecido (Task 6).

---

### Task 1: Motor — margem exata, imposto desconhecido, kit e solver de preço por margem

**Files:**
- Modify: `src/lib/calculadora-ml.ts`; consumidores para compilar: `src/hooks/useCalculadoraML.ts`, `src/components/calculadora-ml/formulario-calculadora-ml.tsx` (só tipos: `aliquotaImpostoPct ?? 0` onde exibido; comportamento real vem nas Tasks 4 e 6)
- Create: `src/lib/calculadora-ml-preco.ts`
- Test: `src/lib/__tests__/calculadora-ml.test.ts`, Create `src/lib/__tests__/calculadora-ml-preco.test.ts`

**Interfaces:**
- Produces (em `calculadora-ml.ts`):
  - `EntradaCalculadoraML.aliquotaImpostoPct: number | null` (null = desconhecido)
  - `ResultadoModalidadeML.margemPctExata: number` (sem arredondar; `margemPct` segue arredondada)
  - `margemAlvoPct`: finita e `< 100`, negativo permitido
- Produces (em `calculadora-ml-preco.ts`):
  - `dimensoesDoKit(d: DimensoesProduto, q: number): DimensoesProduto`
  - `entradaDoKit(e: EntradaCalculadoraML, q: number): EntradaCalculadoraML`
  - `type CotarEm = (preco: number, entrada: EntradaCalculadoraML) => Promise<CotacoesOficiaisPorModalidade>`
  - `interface PrecoPorMargem { preco: number; cotacao: CotacoesOficiaisPorModalidade; margemPct: number; lucro: number; confirmado: boolean }`
  - `precoPorMargem(entrada: EntradaCalculadoraML, modalidade: ModalidadeML, metaPct: number, inicial: CustosModalidadeML, cotarEm: CotarEm, maxChamadas = 12): Promise<PrecoPorMargem | null>`

- [ ] **Step 1: Testes que falham** em `calculadora-ml.test.ts`:
  - `aliquotaImpostoPct: null` → `modalidades.classico === null`, `veredito.tipo === 'Dados insuficientes'`, fator contendo `"imposto"`.
  - `margemAlvoPct: -10` não lança; `margemAlvoPct: 100` lança `RangeError`.
  - preço 30 com lucro 10 → `margemPctExata` `toBeCloseTo(100/3, 6)`, `margemPct === 33.33`.
  - preço com prejuízo → `margemPctExata < 0`, sem exceção.
- [ ] **Step 2:** `pnpm test src/lib/__tests__/calculadora-ml.test.ts` → FAIL.
- [ ] **Step 3:** Implementar. `aliquotaImpostoPct === null` → `calcularModalidade` devolve `null`; veredito `'Dados insuficientes'` com `'Informe a alíquota de imposto (origem do produto não definida).'`.
- [ ] **Step 4: Testes que falham** em `calculadora-ml-preco.test.ts` (cotação fake: comissão `pct(p)`, taxa fixa 0, frete 0, `proveniencia: 'official'`, `comissaoTotal = round2(p × pct/100)`):
  - `dimensoesDoKit({alturaCm:15,larguraCm:5,comprimentoCm:5,pesoKg:0.13}, 3)` → `{15, 15, 5, 0.39}` (empate no menor: o primeiro na ordem altura→largura→comprimento); volume ×3.
  - `entradaDoKit(e, 2)`: custo ×2; fixos/variáveis/rebate iguais; dimensões via `dimensoesDoKit`; sem dimensões → undefined.
  - comissão 0%, custo 1, meta 33 → `preco === 1.50`, `confirmado: true` (1,49 daria 32,89%).
  - comissão 12% arredondada, custo 1, meta 33 → `preco === 1.83` (o ponto fixo 1,82 dá 32,967%; o solver avança centavos).
  - comissão 11% + imposto 4% (ambos arredondados a centavo), custo 1, meta 84,26 → `preco === 135.20`, `confirmado: true` (exige 6 avanços de centavo a partir de 135,14).
  - comissão 12% abaixo de R$100 e 11% a partir de R$100, custo 1, meta 88,5 → `confirmado: true`, `preco === 200` (denominador ≤ 0 na 1ª faixa não encerra).
  - comissão oscilando na fronteira → menor preço verificado que cumpre a meta.
  - meta 95 com comissão 12% e imposto 8% → `confirmado: false` (ou `null` se nada foi cotado), sem lançar, no máximo `maxChamadas` chamadas a `cotarEm`.
  - `cotarEm` com frete `null` ou `proveniencia: 'estimated'` → nunca `confirmado: true`.
  - `cotarEm` lança na 1ª chamada → relança; lança depois de um seguro → devolve o seguro.
- [ ] **Step 5:** `pnpm test src/lib/__tests__/calculadora-ml-preco.test.ts` → FAIL.
- [ ] **Step 6:** Implementar (padrão de `precoProprioEstavel`, `supabase/functions/_shared/preco/sugerir.ts:107`):
  ```
  candidato(cot) = ceil100(base / (1 − (pct+imposto)/100 − meta/100)), base = custo + taxaFixa + frete + fixos + variáveis − rebate
  p = candidato(inicial); se denominador ≤ 0 → p = sondagem (max(base, 1) × 2)
  loop até maxChamadas:
    cot = await cotarEm(p, entrada); r = simulação em p na modalidade
    seguro se r && r.proveniencia !== 'estimated' && r.margemPctExata >= meta − 1e-9
    próximo = candidato(cot)
      denominador ≤ 0      → próximo = p × 2            (sondar faixa seguinte)
      próximo ≤ p e !seguro → próximo = p + 0,01         (avançar centavos; limitado só por maxChamadas)
      próximo já visitado e algum seguro → parar
    seguro e próximo ≥ p → parar
  retorno: menor seguro (confirmado) | visitado de maior margem (não confirmado) | null
  ```
  Teto da sondagem: R$ 100.000 (para e devolve não confirmado). `ponytail:` comentar o teto de chamadas.
- [ ] **Step 7:** `pnpm test src/lib/__tests__ && pnpm exec tsc -b` → PASS.
- [ ] **Step 8:** Commit `feat(calculadora): margem exata, imposto desconhecido, kit e preço por margem`.

### Task 2: Frete desconhecido na calculadora (B1)

**Files:**
- Modify: `src/hooks/useCalculadoraML.ts`
- Test: `src/hooks/__tests__/useCalculadoraML.test.tsx`

**Interfaces:**
- Consumes: `provenienciaDaTarifa(tarifa)` (`src/lib/tarifa.ts`, falha fechado).
- Produces: `cotacaoCalculadora(tarifa: Tarifa, taxas: TaxasManuaisML): CotacoesOficiaisPorModalidade` (exportada; usada nas Tasks 5 e 7).

- [ ] **Step 1: Testes que falham:**
  - tarifa `official` → frete da tarifa, `proveniencia: 'official'`, `statusCotacao === 'official'`.
  - tarifa `partial` (medidas abaixo do piso) ou `estimated` (falha) sem frete manual → `frete === null`, card sem selo oficial, `statusCotacao !== 'official'`, aviso com `motivo_proveniencia`.
  - tarifa `partial` com frete manual confirmado → frete manual, `proveniencia: 'partial'`.
  - tarifa `estimated` (falha de frete **ou** comissão ausente) com frete manual confirmado → frete manual, `proveniencia` continua `'estimated'` (nunca promovida; nunca confirma meta).
  - sem dimensões → comportamento atual (`partial` + frete manual).
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** Implementar `cotacaoCalculadora`; `statusCotacao` e avisos derivados da proveniência resultante, não de `entrada.dimensoes`. Não tocar `src/lib/tarifa.ts`.
- [ ] **Step 4:** testes + `pnpm exec tsc -b` → PASS. **Step 5:** Commit `fix(calculadora): frete parcial ou indisponível não vira oficial`.

### Task 3: Edge `ler-anuncio-calculadora` (somente leitura)

**Files:**
- Create: `supabase/functions/ler-anuncio-calculadora/index.ts`, `.../processar.ts`, `.../__tests__/processar.test.ts` (vitest com deps — padrão `status-publicados/__tests__/processar.test.ts`)
- Modify: `supabase/config.toml` (bloco igual ao de `tabela-frete-ml`)
- Create: `src/lib/anuncio-calculadora.ts`

**Interfaces:**
- Request: `POST { codigo_pai: string, item_id: string | null }` (`item_id` = `VariacaoComSaldo.mlItemId`, já resolvido por SKU na RPC). Auth `requireUserOrg`; conexão via `resolverConexao(admin, orgId, 'mercado_livre')` + `getValidAccessTokenConexao` (como `tabela-frete-ml/index.ts`).
- Response `AnuncioCalculadora` (camelCase no cliente):
  ```ts
  { publicado: boolean; itemId: string | null; preco: number | null; precoOriginal: number | null;
    fontePreco: 'sale_price' | 'items' | null; salePriceFalhou: boolean;
    modalidade: 'classico' | 'premium' | null;   // gold_special → classico, gold_pro → premium
    categoriaId: string | null; categoriaNome: string | null;
    categoriaFonte: 'item' | 'cadastro' | null; motivo?: string }
  ```
- Cliente: `fetchAnuncioCalculadora(codigoPai: string, itemId: string | null): Promise<AnuncioCalculadora>`; HTTP ≠ 2xx → lança.

- [ ] **Step 1: Testes que falham** (`processar.test.ts`):
  - `item_id` que não aparece em `anuncios_externos.item_externo_id`, `anuncios_externos_itens.item_externo_id` nem `familias.ml_item_id` **da org** → `{ status: 404 }`, nenhuma chamada ao ML. Duas orgs com o mesmo `codigo_pai`: cada uma só vê o seu.
  - `item_id: null` → `publicado: false`, `categoriaId` = `familias.categoria_ml_id` da org (família canônica `criado_em desc`), `categoriaFonte: 'cadastro'`.
  - `/sale_price` com promoção → `preco` = valor pago, `precoOriginal` = regular, `fontePreco: 'sale_price'`.
  - `/sale_price` null → `preco` = `price` do `/items`, `fontePreco: 'items'`, `salePriceFalhou: true`.
  - `listing_type_id: 'gold_pro'` → `'premium'`; `category_id` do item → `categoriaFonte: 'item'`; nome via `/categories/{id}`.
  - `/items` falha → `publicado: true`, `preco: null`, `motivo`, categoria do cadastro.
  - todas as chamadas ao ML usam método `GET`.
- [ ] **Step 2:** `pnpm test supabase/functions/ler-anuncio-calculadora` → FAIL.
- [ ] **Step 3:** Implementar `processar.ts` com deps `{ db, lerItem, lerSalePrice, lerCategoriaNome }`. `lerItem` = `GET /items/{id}?attributes=price,listing_type_id,category_id` (timeout 5 s, null em falha). `lerSalePrice` = `lerSalePriceML`. `index.ts` só auth/conexão/JSON, sem cache.
- [ ] **Step 4:** testes → PASS; `pnpm lint:functions && pnpm check:functions` limpos.
- [ ] **Step 5:** `src/lib/anuncio-calculadora.ts` (fetch autenticado como `calcularTarifaML`). `pnpm exec tsc -b` verde.
- [ ] **Step 6:** Commit `feat(edge): ler-anuncio-calculadora — preço vivo, modalidade e categoria (somente leitura)`.

### Task 4: Hook com revisão única + prefill atômico (B2)

**Files:**
- Modify: `src/hooks/useCalculadoraML.ts`, `src/components/calculadora-ml/calculadora-ml.tsx` (passar o que mudou de nome)
- Test: `src/hooks/__tests__/useCalculadoraML.test.tsx`

**Interfaces:**
- Consumes: `fetchVariacoesProduto` + `escolherVariacao` (existentes), `fetchAnuncioCalculadora` (Task 3), `useAliquotas` (`src/hooks/useConfiguracoes.ts`), `aliquotaDoKit` (`src/lib/kit-variacao-simulacao.ts`), `cotacaoCalculadora` (Task 2).
- Produces:
  - estado interno em `useReducer`: `{ revisao: number; entrada; cotacao: CotacoesPorModalidade | null; chaveCotada: string | null; modalidade: ModalidadeML; modalidadeDoAnuncio: ModalidadeML | null; impostoManual: boolean; avisosProduto: string[]; categoriaNome: string | null }`. **Toda** ação de edição/seleção incrementa `revisao`; toda operação assíncrona captura a revisão e só publica se ainda for a atual.
  - no retorno: `modalidadeAtiva`, `modalidadeDoAnuncio`, `setModalidadeAtiva(m)`, `avisosProduto`, `categoriaNome`.

- [ ] **Step 1: Testes que falham:**
  - produto publicado (mock: preço 20, `gold_special`, MLB200339) → `precoVenda 20`, `categoriaId 'MLB200339'`, `modalidadeAtiva 'classico'`, `modalidadeDoAnuncio 'classico'`, imposto = alíquota nacional.
  - sequência: variações → `escolherVariacao` → `fetchAnuncioCalculadora(codigoPai, variacao.mlItemId)` (nunca antes de escolher).
  - troca A (dimensões, nacional) → B (sem dimensões, origem `''`) → `dimensoes undefined`, `aliquotaImpostoPct null`, aviso com `"origem"`.
  - alíquotas ainda carregando → `null`; quando chegam, preenche **se** `impostoManual === false`; editado à mão → não sobrescreve.
  - `fetchAnuncioCalculadora` rejeita (HTTP) ou devolve `preco: null` → preço do cadastro + aviso `"não foi possível ler o preço no ar"`; `salePriceFalhou` → aviso `"promoção"`.
  - lista de variações vazia → campos do produto limpos + aviso.
  - resposta de A chegando após selecionar B; cotação antiga chegando após edição de preço → ignoradas.
  - editar custo (ou imposto, rebate) enquanto a cotação está em voo → a cotação **ainda publica** (a chave preço|categoria|dimensões não mudou) e o status sai de `loading`.
  - "Produto avulso" (null) → limpa campos do produto e `modalidadeDoAnuncio null`.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** Implementar: montar a entrada nova **inteira** e aplicar numa única ação (`PRODUTO_CARREGADO`); ausente = limpo (`custoProduto 0`, `dimensoes undefined`, `aliquotaImpostoPct null`). Validade das respostas: **prefill e solver** por `revisao`; **cotação comum** pela própria chave (preço|categoria|dimensões) — resposta só é descartada se a chave atual mudou. O effect compara `chaveCotada` e não recota se igual. Modalidade do anúncio só define o valor inicial.
- [ ] **Step 4:** testes + `pnpm exec tsc -b` → PASS. **Step 5:** Commit `feat(calculadora): revisão única no hook e produto publicado preenche tudo`.

### Task 5: Preço ⇄ margem ligados (I3)

**Files:**
- Modify: `src/hooks/useCalculadoraML.ts`, `src/components/calculadora-ml/resultado-calculadora-ml.tsx` e `calculadora-ml.tsx` (remover consumo das props apagadas, no mesmo commit)
- Test: `src/hooks/__tests__/useCalculadoraML.test.tsx`

**Interfaces:**
- Consumes: `precoPorMargem` (Task 1), `cotacaoCalculadora` (Task 2), reducer/revisão (Task 4).
- Produces: `editarPreco(v: number)`, `editarMargem(v: number)`, `metaSolicitada: number | null`, `margemEfetiva: number | null` (`resultado.modalidades[ativa]?.margemPctExata ?? null`), `margemExibida: number | null`, `metaStatus: 'ok' | 'calculando' | 'nao_confirmada' | null`, `ultimoEditado: 'preco' | 'margem'`. Remove `validarNaApi`, `cotacaoMeta`, `validacaoMeta`, `erroMeta`.

- [ ] **Step 1: Testes que falham:**
  - `editarPreco(25)` → `margemExibida === margemEfetiva` a R$25.
  - `editarMargem(38)` → debounce 400 ms; durante `'calculando'`, `margemExibida === 38`; ao resolver, preço + cotação publicados na **mesma** ação, `metaStatus 'ok'`, e o effect **não** recota esse preço.
  - `editarMargem(30)` e `editarMargem(40)` com a 1ª resolvendo por último → vale a de 40.
  - `editarMargem` seguido de `editarPreco` antes da resposta → solver descartado.
  - solver `confirmado: false` → preço = melhor candidato, `metaStatus 'nao_confirmada'`, `margemExibida === margemEfetiva` (não a meta); `metaSolicitada` fica disponível para o rótulo.
  - solver `null` ou exceção → preço inalterado, `metaStatus 'nao_confirmada'`.
  - alterar custo/imposto/medidas/modalidade após `editarMargem` → preço mantido, `ultimoEditado 'preco'`.
  - sem categoria → solver com cotação manual, sempre `'nao_confirmada'`.
  - preço 10, custo 1, rebate 2, demais 0 → `margemEfetiva === 110`, nada lança, `entrada.margemAlvoPct` segue a meta (ou 0).
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** Implementar. `cotarEm = (p, e) => calcularTarifaML(p, categoriaId, dimensoesDaTarifa(e.dimensoes?.alturaCm, e.dimensoes?.larguraCm, e.dimensoes?.comprimentoCm, e.dimensoes?.pesoKg), 0)` → null lança → `cotacaoCalculadora(t, taxas)`. `inicial` = cotação vigente da modalidade ativa. `margemExibida = metaStatus === 'calculando' ? metaSolicitada : margemEfetiva`. Veredito: `entrada.margemAlvoPct` = `metaSolicitada ?? 0` — **nunca** a margem efetiva (ela pode passar de 100%, ex.: rebate maior que custos, e o motor rejeita meta ≥ 100). Sem `metaSolicitada`, o veredito não cita meta (Task 6).
- [ ] **Step 4:** testes + `pnpm exec tsc -b` → PASS. **Step 5:** Commit `feat(calculadora): preço e margem ligados pela modalidade ativa`.

### Task 6: UI — campos numéricos, modalidade, margem viva e central de decisão

**Files:**
- Modify: `src/components/calculadora-ml/formulario-calculadora-ml.tsx`, `resultado-calculadora-ml.tsx`, `calculadora-ml.tsx`, `busca-categoria-ml.tsx`
- Test: `src/components/calculadora-ml/__tests__/calculadora-ml.test.tsx`, `src/pages/__tests__/Viabilidade.test.tsx`

**Interfaces:**
- Consumes: retorno do hook (Tasks 4–5).
- Produces: `parseNumeroBR(texto: string): number | null` exportada de `formulario-calculadora-ml.tsx`.

- [ ] **Step 1: Testes que falham:**
  - `parseNumeroBR`: `'12,5'→12.5`, `'1.234,56'→1234.56`, `'R$ 3,04'→3.04`, `'-5'→-5`, `''→null`, `'abc'→null`.
  - nenhum `input[type=number]`; foco seleciona o texto inteiro.
  - vazio: imposto → `aliquotaImpostoPct null` (aviso de imposto); margem → nada muda; demais → 0. Limites: margem `< 100` (negativo ok); imposto e demais `>= 0`; mensagem de erro em vez de clamp silencioso.
  - modalidade editável sempre; publicado mostra "Clássico · do anúncio" e trocar recalcula a margem.
  - "Margem (%)" mostra `margemExibida` com 2 casas; `'nao_confirmada'` → "meta de 38,00% não confirmada".
  - categoria do produto aparece com nome + ID; `avisosProduto` com `role="status"`.
  - sem botão "Validar preço projetado na API"; sem "atinge a meta de 0%".
- [ ] **Step 2:** `pnpm test src/components/calculadora-ml src/pages/__tests__/Viabilidade.test.tsx` → FAIL.
- [ ] **Step 3:** Implementar. `CampoNumero`: `type="text"`, `inputMode="decimal"`, rascunho de texto local (formatado pt-BR fora do foco), `onFocus={e => e.currentTarget.select()}`, props `permiteNegativo`, `vazio: 'null' | 'ignorar' | 'zero'`, `max`/`maxExclusivo`. Margem → `editarMargem`; preço → `editarPreco`. Modalidade: toggle de dois botões no topo de "Compra e venda". `BuscaCategoriaML` ganha `nome?: string`.
- [ ] **Step 4:** testes + `pnpm exec tsc -b` → PASS. **Step 5:** Commit `feat(calculadora): campos sem setas, modalidade e margem viva na tela`.

### Task 7: Quadro de kits 1 · 2 · 3 · N

**Files:**
- Create: `src/hooks/useKitsCalculadora.ts`, `src/components/calculadora-ml/quadro-kits.tsx`
- Modify: `src/components/calculadora-ml/calculadora-ml.tsx`
- Test: Create `src/hooks/__tests__/useKitsCalculadora.test.tsx`, `src/components/calculadora-ml/__tests__/quadro-kits.test.tsx`

**Interfaces:**
- Consumes: `entradaDoKit`, `precoPorMargem` (Task 1); `cotacaoCalculadora` (Task 2); `margemEfetiva`, `modalidadeAtiva`, `resultado`, `entrada` (Tasks 4–5).
- Produces: `useKitsCalculadora(args: { entrada: EntradaCalculadoraML; modalidade: ModalidadeML; margemPct: number | null; quantidadeN: number; resultadoUnidade: ResultadoModalidadeML | null; taxas: TaxasManuaisML; cotarEm: CotarEm }): ColunaKit[]`, `ColunaKit = { quantidade: number; preco: number | null; precoUnitario: number | null; frete: number | null; comissao: number | null; lucro: number | null; status: 'ok' | 'calculando' | 'nao_confirmado' | 'sem_dados' }`.

- [ ] **Step 1: Testes que falham:**
  - quantidades `[1,2,3]` + N se N ∉ {1,2,3}; N=5 → 4 colunas.
  - margem usada = `margemEfetiva` (nunca a meta não confirmada).
  - coluna 1 = `resultadoUnidade`, sem chamar API.
  - coluna 2 chama `cotarEm` com custo ×2 e `dimensoesDoKit(…, 2)`; `precoUnitario = preco / 2`.
  - sem categoria, sem dimensões, imposto null ou `margemPct null` → colunas ≥ 2 `'sem_dados'`.
  - edições rápidas → debounce 400 ms; só a última rodada publica.
  - componente: N inteiro ≥ 1 (0/vazio → 1); linha "Custos fixos, variáveis e rebate considerados por kit."; "não confirmado" na coluna.
- [ ] **Step 2:** rodar → FAIL. **Step 3:** Implementar (colunas ≥ 2 em paralelo). **Step 4:** testes + `pnpm exec tsc -b` → PASS.
- [ ] **Step 5:** Commit `feat(calculadora): quadro de kits com frete e margem por quantidade`.

### Task 8: Tabela de frete — indisponível ≠ zero, e na calculadora

**Files:**
- Modify: `supabase/functions/_shared/ml/tabela-frete.ts`, `supabase/functions/tabela-frete-ml/index.ts`, `src/lib/tabela-frete.ts`, `src/hooks/useTabelaFreteML.ts`, `src/components/tabela-frete-viabilidade.tsx`, `src/components/calculadora-ml/calculadora-ml.tsx`
- Test: `supabase/functions/_shared/ml/__tests__/tabela-frete.test.ts`, Create `src/components/__tests__/tabela-frete-viabilidade.test.tsx`, Create `src/hooks/__tests__/useTabelaFreteML.test.tsx`

**Interfaces:**
- Produces: `TabelaFrete.celulas: (number | null)[][]` no shared e no cliente; `tabelaIncompleta(t: TabelaFrete): boolean` em `src/lib/tabela-frete.ts`.

- [ ] **Step 1: Testes que falham:**
  - `montarTabelaFrete`: célula `estimated` → `null`; `official` 0 → `0`.
  - edge: com `null` → Redis TTL 300 s; completa → 24 h; chave `tabela-frete:v2:`.
  - hook: resposta incompleta ou `erro` → `staleTime` 5 min (refaz após expirar); completa → 24 h.
  - UI: `null` → "—" com `title="Indisponível no Mercado Livre"`; `0` → "R$ 0,00"; legenda "— = o Mercado Livre não respondeu esta faixa".
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** Implementar: default de `montarTabelaFrete` passa a `buscarFreteVendedorComProveniencia`; `staleTime` como função da resposta. Na calculadora: `<TabelaFreteViabilidade categoriaMlId={categoriaId} analiseConcluida />` no fim; sem categoria → "Informe a categoria para ver a tabela de frete do Mercado Livre.".
- [ ] **Step 4:** `pnpm test` (suite toda) + `pnpm exec tsc -b` → PASS. **Step 5:** Commit `fix(frete): tabela distingue faixa indisponível de frete zero; exibida na calculadora`.

### Task 9: Docs, preflight, deploy antes do merge

**Files:**
- Modify: `docs/decisions/0126-calculadora-mercado-livre-premium.md` (seção "Emenda 2026-11-10"), `docs/TASKS.md`, `docs/reference/edge-functions.md`

- [ ] **Step 1:** Emenda no ADR-0126 (prefill pelo item da variação, preço⇄margem confirmado na tarifa, kit lado menor × q, frete parcial/indisponível = desconhecido só na calculadora, tabela com célula indisponível, edge `ler-anuncio-calculadora`). Registrar a edge em `edge-functions.md` e a entrega em `TASKS.md`. Commit `docs: emenda ADR-0126 e edge ler-anuncio-calculadora`.
- [ ] **Step 2:** rebase na `origin/main` atual; `pnpm preflight` → verde; push da branch; CI verde no SHA final.
- [ ] **Step 3 (antes do merge):** `supabase functions deploy ler-anuncio-calculadora tabela-frete-ml`; conferir versão nova em `supabase functions list`. (A `tabela-frete-ml` nova é compatível com o front antigo: `null <= 0` já exibe "—".)
- [ ] **Step 4: Smoke autenticado:** chamar `ler-anuncio-calculadora` com um item da org (200, preço preenchido) e com um item de outra org (404). Conferir em `processar.ts` que só há `GET` ao ML.
- [ ] **Step 5:** só então o merge fast-forward na `main` (fluxo do CLAUDE.md).
