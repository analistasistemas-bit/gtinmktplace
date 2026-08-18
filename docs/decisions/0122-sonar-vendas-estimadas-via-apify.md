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
2. **Actor:** `karamelo/mercadolivre-scraper-brasil-portugues` (BR-nativo, único barato que
   retorna `quantidadeVendida` sem enrichment pago). Input: `{ keyword, maxPages: 1 }`, ordem de
   relevância do ML. Chamada síncrona `run-sync-get-dataset-items` com `timeout=120s`; padrão
   assíncrono (start + poll) só se o timeout se provar insuficiente na prática.
3. **Teto de gasto por busca: `maxTotalChargeUsd=0.10` ≈ 20 anúncios.** Escolhido pelo Diego em
   18/08 pesando custo × cobertura, depois de um teste em 0,03 (6 anúncios) que se mostrou barato
   demais em informação. Histórico do teto: 0,24 sem teto → 0,10 → 0,03 → **0,10**. O preço real medido é
   **US$ 0,005 por anúncio** (a página do actor anuncia "a partir de US$ 1,20/1.000"; o cobrado é
   US$ 5,00/1.000 — a estimativa original de ~US$ 0,06 por busca estava 4× baixa: 1 página cheia
   custava **US$ 0,24**). Como o modelo é PAY_PER_EVENT **sem custo fixo de run**, o teto é a
   alavanca direta: gasto e nº de anúncios andam juntos. Atingir o teto devolve o run como
   **SUCCEEDED** com os itens que couberam, não como falha (medido em 18/08: teto 0,05 → 10 itens,
   HTTP 201). `maxItems` não serve — só vale para actors pay-per-result.
   Trade-off aceito, medido sobre dados reais (dataset de 48 anúncios de "protetor solar facial"):
   10 anúncios capturam 42% das vendas, 20 capturam 62%, 30 capturam 85% — e o **produto destaque
   é o mesmo em qualquer corte** (o mais vendido está sempre no topo da relevância). Perde-se
   altura no total, não a leitura do nicho; como todo termo usa o mesmo corte, os nichos seguem
   comparáveis entre si. A UI chama o bloco de "amostra dos N anúncios mais relevantes".
4. **Cache Redis 7 dias, chave global `sonar:vendas:v2:MLB:<termo>`** — mesmo racional do
   ADR-0120 §3 (dado público, sem org_id). 7 dias e não 24 h porque o dado é acumulado histórico
   em faixas arredondadas: praticamente não muda de um dia para o outro, e repetir o termo era o
   desperdício mais caro. A **versão da chave identifica o corte** (v1=48 anúncios, v2=20, v3=6) e
   não é um contador: voltar ao corte de 20 volta à v2 e reaproveita o cache válido em vez de
   pagar runs de novo. Sem essa separação, painéis de cortes diferentes conviveriam por uma semana
   com totais incomparáveis entre termos.
5. **Semântica do dado (regra LOUD):** `quantidadeVendida` é o "+N vendidos" da página —
   **acumulado desde a criação do anúncio, arredondado pelo ML (piso), não é venda mensal nem
   exata**. A UI exibe com "≈", rotula "acumulado" e informa quantos anúncios têm o dado.
   `Mercado endereçável ≈ Σ preço × vendidos` dos anúncios analisados — derivação aritmética de
   dois dados reais da página, nunca visitas×conversão (que segue proibido pelo 0120:75-76).
   Anúncio sem o dado **não soma como zero**.
6. **Sem token (`APIFY_TOKEN`) → indisponível explícito** (`{ configurado: false }`), nunca
   número inventado nem erro barulhento. Token: secret de edge (`supabase secrets set
   APIFY_TOKEN=...`); no dev, placeholder em `.env.local`.

## Alternativas descartadas

- **Integrar na `pulse-sonar`:** acopla o painel oficial ao tempo/custo/falha da Apify; um run
  lento estouraria o teto da edge inteira.
- **Actor `scrapers_lat/mercadolibre-scraper`:** sold_quantity só com detail enrichment, a
  partir de $6.15/1k — 5× o custo para o mesmo campo.
- **Persistir histórico de vendas por termo:** adiado junto com "monitorar este termo"
  (0120 §3). O bloco é on-demand com cache; longitudinal só quando houver demanda real.

### Buscas por um fornecedor mais barato (todas medidas em 18/08, todas descartadas)

O alvo era US$ 0,03/consulta **sem** perder anúncios. Nenhuma via entregou — registrado aqui para
não repetir a pesquisa:

| Via | Resultado medido |
|---|---|
| Scraper próprio (`apify/website-content-crawler`, cheerio) + proxy **datacenter** | ML devolve página vazia (só banner de cookies) — bloqueio |
| Idem + proxy **residencial** (US$ 8/GB) | ML devolve a tela "Continuar": exige execução de JS, cheerio não serve |
| `apify/cheerio-scraper` (pageFunction própria) | Exige aprovação manual de "full permission" na conta; não testado além disso |
| Apify Proxy direto via HTTP, sem actor | HTTP 403 `x-apify-proxy-error` — recurso de plano pago |
| `gio21/mercado-livre-scraper` (US$ 0,00175/item, 2,9× mais barato) | **Não retorna quantidade vendida** |
| `automation-lab/mercado-livre-brazil-scraper` (vendas confirmadas no README) | Só raspa `mercadolivre.com.br/ofertas`; ignora busca por termo e devolveu 0 itens |

**Conclusão:** os US$ 0,005 por anúncio do `karamelo` são o preço do *desbloqueio* (browser real +
proxy premium), não margem gorda — as mesmas proteções que barraram curl/Playwright/Chrome no
ADR-0120 barram qualquer scraper próprio barato. A única alavanca de custo é a **quantidade de
anúncios**. Reavaliar apenas se: (a) a Apify reduzir o preço por item em plano pago, ou (b) o ML
voltar a expor `sold_quantity` de terceiros na API oficial.

## Consequências

- Custo **US$ 0,10 por termo novo** (teto duro por run, §3), contra US$ 0,24 sem teto. **O cache
  limita repetições do mesmo termo, não o gasto total:** termos distintos são ilimitados e não há
  cota por org, então o teto real é "quantos termos novos forem garimpados na semana". Dois
  pedidos simultâneos do mesmo termo ainda não-cacheado também disparam dois runs pagos (o lock
  `redisSetNX` de `_shared/redis/client.ts` resolve, se o volume justificar). Rever com quota por
  org se o gasto incomodar.
- A conta Apify é **única e global** (um `APIFY_TOKEN`, não uma chave por org): todo o consumo de
  todas as orgs cai na fatura da DALUDI. No plano FREE (US$ 5/mês) isso dá ~50 termos novos por
  mês — o cache de 7 dias é o que estica esse número na prática.
- `vendas_totais` soma faixas arredondadas do ML (100 / 500 / 1k / … / 250k), então o total exibido
  tem menos precisão do que os dígitos sugerem — daí o "≈" e o rótulo de acumulado na UI.
- Dependência de HTML de terceiro (via actor mantido pela comunidade Apify): aceita porque está
  isolada numa edge própria, com parser tolerante e degradação silenciosa para o resto do Sonar.
- Run síncrono que estourar o timeout é cobrado pela Apify mesmo sem devolver resultado —
  aceito; se frequente, migrar para start + poll.
