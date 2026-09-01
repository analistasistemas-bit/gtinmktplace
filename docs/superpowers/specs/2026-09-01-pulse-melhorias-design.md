# Análise do menu Pulse (Radar + Sonar) — produto e design de UI

Data: 2026-09-01 · Escopo: leitura de código, docs e ADRs **+ validação em runtime** (produção, sessão Playwright isolada com a conta VALIDATION, que está na org com Pulse ligado — 13 produtos, 450 ofertas, 9 alertas de Ação reais). Radar/Detalhe/Alertas renderizados com dados reais; Sonar renderizado com resposta **injetada** (rotas mock nos 4 endpoints — nenhum run Apify pago, nenhum clique mutador). Screenshots em `/Users/diego/.claude/jobs/5e9166a3/tmp/shots/`. Seção "Validação em runtime" abaixo marca cada ponto como confirmado/refutado/não verificável.
Caminhos relativos a `/Users/diego/Desktop/IA/Anuncios MktPlace/`.

---

## Resumo executivo

O Pulse vigia o preço dos anúncios de catálogo que a org já vende (Radar), prospecta um nicho pelo termo/EAN antes de cadastrar (Sonar) e transforma movimento de mercado em alertas de Ação/Informativo. Os elogios têm causa verificável: regra LOUD aplicada com disciplina (nenhum número financeiro é presumido — `pulse-margem.ts:146`, `sonar-dre.tsx:214`), cada `—` explica o motivo em tooltip (`pulse-formato.ts:19-45`), KPI e lista saem da mesma função (`pulse-filtros.ts:85`), e o Sonar entrega um veredito em linguagem de comerciante com "Saiba mais" auditável (`veredito-sonar.tsx`). É raro em SaaS B2B pequeno.

As três melhorias de maior impacto: (1) **o Radar não diz o que fazer**: a tabela abre ordenada por "Sua posição", mas não há "quanto sobra" nem "reprecificar" na linha — decisão só a 2 cliques e 1 dialog de 7xl; (2) **o Sonar empilha 6 blocos e 2 simuladores de margem com bases diferentes** (markup no dialog, margem sobre venda na DRE) — em demo é o ponto onde a plateia se perde; (3) **os alertas não têm data** e o Radar não mostra tendência na lista — o operador não consegue priorizar "o que mudou desde ontem" sem abrir cada produto.

---

## Radar — informações

### O que a lista mostra e de onde vem cada número

| Coluna (`tabela-radar.tsx`) | Fonte | Observação |
|---|---|---|
| Produto + EAN + selo (Sem estoque / Pausado no ML / Fora do ar) + "coleta há Nd" se > 48h | `pulse_produtos.titulo/gtin/anuncio_status/anuncio_sub_status/ultimo_snapshot_em` (`:64-93`) | selo via `seloAnuncio` (`pulse-formato.ts:53`) |
| Seu preço | `meu_preco` lido do ML na coleta (`:100-114`) | `—` com tooltip por `motivoSemPrecoProprio` |
| Menor relevante | `resumoOfertas.menorRelevante` — mínimo entre ofertas **qualificadas** (`qualificacao.ts:22-30`: ≥10 transações, visitas 30d ≠ 0, reputação ≠ vermelha/laranja) | **Não** é o menor preço da ficha |
| Sua posição | `posicaoVsMercado` (`pulse-formato.ts:137`): Δ% vs menor relevante; `<0,5%` = Empatado; `≥15%` = risco | badge com tom |
| Ofertas | `nOfertas` — todas as observadas, inclusive não relevantes (`:145-151`) | oculto abaixo de `md` |
| Análise PubliAI | `disputaCatalogo` (`pulse-formato.ts:179`): N relevantes, faixa min–max, "seu preço ficaria em Xº de N+1" | oculto abaixo de `xl` (`:160`) |

KPIs do topo (`Pulse.tsx:210-249`): No radar / Mais caro que o mercado (`Δ>0,5%`) / Você é o menor preço (`Δ<-0,5%`) / Sem vínculo de catálogo. Todos derivam de `contarPulse` — clicar num "12" devolve 12 linhas. Telemetria (`:167-185`): itens, ofertas observadas, relevantes, última leitura.

Detalhe (`dialog-detalhe.tsx`): bloco de decisão (seu preço / menor relevante + menor observado / posição), aviso de ofertas abaixo da referência (`:480-496`), simulador de margem (`:498-573`), sparkline de 14 dias (`:577-588`), tabela de concorrentes com 10 colunas (`:215-405`).

### O que confunde, falta ou é redundante

