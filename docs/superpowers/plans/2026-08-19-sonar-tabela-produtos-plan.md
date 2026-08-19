# Plano — Sonar: enriquecer a tabela de produtos (paridade Hunter Hub, custo Apify zero)

> Branch: `worktree-sonar-colunas-hunter`. Referências de código conferidas em 2026-08-18.
> Payload REAL do actor Apify inspecionado em 2026-08-18 (dataset do último run, 20 registros,
> termo "abraçadeira nylon") — as regras de parse e casamento abaixo vêm dessa medição, não de suposição.

## 1. Objetivo

Enriquecer a tabela de fichas do Sonar (`src/pages/PulseSonar.tsx:467`) com dados que **já pagamos** —
o payload da Apify que `montarPainelVendas` hoje descarta e os campos que a `pulse-sonar` já coleta
mas não expõe — mais filtros client-side sobre a tabela e uma sonda condicional para "Criação (dias)".

**Fora de escopo:** novas chamadas pagas à Apify; seletor de colunas e exportar (features do Hunter
que ficam para outra entrega); paginação além das 40 fichas; persistência de filtros em
URL/localStorage; qualquer mudança no Radar; qualquer escrita no ML.

---

## 2. Decisões de design

| # | Decisão | Justificativa |
|---|---------|---------------|
| D1 | **Agregação de "vendidos" quando a ficha casa com vários anúncios: MAIOR, nunca soma.** | `quantidadeVendida` vem NUMÉRICO no dataset (ex.: `10000`), mas o ML arredonda na origem em faixas (25/100/1.000/10.000) e os anúncios casados são amostra parcial (top ~20 da busca). Soma de faixas arredondadas sobre amostra parcial = número inventado que parece total. O maior é um **piso verificável**: "pelo menos N". Definição de **anúncio principal** da ficha: o de maior `vendidos`; desempate/todos-null → o de menor `posicao`. Faturamento, avaliação, desconto e selo vêm todos do anúncio principal (par coerente, não colagem de anúncios diferentes). |
| D2 | **Cache da `pulse-sonar-vendas`: manter chave `v4` e adicionar campo OPCIONAL `por_anuncio` (recommended).** | Bump v4→v5 re-cobra ~US$0,10 por termo já buscado nos últimos 7 dias. Campo aditivo é retrocompatível: entrada v4 antiga simplesmente não tem o índice e as colunas novas mostram "—" até o TTL (≤7d) expirar sozinho — custo forçado ZERO. Documentar no comentário da chave (`supabase/functions/pulse-sonar-vendas/index.ts:36-38`) que a partir desta entrega "shape aditivo opcional não exige bump; bump só para mudança incompatível ou de corte". Alternativa rejeitada: bump v5 com fallback de leitura do v4 — mesmo efeito prático, mais código. Se Diego preferir dado imediato em termo já cacheado, o bump v5 é a troca: US$0,10 × termos re-buscados na semana. |
| D3 | **Cache da `pulse-sonar` (`sonar:v2`, `supabase/functions/pulse-sonar/index.ts:122`): bump v2→v3.** | Aqui o bump é grátis (API oficial, sem custo monetário) e a convenção existente já versiona shape (v1→v2 pelo mesmo motivo). Único custo: primeira busca de termo cacheado volta a demorar ~15s. |
| D4 | **Casamento ficha↔anúncio no FRONTEND, por função pura, chaveado por `idPublicacao`.** Medido no dataset real: `idPublicacao` (= item_id do anúncio, ex. `MLB4445303151`) vem **20/20**; `idProdutoCatalogo` (= product_id da ficha, só quando o anúncio está em catálogo) vem 6/20; o `zProdutoLink` só carrega `MLBU…` (`idProdutoUsuario`), inútil para casar — **nada de extrair MLB de link**. Regra: primário = `idPublicacao ∈ ficha.item_ids`; atalho = `idProdutoCatalogo === ficha.product_id` quando não vazio. Isso torna a exposição de `item_ids` pela `pulse-sonar` (T3) **obrigatória** — sem ela não existe casamento. As edges continuam desacopladas (ADR-0122): `pulse-sonar-vendas` só expõe o índice `por_anuncio` chaveado por `idPublicacao`; o cruzamento vive no front. |
| D5 | **Apify indisponível (`configurado:false`), erro ou termo sem cache: as colunas do Grupo B nem aparecem.** | Colunas condicionais (`useMemo` já depende de `vendas`). Uma tabela inteira de "—" quando a Apify nem está configurada é ruído enganoso; coluna ausente comunica "fonte indisponível". Com Apify OK mas ficha sem anúncio casado → "—" na célula (com `title="Sem anúncio correspondente na amostra"`). |
| D6 | **Sem dado = `null` = "—" em TODA célula nova.** Nunca 0, nunca soma parcial disfarçada. | Regra LOUD do projeto; padrão já usado na coluna Visitas (`PulseSonar.tsx:297`). Campos do dataset com cobertura ruim medida ficam FORA do parse: `is_inStock` (6/20), `produtoMarca` (0/20), `enviadoDe`/`localizacao`/`disponivelEm` (vazios), `vendedorID` (0/20 — não dá para casar por vendedor), `SKU` (duplica `idPublicacao`), campo `patrocinado` do actor (vazio em 0/20 — usar `tipoResultado`). |
| D7 | **Rótulo honesto nas métricas derivadas:** header "Vendas" com sufixo "(acum.)" e tooltip "acumulado da vida do anúncio, arredondado em faixas pelo ML — não é ritmo mensal"; "Faturamento (acum.)" com "≈ vendidos × preço atual do anúncio — o preço pode ter variado ao longo da vida"; "Visitas/oferta" com "visitas do anúncio ganhador ÷ nº de ofertas". | Diego odeia estimativa disfarçada de fato. **Atenção assumida e sinalizada:** `visitas_30d` da ficha é do item MAIS BARATO (proxy do ganhador — `pulse-sonar/index.ts:38-45`), não a soma da ficha; a divisão por ofertas herda essa semântica e o tooltip diz isso. Se Diego achar a métrica fraca demais com esse rótulo, cortar é decisão dele, não nossa. |
| D8 | **FLEX segue best-effort.** `full` já é derivado do texto `envio` (`sonar-vendas.ts:104`; amostra real: `'Frete grátis Enviado pelo FULL'`); FLEX sai do mesmo texto (`/flex/i`). Na amostra de 20 nenhum registro dizia "flex" — se o actor nunca emitir, a coluna Envio mostra só FULL/— e nada quebra. | Não prometer o que a fonte pode não ter. |
| D9 | **Grupo C é sonda auto-desligável, não promessa — e é a ÚNICA coluna que ainda depende de hipótese não testada** (todo o resto deste plano está confirmado por payload real ou código existente). Multiget `/items?ids=...&attributes=id,date_created` (mesmo endpoint que já usamos para itens PRÓPRIOS em `supabase/functions/pulse-coletar/processar.ts:395`) numa chamada com status HTTP inspecionado localmente — `mlGet` (`_shared/ml/http.ts:15-18`) engole o status e devolve `null`, então a sonda usa um `fetch` local no `pulse-sonar/index.ts` (não tocar o `mlGet` compartilhado, é usado pelo coletor). 403 no todo ou em TODOS os envelopes → grava flag Redis `sonar:items-multiget-403` TTL 24h e para de tentar; coluna mostra "—". Funcionou → `criado_em` (do item mais barato, o mesmo cujas visitas medimos) entra na ficha. | ADR-0119 Errata 1 prova o 403 no GET unitário; o multiget é hipótese. Sonda barata (1-2 chamadas por garimpo), desliga sozinha, não vira erro na tela. |
| D10 | **Sparkline em SVG puro (componente novo ~25 linhas), não Recharts.** | 40 `ResponsiveContainer` por render da tabela é peso desnecessário; um `<svg><polyline/></svg>` resolve. |
| D11 | **Layout: 9 colunas de dados + Ações (+ Criação condicional), compostas em 2 linhas por célula.** Coluna própria (ordenável) só para o que se ordena de verdade; o resto vai em sublinha/badge: |
|    | 1. **Produto** — nome (sort); sublinha de badges: selo do ML ("MAIS VENDIDO"), "Patrocinado" (D-cruz abaixo). 2. **Vendas (acum.)** — sort por `vendidos`. 3. **Faturamento (acum.)** — sort. 4. **Preço** — mediana em destaque (sort passa de `min` para `mediana` — mudança visível, registrada no ADR); sublinha `min – max · +X%` (espalhamento) e, quando o anúncio principal tiver desconto ativo, `de R$ 45,90 · 13% OFF` (fonte Apify, tooltip diz isso). 5. **Avaliação** — `★ 4.9` (sort por nota); sublinha `(84)` quando `avaliacao_qtd` existir. 6. **Posição** — menor `posicao` ORGÂNICA entre os casados, `#1` (sort asc); todos patrocinados → "—" + badge Patrocinado no Produto. 7. **Visitas (30d)** — número (sort) + sparkline; sublinha `≈ N/oferta`. 8. **Envio** — FULL/FLEX + badge 🌐 internacional; sublinha `frete grátis X%` (da ficha, API oficial). 9. **Vendedores/UF** — contagem + UFs; sublinha top vendedor por `transacoes_total`; badge "Oficial". Cabe no `overflow-x-auto` do DataTable (`data-table.tsx:77`); ordenação continua por `sortValue` normal (coluna composta ordena pelo número principal). | 15 colunas soltas não cabem; sublinha preserva ordenação e leitura. **Posição/Patrocinado o Hunter não tem** — líder que só aparece pagando fica exposto. |
| D12 | Decisões D1, D2, D4 e D9 viram **ADR 0125** (próximo livre; último é 0124 — há um 0116 duplicado, ignorar). | Regra do projeto: decisão não-trivial → ADR antes da implementação. |
| D13 | **Filtros 100% client-side, sobre as fichas já em memória.** As ~40 fichas já estão no react-query; filtrar é um `filter` puro ANTES do `DataTable` ordenar — zero chamada nova a edge/Apify, zero paginação de servidor. **Estado em `useState` na página, sem URL/localStorage nesta entrega** (decisão consciente: o Sonar já usa localStorage para buscas recentes e misturar filtro ali é escopo extra; persistir quando houver demanda real). Conjunto fechado: mín. vendas (acum.)†, mín. visitas 30d, máx. vendedores, faixa de preço (sobre a MEDIANA da ficha), nota mínima†, toggles só FULL† · só com desconto ativo† · esconder patrocinados† · esconder fichas com loja oficial (risco de propriedade intelectual, ADR-0124 — este vem da API oficial, sempre disponível). † = dado da Apify: o controle **não aparece** quando `configurado:false` ou sem `por_anuncio` (mesma regra D5 das colunas). | Não inventar filtro além desta lista. |
| D14 | **Filtro ativo com `null` no campo: a ficha é EXCLUÍDA (null nunca vira 0), e a UI conta as excluídas por falta de dado** ("N fichas sem esse dado") para o operador não achar que sumiram por engano. Contador "X de Y fichas" sempre visível + botão "Limpar filtros" quando houver algum ativo. **KPIs do topo e veredito NÃO reagem a filtro** — falam do nicho inteiro; um veredito que muda conforme o filtro vira número enganoso. | Coerência com D6/D7. |

