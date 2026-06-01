# CLAUDE.md — Contexto persistente do projeto PubliAI

> Este arquivo é o **system prompt do projeto**. Toda sessão de Claude Code (ou outro agente IA) deve lê-lo primeiro, antes de tocar em qualquer arquivo. Ele resume regras, convenções, decisões e workflow do projeto, e aponta para a documentação detalhada.

**Última atualização:** 2026-05-29
**Status do projeto:** M0+M1+M2+M3+M3.1 ✅ concluídos; M4 (Integração ML) em andamento — **OAuth ✅** + **concorrência ✅** + **estratégia de preço ✅** + **categorias/atributos ✅** (ADR-0009, process-familia v17); próximo bloco do M4: **publicação CREATE/UPDATE** (+ pré-condição ADR-0013, edge cases da planilha)

---

## O que é este projeto

**PubliAI** é um sistema web interno que transforma planilhas de produtos exportadas do sistema interno da empresa em **anúncios publicados no Mercado Livre**, usando IA como copywriter especializado em **aviamentos** (linha de costura, botões, fitas).

- **Cliente final:** empresa de tecidos e aviamentos (uso interno)
- **Desenvolvedor único:** Diego — funcionário interno; também é o usuário-operador-validador
- **Substitui:** uma proposta comercial externa (Leonardo Freitas) que foi inviável financeiramente
- **MVP foca em:** aviamentos no Mercado Livre. Tecidos e outros marketplaces ficam para v2+
- **Prazo:** 10 semanas de desenvolvimento (~2,5 meses), com buffer de 3 semanas até o limite de 3 meses

---

## Por onde começar (todo agente lê isso)

Antes de fazer **qualquer alteração** ou tomar **qualquer decisão**, consulte os documentos abaixo nesta ordem:

1. [docs/README.md](docs/README.md) — índice geral
2. [docs/superpowers/specs/2026-05-26-publiai-design.md](docs/superpowers/specs/2026-05-26-publiai-design.md) — **spec completo** do design
3. [docs/ROADMAP.md](docs/ROADMAP.md) — em que marco estamos, o que está fora de escopo
4. [docs/TASKS.md](docs/TASKS.md) — checklist operacional; pegue a próxima tarefa aqui
5. [docs/decisions/](docs/decisions/) — todos os ADRs vigentes; **para qualquer decisão técnica, leia o ADR correspondente antes de propor algo diferente**

Se algum desses arquivos ainda não cobre algo que você precisa decidir, **escreva um ADR novo antes de implementar**.

---

## Stack confirmado

(detalhes completos em [ADR-0001](docs/decisions/0001-stack-tecnologico.md))

| Camada | Tecnologia |
|---|---|
| Frontend | Vite + React 18 + TypeScript + shadcn/ui + Tailwind + TanStack Query + Zustand |
| Backend / DB / Storage / Auth / Realtime | Supabase (Postgres + Edge Functions Deno/TS + Storage + Vault) |
| Hospedagem do frontend | Render Static Site |
| Fila assíncrona | Upstash QStash |
| Cache | Upstash Redis |
| IA copywriting | OpenAI GPT-4o-mini |
| IA visão (cor) | OpenAI GPT-4o Vision |
| Integração externa | Mercado Livre API (OAuth 2.0) |

**Custo operacional alvo:** $3–28/mês

---

## MCPs do ambiente (priorizar SEMPRE)

Diego tem MCPs configurados localmente; usá-los é a primeira escolha em qualquer operação que tenha equivalente:

- `supabase-mcp-server` — operações no Supabase (DB, auth, storage, edge functions)
- `upstash` — QStash + Redis
- `render` — deploy do frontend
- `shadcn` — componentes UI
- `context7` — documentação atualizada de SDKs (use antes de chutar API)
- `n8n-mcp`, `Firebase`, `Stitch` — disponíveis se necessário

**Regra de ouro:** antes de propor solução custom ou sugerir "vá no dashboard do serviço X", verifique se há MCP equivalente.

---

## Decisões arquiteturais já tomadas (todos os ADRs)

Quando o assunto for um destes tópicos, **leia o ADR antes de propor mudança**:

| ADR | Tópico |
|---|---|
| [0001](docs/decisions/0001-stack-tecnologico.md) | Stack tecnológico |
| [0002](docs/decisions/0002-mvp-aviamentos-primeiro.md) | MVP começa por aviamentos, não tecidos |
| [0003](docs/decisions/0003-variacoes-agrupadas-por-pai.md) | Variações agrupadas por código PAI no anúncio do ML |
| [0004](docs/decisions/0004-atribuicao-de-cor.md) | Cor: descrição primeiro, IA Vision como fallback |
| [0005](docs/decisions/0005-lifecycle-publish-and-update.md) | Lifecycle: publica novo, atualiza existente |
| [0006](docs/decisions/0006-qstash-em-vez-de-postgres-queue.md) | QStash em vez de fila no Postgres |
| [0007](docs/decisions/0007-modelo-de-dados-4-tabelas.md) | Modelo de dados: 4 tabelas, sem catalogo_interno separado |
| [0008](docs/decisions/0008-estrategia-de-preco-condicional.md) | Estratégia de preço condicional (PRÓPRIO vs COMPETITIVO) |
| [0009](docs/decisions/0009-campos-payload-ml-e-categoria-deterministica.md) | Campos obrigatórios do payload ML + categoria via lookup determinístico (não via IA) |
| [0010](docs/decisions/0010-openrouter-em-vez-de-openai-direto.md) | IA via OpenRouter (gateway compatível com OpenAI SDK), não OpenAI direto |
| [0011](docs/decisions/0011-redirect-uri-via-edge-function.md) | OAuth ML: redirect URI aponta para Supabase Edge Function (não para o frontend; mantém client_secret no servidor e evita o problema do HashRouter) |
| [0012](docs/decisions/0012-refresh-token-oauth-ml-com-lock-redis.md) | Refresh de token OAuth ML com lock distribuído no Redis (evita corrida de refresh) |
| [0013](docs/decisions/0013-edge-cases-da-planilha-no-ingest.md) | Edge cases da planilha no ingest (não-bloqueantes): CODIGO duplicado → manter 1ª + avisar; filho órfão → pular + avisar; PAI sem filho → pular + avisar |
| [0014](docs/decisions/0014-busca-de-concorrencia.md) | Busca de concorrência no ML: 1 busca por família; GTIN válido → catálogo, senão título (baixa confiança); classe sem/moderada/alta só informativa; erro → PRÓPRIO seguro |

---

## Convenções do projeto

### Documentação
- **Toda decisão técnica não-trivial** vira ADR em `docs/decisions/` antes da implementação
- ADRs são **imutáveis** depois de aceitos; se mudar, criar novo ADR substituindo (com referência)
- `docs/ROADMAP.md` e `docs/TASKS.md` são **vivos** — atualize ao avançar
- Atualizar `docs/README.md` e este `CLAUDE.md` quando criar ADR novo ou mudar workflow

### Código
- **TypeScript strict mode** sempre
- **Tipos do Supabase gerados** (`supabase gen types`) — não escrever à mão
- **Camada de IA isolada** (não chamar OpenAI direto em todo lugar — passar por `lib/ai/*`) para facilitar swap de modelo
- **Camada de fila isolada** (`lib/queue.ts`) — abstrair QStash para que troca seja localizada
- Edge Functions devem ser **idempotentes** (verificar `status` antes de processar — padrão completo em [ADR-0006](docs/decisions/0006-qstash-em-vez-de-postgres-queue.md))
- **Sem comentários explicando o "o que"** — só o "porquê" quando não-óbvio
- **Sem código morto** — funcionalidades não-pedidas ficam de fora

### Banco de dados
- **4 tabelas:** `lotes`, `familias`, `variacoes`, `ml_credentials`
- **RLS por user_id** em todas as tabelas de domínio
- **Tokens OAuth** sempre via Supabase Vault (pgsodium)
- **Enums Postgres** em vez de string livre
- **Migrations aditivas** sempre que possível; nunca soltar `DROP COLUMN` sem backup