1. **"Ofertas" e "Análise PubliAI" contam populações diferentes sem dizer.** "Ofertas" é `nOfertas` (todas); a coluna ao lado diz "3 anúncios relevantes disputam". Na mesma linha, 9 e 3 sem legenda. O operador lê como contradição. `tabela-radar.tsx:145-193`.
2. **Coluna "Sua posição" compara com o menor *relevante*, mas o comprador vê o menor *observado*.** A distinção está correta por ADR (régua de relevância, ver "Não mudar"), mas a lista não a expõe: só o detalhe mostra "Menor oferta observada" (`dialog-detalhe.tsx:458-462`) e o aviso amarelo "N ofertas ativas abaixo da sua referência" (`:480`). Um gerente que sabe que existe alguém a R$ 36 quando o Radar diz "você é o menor" perde confiança na tela. Falta na lista um marcador discreto (ex.: "· 2 abaixo, não relevantes") que já existe calculado em `ofertasAbaixoDaReferencia` (`pulse-margem.ts:231`).
3. **Nenhuma coluna responde "quanto sobra".** A margem só aparece no simulador do detalhe. A pergunta 3 do how-to ("até onde posso baixar") não tem resposta na lista, e a fila de trabalho ordena por Δ% sem saber se o produto tem margem para reagir. Os insumos (`comissao_pct`, `comissao_fixa`, `ptw_custos.frete`) já vêm em `PulseProduto`; falta só `custo` + alíquota, hoje buscados por produto em `fetchContextoMargem` (`dialog-detalhe.tsx:148-152`). Um "Sobra hoje" na linha (ou ao menos "margem ≤ 0" em vermelho) transformaria a lista em fila de decisão.
4. **Sem tendência na lista.** O sparkline existe só no detalhe (`dialog-detalhe.tsx:51-72`). "Menor relevante caiu 8% em 7 dias" é a leitura que um comprador quer antes de abrir — o dado (`pulse_ofertas` por dia) já é consultado no detalhe; na lista exigiria um agregado por produto.
5. **"Análise PubliAI" como nome de coluna promete mais do que entrega.** O conteúdo são três fatos (quantos, faixa, posição hipotética) — o nome sugere IA/veredito. Chamar de "Disputa do catálogo" (que é o termo do ADR-0147) alinha com o que está lá.
6. **KPI "Você é o menor preço" é sempre verde, inclusive em 0** (`Pulse.tsx:235` `tom="success"` fixo, enquanto "Mais caro" alterna warning/success em `:225`). Zero em "menor preço" não é bom nem ruim; verde com 0 lê como parabéns por nada.
7. **Telemetria "ofertas observadas / relevantes" no cabeçalho não tem ação** (`Pulse.tsx:179-180`). São números de vaidade — em demo até ajudam ("o motor viu 412 ofertas"), mas não são clicáveis nem explicados; o "i" existe só nos KpiCards.
8. **Sem coluna/tooltip de "quando meu preço foi lido"** (`meu_preco_em` existe no tipo, usado só em `motivoSemPrecoProprio`). "Seu preço R$ 79,90" pode ter 6h de defasagem sem o operador saber, enquanto o aviso "coleta há Nd" só dispara acima de 48h (`tabela-radar.tsx:88`).
9. **Detalhe — tabela de concorrentes tem 10 colunas num dialog `sm:max-w-7xl`** (`dialog-detalhe.tsx:410`): Preço, Vendedor, Qualificação (badge + motivos), Reputação (details expansível), MercadoLíder, Estado, Porte, Visitas 30d, Anúncio, Oferta. "Reputação" e "MercadoLíder" são duas colunas para o mesmo conceito (cor da reputação × selo de líder); "Qualificação" repete os motivos em texto embaixo do badge. Para um comprador, 5 colunas bastam: Preço · Vendedor (com selos) · Porte · Visitas · Envio/Abrir.
10. **Simulador: "Sobra para você" mostra `(comissão R$ x)` ao lado do rótulo** e as outras 3 parcelas só no `title` (`dialog-detalhe.tsx:516-528`). Tooltip não funciona em touch e some em demo projetada. A decomposição (comissão/frete/imposto/custo) merece 4 números visíveis — é o que a DRE do Sonar já faz em tabela (`sonar-dre.tsx:77-87`); reaproveitar o padrão.
11. **Alertas sem data/hora.** `criado_em` só é usado para "marcar todos" (`aba-alertas.tsx:114`); a linha renderiza texto + botões (`:231-270`). "Menor preço de X caiu de A para B" sem "há 3h" não permite priorizar nem saber se já foi reagido. `textoAlerta` (`pulse-alerta-texto.ts:5`) também não diz o % da queda — "caiu de R$ 49,90 para R$ 47,90" obriga a conta mental; "-4%" ao lado é uma linha.
12. **How-to desatualizado em relação à UI.** `docs/how-to/usar-o-pulse.md` §3 documenta as colunas "Menor concorrente" e "Referência do ML" (com 4 selos), mas a UI tem "Menor relevante" e "Análise PubliAI" (ADR-0147 D-24 substituiu a referência). §5 fala em "Vendas na conta / ≈N no período", mas a coluna virou "Porte do vendedor" (média mensal 12m, ADR-0146). Se um cliente ler o guia após a demo, verá outra tela. `docs/project-status.md` também para de registrar Pulse/Sonar em 28/08 — antes do abandono do JoomPulse, do ADR-0147 e das erratas mais recentes.

### O que um comprador/gerente de e-commerce sentiria falta

- Uma fila explícita: "3 produtos precisam de decisão hoje" com preço sugerido e margem resultante, em vez de 4 KPIs + tabela.
- Histórico de preço próprio vs. menor relevante (duas linhas no sparkline, não uma).
- Exportar/compartilhar (CSV ou link) — inexistente em Radar e Sonar.
- Agrupamento por categoria ou fornecedor (`FORNECEDOR` existe na planilha; o Radar só filtra por busca/status/foco — `pulse-filtros.ts:18-22`).
- Cobertura: 89% dos anúncios da Avil ficam fora do radar (how-to, aviso do topo). A tela não diz "X dos seus anúncios publicados não são vigiados" — o cliente descobre pela ausência.

---

## Radar — design/UX

