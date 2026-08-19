# Sonar por anúncio + histórico de snapshots — Design

**Data:** 2026-08-19
**Status:** aprovado pelo Diego (abordagem A1 do brainstorming)
**Relacionados:** ADR-0120 (Sonar por termo), ADR-0122 (vendas via Apify), ADR-0124 (veredito), ADR-0125 (cruzamento ficha↔anúncio — **superado em parte por este design**)
**Escopo:** a tabela do Sonar passa a listar ANÚNCIOS; início da gravação de histórico. O drill-down "Análise de Anúncio" fica para spec separada.

## Objetivo

Trocar a unidade da tabela do Sonar de ficha de catálogo para anúncio real da busca, e começar a gravar um snapshot por garimpo para que, no futuro, a diferença entre dois snapshots vire "vendas do período" MEDIDAS — o único caminho, dado que `date_created` de terceiro é inobtenível (ADR-0125/D9).

## Contexto e evidência

O ADR-0125 apostou no cruzamento ficha↔anúncio (D4) para juntar os dois universos. As medições de 19/08/2026 (token real de produção + dataset Apify já pago, termo de referência "abraçadeira nylon", mais 4 nichos de controle) mostraram que a ficha é a unidade errada:

- **Interseção 0**: nenhum `idPublicacao` da amostra Apify (20 anúncios do topo da busca) caiu dentro dos `item_ids` das fichas do painel oficial no termo medido. O cruzamento D4 existe, funciona e não casa nada — os dois universos quase não se tocam.
- **21 das 40 fichas mortas**: mais da metade das fichas do topo do `/products/search` está sem vendedor ativo (404 "No winners found" ou `results: []`). Medição em 5 nichos: fichas ativas variam de 10% a 60% do painel. A tabela atual lista, na maioria, prateleiras vazias.
- **138 vs 44.680 visitas em 30 dias (324×)**: soma das visitas das 19 fichas vivas do painel atual contra a soma dos 20 anúncios da Apify (20/20 responderam HTTP 200 em `/items/{id}/visits/time_window?last=30&unit=day`, medido 19/08, inclusive os vinculados a catálogo). O tráfego real do nicho está nos anúncios, não nas fichas.
- **14% das vendas em ficha**: só essa fração das vendas da amostra está em anúncios vinculados a catálogo (`idProdutoCatalogo` presente em ~20-30% dos itens). Julgar o nicho pelas fichas ignora ~86% da venda medida.
- `produtoCategoryID` vem 20/20 no payload Apify (medido 18/08) — o simulador de margem dispensa o preditor de categoria.
- `GET /items/{id}` e o multiget de terceiros devolvem 403 (ADR-0119 Errata 1, ADR-0125/D9): seller_id, reputação, UF e `date_created` de terceiros são inobteníveis. Da API oficial sobra, com utilidade, **visitas**.

Conclusão factual: o painel de fichas mede um universo pequeno, majoritariamente morto e com 324× menos tráfego do que os anúncios que a Apify já entrega pagos. É isso que justifica contradizer o ADR-0125/D4.

## Decisões

### D1 — Unidade da linha = ANÚNCIO; catálogo vira selo

A tabela lista os até 20 anúncios da amostra Apify, na ordem da busca. Anúncio com `catalog_product_id` (~20-30% dos casos) ganha selo "Catálogo" na coluna Anúncio — nada além disso nesta entrega.
**Descartado:** manter fichas e "melhorar o cruzamento" — com interseção 0 medida, não há o que melhorar; o dado não casa.

### D2 — API oficial reduzida a visitas: 1 chamada por anúncio

Único uso restante: `/items/{id}/visits/time_window?last=30&unit=day` (funciona para terceiros, 20/20 HTTP 200 medido 19/08). Morrem: `/products/search`, `/products/{id}/items`, preditor de categoria no Sonar e `/users/{seller_id}`.
**Descartado:** manter a busca de fichas como fonte secundária de "vendedores/UF" — custaria ~100-200 chamadas por garimpo para descrever um universo que não é o da tabela.

### D3 — Orquestração: `pulse-sonar-vendas` primária, edge nova `pulse-sonar-visitas`, `pulse-sonar` DELETADA

