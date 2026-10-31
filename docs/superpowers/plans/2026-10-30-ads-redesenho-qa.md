# QA visual do redesenho do /ads (Tasks 37, 38 e 39)

Data: 2026-10-31. Branch `worktree-ads-redesign-plano`. App local (`pnpm dev`, Vite 5173), sessão Playwright própria `adsqa`, conta VALIDATION (org DSA). Nenhum código foi alterado.

## O que foi real e o que foi injetado

- **Real:** login, módulo Ads habilitado na DSA, edge `ads-metricas` (conta), RPC `ads_painel`, vendas SKU (ml_vendas, catálogo). A DSA tem **R$ 0,00 de gasto em Ads** em 2026 (impressões e cliques 0; só vendas orgânicas), então o /ads real mostra zeros e "Indisponível" (print `real-ads-1280b.png`).
- **Injetado (`page.route`, fixtures realistas):** `ads-metricas` (escopos conta, campanhas, campanha, competitividade), `ads-campanhas`, RPC `ads_painel` (conta diária e 6 grupos) e `vendas_sku_codigos_mlbs`. Os MLBs e códigos dos grupos são os 8 de maior receita do `ml_vendas` real da DSA, então as famílias, nomes e lucro vêm de dados reais; os custos de Ads, receita Ads, campanhas e anúncios patrocinados são fictícios.
- **Cenários exercitados:** famílias "sem espaço para Ads", "dentro do equilíbrio", "sem referência" (grupo compartilhado + MLB sem cadastro), campanha removida, comparação provisória (conta, campanhas e anúncios), anúncio sem comparação (`anterior: null`), competitividade com `top_impression_share` indisponível.
- **Artefatos da fixture (não são bugs do app):** ROAS 4,20x, ACOS 23,8% e conversão 93% idênticos em todas as linhas; "Não publicado pelo PubliAI" nos produtos patrocinados (`publicadosPorFamilia: null`); ACOS direto de 20,0% em todas as famílias; só 1 família resultou "acima do equilíbrio".
- **Limite:** tela sem rolagem de página (o `main` rola por dentro), então as capturas "altas" usam viewport de 2300 a 3800 px de altura; as "dobra" usam o viewport real (1440×900, 1280×800 etc.).

Pasta dos prints: `/Users/diego/.claude/jobs/7b0b2175/tmp/qa/`

---

## Task 37: desktop (1440×900 e 1280×800, claro e escuro)

| Tela | Viewport | Tema | Print | Resultado |
|---|---|---|---|---|
| Desempenho (dobra) | 1440×900 | escuro | `desempenho-1440-escuro-dobra.png` | OK, ver P1/P2 |
| Desempenho (inteira) | 1440 alto | escuro | `desempenho-1440-escuro.png` | OK |
| Desempenho (dobra / inteira) | 1440×900 | claro | `desempenho-1440-claro-dobra.png`, `desempenho-1440-claro.png` | OK |
| Desempenho (dobra / inteira) | 1280×800 | escuro | `desempenho-1280-escuro-dobra.png`, `desempenho-1280-escuro.png` | OK |
| Desempenho (dobra / inteira) | 1280×800 | claro | `desempenho-1280-claro-dobra.png`, `desempenho-1280-claro.png` | OK |
| Campanhas | 1440 / 1280 | escuro / claro | `campanhas-{1440,1280}-{escuro,claro}.png` | OK, ver P6 |
| Detalhe da campanha | 1440 / 1280 | escuro / claro | `detalhe-{1440,1280}-{escuro,claro}.png` | OK, ver P4 |
| Detalhe com competitividade expandida | 1440 e 1280 | escuro; 1440 claro | `detalhe-competitividade-1440-escuro.png`, `detalhe-competitividade-1440-claro.png`, `detalhe-competitividade-1280-escuro.png` | OK |
| /ads real (sem gasto) | 1280×720 | escuro | `real-ads-1280b.png` | Estados "Indisponível" com motivo, sem zero presumido |

### Teste dos 5 segundos (1440×900 e 1280×800, primeira dobra, fixture)

| Pergunta | Imediato? | Observação |
|---|---|---|
| Investimento | Sim | Primeiro cartão, R$ 3.024,00, +11% |
| Receita Ads | Parcial | Só como linha secundária pequena do cartão "Vendas por Ads" ("R$ 12.700,80 em receita"); não é um indicador próprio |
| Resultado após Ads | **Não** | Fica abaixo do gráfico (cerca de 1150 px do topo), fora da primeira dobra nos dois tamanhos |
| Primeiro caminho de revisão | **Não** | "Ver famílias acima do equilíbrio" e a lista "Famílias por gasto" também só aparecem depois de rolar |
| "Está dando lucro?" | **Não** na dobra | A resposta (-R$ 2.126,36 parcial, em vermelho no card "Resultado parcial após Ads") exige rolar |