**Hierarquia.** Header com gradiente + BorderTrail animado no "Atualizar agora" (`Pulse.tsx:148-187`), 4 KPIs compactos, filtros, tabela. Boa cadência de cima para baixo. Porém o header em card decorado + subtítulo de marketing ("Inteligência de mercado para detectar movimentos, priorizar decisões e proteger sua margem", `:153`) é o único do app com esse tratamento? Se sim, é intencional para demo; se não, fere consistência com `PageHeader` das outras páginas.

**Densidade.** A lista é plana: `DataTable` não pagina nem virtualiza (`data-table.tsx`, sem `slice`/página), e o Radar já tem ~229 catálogos (`docs/TASKS.md:1337` registra o risco de truncamento do PostgREST). A ordenação padrão por "Sua posição desc" joga os `—` (sem comparação) para o fim, mas ainda são 229 linhas para rolar; sem agrupamento nem "top 20 que exigem ação". Lista com 6 colunas em `xl`, 4 em `<md`. A coluna "Análise PubliAI" é texto de 3 linhas (`tabela-radar.tsx:171-190`) numa tabela de linhas de 1–2 — quebra o ritmo vertical; a linha fica com altura variável dependendo de haver preço próprio. Merece virar badge + tooltip, ou coluna própria de largura fixa.

**Cores/semáforo.** `classeTom` (`pulse-formato.ts:151`) usa success/warning/destructive com fundo 10% — consistente com o restante (shadcn tokens). Tom "risco" só a partir de +15% (`:146`) — ver "Não mudar". Badge de status "Fora do ar" em `risco` e "Sem estoque" em `atencao` — correto. Em contraste, a KpiCard "Sem vínculo de catálogo" usa ícone `Bell` (`Pulse.tsx:243`) — sino é o ícone dos Alertas na aba ao lado; ícone errado para "vínculo".

**Estados.** Bem cobertos: loading skeleton (`Pulse.tsx:296-299`), erro com retry e sem disfarce de vazio (`:300-311`), vazio inicial com CTA (`:313-318`), vazio por filtro (`:319-327`), skeleton por célula enquanto o resumo carrega (`tabela-radar.tsx:40-41`). Falta: estado de "coleta em andamento" na tabela quando `atualizar.isPending` — hoje só o botão e o texto do header mudam; a tabela fica com dados velhos sem indicação por linha.

**Responsividade.** `DataTable` tem `overflow-x-auto` (`data-table.tsx:79`). Colunas somem por breakpoint (`hidden md:table-cell`, `hidden xl:table-cell`) — em tablet o operador perde "Ofertas" e a análise sem saber que existem. KPIs em `grid-cols-2 sm:grid-cols-4` ok. Dialog do detalhe `sm:max-w-7xl` com tabela de 10 colunas e `stickyRight` na última — em 1440 cabe (medido: 1246 px em 1280 px de dialog, só scroll vertical); em 820 o dialog **estoura horizontalmente** e corta conteúdo sem barra (ver "Validação em runtime").

**Acessibilidade.** Acima da média: `aria-label` nos botões de linha (`tabela-radar.tsx:203`), `role="group"`/`aria-pressed` nos filtros de severidade com justificativa (`aba-alertas.tsx:162-189`), `sr-only` no cabeçalho de ações, `aria-label` no sparkline (`dialog-detalhe.tsx:64`), `<details>` com teclado (`:103-112`). Lacuna: informação transmitida só por `title` (motivo do `—`, decomposição da margem, "Envia de UF") — invisível em touch e para leitor de tela que não lê `title`.

**Consistência.** Usa KpiCard, DataTable, EmptyState, Badge, Dialog — os mesmos do resto. Inconsistências pequenas: o filtro Ação/Info/Todos replica visual de Tabs com botões (`aba-alertas.tsx:170-190`, decisão justificada por a11y) — fica visualmente idêntico a uma segunda barra de abas logo abaixo da primeira (Radar/Sonar/Alertas). Duas linhas de abas empilhadas é o padrão que confunde em demo.

---

## Sonar — informações

### O que mostra e de onde vem

Fluxo (`PulseSonar.tsx:342-827`): campo único termo/EAN → stepper temporizado (4 etapas, 2,5s cada, `sonar.ts:143-172`) → resultado empilhado nesta ordem:

1. **Cruzamento EAN** (só GTIN): "Você já vende: …" / "Já está no seu Radar" / "Produto novo" (`:197-220`). Fonte: `variacoes.gtin` local + `catalog_product_id` da amostra.
2. **Veredito** (`veredito-sonar.tsx`): título `<Demanda> · <Barreira>` (`veredito-sonar.ts:179`), chip com o número da barreira, 2–3 fatores (Demanda, Concorrência, Faturamento por concorrente) com ícone/tom, resumo em frase, alerta de Marca fora da conta, "Insights do nicho" (condição de entrada + pódio de rivais por faturamento e por visitas), "Saiba mais" com pontuação, réguas e contexto. Cortes: `DEMANDA` (`:104`), `DISPUTA_B` (`:438`), `TRACAO_V2` (`:439`), `MARCA` (`:105`).
3. **Vendas do nicho** (`PulseSonar.tsx:103-181`): KPIs "Vendas acumuladas ≈ N unidades", "Mercado endereçável ≈ R$", "Produto destaque"; Raio-X (ticket médio, lojas oficiais, Full, frete grátis, internacionais, total de anúncios); nuvem de palavras-chave. Fonte: amostra Apify de 20 anúncios (US$ 0,10/run, cache 7 dias).
4. **Análise PubliAI — demanda por vendedor** (`sonar-analise-publiai.tsx`): "Concorrentes vendendo mais que há um ano X de Y", "Média mensal por vendedor (12 meses)", linhas de cobertura, top vendedor %, duas notas de limitação. Fonte: `pulse_vendedores` (loja inteira).
5. **DRE "6. Dá lucro?"** (`sonar-dre.tsx`): inputs custo/origem/margem-alvo/qtd + 4 campos de pacote; tabela de 5 cenários (mais barato, equilíbrio, médio, que mais vende, preço-alvo) com comissão/frete/imposto/custo/lucro/margem; bloco de peso; bloco do lote.
6. **Filtros + tabela de 20 anúncios** (`:505-639`): #, Anúncio (imagem, selo, Catálogo), Preço (+ de/desconto), Vendidos, Faturamento, Avaliação, Visitas (+ sparkline), Envio, ações Simular/Abrir.
7. **Dialog "Simular margem"** por anúncio (`dialog-margem-sonar.tsx`): custo hipotético + origem + preço-alvo → Clássico/Premium com "Você recebe" e "Margem sobre o custo (markup)".