- `pulse-sonar-vendas` segue dona do Apify e vira a query primária da tela; contrato de resposta inalterado (ver D5/D7 para o efeito colateral de gravação).
- Edge nova e fina `pulse-sonar-visitas` (~60 linhas, espelho estrutural da vendas): recebe `{ item_ids: string[] }` (teto 20 — acima disso, 400), resolve conexão ML da org (mesmo padrão da `pulse-sonar` atual), chama visitas com concorrência 5, responde `{ por_item: Record<string, { total: number; por_dia: [...] } | null> }`.
- `pulse-sonar` morre: diretório deletado e entrada `[functions.pulse-sonar]` removida de `supabase/config.toml:125`. Helpers compartilhados (`parseVisitasJanela`, `ufDoVendedor`, `extrairPalavrasChave`) sobrevivem — o Radar (`pulse-coletar/processar.ts`) os usa.
**Descartado:** fachada única (uma edge chama Apify + visitas + grava) — reacopla o que o ADR-0122 desacoplou, obriga bump de chave (re-cobra Apify) e soma o timeout Apify de 135s com visitas no mesmo orçamento de execução. Também descartada a gravação via QStash: worker inteiro para ≤20 inserts de <0,5s.

### D4 — Amostra mantida: 20 anúncios, teto US$ 0,10 por garimpo

Igual a hoje (`_shared/apify/client.ts`, `TETO_USD = 0.10`, PAY_PER_EVENT US$ 0,005/anúncio). Sem mudança de corte → sem bump de chave (regra do ADR-0122 §4).
**Descartado:** ampliar a amostra junto com a mudança de unidade — mudaria custo e chave de cache na mesma entrega; se 20 se provar pouco, é decisão futura do Diego com o trade-off medido.

### D5 — Cache de vendas: `sonar:vendas:v4` mantida, SEM bump

O shape de resposta não muda de forma incompatível (a tela nova lê os mesmos campos de `ItemVendasSonar`; a gravação de histórico é efeito servidor, invisível no payload cacheado; `historico_gravado` é aditivo e fica fora do cache, ver D7). Bump re-cobraria ~US$ 0,10 por termo cacheado nos últimos 7 dias, por nada.
**Descartado:** bump "por higiene" — viola a convenção do ADR-0125/D2 (bump só para mudança incompatível ou de corte).

### D6 — Visitas em chave própria por item: `sonar:visitas:v1:{item_id}`, TTL 24h

Chave por anúncio, não por termo: o mesmo anúncio em dois termos garimpados reaproveita a chamada. TTL 24h porque a janela de 30 dias anda todo dia — 7d serviria visitas até 7 dias velhas. Dado público → chave global sem org_id (mesma regra do ADR-0120 §3).
**Descartado:** visitas dentro da chave de vendas — TTLs incompatíveis (7d vs 24h) e acoplaria a expiração de dado barato (ML, grátis) a dado caro (Apify).

### D7 — Histórico gravado pela `pulse-sonar-vendas` no caminho de CACHE-MISS

Run Apify fresco → a edge grava ≤20 linhas em `sonar_snapshots` (upsert `on conflict do nothing`, `adminClient()`) antes de responder. Cache hit → não grava: mesmo dado, nenhum ponto novo — 1 snapshot por termo por ciclo de TTL, por construção. Falha de insert NÃO derruba a resposta (o dado Apify já foi pago), mas não é silenciosa: log + campo aditivo `historico_gravado: boolean` na resposta. **Esse campo fica FORA do objeto cacheado**: é montado na hora de responder, nunca gravado no Redis. Caso contrário um cache hit serviria o `historico_gravado: true` de um miss antigo, afirmando uma gravação que não aconteceu naquela requisição. Em cache hit o campo vale `false` — não gravou mesmo (D7).
**Descartado:** gravar também em cache hit (duplicaria o mesmo ponto) e gravação assíncrona (ver D3).

### D8 — Regra LOUD refinada: ZERO MEDIDO ≠ ausência de dado

Medido 19/08: um anúncio devolveu `total_visits = 0` com HTTP 200. É zero de verdade. Tela e snapshot distinguem: HTTP 200 com total 0 → exibe "0"; falha de chamada, item ausente da resposta ou org sem conexão ML → "—" e `null`. Nunca converter um no outro.
**Descartado:** tratar 0 como "sem dado" (mente para cima) ou falha como 0 (mente para baixo — a violação clássica de LOUD).

### D9 — Sparkline de visitas: ordenar por data e preencher dias ausentes com 0