Veredito: o objetivo "entender em 5 s se o Ads dá lucro e onde agir" **não é atendido na primeira dobra**: a dobra mostra 10 KPIs de peso visual igual.

---

## Task 38: mobile e teclado

Viewports: 360×800, 390×844 (claro e escuro) e paisagem 800×360 e 844×390. Prints: `m-desempenho-{360x800,390x844}-{escuro,claro}[-dobra].png`, `m-campanhas-*.png`, `m-detalhe-{360x800-escuro,360x800-claro,390x844-claro,800x360-escuro}[-dobra].png`.

| Verificação | Resultado |
|---|---|
| Scroll horizontal da página (`documentElement.scrollWidth/clientWidth`) | **Passa** em todos: 360/360, 390/390, 800/800, 844/844; detalhe 360/360 (painel 359/359) |
| Overflow interno | 3 `span.flex items-center gap-1 text-sm text-muted` com `scrollWidth > clientWidth` (113>101, 131>119, 67>55) nos cartões de KPI; não gera scroll da página, mas indica texto apertado ou cortado (ver P7) |
| Alvos de toque ≥ 44 px (mobile 360/390) | **Falha** em vários (tabela abaixo). Botão "Ver campanha" 126×44 e seletor de período passam |
| Alvos em paisagem (800×360) | **Falha** em 61 controles no Desempenho (todos a 32 px: períodos, abas, Atualizar, "Ver campanha" 126×32); o breakpoint `sm` desliga a altura de toque |
| Período, motivo de indisponibilidade e resultado sem hover | **OK**: período e "Comparado com" são texto fixo; "Provisória", "Indisponível: há vendas sem custo cadastrado" e o resultado são texto visível, não tooltip. Os "O que é X" (i) dependem de toque/clique e têm só 38×38 |
| Detalhe abre e fecha no mobile | OK (sheet em tela cheia, 359 px); botão fechar 28×28 |
| Teclado (1440×900, claro e escuro) | Tab alcança "Ver campanha Moda Praia Verão" no 36º Tab (sem pular a sidebar do cabeçalho, mas passa por todos os "O que é" e linhas do ranking). Enter abre o detalhe; foco vai para dentro do painel; 6 Tabs seguidos ficam dentro (foco preso corretamente); Esc fecha |
| Retorno do foco após Esc | **Falha**: `document.activeElement` vira `BODY`, não o botão "Ver campanha" que abriu o painel (ver P3) |
| Foco visível | Anel existe mas é fraco: `outline: oklab(... / 0.5) 3px`, ou seja, indigo a 50% (cerca de 2:1 sobre branco, estimado a partir da cor computada; não medido por pixel). No botão ghost (">") da tabela quase não se vê (`teclado-foco-claro.png`, `teclado-foco-escuro.png`) |

Alvos < 44 px no mobile (360/390):

| Controle | Medida |
|---|---|
| "O que é <indicador>" (ícone i) | 38×38 |
| "Mostrar todos os indicadores" | 328×38 |
| Alternância do gráfico (Vendas atribuídas…, Investimento × Receita Ads) | 28 de altura |
| "Ver dados em tabela", "Ver competitividade" | 28 de altura |
| Linhas do ranking de famílias (botão de nome) | 40 (uma linha com 20 de altura) |
| Filtro "Status" (Campanhas) | 32 de altura (o código declara `h-11 sm:h-8`, mas a medição deu 32) |
| Abas Desempenho / Campanhas, "Resultado / Eficiência" | 40 |
| "Ordenar anúncios por" (detalhe) | 32 |
| Fechar o painel | 28×28 |

---

## Task 39: contraste, movimento e preflight

Medição renderizada (getComputedStyle, composição do fundo, razão WCAG; texto normal 4,5:1, grande 3:1), tela Desempenho, Campanhas e detalhe, 1440 px. Só estão listados os pares abaixo de 4,5:1 (os demais textos de KPI, deltas e legendas passaram com folga).