---

## 3. Tarefas (ordem de execução — TDD em todas)

### T0 — ADR 0125
- **Arquivo:** `docs/decisions/0125-sonar-tabela-cruzamento-ficha-anuncio.md` (novo).
- **Conteúdo:** D1, D2, D3, D4, D9 acima, com o custo do bump explicitado e a medição do dataset (coberturas por campo) registrada.
- **Pronto quando:** ADR escrito antes de qualquer código (regra do CLAUDE.md).

### T1 — Shared vendas: campos novos do dataset + índice `por_anuncio`
- **Arquivos:** `supabase/functions/_shared/pulse/sonar-vendas.ts`, `supabase/functions/_shared/pulse/__tests__/sonar-vendas.test.ts`.
- **Muda — `ItemVendas` ganha (tudo já pago, zero chamada nova; '' e ilegível → `null` sempre):**
  - `item_id` (de `idPublicacao` — 20/20 no dataset; sem ele o item fica fora do índice)
  - `catalog_product_id` (de `idProdutoCatalogo`; `''` → null — 6/20)
  - `avaliacao_nota` (de `produtoReviews`, string `'4.9'`/`'4,9'` → número; fora de 0–5 → null)
  - `avaliacao_qtd` (de `numeroAvaliacoes`, aceita `'(84)'` e `'84'` → 84)
  - `posicao` (de `posicaoItem`, inteiro ≥1 — 20/20)
  - `patrocinado` (`tipoResultado !== 'ORGANIC'` quando `tipoResultado` for string não vazia; ausente → null. NÃO usar o campo `patrocinado` do actor — vazio em 0/20)
  - `selo` (de `highlight`, ex. `'MAIS VENDIDO'`; `''` → null)
  - `preco_anterior` (de `precoAnterior`, `'45,9'` → 45.9 — **reusar `parsePrecoApify`**, `sonar-vendas.ts:60-69`, já trata pt-BR)
  - `desconto_pct` (de `precoDiscount`, `'13% OFF'` → 13)
  - `flex` (de `/flex/i.test(envio)`, mesmo padrão do `full` em `:104`; `envio === null` → null)
