# ADR-0120 — Pulse Sonar: garimpo de sortimento por termo, só API oficial

**Status:** Aceito — design fechado em entrevista (grilling, 2026-08-17); implementação não iniciada
**Data:** 2026-08-17
**Relacionados:** ADR-0119 (Pulse v1 + erratas), ADR-0055 (imposto por origem), ADR-0086 (módulos por org), ADR-0118 (extensão)

## Problema

O operador decide **o que cadastrar** às cegas: o PubliAI só analisa produtos que já entraram por
planilha (Viabilidade) ou já foram publicados (Pulse Radar). Ferramentas como o Hunter Spy
("Garimpador") respondem "vale entrar neste nicho?" antes de qualquer cadastro. O ADR-0119 já
previa "termos de busca monitorados" como v2 do Pulse.

Investigação de 2026-08-17 (interceptando o próprio Hunter no navegador + testes com token real)
estabeleceu os fatos que viabilizam e limitam esta feature:

1. **O "número de vendas" do Hunter é a faixa pública "+N vendidos" raspada do site** — o campo
   `sales` da API deles só assume {0,1,2,3,4,5,25,50,100,1000,5000} e a soma bate com o KPI da
   tela. Não existe API secreta de vendas de terceiros.
2. **Endpoints oficiais vivos além dos da Errata 2 do ADR-0119** (testados com token):
   `/products/search?q=<termo>` (busca textual no **catálogo**, paging.total até 10.000) e
   `/items/{id}/visits/time_window?last=30&unit=day` (**visitas diárias de item de terceiro** —
   medido ao vivo). Multiget de visitas com janela é limitado a 1 id por chamada
   (`maximum amount of items to query is 1`); `/visits/items?ids=` devolve o total vitalício.
3. Continuam mortos para terceiros: `/sites/MLB/search` (403 com e sem token), `/items/{id}` de
   terceiro (403), `/orders` de terceiro, `/users/{seller}/items/search` (403). Scraping direto do
   site cai em `suspicious-traffic` (curl, Playwright limpo e Chrome channel — 3 formas testadas).

## Decisão

**Aba "Sonar" dentro do menu Pulse: pesquisa de nicho por termo, alimentada exclusivamente pela
API oficial do ML, on-demand com cache.** ("Radar" vigia o que já vendemos; "Sonar" varre o que
ainda não vendemos.)

1. **Caso de uso: garimpo de sortimento.** O operador digita um termo (ex. "tecido oxford 10
   metros") e decide se vale cadastrar o produto — antes de existir planilha. Não substitui o
   Radar (concorrência do que já está publicado) nem a Viabilidade (margem do que já foi ingerido).
2. **Só API oficial no v1.** Fontes: `/products/search` (fichas de catálogo do termo),
   `/products/{id}/items` (ofertas/preços/vendedores por ficha — parse já existente),
   `/users/{seller_id}` (reputação, transações totais, UF — parse já existente),
   `/items/{id}/visits/time_window` (demanda por item), `/highlights` + `/trends` da categoria
   dominante. **Aceita-se os dois limites:** cobertura catálogo-only (GTIN interno fica fora,
   Errata 2 do 0119) e ausência da faixa "+N vendidos" (exigiria scraping). Nenhum número de
   venda é inventado: demanda = visitas medidas + transações totais do vendedor + posição no
   ranking, sempre rotuladas pelo que são (regra LOUD).
3. **On-demand com cache Redis 24h** (`sonar:v1:MLB:<termo normalizado>`, resultado agregado).
   Dado público e idêntico entre orgs → chave **global**, sem org_id. Cada garimpo custa ~40–60
   chamadas (1 busca + N fichas + N visitas + vendedores, N=20 fichas no v1); o cache impede
   repetição no mesmo dia. "Monitorar este termo" (histórico/alertas) fica para fase futura sobre
   o coletor de snapshots existente — o modelo de dados do 0119 já o previa.
4. **Painel v1 (4 blocos):** Demanda (visitas 30d por ficha + gráfico diário agregado + posição no
   top-20 da categoria + termos em alta), Concorrência/barreira (ofertas por ficha, vendedores com
   reputação/transações/UF/oficial/Full, % frete grátis), Preço + margem (faixa min/mediana/max e
   simulador "a este preço você receberia X" — comissão/frete via `calcular-tarifa-ml`, imposto
   por origem escolhido explicitamente pelo operador, **custo hipotético digitado** — no garimpo
   não existe `variacoes.custo` e defaultar custo é proibido), Palavras-chave (termos extraídos
   dos nomes das fichas).
5. **UX de espera:** a pesquisa leva segundos; a tela mostra **progresso por etapas** ("Buscando
   fichas do catálogo → Analisando concorrentes → Medindo visitas → Montando painel") para
   evidenciar que o sistema não travou. A aba abre com **texto explicativo** do que o Sonar faz e
   dos limites do dado (catálogo-only; demanda por visitas, não por vendas exatas).
6. **Mesmo módulo org-scoped do Pulse** (`organizations.modulos_habilitados`, ADR-0086/0119 §6
   corrigido) — sem menu novo, sem flag nova.
7. **Escopo acoplado ao épico:** coluna **"Visitas 30d"** nos concorrentes do Radar existente,
   reusando o mesmo módulo de visitas apontado para `pulse_ofertas_atual.item_id`.

## Alternativas descartadas

- **Scraping pago (Zyte/ScraperAPI) para a faixa "+N vendidos" e itens sem catálogo:** iguala o
  Hunter, mas cria custo mensal, risco de ToS e dependência de HTML instável — contra o espírito
  do 0119 ("sem crawl massivo"). Reavaliar se o garimpo catálogo-only se provar insuficiente.
- **Acoplar à extensão Chrome (v2 do 0119):** cobre tudo, mas atrasa o v1 pela complexidade de
  Web Store/MV3; a extensão continua no roadmap como caminho de cobertura do Radar, não como
  pré-requisito do Sonar.
- **Vendas estimadas = visitas × conversão:** número inventado apresentado como venda — viola a
  regra LOUD. Mostramos visitas e deixamos a inferência para o operador.
- **Menu próprio "Garimpador":** nome colado no concorrente e mais um módulo para gerir; a aba
  dentro do Pulse mantém a família "inteligência de mercado" coesa.

## Consequências

- O ADR-0119 ganha errata apontando que `/products/search?q=` e visits de terceiros estão vivos
  (a tabela da Errata 2 dizia "não há caminho pela API" para busca textual — havia, no catálogo).
- `pulse_ofertas_atual` ganha coluna de visitas (migration; detalhes no plano).
- Verificação pendente para o executor: confirmar que `/products/{id}` devolve `category_id`
  (necessário para tarifa/highlights/trends da ficha); se não devolver, resolver categoria pela
  ficha mais barata via oferta própria ou registrar limitação.
- Plano: `docs/superpowers/plans/2026-08-17-pulse-sonar-plan.md`.