Medido 19/08: a API de visitas OMITE os dias sem visita e devolve os pontos FORA DE ORDEM (`last=30` devolveu 7 pontos numa janela de 30 dias, datas embaralhadas, `date_from` 2026-07-20 → `date_to` 2026-08-19). O front ordena por data e preenche a janela completa com 0 nos dias ausentes — senão o gráfico comprime 30 dias em 7 e mente sobre o período. Aqui o 0 preenchido é legítimo: a janela é fechada e dia sem ponto é dia com zero visitas dentro dela.
**Refutação registrada (não tentar de novo):** "N pontos devolvidos" NÃO é proxy de idade do anúncio — os 7 pontos vieram de uma janela de 30 dias de um anúncio que não tem 7 dias de vida. `date_created` de terceiro segue inobtenível (ADR-0125/D9).

### D10 — Veredito v2 sobre os anúncios reais, com trava LOUD de cobertura

Fatores recalculados sobre a amostra Apify + visitas (detalhe na seção "Veredito v2"): Demanda intacta; Disputa e Tração reformuladas (D11); Marca vira % da amostra com loja oficial. **Trava:** se `vendedor` (nickname) vier em menos de 50% dos itens da amostra, Disputa e Tração ficam indisponíveis e saem da escala proporcional (mecanismo que o ADR-0124 §4 já tem) — nunca calcular concorrência sobre meia dúzia de nicknames e fingir que é o nicho.
**Descartado:** manter os fatores lendo o painel de fichas — o painel morre (D3); e "vendedores distintos" por fonte oficial é impossível (403 medido).

### D11 — Disputa e Tração viram métricas invariantes ao tamanho da amostra; os cortes antigos são INVÁLIDOS na fonte nova

O defeito: os cortes atuais (`DISPUTA = { vendedoresPoucos: 10, vendedoresMuitos: 25 }`, `TRACAO = { boa: 150_000, media: 30_000 }` em `src/lib/veredito-sonar.ts`) vivem numa escala cujo teto vinha de ~40 fichas com todas as suas ofertas — o gabarito registra 27 vendedores no EUCERIN (`docs/decisions/0124-veredito-de-oportunidade-do-sonar.md:88-95`). Na fonte nova a contagem é **censurada pela amostra**: 20 anúncios, nickname em ~13 → máximo observável 13-20. O corte 25 fica inatingível por construção, nenhum nicho seria disputa 🔴, e o EUCERIN (hoje 🔴 em Disputa, veredito 🟡) viraria 🟢 — inversão silenciosa do gabarito com todos os testes antigos passando.

Reformulação:

- **Disputa v2 = pulverização**: `vendedores_distintos ÷ anúncios com vendedor nomeado` (razão 0–1). Nicho pulverizado (cada anúncio de um vendedor diferente) tende a 1,0 = muitos concorrentes = disputa alta; nicho concentrado (poucos vendedores com vários anúncios) tende a baixo. Invariante ao tamanho da amostra — a propriedade que faltava à contagem absoluta. Frete% e % patrocinado da amostra seguem como sinais complementares do fator.
- **Tração v2 = faturamento por vendedor DA MESMA SUBAMOSTRA**: `Σ(vendidos × preço) dos anúncios com vendedor nomeado ÷ vendedores_distintos nomeados`. Numerador e denominador sobre o mesmo subconjunto — sem isso, o denominador censurado infla a razão (o mesmo defeito herdado). Os cortes em R$ atuais foram derivados da escala antiga e **não podem ser reaproveitados**: serão re-derivados dos 3 fixtures da recalibração (D12).
- **Guarda contra regressão silenciosa:** as constantes antigas não são reutilizadas nem "ajustadas" — são substituídas por constantes com nomes novos (ex.: `DISPUTA_V2`, `TRACAO_V2`), para que nenhum número da escala morta sobreviva por cópia. Este parágrafo existe para ninguém ler os cortes antigos achando que só a fonte mudou.

**Descartado:** manter contagem absoluta com cortes rebaixados "no olho" — continuaria censurada (um nicho com 30 vendedores reais e outro com 15 mediriam igual) e os números seriam inventados, não medidos.

### D12 — Recalibração: 3 termos-gabarito, ≤ US$ 0,30, aceite "média / média / alta"

Rodar "EUCERIN protetor solar", "protetor solar facial" e "tecido oxford 10 metros" na `pulse-sonar-vendas` (custo zero para o que estiver no cache 7d; máximo US$ 0,30) e congelar os payloads como fixtures do novo `veredito-sonar.test.ts`. Os cortes de Disputa v2, Tração v2 e do fallback de visitas saem DESSES payloads — a recalibração é medição, o resultado dela não está previsto nesta spec.