- **Muda — índice:** nova fn pura `indexarPorAnuncio(itens: ItemVendas[]): Record<string, ItemVendas>` chaveada por `item_id`; item sem `item_id` fica fora; colisão fica com o primeiro (ordem de relevância, mesmo critério do destaque em `:110-111`). `PainelVendasSonar` ganha `por_anuncio`.
- **Testes (escrever ANTES):** parse de cada campo novo com o valor REAL do dataset (`'4.9'`, `'4,9'`, `'6'` fora de faixa→null, `'(84)'`, `'13% OFF'`, `'45,9'`→45.9, `tipoResultado 'ORGANIC'`→false / `'ADVERTISING'`→true / ausente→null, `highlight ''`→null, `idProdutoCatalogo ''`→null); `indexarPorAnuncio` indexa por `idPublicacao`, descarta item sem id, colisão mantém o primeiro; `flex` com `'Enviado pelo FLEX'`/`'Frete grátis Enviado pelo FULL'`/null.
- **Pronto:** `pnpm test` verde; nenhum teste existente alterado.

### T2 — Edge `pulse-sonar-vendas`: expor `por_anuncio` sem bump
- **Arquivo:** `supabase/functions/pulse-sonar-vendas/index.ts`.
- **Muda:** resposta (`index.ts:47-50`) inclui `por_anuncio: indexarPorAnuncio(itens)`. Chave continua `sonar:vendas:v4:` — atualizar o comentário `index.ts:36-38` registrando D2 (aditivo não exige bump).
- **Teste:** coberto por T1 (a edge só chama a fn pura; convenção do projeto — as edges não têm teste próprio, os parsers têm).
- **Pronto:** `npx tsc` sem erro no arquivo (deno-check via lint do CI backend).