### Arquivos e imagens
- Imagens de produto: arquivo nomeado `00CODIGO.jpeg` (8 dígitos, zero-padded)
- Storage path: `{user_id}/{codigo}.jpeg` no bucket `imagens`
- Capa do anúncio agrupado: foto do PAI se existir o arquivo; caso contrário, foto da primeira variação encontrada

### Schema esperado da planilha
Colunas obrigatórias: `CODIGO`, `PAI`, `NOME`, `UNIDADE`, `GTIN`, `PRECO`, `ESTOQUE`, `DESCRICAO_DETALHADO`, `PESO_GRAMAS`, `ALTURA_CM`, `LARGURA_CM`, `COMPRIMENTO_CM`.

Regras:
- `PAI = 0` significa que o produto é o pai (não vendido, só agrupador)
- `PAI = <código>` significa que o produto é filho daquele código
- Se faltar coluna obrigatória, o ingest falha cedo (erro de validação clara)

### Domínio
- **Produtos PAI nunca são vendidos** — só conceito de agrupador no ML
- **Filhos (cores) são os SKUs reais** que viram variações dentro do anúncio único do ML
- **Revisão humana obrigatória** antes de qualquer publicação no ML

---

## Workflow por sessão

Ao iniciar uma sessão neste projeto:

1. Ler este CLAUDE.md
2. Ler `MEMORY.md` global do Claude Code (preferências persistentes de Diego)
3. Ler `docs/ROADMAP.md` (em que marco estamos)
4. Pegar próxima tarefa pendente em `docs/TASKS.md`
5. Se for tarefa de implementação:
   - Conferir ADR relacionado (se houver)
   - Implementar
   - Atualizar TASKS.md (marcar ✅)
   - Se a tarefa originou decisão nova → escrever ADR
   - Se mudou roadmap → atualizar ROADMAP.md
   - Antes do commit: lint + types check
6. Se for tarefa de design/planejamento:
   - Seguir workflow do Superpowers (`brainstorming` → `writing-plans` → `subagent-driven-development`)
7. Sempre que tomar atalho ou pular convenção: registrar exceção como TODO no TASKS.md ou em comentário no código (com explicação)

---

## Regras de operação para a IA

Estas regras são **inegociáveis** salvo aprovação explícita do Diego em mensagem da sessão:

1. **Antes de propor algo, ler ADR relacionado.** Não improvisar contradizendo ADR vigente.
2. **Antes de implementar decisão não-trivial, escrever ADR.** ADR vem antes do código, não depois.
3. **Priorizar MCPs configurados** sobre soluções manuais ou outros serviços.
4. **Recomendar diretamente** em decisões técnicas que Diego não tem expertise; menu A/B/C/D só em decisões de produto/negócio.
5. **Caminho mais prático e rápido** vence elegância em tradeoffs (Diego declarou preferência).
6. **Edge Functions sempre idempotentes** — verificar status antes de processar.
7. **Para mudanças que afetam arquitetura**: atualizar spec + criar ADR antes de codar.
8. **Cada commit** deve fazer referência a item do TASKS.md ou ADR.
9. **Testes:** TDD onde aplicável (regras de negócio, parsers, cálculo de preço); pular onde não agrega valor (UI cosmética).
10. **Authoring e review separados** (regra do OMC): nunca aprovar a própria mudança no mesmo passo.

---

## Glossário

| Termo | Significado |
|---|---|
| **PAI** | Produto-pai conceitual, identificado pelo campo `PAI=0` na planilha; agrupa variações; nunca é vendido isoladamente |
| **Filho** | Produto-variação (geralmente uma cor); tem `PAI = <código do pai>`; é o SKU real vendido |
| **Família** | Registro do PAI no nosso banco (tabela `familias`); vira **1 anúncio** no ML |
| **Variação** | Registro do filho no nosso banco (tabela `variacoes`); vira **1 variação** dentro do anúncio do ML |
| **Lote** | Uma sessão de importação (1 upload de planilha + imagens correspondentes) |
| **CREATE / UPDATE** | Operações de publicação no ML: CREATE = anúncio novo; UPDATE = atualizar estoque/preço de anúncio existente |
| **Operador** | O usuário-final do sistema (no caso, Diego ou outra pessoa interna da empresa) |
| **GTIN** | Código de barras EAN; pode ser nulo ou começar com `3000*` (código interno, não EAN real GS1) |
| **MLB####** | Identificador de categoria no Mercado Livre |