### O que confunde, falta ou é redundante

1. **Dois simuladores de margem com bases diferentes na mesma tela.** O dialog calcula `margemPct = liquido / custo` (`sonar.ts:266`, rótulo "markup"); a DRE calcula `lucro / precoVenda` (`calculadora-ml.ts:179`, coluna "Margem s/ venda") e ainda mostra "markup líquido" no bloco do lote (`sonar-dre.tsx:389`). O Radar usa `liquido / preco` (`pulse-margem.ts:148`) chamado de "Sobra para você (%)". Três rótulos, duas bases, símbolo `%` igual. O dialog ainda diz "frete não estimado — margem otimista" (`dialog-margem-sonar.tsx:52-56`) porque não pede dimensões, enquanto a DRE recusa calcular sem elas (`sonar-dre.tsx:214-219`) — a mesma pergunta recebe resposta diferente dependendo do botão. O dialog "Simular" deveria abrir a DRE com a âncora trocada (o comentário em `PulseSonar.tsx:788` já registra "seletor de âncora fica para a fatia seguinte").
2. **Numeração órfã: "6. Dá lucro?"** (`sonar-dre.tsx:232`) é o único bloco numerado na tela; as seções 2/3/7 do relatório (ADR-0141) aparecem sem número em "Análise PubliAI". O operador procura 1–5 e não acha. Contexto: a numeração e o nome "Análise PubliAI" vêm do plano de 28 decisões do ADR-0141, desenhado sobre o JoomPulse — fonte **abandonada em 29/08** (ADR-0132) e substituída por Apify + API ML + série própria (ADR-0141 Errata 1, status "em revisão"). O que sobrou na tela é o esqueleto de um relatório que não existe mais; vale renomear os blocos pelo que respondem ("Quem vende neste nicho", "Dá lucro?") em vez do número da seção.
3. **Redundância entre Veredito e Vendas do nicho.** O fator Demanda diz "X% dos anúncios vendem" (`veredito-sonar.ts:115`); o KPI logo abaixo repete "N de 20 anúncios com o dado" (`PulseSonar.tsx:124`). O pódio "Quem mais fatura" (veredito) repete "Produto destaque" (vendas). "Ticket médio" está no Raio-X e no "Contexto do nicho" do Saiba mais (`veredito-sonar.ts:909`). Três lugares para o mesmo número, sem um "ver mais" que ligue um ao outro.
4. **Sonar não repete o termo buscado na tela de resultado** (comentário em `PulseSonar.tsx:484-485` confirma). Com EAN o campo é limpo — o resultado fica sem título. Em demo, ao rolar, ninguém sabe mais o que está sendo analisado. Um `h2` "Nicho: tecido oxford 10 metros · amostra de 20 · coletado há 2 dias" resolve e ainda expõe a idade do cache (7 dias, hoje invisível).
5. **KPIs do Sonar não têm "i".** `kpi-descriptions.ts` cobre os 4 KPIs do Radar e nenhum dos 4 do Sonar ("Vendas acumuladas", "Mercado endereçável", "Concorrentes vendendo mais que há um ano", "Média mensal por vendedor") — `KpiInfoButton` retorna `null` sem descrição (`kpi-card.tsx:48`). "Mercado endereçável" é o número mais forte da demo e o menos explicado: é Σ preço × vendidos *acumulados na vida do anúncio*, não TAM anual — o hint "Σ preço × vendidos acumulados" (`:132`) não diz isso.
6. **"Vendas acumuladas" e "Faturamento" são piso da vida do anúncio, e a tela avisa em três lugares diferentes** (badge "estimativa", texto do cabeçalho, `title` da célula `:561,:568`), mas o KPI grande diz "≈ 12,4 mil unidades" sem período. Um comprador lê como mensal. A palavra "na vida dos anúncios" no próprio value/hint do KPI vale mais que três avisos periféricos.
7. **Tabela: "Faturamento" = vendidos × preço atual** (`:568`) — com desconto ativo, multiplica pelo preço promocional; com kit misto, soma laranjas com kits de laranja. O `title` avisa; a coluna ordenável não. Sugestão: manter, mas rotular "Fat. estimado".
8. **Sem "Adicionar ao Radar" a partir do Sonar.** O cruzamento diz "Já está no seu Radar" quando encontra, mas não há botão para vigiar a ficha quando não está (o DialogAdicionar existe no Radar e aceita GTIN/`catalog_product_id`, `dialog-adicionar.tsx`). É o passo natural do funil prospectar → vigiar → publicar, e é a ponte Radar↔Sonar que a demo pede.
9. **Buscas recentes só antes da primeira busca** (`:672-705`). Depois do resultado, para trocar de nicho o operador redigita; não há histórico lateral nem "comparar com o anterior".
10. **Filtros do Sonar vivem num Popover sem resumo dos ativos** (`:224-339`). Com "Só FULL + preço ≥ 50" aplicados, a tela mostra só "12 de 20 anúncios · Limpar filtros"; quais filtros estão ativos exige reabrir o popover. Chips dos filtros ativos ao lado do botão é o padrão.
11. **Veredito: chip com o número da barreira sem unidade/explicação visível** (`veredito-sonar.tsx:188-195`) — o `title` diz "Número que sustenta a barreira (ADR-0138)". Em demo lê-se "Demanda comprovada · concorrência pesada [37%]" e a plateia pergunta "37% de quê?".
12. **Handicap Full de 5% é heurística não medida** (`veredito-sonar.ts:129-134`) e aparece como recomendação numérica ("Avalie entrar 5% abaixo…", `:222`). Está documentado no código como opinião; na tela tem o mesmo peso dos cortes medidos. Vale um "(regra prática)" no texto.