### T3 — Edge `pulse-sonar`: `item_ids` por ficha + bump v2→v3 (OBRIGATÓRIA — é a chave primária do casamento, D4)
- **Arquivos:** `supabase/functions/_shared/pulse/sonar.ts`, `supabase/functions/pulse-sonar/index.ts`, `supabase/functions/_shared/pulse/__tests__/sonar.test.ts`.
- **Muda:**
  - `ResultadoFicha` (`sonar.ts:62-70`) ganha `item_ids: string[]` (ordem da resposta do ML; ficha vazia → `[]`).
  - `processarFicha` (`index.ts:65-104`) devolve `item_ids: ofertas.map((o) => o.item_id)` — os ids já estão em memória via `parseOfertasProduto` (`parse.ts:10`). `resultadoVazio()` (`index.ts:61-63`) ganha `item_ids: []`.
  - Chave `index.ts:122`: `sonar:v2:` → `sonar:v3:`, comentário citando esta entrega.
- **Teste:** `montarPainelSonar` propaga `item_ids` para a ficha (fixture com 2 ids); ficha vazia com `[]`.
- **Pronto:** `pnpm test` verde.

### T4 — Tipos do front espelhados
- **Arquivo:** `src/lib/sonar.ts`.
- **Muda:** `ResultadoFichaSonar` ganha `item_ids?: string[]` e `criado_em?: string | null` (opcionais: cache antigo/sonda desligada não os têm); `ItemVendasSonar` ganha os campos novos de T1; `PainelVendasSonar` ganha `por_anuncio?: Record<string, ItemVendasSonar>`. Comentário mantém a regra "espelho sem import cross-runtime" (`sonar.ts:1-4`).
- **Teste:** compilação (`tsc`) — tipos puros.
- **Pronto:** `npx tsc -b --force` verde.

