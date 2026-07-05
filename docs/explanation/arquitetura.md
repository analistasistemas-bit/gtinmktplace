# Arquitetura do PubliAI

> **Tipo:** Explanation (Diátaxis). Visão de alto nível de como o sistema funciona ponta a
> ponta e por quê. Para fatos pontuais use a [Reference](../reference/); para executar
> tarefas use os [How-to](../how-to/). Termos em [glossario.md](../reference/glossario.md).
> Versão visual (C4, ERD, sequências): [diagrams/](../diagrams/).

## Em uma frase

PubliAI transforma planilhas de produtos em anúncios publicados em marketplaces (hoje
Mercado Livre), usando IA como copywriter e um pipeline assíncrono com revisão humana
obrigatória antes de cada publicação.

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | React 18 + TypeScript + Vite + shadcn/ui + Tailwind + TanStack Query + Zustand + React Router |
| Hospedagem do frontend | Render (Static Site) |
| Backend / DB / Auth / Storage | Supabase (Postgres + Edge Functions Deno + Storage + Auth) |
| Fila assíncrona | Upstash QStash (retry automático) |
| Cache + locks | Upstash Redis |
| IA | OpenRouter (gateway compatível com OpenAI) — copy + Vision |
| Integrações | Mercado Livre (OAuth, items, webhooks), Mercado Pago (financeiro), Telegram (alertas) |

Detalhes e justificativas em ADR-0001 (stack), ADR-0006 (QStash), ADR-0010 (OpenRouter).

## Princípios que moldam o sistema

1. **Revisão humana antes de publicar.** O pipeline para na etapa de revisão; nada vai ao
   ar sem aprovação do operador.
2. **Workers idempotentes.** Toda Edge Function disparada por fila pode ser reexecutada sem
   efeito colateral duplicado (claims atômicos, upserts, reuso de IDs).
3. **Assíncrono por fila.** Trabalho pesado (IA, publicação no ML) sai do request HTTP e vai
   para o QStash, que dá retry. O frontend acompanha por status no banco.
4. **Multi-tenant por `org_id` + RLS (ADR-0027).** Cada organização (empresa cliente) só enxerga
   os próprios dados — o isolamento é por `org_id`, não por usuário; usuários da mesma empresa
   compartilham tudo (operação compartilhada, ADR-0047).
5. **Segredos fora do código.** Tokens OAuth no Vault; chaves de API em Supabase Secrets.
6. **Multicanal por abstração.** A lógica de publicação fala com um *conector* de canal, não
   com o ML diretamente (ADR-0024/0025) — preparado para o 2º marketplace.

## Pipeline ponta a ponta

O coração do produto é a jornada planilha → anúncio, espelhada nos status de `lotes` e
`familias` e mapeada em `src/lib/jornada.ts`.

```
[Operador]                [Edge Functions / QStash]                 [Estado]
   │
   │ upload planilha + fotos
   ▼
1. ingest-lote ───────────────────────────────────────────────►  lote: importando→processando
   │ valida colunas, agrupa por PAI, casa fotos,                  familias: pendente/pronto
   │ detecta CREATE vs UPDATE, cria familias+variacoes
   │ enfileira famílias pendentes ──┐
                                     ▼
2. process-familia (QStash worker) ───────────────────────────►  familia: processando→pronto/erro
   │ claim atômico (pendente→processando)
   │ resolve cor (dicionário→Vision→cache Redis)
   │ gera copy (OpenRouter), detecta categoria, monta atributos,
   │ calcula estratégia de preço, análise de concorrência
                                     ▼
3. REVISÃO HUMANA (tela Revisao) ─────────────────────────────►  lote: revisao
   │ operador confere copy/preço/cor/categoria,
   │ exclui variações, escolhe o que publicar
   │ "Publicar" ──┐
                  ▼
4. publicar-familias → fila serial (parallelism=1) ───────────►  familia: publicando
   │   ├─ publish-familia-ml (CREATE)  ──┐
   │   └─ update-familia-ml   (UPDATE) ──┤
   │      sobe fotos, cria/atualiza item no ML, aplica atacado,  familia: publicado
   │      espelha em anuncios_externos, enfileira vínculo de     anuncios_externos: upsert
   │      catálogo com delay de 10 min ──┐
                                         ▼
5. vincular-catalogo (QStash, delay 10min) ───────────────────►  variacoes.catalog_status
       opt-in de catálogo por GTIN; alerta Telegram se no-match  lote: concluido
```

Referências de código: `src/lib/{ingest,publicar,publicavel,jornada,queries}.ts`;
`supabase/functions/{ingest-lote,process-familia,publish-familia-ml,update-familia-ml,vincular-catalogo}`.
Por que fila serial na publicação: ADR-0034. Por que delay no catálogo: ADR-0021.

## Por que QStash (e não fila no Postgres)

Publicar no ML é lento e sujeito a falhas transitórias (foto em processamento assíncrono,
429, 5xx). Tirar isso do request e delegar a uma fila com retry nativo simplifica o backend
e dá resiliência. O Postgres guarda só o **estado** (`status`, `qstash_message_id`), não a
fila em si. Detalhe e trade-offs em ADR-0006. O retry interno de foto está em ADR-0033.

## Por que fila serial por usuário

Publicações concorrentes da mesma conta colidiam no ML (foto assíncrona ainda indisponível
→ item travado em "publicando"). A solução foi uma fila QStash com `parallelism=1` por
usuário: as publicações de uma conta acontecem uma de cada vez. Ver ADR-0034 e a nota de
`reference_publicacao_concorrente_backoff`.