| Elemento | Tema | Razão | Mínimo | Resultado |
|---|---|---|---|---|
| Botão selecionado "Mês atual" (texto branco sobre indigo) | escuro | 3,38 | 4,5 (14 px) | **Falha** |
| Botão selecionado "Vendas atribuídas × Outras vendas + ROAS" (12 px) | escuro | 3,38 | 4,5 | **Falha** |
| Pill "ACOS-alvo acima do equilíbrio" (detalhe) | escuro | 4,30 | 4,5 | **Falha** (quase) |
| Pill "Dentro do equilíbrio" (3 linhas) | claro | 4,39 | 4,5 | **Falha** (quase) |
| Pill "Sem espaço para Ads" | claro | 4,40 | 4,5 | **Falha** (quase) |
| Pill "Provisória" (12 px, variante da faixa de contexto) | claro | 4,45 | 4,5 | **Falha** (quase) |
| Pills "Ativa" / "Pausada" na tabela de campanhas | claro | 4,39 / 4,45 | 4,5 | **Falha** (quase) |
| Pill "Provisória" nos KPIs (11 px) | claro | 4,98 | 4,5 | Passa |
| "Mês atual", legendas do gráfico, "Todas", "provisório — N dias" | claro | 4,51 a 4,95 | 4,5 | Passa (margem estreita) |
| Gráficos (barras, linha de ROAS, hachura) | ambos | não medido por razão | 3:1 | Revisão visual: barras e linha distinguíveis nos dois temas; a faixa hachurada "atribuição em aberto" é discreta no escuro |

Observação: o escuro mostrou menos pares críticos que o claro, mas os botões ativos em indigo reprovam nele. Os dois temas foram medidos com o mesmo script; a composição de fundos translúcidos é aproximada (±0,1).

Movimento reduzido (`prefers-reduced-motion: reduce`): **passa**. Com `no-preference` há transições de 0,15 a 0,2 s e nenhuma animação em `main`; com `reduce` a lista de transições ativas fica vazia.

### Preflights (`src/components/ads` e `src/pages/Ads.tsx`, `--allow-lucide`, 27 arquivos)

| Skill | Resultado | Avaliação |
|---|---|---|
| frontend-design-fable5 | 1 FAIL, 1 WARN | FAIL "travessão (— ou –)": **falso positivo na maior parte**. Ocorrências são o placeholder de valor ausente `—` (convenção do produto, com texto para leitor de tela), comentários de código e testes, e faixas "01–07/10". **Uma ocorrência é texto visível de verdade**: `resumo-conta.tsx:210` ("provisório — N dias com atribuição em aberto"); cosmético, e o texto é obrigatório, então não alterar sem decisão do Diego. WARN `border-t + border-b`: falso positivo (3 usos de `border-t` em bloco expandido, sem linha sob cada linha) |
| ui-ux-pro-max-fable5 | idêntico (1 FAIL, 1 WARN) | Mesma avaliação |

---

## Problemas encontrados

Gravidade: **bloqueia** (nenhum), **deve corrigir**, cosmético.

