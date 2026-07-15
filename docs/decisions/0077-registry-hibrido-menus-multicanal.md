# ADR-0077: Registry híbrido para UI multi-marketplace (frontend + `canais_habilitados` por org)

**Status:** Aceito, em produção
**Data:** 2026-07-14 (decisão) · 2026-07-15 (implementado e em produção)
**Decisores:** Diego
**Relacionado:** [spec 2026-07-14 "menus multicanal"](../superpowers/specs/2026-07-14-menus-multicanal-design.md); [plano](../superpowers/plans/2026-07-14-menus-multicanal.md); refina ADR-0024 (abstração de canais/backend), ADR-0025 (`anuncios_externos`), ADR-0061 (orquestração multicanal); depende de ADR-0027 (multi-tenancy, `organizations`)

## Contexto

O PubliAI publica hoje só no Mercado Livre, mas o roadmap prevê 5 marketplaces (ML, Shopee,
Magalu, Amazon, Casas Bahia). O backend já tem a abstração de canal (`ChannelConnector`,
ADR-0024) e o modelo de dados (`anuncios_externos`, ADR-0025), mas a **UI** não tinha nenhuma
noção de "existem outros marketplaces" — cada tela era hard-coded para Mercado Livre, e a
regra de visibilidade do E6 (`src/lib/canais-ui.ts`) escondia qualquer elemento de canal até
existir um 2º canal REAL conectado, para não perturbar a experiência atual.

Faltava decidir: como a UI passa a mostrar os 5 marketplaces (vitrine do roadmap) sem
implicar que os 4 não-ML já funcionam, e como o rollout de um marketplace novo é controlado
por cliente (SaaS multi-tenant) sem exigir deploy por organização.

## Decisão

**Registry híbrido — duas fontes independentes, cada uma resolvendo uma pergunta diferente:**

1. **Registry estático de UI** (`src/lib/canais.ts`, frontend, sem I/O): catálogo dos 5
   marketplaces conhecidos, com `status: 'ativo' | 'em_breve'`. Resolve *"o que existe hoje no
   produto"* — muda só com deploy (é o registry que desenha tabs/cards/badges).
2. **Habilitação por organização** (`organizations.canais_habilitados text[]`, banco,
   `security definer` RPC `canais_habilitados_da_org()`): resolve *"o que esta organização
   pode operar"* — muda por ação do super-admin (`/admin`, edge `usuarios` action
   `set_canais_org`), sem deploy.

Um canal só é **operável** para uma org quando as duas condições se cruzam: `status='ativo'`
no registry **E** presente em `canais_habilitados` da org (`canaisOperaveis`). Caso contrário,
aparece como vitrine "Em breve" (`canaisEmBreve`) — inclusive um canal já `ativo` no produto mas
ainda não habilitado para aquela org específica, o que permite rollout piloto por cliente.

**Isto é explicitamente independente do registry de conectores do backend**
(`_shared/canais/registry.ts`, `getConnector(canal)`, ADR-0024) — mesmo nome conceitual,
camadas diferentes. Um marketplace novo exige entrada nos dois; um pode evoluir sem o outro
(ex.: o registry de UI pode listar Shopee como "em breve" muito antes do `ShopeeConnector`
existir, e o inverso também é válido caso o backend termine antes da UI).

**Consequência para a regra de visibilidade do E6:** a regra anterior de "esconder toda UI de
canal até existir 2º canal real" (`src/lib/canais-ui.ts`, `deveMostrarSeletorCanais`/
`deveMostrarChipCanal`) foi **revertida** — a vitrine multicanal (tabs "Todos"/"Em breve",
tela `/canais`) agora é sempre visível, mesmo com só o ML operável. Racional: mostrar o roadmap
de marketplaces é uma feature do produto SaaS (vitrine comercial), não um vazamento de
implementação incompleta — diferente do E6, onde o seletor de canal na Revisão só fazia sentido
operacionalmente quando havia 2+ canais reais para escolher.

## Alternativas rejeitadas

- **Só registry no backend, UI deriva dele em runtime** — acoplaria o deploy do frontend ao
  deploy de cada conector novo; o registry de UI puro-frontend permite desenhar a vitrine
  "em breve" de um canal sem nenhum código de conector existir ainda.
- **Habilitação só por deploy (sem `canais_habilitados`)** — todo cliente veria o canal novo
  no mesmo instante do deploy; sem esta coluna não há como fazer rollout piloto por
  organização (testar Shopee com 1 cliente antes de abrir para todos).
- **Uma única tabela/registry compartilhada front+back** — os dois lados evoluem em ritmos
  diferentes (UI pode antecipar a vitrine; backend pode atrasar por complexidade de
  integração como HMAC da Shopee); acoplar os dois cria uma dependência de deploy
  desnecessária entre times/etapas.

## Consequências

- **E5 (Shopee) vira "preencher a interface" também na UI**: implementar `ShopeeConnector`
  (backend, ADR-0024) + registrar no registry de UI (`status: 'em_breve' → 'ativo'`) +
  adicionar `'shopee'` ao enum `canal_externo`. Nenhuma tela precisa ser redesenhada.
- Migration aditiva `20260715014055_menus_multicanal` (`organizations.canais_habilitados`
  default `'{mercado_livre}'`, RPC `security definer` `search_path=''`) — reversível, RLS
  intacta (a RPC só lê a própria org via `current_org_id()`).
- Dívida explícita, documentada nos follow-ups (`docs/TASKS.md`): o dialog de publicação na
  Revisão ainda tem texto fixo "Publicar no Mercado Livre" — corrigir quando o 2º canal
  operável existir; sub-abas do Faturamento (Devoluções/Perguntas/Mensagens/Geografia) ainda
  não recebem o parâmetro de canal (sem efeito hoje, só ML tem dado).