## Autenticação e fronteiras de confiança

- **Frontend → Edge Function:** JWT do Supabase. Funções com `verify_jwt=true` são validadas
  pelo gateway; as com `verify_jwt=false` leem o `Authorization` na mão (`requireUser`).
- **QStash → worker:** assinatura `upstash-signature` validada por `verificarAssinatura`.
  O worker usa `service_role` (contorna RLS) para escrever.
- **Mercado Livre → ml-webhook:** receiver público que faz ACK rápido, deduplica e
  re-enfileira; nunca confia no corpo (o worker re-busca autenticado).
- **OAuth ML:** refresh de token protegido por lock Redis para evitar corrida (ADR-0012);
  tokens guardados criptografados no Vault.

> ⚠️ Há divergências atuais de `verify_jwt` no `config.toml` para funções acionadas por
> QStash/webhook — ver a nota no fim de [edge-functions.md](../reference/edge-functions.md).

## Multi-tenancy (`org_id`, ADR-0027)

Da E1 ao E6, "multi-usuário" significava **operação compartilhada** (ADR-0047): qualquer usuário
autenticado via `is_membro_operacao()` enxergava e operava os mesmos dados — um tenant só (a Avil).
O E7 introduz o **discriminador `org_id`** para virar SaaS multi-empresa, sem trocar de padrão
(shared DB + shared schema, não schema/DB por tenant — não escala no orçamento do projeto):

- **`organizations`** é o tenant. Cada `profiles` pertence a exatamente 1 org (`org_id NOT NULL`);
  sem `organization_members`/papéis finos por ora — YAGNI enquanto for 1 admin por empresa
  (D-E7.1/D-E7.2 do ADR-0027).
- **`current_org_id()`** é o pivô: função `SECURITY DEFINER STABLE` que devolve a org do chamador
  ativo. Toda policy de RLS nas 12 tabelas de domínio + storage virou `org_id = (select
  current_org_id())` — substituindo `is_membro_operacao()`, que foi dropada. `STABLE` cacheia a
  chamada 1× por statement (initplan), então o custo por linha é só o índice em `org_id`.
- **`marketplace_connections`** substitui `ml_credentials`: a credencial do canal (ex.: token OAuth
  do ML) é da **organização**, não do usuário que conectou — qualquer membro da org publica.
- **O maior risco é estrutural, não de RLS.** Workers/edge functions usam `service_role`, que
  **contorna RLS por definição** — a RLS nova não os protege sozinha. A blindagem real é a
  **propagação obrigatória de `org_id`** em todo caminho de escrita: `requireUserOrg(req)` resolve
  `{userId, orgId, isAdmin}` no início de cada função autenticada; workers sem chamador HTTP
  (webhook, sync, reconciliação) resolvem a org via `marketplace_connections`
  (`resolverIdentidade`/`resolverOrgPorUserId`); e a coluna `org_id NOT NULL` falha alto (erro de
  INSERT) se algum caminho esquecer de propagá-la — defesa estrutural, não só convenção de código.

## Multicanal (preparação para o 2º marketplace)

Hoje só existe o Mercado Livre, mas a arquitetura já separa **o que publicar** de **onde
publicar**:

- **Conector de canal** (`_shared/canais/`): interface única (`criarAnuncio`,
  `atualizarAnuncio`, `lerStatus`, …). `MercadoLivreConnector` delega às funções `_shared/ml/*`.
- **`anuncios_externos`**: espelho normalizado com identidade `(org_id, canal, codigo_pai,
  particao)` — da **organização**, não do usuário, desde o E7 (ADR-0027) —, estável mesmo quando
  lotes/famílias mudam. Workers fazem dual-write nele.

A fonte de verdade ainda são as colunas `ml_*` em `familias`/`variacoes`; `anuncios_externos`
é o espelho que vira fonte quando entrar o 2º canal (Shopee, épico E5). Ver ADR-0024/0025 e a
spec de evolução SaaS em `docs/superpowers/specs/`.

## Módulos além da publicação

- **Faturamento** (ADR-0037/0038/0039): vendas, perguntas e devoluções do ML via webhooks +
  backfill + reconciliação periódica. Tabelas `ml_vendas`, `ml_perguntas`, `ml_devolucoes`.
- **Financeiro** (ADR-0031/0040): "a receber" e liberações via Mercado Pago.
- **Monitoramento** (ADR-0035): varredura de anúncios moderados + alertas Telegram.
- **Viabilidade** (ADR-0014/0015): análise de concorrência e margem antes de cadastrar.

## Mapa do código

```
src/
├── lib/          lógica de domínio (queries, cálculos, ingest, publicar, jornada, tipos)
├── pages/        rotas (Dashboard, NovoLote, Revisao, Publicados, Faturamento, Financeiro…)
├── components/   componentes React
├── hooks/        hooks de dados (TanStack Query)
└── stores/       estado global (Zustand)

supabase/
├── functions/    32 Edge Functions Deno + _shared/ (ml, ai, canais, redis, queue, …)
├── migrations/   DDL do schema (fonte única — ADR-0043)
└── config.toml   verify_jwt por função

docs/
├── explanation/  visão conceitual (você está aqui)
├── reference/    glossário, modelo de dados, edge functions
├── how-to/       guias de tarefa (dev local, deploy, migrations, operações)
├── decisions/    ADRs (o "porquê", imutáveis)
└── runbooks/     procedimentos operacionais
```