Critério de aceitação, herdado do ADR-0124 e agora mais exigente: os 3 nichos têm que reproduzir **média / média / alta, nessa ordem**. "Tecido oxford 10 metros = alta" segue inegociável (nicho em que a operação lucra; calibração que o condene está errada por construção). **Contingência:** se alguma métrica nova não conseguir reproduzir o gabarito com nenhum corte plausível, o fator correspondente vira **informativo, não pontuado** (mesmo tratamento da Marca, ADR-0124 §5), a escala proporcional do §4 absorve, e a limitação é registrada no ADR-0126 — nunca forçar um corte que "passe no teste" distorcendo o resto.
**Descartado:** gabarito ampliado (20-30 termos rotulados) nesta entrega — custa US$ 2-3 e horas do Diego; segue como follow-up. N=3 não piora o que já existe.

### D13 — Histórico: delta entre snapshots de `vendidos` é PISO, nunca total

`vendidos` vem em faixas arredondadas pelo ML. Entre dois snapshots, 500→500 NÃO significa "não vendeu" — significa "não cruzou a próxima faixa". O snapshot grava o número cru pós-parse (`parseVendidos`), e qualquer consumidor futuro (drill-down) trata o delta como piso do período. Registrado agora para o histórico não nascer com semântica corrompida — variante direta da regra "nunca somar faixas arredondadas".

### D14 — Rollout de uma vez, sem feature flag

Sonar é ferramenta interna de garimpo do operador, não fluxo de publicação. Meia-tela velha + meia nova exigiria manter `PainelSonar` e o cruzamento vivos só para a transição. Ordem de deploy e validação na seção "Rollout".
**Descartado:** flag — custo permanente para proteger uma janela de segundos.

### D15 — Link do anúncio: validar no browser durante a implementação, com fallback definido

O `link` da Apify (`zProdutoLink`, formato `/up/MLBU…`) não pôde ser validado por linha de comando: o ML redireciona qualquer requisição sem sessão para `/gz/account-verification` — tanto o `/up/MLBU…` quanto a URL canônica `produto.mercadolivre.com.br/MLB-{id}` (medido 19/08). É anti-bot, não link quebrado. Item obrigatório da validação browser-use pré-merge: abrir 3 links reais logado. Fallback se `/up/MLBU…` não abrir: montar `https://produto.mercadolivre.com.br/MLB-{id-sem-prefixo}` a partir do `item_id`; se nenhum dos dois abrir, a célula perde o link (a ação "Simular margem" permanece).

### D16 — Sem Apify, o Sonar não tem tabela: falha explícita, nunca tela vazia

Consequência direta de D1+D2 que precisa estar escrita: hoje, org sem `APIFY_TOKEN` vê um aviso "Configure o token da Apify" **e a tabela de fichas continua funcionando** (`src/pages/PulseSonar.tsx:124-131`), porque as fichas vinham da API oficial. Na arquitetura nova a tabela inteira nasce da Apify — sem ela não há linhas, e as visitas não salvam nada (são medidas sobre a lista que a Apify devolve).

Comportamento decidido para os três modos de falha:

| Situação | O que a tela mostra |
|---|---|
| `configurado: false` (sem `APIFY_TOKEN`) | Estado vazio explicando que o Sonar depende da Apify, com o nome da variável. Nada de tabela fantasma. |
| Apify configurada mas o run falha/estoura o teto | Erro explícito com o termo e a causa, e o botão de tentar de novo. Nunca "0 anúncios encontrados" — isso mentiria dizendo que o nicho está vazio. |
| Apify responde, mas org sem conexão ML | Tabela completa; só a coluna Visitas fica "—" (D8). Este é o único modo degradado que continua útil. |

**Custo aceito:** o Sonar passa a ter um ponto único de falha (o plano Apify de US$ 5/mês; ADR-0122). Se o saldo acabar, o Sonar para inteiro em vez de degradar para fichas. Aceitável porque as fichas que ele degradava para mostrar são, medidamente, o cemitério do catálogo (21/40 mortas, 138 visitas) — degradar para dado inútil é pior que falhar claro.
**Descartado:** manter a `pulse-sonar` viva só como modo degradado — preservaria a edge mais complexa do par, seu deploy e seus testes, para um caminho que entrega dado que já decidimos não olhar.