### O que um comprador/gerente sentiria falta

- Ver a evolução do nicho entre buscas (o cache de 7 dias já guarda snapshots — não há diff "vs. busca anterior").
- Custo de aquisição sugerido: a DRE calcula ponto de equilíbrio e preço-alvo dado o custo; a pergunta inversa ("quanto posso pagar no fornecedor para ter 20% ao preço médio") é a que o comprador faz antes de negociar.
- Salvar/marcar um nicho como "em avaliação" com nota — hoje o resultado morre com o cache.
- Ranking de vendedores (quem são os 5 que dominam) — existe agregado em `secoes237` (`top1`), mas a lista nominal não aparece.

---

## Sonar — design/UX

**Hierarquia/densidade.** O resultado é uma coluna de ~6 cards de altura cheia antes da tabela. A conclusão (veredito) vem primeiro — correto —, mas depois há 4 blocos de contexto de peso visual igual (Card + p-4 + `mb-4`) sem nenhum colapsado por padrão. O "Saiba mais" já é `aria-expanded`; DRE e Análise PubliAI merecem o mesmo tratamento (abertos só quando o operador precisa). Em demo, o scroll até a tabela é longo e o apresentador tende a pular a DRE, que é justamente a parte com mais valor.

**Cores.** Card do veredito com borda/fundo por nível (`veredito-sonar.tsx:20-24`) + fatores com ícone TrendingUp/Minus/TrendingDown coloridos + resumo em caixa colorida + insights em `bg-card`: quatro camadas de fundo aninhadas (Card tint → caixa do resumo tint → mini-card bg-card). Em dark mode as tints de 5% somem e as bordas /40 são a única distinção. Menos camadas, mais contraste no título.

**Estados.** Muito bem cobertos e honestos: stepper sem barra de % (`sonar.ts:162`), "fonte não configurada", erro com retry, cache antigo sem retry (com justificativa de custo, `PulseSonar.tsx:742-757`), amostra vazia ≠ nicho vazio (`:758-768`), filtro sem resultado. Falta: **indicador de idade do resultado** (cache 7d) e **custo da consulta** — o operador não sabe que reabrir o mesmo termo é grátis e um termo novo custa; a demo ganha se disser "resultado de 28/08 (cache) · nova busca em 3 s".

**Responsividade.** Tabela de 9 colunas com `w-full max-w-[420px]` no título (`:519`) e `stickyRight` nas ações — funciona em desktop; em `<sm` o Raio-X vira wrap de 6 chips e a DRE tem 8 inputs em `sm:grid-cols-4` que colapsam para 1 coluna (8 campos empilhados). O pódio usa `sm:grid-cols-2`. Aceitável para tela de escritório; ruim em tablet de demo.

**Acessibilidade.** `autoFocus` justificado por leitor de código de barras (`:660-663`). Labels em todos os inputs de filtro. Lacunas: o chip do veredito e o número da barreira só explicados por `title`; o botão "Saiba mais" é `text-xs text-muted-foreground` — abaixo do alvo mínimo confortável; o stepper não tem `aria-live`, o leitor de tela não sabe que a busca terminou.

**Consistência.** O Sonar usa `Card` cru com `text-sm font-medium` como título (`:110`, `:118`, `sonar-analise-publiai.tsx:28`, `sonar-dre.tsx:232`) enquanto o Radar usa `PageHeader`/`h3`. Quatro cards com quatro cabeçalhos ligeiramente diferentes (badge "estimativa" num, badge "demanda por vendedor" noutro, subtítulo em `text-xs` no terceiro, "6." no quarto). Um componente `SecaoSonar` com título/subtítulo/colapso padronizaria.

---

## Validação em runtime (screenshots)

Ambiente: `https://ean2marketplace-frontend.onrender.com/#/pulse`, Chromium via `playwright-cli`, sessão própria. Tema alternado por `localStorage.publiai-theme` + reload. Sonar com payloads injetados (`route` em `pulse-sonar-vendas`, `pulse-sonar-visitas`, `pulse-analise-secoes237`, `calcular-tarifa-ml`) — os itens da amostra trazem "(dado de exemplo)" no título; os números da DRE são derivados da tarifa mock, servem só para layout.