---

## O que NUNCA fazer neste projeto

- ❌ **Inventar dados** que a IA não tem (alucinar especificações inexistentes — prompt do copywriter proíbe explicitamente)
- ❌ **Pular o operador** (revisão humana é obrigatória antes de qualquer publicação no ML)
- ❌ **Quebrar idempotência** das Edge Functions (sempre verificar status antes de processar)
- ❌ **Salvar tokens OAuth em texto puro** (sempre via Supabase Vault)
- ❌ **Ignorar RLS** (sempre policy por user_id em toda tabela de domínio)
- ❌ **Criar tabelas novas** sem ADR aprovado
- ❌ **Pôr credenciais** em código ou no repo — sempre via `.env.local` (não commitado) ou Supabase secrets
- ❌ **Modificar ADR** depois de aceito (criar novo substituindo)
- ❌ **Recomendar serviço externo** se houver MCP equivalente já configurado
- ❌ **Fazer review da própria mudança** no mesmo passo (sempre passes separados — `code-reviewer` ou `verifier` agente)
- ❌ **Quebrar a regra do PAI**: PAI nunca é vendido isoladamente; sempre publicado como agrupador
- ❌ **Auto-publicar sem revisão**, mesmo em casos UPDATE — operador sempre confirma o lote

---

## Trilho paralelo — App Mercado Livre Developers ✅

App PubliAI criada no portal ML Developers em 2026-05-27. Credenciais (`ML_CLIENT_ID`, `ML_CLIENT_SECRET`, `ML_REDIRECT_URI`) salvas no `.env.local`. Redirect URI aponta para Supabase Edge Function `ml-oauth-callback` (a ser criada em M4) — ver [ADR-0011](docs/decisions/0011-redirect-uri-via-edge-function.md).

Tarefas que sobram do trilho são naturais do M4 (validar fluxo OAuth real + confirmar rate limits). Certificação formal da app **não é necessária** porque o uso é interno (PubliAI publica nos anúncios da própria Daludi).

---

## Histórico deste CLAUDE.md