## Arquitetura — fluxo do clique em "Prospectar" até a tela

1. Front (`src/pages/PulseSonar.tsx`) dispara `useQuery(['pulse','sonar-vendas', termo])` → `pulse-sonar-vendas`.
2. A edge: cache hit em `sonar:vendas:v4:MLB:{termo}` → responde direto. Miss → Apify (teto US$ 0,10, ~30-120s) → monta painel → grava ≤20 linhas em `sonar_snapshots` (D7) → cacheia 7d → responde.
3. Com os itens em mãos, o front dispara `useQuery(['pulse','sonar-visitas', item_ids], { enabled })` → `pulse-sonar-visitas`: por `item_id`, cache hit em `sonar:visitas:v1:{item_id}` ou chamada ML (concorrência 5, TTL 24h). Org sem conexão ML → resposta explícita de indisponibilidade; a coluna Visitas inteira mostra "—" e o resto da tela vive (hoje é o inverso: sem conexão, o Sonar inteiro falha).
4. A tabela renderiza dos itens da Apify; a coluna Visitas preenche quando a segunda query chega. Stepper (`passosProgresso`, `src/lib/sonar.ts`) mantém o contrato "abre completa": `concluido` = vendas E visitas resolvidas.
5. Veredito v2 (função pura, `src/lib/veredito-sonar.ts`) calcula sobre vendas + visitas.

### Arquivos

| Ação | Arquivo | O quê |
|---|---|---|
| DELETE | `supabase/functions/pulse-sonar/` | edge inteira (busca de fichas, preditor, vendedores, visitas por ficha) |
| DELETE | `src/lib/sonar-cruzamento.ts` + `src/lib/__tests__/sonar-cruzamento.test.ts` | cruzamento D4 do ADR-0125 morre |
| DELETE (parcial) | `supabase/functions/_shared/pulse/sonar.ts` | `montarPainelSonar`, `parseFichasBusca`, `resumoPrecos`; ficam `parseVisitasJanela` e `extrairPalavrasChave` (usados por Radar/vendas) |
| CREATE | `supabase/functions/pulse-sonar-visitas/index.ts` | edge fina de visitas (D3) |
| CREATE | `supabase/migrations/<ts>_sonar_snapshots.sql` | tabela de histórico (via `supabase migration new`, ADR-0043) |
| CREATE | `docs/decisions/0126-sonar-tabela-por-anuncio-e-historico.md` | ADR desta decisão (supersede parcial do ADR-0125) |
| EDIT | `supabase/functions/pulse-sonar-vendas/index.ts` | insert de snapshot no cache-miss + `historico_gravado` (D7) |
| EDIT | `src/lib/sonar.ts` | remove `PainelSonar`/`fichasAtivas`/`fichasSemVendedor`/`fetchPainelSonar`; adiciona `fetchVisitasSonar` e tipos de visitas |
| EDIT | `src/lib/veredito-sonar.ts` | veredito v2 (D10/D11) |
| EDIT | `src/lib/sonar-filtros.ts` | filtros direto sobre `ItemVendasSonar`; `maxVendedores` sai (sem contagem de ofertas por ficha) |
| EDIT | `src/pages/PulseSonar.tsx` | tabela por anúncio (10 colunas), duas queries, seção "fichas sem vendedor" removida |
| EDIT | `src/components/pulse/veredito-sonar.tsx` | render dos fatores v2 |
| EDIT | `src/components/pulse/dialog-margem-sonar.tsx` | categoria vem de `produtoCategoryID` do anúncio |
| EDIT | `supabase/config.toml` | remove `[functions.pulse-sonar]`, adiciona `[functions.pulse-sonar-visitas]` |
| EDIT | `docs/reference/edge-functions.md`, `docs/reference/modelo-de-dados.md`, obsidian-vault | documentação (regra de conclusão do CLAUDE.md) |

## Modelo de dados — `sonar_snapshots`

Uma linha por anúncio por garimpo fresco. Sem tabela-cabeçalho de garimpo: `(termo, gerado_em)` repetido em ≤20 linhas custa menos que um join permanente.