### T5 — Cruzamento e derivados (funções puras do front)
- **Arquivos:** `src/lib/sonar-cruzamento.ts` (novo), `src/lib/__tests__/sonar-cruzamento.test.ts` (novo).
- **Muda:**
  - `cruzarFichaComVendas(ficha, porAnuncio): VendasFicha | null` — candidatos = entradas cujo `item_id` ∈ `ficha.item_ids ?? []` OU cujo `catalog_product_id === ficha.product_id` (D4). Sem candidato → `null`. Com candidatos, devolve:
    - `vendidos` = MAIOR entre os com dado (D1); todos null → null;
    - **anúncio principal** = maior `vendidos`, desempate menor `posicao`;
    - `faturamento` = `vendidos × preco` DO principal (null se qualquer um null);
    - `avaliacao_nota` / `avaliacao_qtd` / `preco_anterior` / `desconto_pct` / `selo` = do principal;
    - `posicao_organica` = menor `posicao` entre candidatos com `patrocinado === false`; nenhum orgânico → null;
    - `patrocinado` = true se algum candidato `patrocinado === true`; todos null → null; senão false;
    - `full` / `flex` / `internacional` = true se algum candidato true, null se todos null, senão false;
    - `anuncios_casados` = contagem.
  - `espalhamentoPct(preco): number | null` — `(max−min)/min×100`; `min<=0` ou `preco==null` → `null`.
  - `visitasPorOferta(visitas_30d, ofertas): number | null` — `null` se visitas `null` ou `ofertas === 0`.
  - `vendedorMaisForte(vendedores): { seller_id, uf, transacoes_total } | null` — maior `transacoes_total` não-null; todos null → `null`.
  - `diasDesde(iso: string | null, agora: Date): number | null`.
- **Testes (ANTES):** casamento por `item_id`; por `catalog_product_id` (anúncio de catálogo); anúncio SEM catálogo casando só por item_id; múltiplos candidatos → maior vendidos e principal certo (faturamento/avaliação/desconto do MESMO anúncio); nenhum candidato → null; candidato sem vendidos → vendidos null mas envio/posição ainda casam; `posicao_organica` ignora patrocinados e vira null quando todos pagos; espalhamento com min 0 → null; visitasPorOferta com null/0; vendedorMaisForte com transacoes null; diasDesde.
- **Pronto:** `pnpm test` verde; 100% dos casos "sem dado" devolvem `null` (nunca 0).

### T6 — UI Grupo B: colunas novas (layout D11)
- **Arquivo:** `src/pages/PulseSonar.tsx` (colunas em `:270-335`).
- **Muda:** `colunasFichas` passa a depender de `vendas` no `useMemo`. Cruzamento calculado UMA vez por linha (memo `Map<product_id, VendasFicha|null>` via `useMemo([painel, vendas])`), não por célula. Com `vendas?.configurado === true` e `por_anuncio` presente:
  - **Produto** ganha sublinha de badges: `selo` ("MAIS VENDIDO", `Badge variant="secondary"`) e "Patrocinado" quando `patrocinado === true`.
  - **Vendas (acum.)** — `+{fmtMilhar(vendidos)}`, tooltip D7; `sortValue` = vendidos (null → fim, nativo do DataTable `data-table.tsx:39-48`); sem dado → `—` com `title="Sem anúncio correspondente na amostra"`.
  - **Faturamento (acum.)** — `≈ {fmtBRL(faturamento)}`, tooltip D7, `sortValue` = faturamento.
  - **Avaliação** — `★ {nota}` + sublinha `({avaliacao_qtd})`; `sortValue` = nota.
  - **Posição** — `#{posicao_organica}`; `sortValue` = posicao_organica (asc = topo primeiro); tooltip "posição orgânica na busca do ML (amostra)".
  - **Envio** — badge `FULL`, senão `FLEX`, senão `—`; badge `Globe` quando `internacional === true`; sublinha `frete grátis {frete_gratis_pct}%` (da ficha, Grupo A — entra aqui para não criar coluna própria).
  - **Preço** ganha sublinha de desconto ativo quando o principal tiver: `de {fmtBRL(preco_anterior)} · {desconto_pct}% OFF` (riscado no preço anterior; tooltip "desconto do anúncio na amostra Apify").
- **Teste:** unitário dos derivados já em T5; a página segue o padrão do projeto (sem teste de componente para PulseSonar — validação runtime na T11).
- **Pronto:** `pnpm lint` verde; com `vendas` undefined/`configurado:false` a tabela renderiza exatamente as colunas atuais.