| Data | Mudança |
|---|---|
| 2026-05-26 | Criação inicial após brainstorming completo (Seções 1-6 aprovadas, 8 ADRs, ROADMAP, TASKS, spec consolidado) |
| 2026-05-27 | M0+M1+M2 todos ✅; status atualizado pra refletir início do M3 |
| 2026-05-27 | Trilho paralelo ML ✅ + ADR-0011 (redirect URI via Edge Function) registrado |
| 2026-05-28 | M3 ✅ via Plano 04 (20 tasks Subagent-Driven Development). Pipeline IA completo: parser cor PT-BR, Vision (gpt-4o conservador), Copywriter (gpt-4o-mini + json_schema), cache Redis TTL 90d. UI: badges cor_origem, drop zone, ícone câmera. Edge functions deployadas: process-familia v11, upload-imagens-lote v1, invalidar-cache-cor v1. Bug bash com 4 famílias reais + 5 ajustes no prompt → Diego aprovou. 86 testes passando. Status do projeto agora aponta para M4 (Integração ML). |
| 2026-05-28 | M3.1 entregue: foto-capa por família (spec + plano-05 + 12 tasks subagent-driven) + 6 ajustes pós (barra progresso em chunks, novo template emoji da descrição, botão regenerar por família, badge compacto com tooltip, GTIN editável). Edge functions deployadas: process-familia v12 (template novo), upload-imagens-lote v5 (CAPA_), regenerar-copy-familia v1 (nova). 101/101 testes verdes. |
| 2026-05-29 | M4 bloco OAuth ML ✅ (spec + ADR-0012 + plano-06 15 tasks subagent-driven). Edge functions deployadas `verify_jwt:false`: ml-oauth-start, ml-oauth-callback, ml-oauth-disconnect. `getValidAccessToken` com refresh proativo + lock Redis (ADR-0012, resolve gap §541). Vault reaproveitado do M2 + migration nova `delete_ml_credentials`. Bug bash real aprovado (conectou como AVILBV; disconnect limpa Vault). Bugs corrigidos no bug bash: domínio de auth do Brasil é `mercadolivre.com.br` (com "v"); banner de sucesso preso pós-disconnect. 106/106 testes verdes. TODO: instalar eslint (`pnpm lint` quebrado). |
| 2026-05-31 | ESLint instalado e configurado (toolchain ESLint 9 flat config + `eslint.config.js`); `pnpm lint` passa (0 errors, 3 warnings benignos). TODO do M4 resolvido. |
| 2026-05-31 | TASKS.md sincronizado com o código real (falsos-pendentes marcados ✅). ADR-0013 registra a política de edge cases da planilha no ingest (gap §556): os 3 casos (CODIGO duplicado, filho órfão, PAI sem filho) passam a ser não-bloqueantes (descartar + avisar); hoje os 2 últimos rejeitam o lote. Tabela de ADRs deste arquivo atualizada com 0012 e 0013. |
| 2026-06-01 | M4 busca de concorrência Tasks 8+9 ✅: migration `add_concorrencia_familias` aplicada via MCP (2 enums `origem_concorrencia`/`classe_concorrencia` + 4 colunas `concorrencia_*` em `familias`), tipos regenerados. `process-familia` integra `buscarConcorrencia` 1×/família após a copy (resiliente: erro → `nenhuma`/PRÓPRIO seguro); inclui `gtin` no select das variações e persiste os 4 campos. 122→125 testes verdes, lint verde. |
| 2026-06-01 | **Bug bash da concorrência (Task 10) — achado crítico + correção.** Com token real (AVILBV reconectado), `/sites/MLB/search` retorna **403** (ML descontinuou o search de itens por site). Corrigido para o **catálogo** (intenção original do ADR-0014): ramo GTIN = `/products/search?q={gtin}` → `/products/{id}/items` (conta `seller_id` distintos + `min(price)`); ramo título não quantifica (catálogo textual = ~10k ruído) → `origem='titulo'`/PRÓPRIO seguro. `parse.ts` agora expõe `parseProdutoBusca`+`parseItensProduto`. `process-familia` **v15** deployada. ADR-0014 aditado (§Adendo). Validado contra API real: GTIN `7891521360659` → produto `MLB34175726`, 6 vendedores, R$ 12,62, classe alta. |
| 2026-06-01 | **Busca de concorrência concluída (Task 10 ✅).** Bug bash do **lote #5** (4 famílias) validou o pipeline v15 ponta a ponta com token real: FITA N.3 → 6 vend./R$12,62; LINHA XIK → 6/R$12,90; FITA N.9 → 9/R$17,99 (todas `origem=gtin`/alta); LINHA 1500MT (GTIN `4201516783012` fora do catálogo ML, `paging.total=0`) → `gtin`/0 vendedores, status `pronto` (resiliência validada). Ramo título não exercitado no lote (todas tinham EAN) — lógica é retorno trivial. **Nota operacional:** o MCP `qstash_publish_message` não aciona o `process-familia` (conta QStash divergente das signing keys do Supabase); reprocessar exige lote novo pela UI (`ingest-lote` usa o SDK QStash real). |
| 2026-06-01 | **Estratégia de preço condicional ✅ (ADR-0008).** Função pura `calcularEstrategiaPreco` (`_shared/preco/calcular.ts`, TDD 6 testes): vendedores 0/sem preço_min → PRÓPRIO; preço_min ≤ planilha → COMPETITIVO (preço_min − R$ 0,01); preço_min > planilha → PRÓPRIO ("já menor"). `process-familia` **v16** persiste `preco_publicacao` por variação (preserva `preco_editado_pelo_operador`) + `estrategia_preco`/`estrategia_motivo` da família. Frontend: adapters reais (concorrência, vendedores, preço_min, `precoAbaixo20pc` p/ gap §556) + linha "publica: R$ X" no card + detalhe de concorrência no expandido + util `fmtBRL`. 131 testes verdes. **Insight (projeção SQL lote #5):** a Daludi vende 2–3× mais barato que o ML → todas as famílias caem em PRÓPRIO ("já menor"); o ramo COMPETITIVO raramente dispara na prática real. A persistência v16 aparece na UI no próximo lote subido. |
| 2026-06-01 | **Mapeamento de categorias/atributos ✅ (ADR-0009 + Adendo).** Achado: os IDs do ADR (MLB1132/1430/1429) eram chutes e estavam **todos errados** (categorias raiz não-publicáveis). IDs reais validados via `domain_discovery` + `/categories/{id}` com token de produção: linha→**MLB270273**, fita→**MLB255054**, botao→**MLB270272** (folha, listing_allowed). Atributos obrigatórios reais: linha=BRAND+MODEL, fita=BRAND+RIBBON_TYPE, botao=BRAND+MATERIAL. `_shared/categoria/{detectar,atributos}.ts` (TDD 17 testes): `detectarTipoAviamento` (regex PT-BR), `categoriaParaTipo`, `montarAtributosML` (BRAND fixo "Avil", MODEL=nome, RIBBON_TYPE/MATERIAL inferidos), `atributosFaltantes`. `process-familia` **v17** popula tipo_aviamento/tipo_origem/categoria_ml_id/atributos_ml. UI: badge "categoria indefinida" quando tipo=outro; IDs corrigidos na tela Configurações. 148 testes verdes. Camada IA classificadora não implementada (regex cobre os casos reais). Próximo: publicação CREATE/UPDATE. |
| 2026-06-01 | **Fix: foto-capa (CAPA_) ignorada no upload inicial do lote** (systematic-debugging). Causa raiz: o `ingest-lote` só fazia `matchImagem` das variações (`00CODIGO.jpeg`) e **nunca tratava o prefixo `CAPA_`** — a detecção de capa (`classificarArquivo`) só existia no `upload-imagens-lote` (drop-zone posterior, M3.1). Então `CAPA_00CODIGO.jpg` subia ao storage mas `familias.capa_storage_path` ficava null. Fix: `matchCapa(codigoPai, paths)` em `_shared/parser.ts` (TDD, 4 testes) + `ingest-lote` seta `capa_storage_path` no insert das famílias (deploy v7). Dado retroativo corrigido via SQL (lotes #5/#6/#7). Só recarregar a revisão (frontend já renderizava `capaStoragePath`). 166 testes verdes. |
| 2026-06-01 | **Card "Potencial de venda"** (Superpowers completo: brainstorming → ADR-0015 → spec → plano-09 → subagent-driven 9 tasks). A venda exata por produto **não é exposta pela API do ML** (sold_quantity null; /items e /reviews 403) — investigado com token real. Usamos proxies: faixa de preço dos concorrentes, frete grátis, FULL, força dos concorrentes (MercadoLíder + maior reputação de vendas via `/users`), ranking da categoria (`/highlights`) e idade no catálogo. Backend: `parseItensProduto`→`DadosOfertas`, `analisarMercado` (`_shared/ml/mercado.ts` + `mercado-agregar.ts` puro, cache seller 24h/highlights 6h, resiliente), coluna `analise_mercado jsonb`, `process-familia` **v18**. Frontend: card no `PainelAnalise` + `fmtMilhar`. ADR-0015 + plano-09. 162 testes verdes. Falta bug bash com lote real. |
| 2026-06-01 | **Painel de Análise visual na Revisão** (Superpowers completo: brainstorming → spec → plano-08 → execução inline). A pedido do Diego, estratégia/concorrência/categoria saíram do final do expandido (texto corrido) para um `PainelAnalise` visual no topo, ao lado da foto-capa: cards com ícones (Coins/Tag/Store) + cores semânticas (PRÓPRIO=azul, COMPETITIVO=âmbar; concorrência sem=cinza/moderada=azul/alta=âmbar) + alerta de preço perigoso consolidado + nome amigável de categoria. Label PRÓPRIO acentuado (enum é 'PROPRIO'). Só frontend (zero backend/schema). Spec `2026-06-01-painel-analise-revisao-design.md` + plano-08. 155 testes verdes, build/lint verdes. | 