```sql
create table public.sonar_snapshots (
  id uuid primary key default gen_random_uuid(),
  termo text not null,                 -- normalizado (trim/lower/espaço único), igual à chave de cache
  gerado_em timestamptz not null,      -- gerado_em do painel: idempotência natural no retry
  item_id text not null,               -- idPublicacao (MLB…)
  titulo text,
  preco numeric(12,2),                 -- null = não veio (LOUD)
  vendidos integer,                    -- cru pós-parseVendidos; null nunca 0; delta futuro = PISO (D13)
  posicao integer,
  patrocinado boolean,                 -- tipoResultado !== 'ORGANIC'; null = desconhecido
  vendedor text,                       -- nickname (cobertura 13/20 no termo medido em 18/08)
  catalog_product_id text,             -- presente em ~20-30% (medido 18/08)
  criado_em timestamptz not null default now()
);
create unique index sonar_snapshots_termo_item_gerado_uniq
  on public.sonar_snapshots (termo, item_id, gerado_em);
create index sonar_snapshots_item_gerado_idx
  on public.sonar_snapshots (item_id, gerado_em desc);  -- a série do drill-down futuro é por anúncio

alter table public.sonar_snapshots enable row level security;
create policy "sonar_snapshots: select autenticado"
  on public.sonar_snapshots for select to authenticated using (true);
grant select on public.sonar_snapshots to authenticated;
-- escrita: nenhuma policy de insert/update/delete — só service_role (edge), como pulse_v1
```

**Global, sem `org_id`, de propósito:** é o mesmo dado público que já vive em cache Redis com chave global (ADR-0120 §3; `sonar:vendas:v4` não tem org). RLS habilitada com select aberto a autenticados e escrita exclusiva do service_role — variação consciente do padrão org-scoped de `20260816125057_pulse_v1.sql`, registrada no ADR-0126.

**Crescimento:** ~250 bytes/linha com índices (estimativa). O cache de 7d limita a 1 garimpo fresco por termo por semana; com 20 termos distintos/semana (estimativa de uso), 400 linhas/semana ≈ 21 mil linhas ≈ 5-8 MB/ano (estimativa). Ordem de grandeza abaixo das `pulse_ofertas` diárias do Radar; nenhuma partição.

## A tabela (10 colunas)

O `DataTable` genérico (`src/components/ui/data-table.tsx`) suporta tudo: `Column<T>` com `sortValue`, nulos sempre no fim, `overflow-x-auto`. A tela atual já teve 10 colunas (ADR-0125/D11) — cabe sem espremer. Sem `defaultSort`: a ordem de chegada É a posição na busca (mesma decisão da tela atual).

| # | Coluna | Fonte | Exibe | Ordena por | null (LOUD) |
|---|---|---|---|---|---|
| 1 | **#** | Apify `posicaoItem` (20/20) | posição na busca; badge "Patrocinado" quando `tipoResultado !== 'ORGANIC'` | posicao asc | "—"; patrocinado null ≠ orgânico |
| 2 | **Anúncio** | Apify | thumb + título truncado + selo do ML ("MAIS VENDIDO") + selo "Catálogo" quando `catalog_product_id` presente | título | — |
| 3 | **Preço** | Apify | preço; "de X · N% OFF" quando houver | preco | "—" |
| 4 | **Vendidos (acum.)** | Apify | "+N", tooltip "acumulado da vida do anúncio, faixa piso do ML — não é ritmo" | vendidos | "—" tooltip "ML não exibe" (nunca 0) |
| 5 | **Faturamento (acum.)** | derivado | "≈ vendidos × preço atual" | valor | "—" se qualquer operando null |
| 6 | **Avaliação** | Apify | ★ nota (qtd) | nota | "—" |
| 7 | **Visitas (30d)** | API oficial (edge visitas) | total + sparkline ordenado e com dias-zero preenchidos (D9) | total | 200 com 0 → "0"; falha/sem conexão → "—" (D8) |
| 8 | **Vendedor** | Apify `vendedor` (13/20 no termo medido) | nickname; badge "Oficial" quando `loja_oficial` | nickname | "—" (a coluna assume o buraco de cobertura) |
| 9 | **Envio** | Apify | FULL/FLEX, frete grátis, internacional | — | "—" por sub-campo |
| 10 | **Ações** | — | "Simular margem" (comissão real via `produtoCategoryID`) + abrir anúncio (D15) | — | sem link validado → só simular |

## Veredito v2