### T7 — Filtros client-side (D13/D14) — DEPOIS do Grupo B: mín. vendas e nota mínima dependem do cruzamento
- **Arquivos:** `src/lib/sonar-filtros.ts` (novo), `src/lib/__tests__/sonar-filtros.test.ts` (novo), `src/pages/PulseSonar.tsx`.
- **Por que arquivo novo e não dentro de `sonar-cruzamento.ts`:** cruzamento produz o dado (casamento/derivados), filtro consome o dado pronto — responsabilidades e suítes de teste separadas; o cruzamento já vai ficar grande com T5.
- **Muda (lib pura):**
  - `interface FiltrosSonar { minVendas, minVisitas, maxVendedores, precoMin, precoMax, minNota: number | null; soFull, soComDesconto, esconderPatrocinados, esconderLojaOficial: boolean }` + `FILTROS_VAZIOS` (tudo null/false) + `temFiltroAtivo(f): boolean`.
  - `aplicarFiltros(fichas, vendasPorFicha: Map<string, VendasFicha | null>, filtros): { visiveis: Ficha[]; excluidasSemDado: number }` — filtro numérico ativo com campo `null` na ficha → EXCLUI e conta em `excluidasSemDado` (D14; null nunca vira 0); toggles: `soFull` exige `full === true`, `soComDesconto` exige `desconto_pct != null`, `esconderPatrocinados` remove `patrocinado === true`, `esconderLojaOficial` remove ficha com algum `vendedores[].loja_oficial` (API oficial, independe da Apify); faixa de preço compara com `preco.mediana`; `precoMin > precoMax` → resultado vazio, sem exceção. A ordenação NÃO é responsabilidade daqui: o resultado filtrado entra no `DataTable`, que ordena como hoje (`data-table.tsx:64-69`).
- **Muda (UI):** estado `useState<FiltrosSonar>` na página (D13 — sem URL/localStorage). Botão "Filtros" abrindo **`Popover` já existente em `src/components/ui/popover.tsx`** (não criar componente), com `Input` numéricos e `Switch` (`src/components/ui/switch.tsx`) para os toggles. Controles marcados † em D13 só renderizam com `vendas?.configurado === true` e `por_anuncio` presente. Acima da tabela, sempre visível: contador `X de Y fichas` + (quando `excluidasSemDado > 0` com filtro ativo) `· N sem esse dado` com tooltip + botão "Limpar filtros" quando `temFiltroAtivo`. **KPIs e `VereditoSonar` continuam recebendo o painel INTEIRO** (`PulseSonar.tsx:419-440`) — filtro só alcança as `rows` do `DataTable` (D14).
- **Testes (ANTES):** mínimo de vendas exclui ficha com `vendidos: null` e conta em `excluidasSemDado`; faixa invertida não lança e devolve vazio; toggles combinados (só FULL + esconder patrocinados); contador correto com múltiplos filtros; `aplicarFiltros(fichas, m, FILTROS_VAZIOS)` devolve todas com `excluidasSemDado: 0` (= "limpar restaura tudo"); `esconderLojaOficial` funciona sem dado da Apify.
- **Pronto:** `pnpm test` + `pnpm lint` verdes; sem filtro ativo a tabela é idêntica à de antes.

### T8 — UI Grupo A: mediana, espalhamento, top vendedor, badge oficial, visitas/oferta
- **Arquivo:** `src/pages/PulseSonar.tsx`.
- **Muda (colunas existentes, sem colunas novas):**
  - **Preço** (`:286-292`): linha 1 = `fmtBRL(preco.mediana)` (número principal e `sortValue` — trocar o sort de `min` para `mediana`, atualizar o comentário `:290`); sublinha = `min – max · +{espalhamentoPct}%`.
  - **Visitas (30d)** (`:294-299`): número + `<Sparkline dados={f.visitas_por_dia} />` + sublinha `≈ {visitasPorOferta}/oferta` com tooltip D7.
  - **Vendedores/UF** (`:300-309`): mantém contagem+UFs; sublinha `top: {fmtMilhar(transacoes_total)} vendas · {uf}` via `vendedorMaisForte`; badge `Oficial` quando algum `vendedores[].loja_oficial`.
- **Pronto:** `pnpm lint` verde; célula sem dado mostra `—`/omite sublinha (nunca `0`, nunca `NaN%`).

### T9 — Componente Sparkline
- **Arquivos:** `src/components/ui/sparkline.tsx` (novo).
- **Muda:** `<Sparkline dados={{data,total}[]} />` → `<svg>` ~80×20px com `<polyline>` normalizada; `dados.length < 2` → `null`; `aria-hidden` + cor `var(--primary)`. Se a normalização for extraída como fn, ganha teste junto do T5.
- **Pronto:** lint verde; render com série constante (divisão por zero na normalização) não quebra.