| # | Gravidade | Problema | Tela / viewport / tema | Print | Arquivo provável |
|---|---|---|---|---|---|
| P1 | deve corrigir | "Resultado após Ads" e o caminho de revisão ("Ver famílias acima do equilíbrio", ranking) ficam abaixo do gráfico, fora da primeira dobra; os 10 KPIs têm peso igual e nada responde "está dando lucro?" nos primeiros 5 s | Desempenho, 1440×900 e 1280×800, ambos | `desempenho-1440-claro-dobra.png`, `desempenho-1280-claro-dobra.png` | `src/pages/Ads.tsx`, `src/components/ads/faixa-kpis.tsx`, `resumo-conta.tsx` |
| P2 | deve corrigir | Receita Ads só aparece como linha secundária pequena em "Vendas por Ads"; não é um indicador com destaque | Desempenho, todos | `desempenho-1440-escuro-dobra.png` | `src/components/ads/faixa-kpis.tsx` |
| P3 | deve corrigir | Após Esc, o foco volta para `BODY` em vez do botão "Ver campanha" que abriu o painel | Campanhas/detalhe, 1440, ambos | `teclado-detalhe-claro.png` | `src/components/ads/campanhas/detalhe-campanha.tsx`, `tabela-campanhas.tsx` (Sheet sem gatilho Radix) |
| P4 | deve corrigir | Anel de foco fraco (indigo a 50%, ~2:1) em botões ghost como ">" da tabela de campanhas | Campanhas, 1440, ambos | `teclado-foco-claro.png`, `teclado-foco-escuro.png` | `src/components/ui/button.tsx` |
| P5 | deve corrigir | Contraste: texto branco sobre indigo dos botões selecionados no escuro 3,38:1 (exigido 4,5:1); pills 4,30 a 4,45:1 no claro e no escuro (Dentro do equilíbrio, Sem espaço para Ads, Ativa, Pausada, Provisória 12 px, ACOS-alvo acima do equilíbrio) | Desempenho/Campanhas/Detalhe, 1440 | `desempenho-1440-escuro-dobra.png`, `desempenho-1440-claro.png`, `campanhas-1440-claro.png` | `src/components/ui/status-pill.tsx`, `src/components/ads/periodo-ads.tsx` e `serie-diaria.tsx` (botões ativos), tokens de cor |
| P6 | deve corrigir | Alvos de toque < 44 px no mobile: ícones "O que é" 38×38, "Mostrar todos os indicadores" 38, alternância do gráfico 28, "Ver dados em tabela" e "Ver competitividade" 28, linhas do ranking 20 a 40, filtro Status 32, ordenar anúncios 32, fechar painel 28×28, abas 40 | Desempenho/Campanhas/Detalhe, 360×800 e 390×844 | `m-desempenho-360x800-escuro.png`, `m-detalhe-360x800-claro.png` | `faixa-kpis.tsx`, `serie-diaria.tsx`, `ranking-familias.tsx`, `campanhas/tabela-campanhas.tsx`, `campanhas/detalhe-campanha.tsx`, `src/components/ui/sheet.tsx` |
| P7 | deve corrigir | Paisagem de celular (800×360, 844×390) usa o dimensionamento desktop (`sm:`): 61 controles a 32 px | Desempenho/Campanhas, paisagem | `m-detalhe-800x360-escuro-dobra.png` | classes `h-11 sm:h-8` em vários componentes (usar `pointer-coarse:` ou breakpoint por altura) |
| P8 | cosmético | Valor em moeda quebra em duas linhas nos cartões estreitos ("R$" / "3.024,00") no mobile e no painel de detalhe a 1440; "R$ 2.540,16" quebra na tabela de anúncios | KPI mobile 360/390; detalhe 1440 | `m-desempenho-360x800-escuro.png`, `detalhe-1440-claro.png` | `faixa-kpis.tsx`, `detalhe-campanha.tsx` (usar `whitespace-nowrap` e reduzir fonte) |
| P9 | cosmético | Spans de rodapé do KPI com `scrollWidth > clientWidth` (texto apertado em 360/390) | Desempenho, 360/390 | `m-desempenho-390x844-claro.png` | `faixa-kpis.tsx` |
| P10 | cosmético | "Provisória" repetido em todos os 10 KPIs e em cada célula de campanha/anúncio: ruído; um aviso por bloco bastaria | Desempenho/Campanhas | `campanhas-1440-escuro.png` | `faixa-kpis.tsx`, `tabela-campanhas.tsx` |
| P11 | cosmético | 36 Tabs até a primeira campanha (percorre ícones "O que é" e todas as linhas do ranking); sem atalho de pulo | Campanhas, 1440 | `teclado-foco-claro.png` | `Ads.tsx` (ordem de foco) |
| P12 | cosmético | Texto visível com travessão "provisório — N dias…" (regra do projeto de pontuação); texto obrigatório, decisão do Diego | Desempenho, resultado da conta | `desempenho-1440-claro.png` | `src/components/ads/resumo-conta.tsx:210` |
| P13 | cosmético | Dado real sem gasto: com Ads zerado os 10 cartões viram "R$ 0,00" / "Indisponível" com o mesmo peso; não há estado "sem anúncios patrocinados" que oriente (ex.: ir para Campanhas) | /ads real, DSA | `real-ads-1280b.png` | `Ads.tsx`, `faixa-kpis.tsx` |

## Rastreabilidade

- Medições brutas: `mobile.out`, `mobile2.out` e `contraste.out` na pasta de prints. Scripts e fixtures foram apagados ao final.
- Dev server e sessão Playwright `adsqa` encerrados.

## Correções (2026-10-31, commit "fix(ads): resultado na primeira dobra, foco, contraste e alvos de toque")