Screenshots (`…/tmp/shots/`): `radar-1440-light.png`, `radar-1440-dark.png`, `radar-820-light.png`, `radar-820-dark.png`, `detalhe-1440-light.png`, `detalhe-1440-dark.png`, `detalhe-820-light.png`, `alertas-1440-light.png`, `alertas-1440-dark.png`, `alertas-820-light.png`, `sonar-1440-light-topo.png`, `sonar-1440-light-full.png` (viewport 1440×3400), `sonar-1440-light-dre-full.png` (DRE preenchida), `sonar-1440-dark-full.png`, `sonar-820-light-full.png` (820×4400).

| Ponto do relatório | Veredito | Evidência |
|---|---|---|
| Radar: coluna "Análise PubliAI" com 3 linhas alonga as linhas | **Confirmado** — linha mede 76 px; em 1440×900 só **5 das 13** linhas cabem acima da dobra | `radar-1440-light.png` (medido via `getBoundingClientRect`) |
| Radar: KPI "Você é o menor preço" verde com 0 | **Confirmado** | `radar-1440-light.png` |
| Radar: cabeçalho decorado (gradiente + telemetria) | **Confirmado**; em dark o gradiente quase some, sobra só a borda | `radar-1440-dark.png` |
| Radar em tablet: colunas somem por breakpoint | **Confirmado e pior**: em 820 px "Análise PubliAI" some (esperado) e a tabela ainda estoura 823 px num container de 770 — a coluna de ações **⋮ fica fora da tela**, só alcançável rolando a tabela; sem indicação visual de que há mais | `radar-820-light.png` |
| Detalhe: dialog 7xl com tabela de 10 colunas, duplo scroll | **Refutado em 1440** (dialog 1280 px, tabela 1246 px cabe; só scroll vertical). **Confirmado e agravado em 820**: o dialog tem `scrollWidth` 1251 num `clientWidth` de 820 — o wrapper da tabela (1217 px) não encolhe, o bloco de decisão perde "Sua posição" pela direita e o conteúdo é cortado sem barra de rolagem visível. Causa provável: filho do `DialogContent` (grid) sem `min-w-0`, então `overflow-x-auto` do DataTable não tem largura para agir | `detalhe-820-light.png`, `detalhe-1440-light.png` |
| Detalhe: 9 colunas na tabela de concorrentes | **Corrigido**: são **10** (Preço, Vendedor, Qualificação, Reputação, MercadoLíder, Estado, Porte, Visitas 30d, Anúncio, Oferta) | `detalhe-1440-light.png` |
| Detalhe: decomposição da margem só em `title` | **Confirmado** — na tela aparece só "(comissão R$ 3,50)" | `detalhe-1440-light.png` |
| Alertas: sem data/hora e sem Δ% | **Confirmado** | `alertas-1440-light.png` |
| Alertas: duas barras de abas empilhadas com o mesmo visual | **Confirmado** — "Radar · Sonar · Alertas" e "Ação · Informativo · Todos" são indistinguíveis | `alertas-1440-light.png` |
| Sonar: 6 blocos antes da tabela | **Confirmado** — 5 cards; a tabela começa a **2.128 px** do topo em 1440 (2,4 telas de 900 px); a DRE sozinha ocupa 797 px | `sonar-1440-light-full.png` |
| Sonar: termo buscado some do resultado | **Parcial**: por termo o texto **fica no input** (refutado); por EAN o campo é limpo (código). Continua sem título/data/amostra no resultado | `sonar-1440-light-topo.png` |
| Sonar: KPIs sem "i" | **Confirmado** — nenhum ícone "i" nos 4 KPIs do Sonar; os do Radar têm | `sonar-1440-light-full.png` vs `radar-1440-light.png` |
| Sonar: "6. Dá lucro?" numeração órfã | **Confirmado** | `sonar-1440-light-full.png` |
| Sonar: DRE em 820 vira 8 inputs empilhados | **Refutado** — 820 ≥ `sm`, os inputs continuam em 4 colunas, apertados mas legíveis | `sonar-820-light-full.png` |
| Sonar: tints de 5% somem em dark | **Refutado (parcial)** — o card do veredito mantém tint verde perceptível e borda /40; legível | `sonar-1440-dark-full.png` |
| Sonar: veredito com 4 camadas de fundo | **Confirmado**, mas em light lê bem; não é problema prioritário | `sonar-1440-light-full.png` |
| Dark mode geral (badges, KPIs, tabela) | **Sem defeito encontrado** em Radar, Detalhe, Alertas e Sonar | `*-dark*.png` |
| Responsividade a 1280 px (claim original) | **Não verificável** — não medido nesse breakpoint | — |

### Achados novos que só a renderização mostrou

