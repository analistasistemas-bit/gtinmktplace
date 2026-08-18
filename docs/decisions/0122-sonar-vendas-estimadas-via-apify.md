# ADR-0122 — Sonar: vendas estimadas do nicho via Apify

- **Status:** aceito
- **Data:** 2026-08-18
- **Relacionados:** ADR-0119 (Pulse), ADR-0120 (Sonar catálogo-only)

## Contexto

O ADR-0120 entregou o Sonar cobrindo só dados oficiais do ML (fichas de catálogo, visitas,
ofertas) e **descartou scraping pago** com a ressalva explícita: "reavaliar se o garimpo
catálogo-only se provar insuficiente" (0120:69-71). Provou-se: comparado ao Hunter Spy, o Sonar
não responde "quanto esse nicho vende" — e a API oficial não expõe vendas de terceiros
(Errata 9 do 0119). Diego reavaliou e **contratou a Apify** para suprir exatamente essa lacuna.

O que o Hunter Spy tem e o Sonar não tinha: **Vendas Totais**, **Mercado Endereçável (R$)**,
**Produto Destaque** e palavras-chave de títulos de anúncios reais (as nossas vinham dos nomes
das fichas de catálogo). Visitas 30d o Sonar já tem — e melhor (API oficial, série diária);
nenhum scraper entrega visitas porque elas não aparecem na página pública.

## Decisão

1. **Edge function separada `pulse-sonar-vendas`** (`verify_jwt = true`), chamada pelo front em
   paralelo à `pulse-sonar`. Separada porque: o run síncrono da Apify pode levar minutos
   (limite 300 s / HTTP 408) e não pode segurar nem derrubar o painel oficial; falha da Apify
   degrada só o bloco de vendas.
2. **Actor:** `karamelo/mercadolivre-scraper-brasil-portugues` (BR-nativo, ~$1.20/1.000
   resultados, único barato que retorna `quantidadeVendida` sem enrichment pago). Input:
   `{ keyword, maxPages: 1 }` (~50 anúncios, ordem de relevância do ML — comparável ao "top 66"
   do Hunter). Chamada síncrona `run-sync-get-dataset-items` com `timeout=120s`; padrão
   assíncrono (start + poll) só se o timeout se provar insuficiente na prática.
3. **Cache Redis 24 h, chave global `sonar:vendas:v1:MLB:<termo>`** — mesmo racional do
   ADR-0120 §3 (dado público, sem org_id). Cache também limita o custo Apify: 1 run por
   termo/dia no máximo (~US$ 0,06 por 50 itens).
4. **Semântica do dado (regra LOUD):** `quantidadeVendida` é o "+N vendidos" da página —
   **acumulado desde a criação do anúncio, arredondado pelo ML (piso), não é venda mensal nem
   exata**. A UI exibe com "≈", rotula "acumulado" e informa quantos anúncios têm o dado.
   `Mercado endereçável ≈ Σ preço × vendidos` dos anúncios analisados — derivação aritmética de
   dois dados reais da página, nunca visitas×conversão (que segue proibido pelo 0120:75-76).
   Anúncio sem o dado **não soma como zero**.
5. **Sem token (`APIFY_TOKEN`) → indisponível explícito** (`{ configurado: false }`), nunca
   número inventado nem erro barulhento. Token: secret de edge (`supabase secrets set
   APIFY_TOKEN=...`); no dev, placeholder em `.env.local`.

## Alternativas descartadas

- **Integrar na `pulse-sonar`:** acopla o painel oficial ao tempo/custo/falha da Apify; um run
  lento estouraria o teto da edge inteira.
- **Actor `scrapers_lat/mercadolibre-scraper`:** sold_quantity só com detail enrichment, a
  partir de $6.15/1k — 5× o custo para o mesmo campo.
- **Persistir histórico de vendas por termo:** adiado junto com "monitorar este termo"
  (0120 §3). O bloco é on-demand com cache 24 h; longitudinal só quando houver demanda real.

## Consequências

- Custo variável por termo novo (~US$ 0,06/run), limitado pelo cache global 24 h.
- Dependência de HTML de terceiro (via actor mantido pela comunidade Apify): aceita porque está
  isolada numa edge própria, com parser tolerante e degradação silenciosa para o resto do Sonar.
- Run síncrono que estourar o timeout é cobrado pela Apify mesmo sem devolver resultado —
  aceito; se frequente, migrar para start + poll.