### T10 — Grupo C: sonda `date_created` + coluna condicional
- **Arquivos:** `supabase/functions/_shared/pulse/sonar.ts` (+ teste), `supabase/functions/pulse-sonar/index.ts`, `src/pages/PulseSonar.tsx` (diasDesde já feito em T5).
- **Muda:**
  - Parser puro `parseDateCreatedMultiget(json): Map<string, string>` em `sonar.ts` — envelopes `{code, body}` como `parseStatusAnuncios` (`parse.ts:89-108`); só `code === 200` com `body.date_created` string entram. Teste: lote misto 200/403, corpo sem date_created, json não-array.
  - No `pulse-sonar/index.ts`, após o loop de fichas (`:140-144`): se flag `sonar:items-multiget-403` ausente no Redis, montar ids = item mais barato de cada ficha com ofertas (mesmo item de `resolverVisitas`, `:40-45` — devolver o `item_id` escolhido junto do resultado ou recalcular), lotes de 20, `fetch` LOCAL com status inspecionado (D9). Status 403 (ou 200 com TODOS os envelopes 403) → `redisSet('sonar:items-multiget-403', '1', 24*60*60)` e `criado_em: null` em todas. Sucesso → `criado_em` por ficha. Qualquer outra falha (timeout, 5xx) → `null` SEM gravar flag (falha transitória não desliga a sonda).
  - `ResultadoFicha` ganha `criado_em: string | null`.
  - UI: coluna **Criação** só quando ≥1 ficha tem `criado_em != null`; célula `{diasDesde(...)} d` com `title` da data absoluta; `sortValue` = dias.
- **Pronto:** testes do parser verdes; com a flag setada a edge não faz nenhuma chamada extra; a coluna nunca aparece vazia inteira.

### T11 — Docs, verificação e entrega
- **Arquivos:** `docs/TASKS.md`, `docs/reference/edge-functions.md` (shapes novos das duas edges), `obsidian-vault/` se o índice de ADRs listar por número.
- **Verificação obrigatória (nesta ordem):** `pnpm test` → `pnpm lint` → `npx tsc -b --force` (CI reprova build incremental).
- **Deploy e validação:** ver seção 5.
- **Pronto:** checklist da seção 5 completo; docs no mesmo commit da entrega.

---

## 4. Riscos e mitigação

| Risco | Mitigação |
|---|---|
| **Custo Apify por bump de cache** | D2: sem bump — campo aditivo no v4. Custo forçado zero; termos cacheados ganham as colunas quando o TTL de 7d vencer. Trade-off explícito para o Diego: quer as colunas HOJE num termo já cacheado → deletar a chave do termo re-cobra US$0,10 pontual. |
| **Ficha sem anúncio na amostra da Apify** | `idProdutoCatalogo` vazio em 14/20 e a amostra é o top ~20 da busca por termo: fichas de cauda longa raramente casam (nem por item_id, nem por catálogo). A célula mostra "—" com tooltip — **isso é esperado, não bug**. O casamento primário por `idPublicacao ∈ item_ids` (20/20 do lado Apify) maximiza o que dá para casar. |
| **Ficha casa com anúncio errado** (janelas de cache 24h × 7d podem descasar: oferta que mudou de ficha) | Efeito é célula "—" ou vendas de oferta que saiu da ficha — aceitável para piso "pelo menos N". Registrado no tooltip ("amostra"). |
| **Latência do garimpo** | Grupo B: zero chamadas novas. Grupo C: 1-2 multigets (≤40 ids) por garimpo sem cache — ~1s no pior caso, dentro do stepper existente. Flag 403 zera isso quando a hipótese falhar. |
| **Payload cresce** | `por_anuncio`: ~20 entradas × ~200 bytes ≈ 4KB. `item_ids`: até ~100 ids/ficha em ficha muito disputada × 40 fichas ≈ 50KB no pior caso teórico; típico <5KB. Se o pior caso aparecer, cap de 30 ids/ficha (os 30 mais baratos) — decidir só se medir problema real. |
| **Filtro sobre amostra parcial da Apify esconde ficha boa que não casou** (mín. vendas/nota ativos excluem toda ficha sem anúncio na amostra) | É o comportamento correto de D14 (null nunca vira 0), mas precisa ser VISÍVEL: o contador "N sem esse dado" ao lado do "X de Y fichas" é a mitigação — o operador vê que foram excluídas por falta de dado, não por serem ruins. |
| **Sort da coluna Preço muda de min para mediana** | Mudança de comportamento visível; citada no ADR e no comentário do código. Reverter é 1 linha se o Diego preferir o piso. |
| **Cache v3 do sonar convive com v2** | Chaves antigas v2 morrem sozinhas no TTL 24h; nenhuma leitura cruzada. |