1. **Sonar: a coluna fixa de ações cobre a coluna "Envio"** (`PulseSonar.tsx:613` `stickyRight`). Em 1440 o cabeçalho "Envio" aparece esmaecido sob a coluna Simular/⧉ e **nenhum badge FULL/FLEX é visível** (o mock tinha 10 de 20 em FULL). Em 820 é pior: `Vendidos`, `Faturamento`, `Avaliação`, `Visitas` e `Envio` ficam **todas** sob a coluna fixa, e o wrapper não rola (`scrollWidth` = `clientWidth` = 740) — a informação é inalcançável. Provável: a coluna sticky tem fundo opaco e a tabela não tem `min-width`, então em vez de rolar ela se sobrepõe. `sonar-1440-light-full.png`, `sonar-820-light-full.png`.
2. **Alertas repetidos para o mesmo produto** na aba Ação com dados reais: "Aptamil Premium 2 caiu de R$ 71,99 para R$ 68,99" aparece **duas vezes** idêntico; "Aptamil Premium 1" tem duas quedas (69,80→67,99 e 70,19→67,99) e "Eucerin Aquaphor" duas (77,87→72,31 e 70,90→68,90). Nove alertas de Ação são na prática **4 produtos**. Sem data é impossível saber se são dias diferentes. Agrupar por produto (último preço + "N movimentos") reduziria a lista a 4 linhas acionáveis. `alertas-1440-light.png`.
3. **Radar em 820: telemetria e KPIs quebram bem**, mas o botão ⋮ da linha some (item acima) — para tablet de demo, é o único acesso a "Pausar no radar".
4. **Sonar em 820: pódio trunca títulos a ~25 caracteres** ("Tecido Oxford Marrom 10m Decoraç…") em duas colunas lado a lado; a coluna de faturamento ainda cabe. Aceitável, mas em produto com nome longo (padrão ML) o pódio vira lista de reticências. `sonar-820-light-full.png`.
5. **Sonar: o veredito ocupa a primeira tela inteira** (≈ 370 px do card + cabeçalho) — em demo é o que se vê primeiro e é bom; mas "Vendas do nicho" e "Análise PubliAI" só aparecem após rolar, e a DRE (o argumento de venda mais forte) começa a 1.685 px.
6. **Detalhe em 820: o link "Buscar anúncios no Mercado Livre" e o EAN cabem; o botão "Reprecificar" some** junto com "Sua posição" pelo corte horizontal (item do dialog acima). `detalhe-820-light.png`.

---

## Melhorias priorizadas (reordenada após a validação)

| # | Melhoria | Impacto | Esforço | Demo? | Ref. |
|---|---|---|---|---|---|
| 1 ★ | **Linha do Radar com "Sobra hoje"** (líquido/% na margem atual, vermelho se ≤ 0) + ação "Reprecificar" direto na linha. Carregar custo/alíquota em lote (uma query para todos os `codigo_pai`, não por produto). | Alto | M | Sim | `tabela-radar.tsx`, `pulse.ts` (`fetchContextoMargem`) |
| 2 ★ | **Unificar simuladores do Sonar**: botão "Simular" abre a DRE com a âncora trocada; aposentar `dialog-margem-sonar.tsx`; rótulo único "Margem s/ venda" + "Markup" em todo o Pulse (Radar incluído). | Alto | M | Sim | `PulseSonar.tsx:619`, `sonar-dre.tsx:94`, `dialog-detalhe.tsx:544` |
| 3 ★ | **Corrigir a coluna sticky do Sonar** (cobre "Envio" em 1440 e 5 colunas em 820, sem rolagem) e **o overflow horizontal do dialog de Detalhe em 820** (`min-w-0` no filho do `DialogContent`). Dois bugs visíveis em qualquer projetor/tablet de demo. | Alto | P | Sim | `PulseSonar.tsx:613`, `data-table.tsx` (stickyRight), `dialog-detalhe.tsx:410` |
| 4 | **Cabeçalho do resultado do Sonar**: termo buscado, tamanho da amostra, data do cache, "Adicionar ao Radar" (reaproveita `DialogAdicionar`). | Alto | P | Sim | `PulseSonar.tsx:769-790`, `dialog-adicionar.tsx` |
| 5 | Alertas: "há Nh", Δ% no texto e **agrupamento por produto** (9 alertas reais = 4 produtos). | Alto | M | Sim | `aba-alertas.tsx:231`, `pulse-alerta-texto.ts:19` |
| 6 | Colapsar por padrão "Análise PubliAI" e "6. Dá lucro?" (tabela a 2.128 px do topo); remover o "6."; padronizar cabeçalho dos cards do Sonar. | Médio | P | Sim | `sonar-dre.tsx:232`, `sonar-analise-publiai.tsx:117` |
| 7 | "Análise PubliAI" do Radar como badge + tooltip (linha de 76 px → ~52 px; 5 → 8 linhas acima da dobra) e renomear para "Disputa do catálogo". | Médio | P | Sim | `tabela-radar.tsx:152-193` |
| 8 | Descrições "i" para os 4 KPIs do Sonar; "Mercado endereçável" com "na vida dos anúncios da amostra" no hint. | Médio | P | Sim | `kpi-descriptions.ts`, `PulseSonar.tsx:118-135` |
| 9 | Detalhe do Radar: fundir Reputação + MercadoLíder + Qualificação numa coluna "Vendedor" com selos (10 → 7 colunas); decomposição da margem visível (4 números), não em `title`. | Médio | M | Sim | `dialog-detalhe.tsx:215-405, 516-528` |
| 10 | Lista do Radar: marcador "· N abaixo (não relevantes)" ao lado do menor relevante, usando `ofertasAbaixoDaReferencia`. | Médio | P | Não | `tabela-radar.tsx:115-128`, `pulse-margem.ts:231` |
| 11 | Sparkline de 7/14 dias na linha do Radar (menor relevante) — exige agregado por produto no resumo de ofertas. | Médio | G | Sim | `pulse.ts` (`fetchPulseResumoOfertas`), `tabela-radar.tsx` |
| 12 | Atualizar `docs/how-to/usar-o-pulse.md` §3/§5 (ADR-0146/0147) e adicionar seção do Sonar; ícone `Bell` do KPI "Sem vínculo"; KPI "menor preço" com tom neutro em 0. | Baixo | P | Sim | `docs/how-to/usar-o-pulse.md`, `Pulse.tsx:235,243` |