| Fator | Hoje (fichas) | v2 (anúncios) | Cobertura do insumo (medida 18/08, "abraçadeira nylon") |
|---|---|---|---|
| **Demanda** | liquidez + `vendas_totais` (Apify) | **intacta** — já era 100% Apify | itens 20/20; `vendidos` na maioria |
| **Disputa** | `vendedores_distintos` (40 fichas, contagem absoluta) + frete% das fichas | **pulverização** (D11): distintos ÷ nomeados, razão 0–1; + frete% e % patrocinado da amostra | `vendedor` 13/20; frete e `tipoResultado` 20/20 |
| **Tração** | `valor_mercado` (Apify) ÷ vendedores (API oficial) — universos diferentes (premissa frágil nº 4 do ADR-0124) | faturamento por vendedor **da mesma subamostra nomeada** (D11) — numerador e denominador do mesmo universo; a premissa frágil se resolve | idem |
| **Marca** | % fichas com loja oficial | % da amostra com `loja_oficial === true` (o `raio_x` já conta) | alta (bool com null) |

- **Cortes:** os de Demanda sobrevivem (insumo idêntico). Os de Disputa e Tração da escala antiga são inválidos na fonte nova (D11) e serão re-derivados dos fixtures da recalibração (D12) — constantes com nomes novos, sem reaproveitar número morto.
- **Trava de cobertura (D10):** `vendedor` em <50% dos itens → Disputa e Tração indisponíveis; a escala proporcional do ADR-0124 §4 absorve. O undercount residual (nomeados ≤ reais) segue existindo dentro da subamostra e é absorvido pelos cortes recalibrados, não pela fórmula.
- **NÃO existe mais fallback sem Apify (ver D16).** O fallback do ADR-0124 §6 (Demanda por visitas quando a Apify falha) dependia de as fichas virem da API oficial. Na arquitetura nova a lista de anúncios vem da Apify, e as visitas são medidas *sobre essa lista* — sem Apify não há `item_ids`, logo não há visitas para somar. O caminho de código do fallback é removido, não reescrito.
- **Cortes de visitas recalibram assim mesmo:** `VISITAS = { boas, minimas }` seguem em uso dentro do fator Demanda quando a Apify responde, e a escala mudou ~324× (44.680 vs 138 no termo medido). Re-derivar dos payloads-gabarito (D12).
- **Marca segue alerta, nunca pontua** (decisão do Diego no ADR-0124 §5, inalterada).
- **Protocolo (D12):** 3 termos-gabarito, ≤ US$ 0,30, fixtures congelados, aceite **média / média / alta** na ordem, contingência "fator vira informativo" se a métrica não reproduzir o gabarito.

## O que perdemos (lista honesta)

Em relação à tela atual:

- **Vendedores/UF e "vendedor mais forte"** — `vendedorID` 0/20 na Apify e `/users/{seller_id}` sem seller_id; inobtenível por anúncio (medido 18/08).
- **Reputação/transações do vendedor** — mesma causa.
- **Seção "fichas sem vendedor ativo"** (oportunidade de prateleira vazia) — o universo de fichas morre com a `pulse-sonar`. É a única perda de informação útil real; se fizer falta, volta como consulta pontual separada (follow-up, não escopo).
- **Faixa de preço min/mediana/max por ficha e espalhamento** — vinham das ofertas da ficha; o anúncio tem um preço só.
- **Ofertas por ficha** — sem sentido na unidade anúncio.
- **Palavras-chave das fichas** — ficam só as dos títulos da amostra (`palavras_chave_titulos`, já existe).

Em relação ao Hunter Spy:

- **Idade do anúncio e vendas/mês estimadas** — `date_created` de terceiro: 403 em GET, 403 em multiget (sonda ADR-0125/D9, medida em produção 19/08), ausente no dataset Apify, e o número de pontos de visitas NÃO é proxy (refutado, D9). O histórico desta entrega é o substituto: vendas do período medidas, não estimadas.
- **Estoque disponível** — não vem em nenhuma fonte nossa.

Diferenciais que o Hunter não tem: visitas 30d reais da API oficial; simulador de margem com comissão real por categoria + imposto por origem; veredito do nicho; e, com o histórico acumulando, delta de vendas medido.

## Testes (TDD — RED antes de implementar)

**Morrem:**
- `src/lib/__tests__/sonar-cruzamento.test.ts` (16 testes) — módulo deletado.
- Em `supabase/functions/_shared/pulse/__tests__/sonar.test.ts`: casos de `montarPainelSonar`/`parseFichasBusca`/`resumoPrecos`.