---

## 5. Ordem de deploy e verificação

1. **Testes/lint/build locais** (T11) — tudo verde antes de qualquer deploy.
2. **Deploy das edges ANTES do front** (mudanças aditivas: front atual ignora campos novos, seguro):
   `supabase link` no worktree (worktree novo nunca vem linkado) → `supabase functions deploy pulse-sonar pulse-sonar-vendas` → conferir versão nova no dashboard/CLI pós-deploy.
3. **Smoke das edges em produção** (curl com token de sessão): termo novo → resposta contém `por_anuncio` (chaveado por `idPublicacao`) e `item_ids`; termo cacheado v4 → resposta SEM `por_anuncio` e front não quebra.
4. **Validação runtime do front com Playwright** (skill `playwright-cli`, sessão própria — nunca o Chrome do Diego):
   - Conta VALIDATION; interceptar `POST */functions/v1/pulse-sonar` e `*/pulse-sonar-vendas` via `route` com fixtures espelhando o dataset REAL (inclusive: ficha que casa por `item_id`, ficha que casa por `catalog_product_id`, ficha sem casamento, `vendidos: null`, anúncio patrocinado, desconto ativo, `criado_em: null`) + `reload` (react-query serve cache sem isso).
   - Cenários: (a) fixture completa → todas as colunas; (b) `configurado:false` → colunas B ausentes E controles de filtro † ausentes; (c) resposta v4 sem `por_anuncio` → tabela renderiza as colunas atuais sem erro no console; (d) filtro ativo (mín. vendas + só FULL) → linhas reduzidas, contador "X de Y" e "N sem esse dado" corretos contra a fixture, KPIs/veredito INALTERADOS, "Limpar filtros" restaura tudo.
   - **Screenshot real de cada cenário** (snapshot de acessibilidade não pega bug de layout) + conferir overflow horizontal da tabela em viewport desktop.
5. **Merge:** branch → push → CI verde (`frontend`, `backend-lint`) → merge → deletar branch → remover worktree → `git pull` na main local. Push na main NÃO deploya edge — o passo 2 é obrigatório e independente.

---

## 6. O que NÃO fazer

- **NUNCA derivar vendas de visitas** (ADR-0120) nem preencher `vendidos` com heurística quando o casamento falhar.
- **NUNCA usar 0 no lugar de `null`** — célula sem dado é "—"; agregado sem dado não entra na conta; filtro numérico exclui `null` contando em "sem esse dado", nunca o trata como 0.
- **Filtro NUNCA alcança KPIs nem veredito** (D14) — eles falam do nicho inteiro; veredito que muda com filtro é número enganoso.
- **NUNCA somar `vendidos` de anúncios casados da mesma ficha** (D1) — soma de faixas arredondadas em amostra parcial é número inventado.
- **Não casar por link nem por vendedor** — medido: `zProdutoLink` só tem `MLBU…` e `vendedorID` vem vazio em 0/20. A chave é `idPublicacao`/`idProdutoCatalogo` (D4).
- **Não usar o campo `patrocinado` do actor** (vazio em 0/20) — a fonte é `tipoResultado`.
- **NUNCA re-rodar a Apify para backfill** de termos cacheados nem bump v4→v5 sem registro do custo (D2/ADR).
- **Não tocar `mlGet` compartilhado** (`_shared/ml/http.ts`) para a sonda — o coletor Pulse depende do contrato atual; o fetch com status é local à `pulse-sonar`.
- **Não cachear falha** (nem da Apify nem do multiget) — cache é global; erro transitório travaria o termo para todo mundo (padrão já em `pulse-sonar/index.ts:132-135`).
- **Não prometer a coluna Criação** em doc/UI antes da sonda provar que o multiget passa (D9).
- **Não anunciar "pronto" sem** `pnpm test` + `pnpm lint` + `npx tsc -b --force` + deploy das edges + validação Playwright com screenshot.
- **Não editar a main direto**; todo o trabalho nesta worktree/branch.