★ = recomendadas. Saíram da lista (baixo impacto): chips dos filtros ativos do Sonar (`PulseSonar.tsx:792-808`).

---

## O que NÃO mudar (parece bug, é decisão)

| Comportamento | Onde | ADR |
|---|---|---|
| "Sua posição" compara com o menor **relevante**, não com o menor preço da ficha; vendedores com <10 transações, 0 visitas ou reputação laranja/vermelha ficam fora da régua; `transactions_total` ausente = "em observação", nunca reprova. O menor **observado** continua visível, mas nunca vira preço/alerta/margem. | `qualificacao.ts:22-30`, `pulse-formato.ts:137` | **0130** D-1/D-6 (o código cita 0020/0050 por herança da régua de preço líquido mínimo da Revisão). Corte fixo, não configurável por org — dívida reconhecida, não bug |
| Tons da posição: amarelo já em +0,5%, vermelho só ≥ +15%; "Empatado" em ±0,5%. Mesmo limiar nos KPIs "Mais caro"/"Menor preço". | `pulse-formato.ts:140-146`, `pulse-filtros.ts:42-44` | 0119 (limiar próprio do Pulse). O semáforo 🟢/🟡/🔴 da **Revisão** (ADR-0020/0050: 🟡 = abaixo do mínimo sem prejuízo; frete grátis é badge, nunca muda cor) é outro vocabulário e também não deve ser "corrigido" |
| "Marcar N como lidos" pode marcar **menos** do que N (âncora em `criado_em` da 1ª linha carregada) — protege contra corrida com o coletor. | `aba-alertas.tsx:114,195` | 0133 Errata 2 |
| Estratégia "competitivo" na Viabilidade nunca sobe o preço para cumprir o piso — o semáforo avisa. | Revisão/Viabilidade | 0020 (incidente registrado em memória: "piso no ramo competitivo violou ADR-0020/0050") |
| Margem "indisponível: falta X" em vez de número aproximado; imposto nunca presumido; DRE recusa sem os 4 campos do pacote. | `pulse-margem.ts:146`, `dialog-detalhe.tsx:39-48`, `sonar-dre.tsx:214-219` | 0055, 0107, 0119 (regra LOUD), 0148 D-16 |
| Rótulo "estimativa" na margem sempre que o preço simulado ≠ preço em que a comissão foi lida. | `pulse-margem.ts:122-128` | 0119 Errata 6/7 |
| Posição no catálogo é **hipotética** ("ficaria em Xº de N+1") e empate não passa à frente. | `pulse-formato.ts:179-204` | 0147 D-5 |
| Coluna "Referência do ML" removida; não voltar. | `tabela-radar.tsx:153-156` | 0147 D-24 |
| Porte do vendedor = `transactions_total ÷ 12`, loja inteira; não existe venda por anúncio de terceiro. | `pulse-margem.ts:172`, `dialog-detalhe.tsx:301-327` | 0142, 0146 |
| Badge da aba Alertas conta só Ação não lida; histórico backfillado como Info → 0 é correto. | `Pulse.tsx:86-93` | 0133 D-6 |
| Primeira coleta de um produto não gera alerta. | `pulse-coletar` | 0119 |
| Sonar: "Já está no seu Radar" só afirmado no positivo; ausência não vira "não está". | `PulseSonar.tsx:183-196` | 0140 D-3 |
| Sonar: sem faixas de preço/estatística de preço sobre a amostra (kits incomparáveis); condição de entrada em %. | `veredito-sonar.ts:195-225` | 0124 Errata 1, 0138 §3 |
| Sonar: veredito "alta" exige disputa medida por rótulo; caminho B tem teto "média" e título "topo aparentemente aberto". | `veredito-sonar.ts:158-175, 782-786` | 0137, 0138 |
| Sonar: Marca alerta mas não pontua; marca dominante fecha a entrada. | `veredito-sonar.tsx:223-235` | 0128 |
| Sonar: sem botão de retry no cache antigo (cada run custa US$ 0,10); cache de 7 dias. | `PulseSonar.tsx:742-757` | 0122, 0127 |
| Sonar: "Vendidos" é piso acumulado da vida do anúncio, nunca ritmo mensal. | `PulseSonar.tsx:558-563` | 0122 |
| Sonar: coluna "Loja" removida a pedido do operador (19/08). | `PulseSonar.tsx:596-599` | decisão do operador registrada no código |
| Sonar não gera faturamento do nicho a partir do porte do vendedor. | `sonar-analise-publiai.tsx:1-3` | 0143 D-3 |
| Reprecificar grava e leva à Revisão; nunca publica. | `dialog-reprecificar.tsx:159` | 0005, regra do projeto |

---

## Dúvidas para o Diego

1. Na demo, o público-alvo é **comprador** (decide estoque → Sonar/DRE) ou **gestor de preço** (Radar/alertas)? Muda a ordem: hoje a aba abre em Radar e o Sonar é o que mais impressiona.
2. O cabeçalho decorado do Pulse (gradiente + BorderTrail + subtítulo de marketing, `Pulse.tsx:148-187`) é padrão que você quer levar para as outras páginas ou exceção deliberada para o módulo "premium"?
3. Os 9 alertas de Ação reais na org de validação cobrem 4 produtos, com quedas repetidas do mesmo produto (ex.: Aptamil Premium 2, 71,99→68,99 duas vezes). É esperado que o coletor grave um alerta por coleta (4× ao dia) para a mesma queda, ou isso é duplicação a investigar em `pulse-coletar`?