**Mudam:**
- `src/lib/__tests__/sonar.test.ts` — caem `fichasAtivas`/`fichasSemVendedor`; ficam `passosProgresso` e `margemSimulada`.
- `src/lib/__tests__/veredito-sonar.test.ts` — reescrito sobre os fixtures reais dos 3 termos-gabarito (D12), com o aceite média/média/alta como asserts.
- `src/lib/__tests__/sonar-filtros.test.ts` — filtros sobre `ItemVendasSonar`; `maxVendedores` sai.
- `supabase/functions/_shared/pulse/__tests__/sonar-vendas.test.ts` — sobrevive; ganha os casos de snapshot.

**Nascem:**
- Mapeamento payload→linhas de snapshot (pura): null-safety LOUD (vendidos null nunca 0), idempotência da chave `(termo, item_id, gerado_em)`.
- Resposta da edge visitas (pura): item com falha → null sem derrubar o lote; **200 com total 0 → 0, não null** (D8); teto de 20 item_ids.
- Normalização do sparkline (pura): ordenar por data + preencher dias ausentes com 0 dentro da janela `date_from`→`date_to` (D9) — fixture com os 7 pontos embaralhados medidos.
- Veredito v2: pulverização e tração-por-subamostra (D11) com casos de censura (amostra de 5 vs 20 itens do mesmo nicho sintético → mesmo nível), trava de cobertura <50% (D10), 3 fixtures-gabarito (D12).
- Colunas/sort da tabela via `sortValue` puro.

Gate da entrega: `pnpm lint` + `pnpm test` (suíte completa, hoje 3521 testes) verdes.

## Rollout

1. Branch/worktree (nunca a main). Migration criada com `supabase migration new` + `supabase db push` (worktree exige `supabase link` antes) + `npm run db:check`.
2. Deploy das edges via CLI completa, na ordem: `pulse-sonar-vendas` (nova versão) → `pulse-sonar-visitas` (nova) → delete da `pulse-sonar`. Conferir versão pós-deploy. O diff toca `supabase/functions/**` → deploy é etapa obrigatória do "concluído", não opcional.
3. Front por último (merge na main com CI verde: `frontend`, `backend-lint`; pré-push com `npx tsc -b --force`). Janela em que o front velho chama a `pulse-sonar` deletada: segundos; aceitável para ferramenta interna (D14).
4. Caches: `sonar:v3` fica órfão e expira sozinho em ≤24h (ninguém mais lê); `sonar:vendas:v4` mantida sem bump (D5) — zero re-cobrança; `sonar:visitas:v1` nasce vazia.
5. Validação pré-merge em browser (sessão isolada, conta VALIDATION, dados injetados via route + reload): tabela com payload real injetado, coluna Visitas nos três estados (número, "0", "—"), sparkline com dias preenchidos, selo Catálogo, e o teste manual dos links do anúncio logado (D15). Screenshot real, não só snapshot de acessibilidade.
6. Pós-merge: deletar branch, remover worktree, `git pull` na main local. Docs e obsidian-vault no mesmo commit da entrega.

## Riscos abertos e follow-ups

- **Cobertura de `vendedor` (13/20) medida em UM termo.** A recalibração (D12) mede nos 3 termos-gabarito por ≤US$0,30; se em algum nicho cair abaixo de 50%, a trava de D10 dispara e o card fica só com Demanda+Marca — a frequência disso é desconhecida até medir.
- **A recalibração pode não reproduzir o gabarito.** Contingência definida em D12 (fator vira informativo), mas o resultado é medição — não está previsto aqui.
- **Gabarito N=3.** Mesmo débito do ADR-0124; ampliar para 20-30 termos rotulados pelo Diego custa US$ 2-3 de Apify + tempo dele. Follow-up, não escopo.
- **Ritmo do histórico: 1 ponto por termo a cada 7 dias** (efeito do cache). Série útil para "vendas do período" leva 1-2 meses de uso natural (estimativa). Alternativa: re-garimpo agendado semanal dos termos marcados, US$ 0,10/termo/semana — **decisão futura do Diego** (o custo é restrição dele; a consequência de não pagar, também).
- **Link do anúncio** — validável só no browser logado (D15); fallback definido, mas o comportamento real do `/up/MLBU…` só se conhece na validação.
- **`raio_x` e `palavras_chave_titulos` na tela nova** — seguem no payload; o lugar deles na tela reorganizada é decisão de UX da implementação, não deste design.
- **Drill-down "Análise de Anúncio"** — spec separada; consumirá `sonar_snapshots` por `item_id` (o índice já nasce pronto) e herda D13 (delta = piso).
