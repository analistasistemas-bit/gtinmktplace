# ADR-0119 — Pulse: inteligência de mercado dirigida, server-side e sem crawl massivo

**Status:** Aceito — design fechado em entrevista (grill-with-docs, 2026-08-16); implementação não iniciada
**Data:** 2026-08-16
**Relacionados:** ADR-0055 (markup/imposto por origem), ADR-0086 (config org-scoped), ADR-0118 (extensão `extensao-ml/`), ADR-0021 (catálogo)

## Problema

O operador decide preço, entrada em nicho e reação à concorrência às cegas: a API privada do ML
(Orders) só mostra as **próprias** vendas. Ferramentas como a Joom Pulse mostram vendas, receita e
histórico de preço **de qualquer anúncio** — e o segredo delas não é acesso especial, é coleta de
dados públicos acumulada ao longo do tempo:

- `sold_quantity` público (items/search) + **snapshots periódicos** → delta entre snapshots = vendas estimadas no período;
- estoque público (`available_quantity`), reputação de seller, catálogo, Trends API;
- extensão Chrome apenas como UX (overlay na página do ML) e ponto de coleta.

Queríamos essa capacidade dentro do PubliAI, sem "implementação gigante".

## Decisão

**Menu "Pulse" no PubliAI, alimentado por coletor server-side. Sem extensão Chrome no v1.**

1. **Radar dirigido, não crawl.** Monitoram-se apenas: (a) concorrentes auto-descobertos dos
   anúncios publicados da org — via `catalog_product_id` quando de catálogo, senão busca por
   GTIN/título, **top-10 por vendas** —; (b) itens adicionados manualmente (URL/MLB-id). Termos de
   busca monitorados (pesquisa de nicho) ficam para o v2 — o modelo de dados já os prevê.
2. **Snapshots com travas de crescimento:** grava-se linha diária por item **só se algo mudou**;
   cru diário vive 90 dias e é agregado em resumo semanal; item morto (anúncio encerrado, produto
   despublicado, tela sem acesso há 60 dias) sai de coleta; teto de itens por org (base de tier
   premium futuro). Banco estabiliza (~centenas de MB em anos, na escala atual).
3. **Coleta na stack existente:** QStash cron + edge function; baseline diário + tier "quente"
   (6/6h) para concorrentes diretos de anúncios ativos — alerta chega em horas.
4. **Escopo v1 (3 telas/decisões):** concorrência por anúncio (reprecificar?), alertas de mudança
   (agir quando?), rentabilidade real (até onde baixar? — usa `variacoes.custo`, comissão, imposto
   8/16% por origem, frete).
5. **Diferenciais v1 sobre a Joom Pulse** (ela só vê dado público e não age):
   **alerta acionável** — margem calculada no alerta + botão de reprecificar (com revisão humana,
   como sempre) — e **price-to-win do catálogo** (buy box: quem tem e qual preço ganha).
6. **Rollout:** coleta roda para **todas** as orgs desde o dia 1 (histórico acumula); menu visível
   por config org-scoped na tela de Configurações (mesmo padrão do menu Estoque, ADR-0086). Liga-se
   primeiro para DSA; Avil quando os números estiverem calibrados — e já nasce com histórico.

## Alternativas descartadas

- **Extensão Chrome no v1** (paridade com a Joom Pulse): custo permanente de manutenção (review da
  Web Store, MV3, DOM do ML quebrando) para ganhar apenas o overlay. O v2 pode reusar a
  `extensao-ml/` do ADR-0118 se o overlay provar valor.
- **Crawl massivo / pesquisa livre** (150M itens, estilo Joom Pulse): infra dedicada e banco
  crescendo antes de qualquer uso. O radar dirigido só paga pelo que está em decisão.
- **Números "instantâneos" sem espera:** desnecessário — o 1º snapshot já dá velocidade média
  vitalícia (`sold_quantity ÷ idade do anúncio`); só a tendência recente exige 1–2 semanas de
  acúmulo.

## Consequências

- O valor do histórico cresce com o tempo de coleta — ligar a coleta cedo é parte da decisão.
- Vendas são **estimativas** (delta de dado público, com faixas "50+" do ML); a UI deve rotulá-las
  como estimadas, nunca como fato.
- Novas orgs entram automaticamente no ciclo de coleta; histórico delas começa do zero na entrada.