| # | Situação | Como |
|---|---|---|
| P1 | corrigido | `LinhaResultado` (resumo-conta.tsx) acima de "Conta inteira" nas duas abas; mesma derivação do painel (`derivarResultado`), cor só com custo real; atalho "Ver famílias acima do equilíbrio" só em Desempenho, filtra e rola até o ranking (o botão duplicado do ResumoConta saiu de Desempenho). Ordem KPIs, gráfico, resultado mantida |
| P2 | corrigido | "R$ X em receita" em `text-sm font-medium text-foreground` |
| P3 | corrigido | `aba-campanhas.tsx` guarda o botão de origem e o refoca após o Radix fechar |
| P4 | corrigido | `TELA_ADS` (tela-ads.ts) na raiz de Ads e no Sheet: anel de 2 px `--ring` + respiro de 2 px; `button.tsx` intacto. Medido: anel indigo oklch(0.55 0.2 277) sobre respiro claro |
| P5 | corrigido | selecionado no escuro usa `oklch(0.55 0.2 277)` (`ATIVO_ESCURO`): 5,17:1 medido; pills: texto tonal misturado a 30% do foreground via `TELA_ADS` (Provisória 6,99 claro / 9,35 escuro; fundo composto aproximado) |
| P6/P7 | corrigido | `max-sm:` (tela estreita) + `pointer-coarse:` (toque, inclusive paisagem), no lugar de `h-11 sm:h-8`. `pointer-coarse:` existe no Tailwind 4.3. SelectTrigger precisa de `data-[size=default]:` (o `data-[size=default]:h-8` do componente vencia o `h-11`, origem dos 32 px). Fechar do Sheet próprio (44 px em toque); ícone "O que é" vai a 44 px em toque por `TELA_ADS`. Medido em 800x360 e 360x800 com toque: nenhum controle < 44 px em `main` |
| P12 | corrigido | "provisório: N dias com atribuição em aberto" |

Deixados (custo/benefício): P8 e P9 (quebra de moeda e rodapé apertado do KPI no mobile), P10 ("Provisória" repetida), P11 (atalho de pulo do foco), P13 (estado "sem anúncios patrocinados"). Também não ampliados: botões de ordenar colunas das tabelas (visíveis só em lg+) e o link de nome do ranking.

Verificação visual: dados reais da DSA (sem gasto), porque as fixtures do QA foram apagadas; prints `fix-*.png` na pasta de prints. Pills no escuro e o atalho em tela não foram vistos com a fixture rica; coberto por teste e por medição.

### Round 1 da revisão (2026-10-31)

Fixtures reproduzíveis agora no repositório: `tests/fixtures/ads-qa/` (`instalar-rotas.js`, `capturas.js`, `capturas-toque.js`; instruções no cabeçalho). Dados: vendas e catálogo reais da DSA; Ads (conta diária, 6 grupos, 2 campanhas, MLBs) fictícios. Artefatos da fixture, não bugs do app: "Composição da conta divergente" (grupos somam mais que a conta) e conversão 0,0%.

| Achado | Resultado |
|---|---|
| 1. Link da família no cartão mobile (~40 px) | Corrigido: link `inline-flex` com `min-h-11` em tela estreita e em toque (`ranking-familias.tsx`). Com a fixture, em 360x800 e 800x360 com `hasTouch` real (`pointer: coarse` = true), Desempenho e Campanhas: 0 controles abaixo de 44 px. Também zerou o ícone "O que é" no 360 sem toque (regra `max-sm:` acrescentada em `TELA_ADS`) |
| 2. Contraste do gráfico | Medido (marca vs fundo do card, claro/escuro). Texto (eixos, legendas, notas) 5,25 a 7,36 (>= 4,5). Barras "Vendas atribuídas" 4,91/5,37; linha de ROAS 16,8; hachura 5,25/7,36 (>= 3). **Falhou:** "Outras vendas" (`--chart-3`) 2,40 no claro, e a borda do marcador da hachura 2,43/3,39 (60% de alfa). Corrigido só em `serie-diaria.tsx`: `color-mix(chart-3, foreground 25%)` (3,97 claro, 9,74 escuro) e borda sem alfa (5,25/7,36). O ícone "O que é" (muted a 60%, 2,43/3,39) é do KpiCard global, não do gráfico: fora de escopo, registrado |
| 3. Reteste com dados | Refeito com a fixture: 1440x900 claro/escuro com o atalho visível (1 botão) e funcionando (filtro "Acima do equilíbrio" aplicado, 1 família); pills no escuro com dados: Provisória 9,35, selo 7,21, Acima do equilíbrio 6,02, Dentro do equilíbrio 6,70; selecionado no escuro 5,17; mobile 360x800 e paisagem 800x360 |
| 4. Teste de Campanhas | Corrigido em `tests/pages/Ads.test.tsx`: aba pelo argumento certo (`'campanhas'`), família acima do equilíbrio na fixture, afirma a aba ativa; o teste do atalho agora também verifica o filtro aplicado e as linhas filtradas |
| Minor 5 (pontuação "provisório: N dias") | Mantido como está por decisão do controlador: o texto não está na lista obrigatória da seção 4.9 |
