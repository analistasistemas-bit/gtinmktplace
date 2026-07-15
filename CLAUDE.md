# CLAUDE.md — Bootstrap do projeto PubliAI

> Bootstrap curto. Estado atual e histórico vivem em `docs/` — não duplicar aqui.

**Última atualização:** 2026-07-02

---

# O que é este projeto

PubliAI transforma planilhas de produtos em anúncios publicados em marketplaces.
Primeiro canal em produção: **Mercado Livre**. Próximo épico: **E5 — Shopee**.
Operador principal: Diego. Domínios: lotes, famílias, variações, anúncios externos.

- Estado atual: `docs/project-status.md` (fonte única)
- Histórico: `docs/project-history.md`, `docs/TASKS.md`, `docs/auditoria-e1-e4-browser-use.md`

---

# Comandos

- Testes: `pnpm test` (vitest; exige `.env.test` — sem ele o supabase.ts lança no boot)
- Migrations: **só** `supabase migration new` + `supabase db push`; validar com `npm run db:check`. Nunca `apply_migration`/painel para DDL (ADR-0043).
- Edge functions: deploy sempre via CLI completa; mudança em `_shared/` → redeployar todas as funções afetadas e conferir versão pós-deploy.
- Worktrees: copiar `.env.local` (gitignored) antes de subir dev, senão a app abre branca.

---

# Fontes de conhecimento e investigação

Ordem obrigatória antes de tocar código:

1. **Graphify** — arquitetura, dependências, impacto de mudanças.
2. **docs/** — `README.md`, `project-status.md`, `ROADMAP.md`, `TASKS.md` + ADR relacionado em `docs/decisions/`.
3. **obsidian-vault/** — documentação viva (decisões, fluxos, roadmap, contexto).

Protocolo de investigação (antes de qualquer `grep`/`rg`):

1. Graphify → `obsidian-vault/` → `docs/` → identificar no máx. 5 arquivos candidatos → só então abrir arquivos.
2. Busca global só se as fontes acima não bastarem, e sempre com escopo (`src/`, `supabase/functions/`, `docs/`). Proibido `grep -R` / `rg termo .` sem escopo.
3. Ao investigar problema, responder primeiro com: hipótese inicial, módulos prováveis, arquivos candidatos, plano de investigação.

Após mudança estrutural relevante, atualizar o Graphify.

---

# Roteamento de modelos (economia de tokens)

A sessão principal roda no Opus. Delegar execução a subagents com `model` explícito conforme a demanda:

| Demanda | Modelo | Exemplos |
|---|---|---|
| Planejamento, arquitetura, ADR, debug difícil, revisão de segurança | opus | novo épico, decisão de schema, incidente em produção |
| Implementação padrão, refactor, testes, edge functions | sonnet | feature já planejada, correção com causa conhecida |
| Tarefa mecânica auto-verificável (a entrada determina a saída) | haiku | localizar arquivo/call sites, extrair lista, rename, reformatar, transcrever texto já verificado |

Regras:
- Nunca rebaixar modelo em: migrations, RLS, publicação em marketplace, código financeiro.
- Tarefa "simples" que revelar complexidade → escalar para o modelo acima e avisar.
- Planejamento fica no loop principal (Opus); só a execução desce de modelo.
- Haiku só quando a saída é auto-verificável e você não vai reconferir. NUNCA para conteúdo factual (números, IDs, caminhos, ADR/docs) — ele preenche lacunas com dado plausível-porém-errado. Doc factual → Sonnet, ou entregue o texto já verificado para o Haiku só transcrever.

---

# MCPs prioritários

CLI nativo primeiro, MCP como fallback, manual como último recurso.
Prioridade MCP: supabase-mcp-server, upstash, render, shadcn, context7.

---

# Regras operacionais inegociáveis

- Ler o ADR relacionado antes de propor mudança arquitetural; decisão nova e não-trivial → escrever ADR **antes** da implementação.
- Edge Functions idempotentes. Workers chamados pelo QStash: `verify_jwt=false`.
- Tokens e segredos nunca em código ou repositório.
- RLS por `user_id` ou `org_id` obrigatória em tabelas de domínio.
- Sempre há revisão humana antes de publicar em marketplace.
- Trabalho de dev sai em branch/worktree — nunca editar a main direto (app em produção).
- Preferir o caminho pragmático e verificável ao mais elegante.

---

# Domínio

- `PAI = 0` → agrupador. Uma família → um anúncio. Uma variação → um SKU.
- CREATE cria anúncio; UPDATE atualiza anúncio existente.
- Custo real do produto: `variacoes.custo` (R$). `familias.custo_centavos` é custo de tokens de IA — nunca usar para markup/preço.
- **Pausar** um anúncio: some da busca/compra no ML, mas continua na tela Publicados (o vínculo local não é afetado — isso só acontece em "Remover"). **Reativar**: volta a aparecer na busca. Ação restrita a admin (ADR-0060).

---

# Planilha

Campos obrigatórios: `CODIGO, PAI, NOME, UNIDADE, GTIN, CUSTO, PRECO, ESTOQUE, DESCRICAO_DETALHADO, PESO_GRAMAS, ALTURA_CM, LARGURA_CM, COMPRIMENTO_CM, FORNECEDOR`

---

# Arquivos de fotos

- Variações: `00CODIGO.ext`
- Comuns: `CAPA_00CODIGO.ext`, `CAPA2_00CODIGO.ext`, `CAPA3_00CODIGO.ext`

---

# Documentação (manutenção + conclusão)

Dois papéis: `docs/` (técnica oficial, Diátaxis) e `obsidian-vault/` (base viva).

Regra de conclusão de qualquer alteração relevante:

1. Consultar Graphify → implementar → **`pnpm lint` + `pnpm test` passando** → verificar `docs/` → atualizar `obsidian-vault/` se houver impacto arquitetural/funcional — **no mesmo commit da entrega**.
2. Atualizar `TASKS.md` quando concluir trabalho relevante.
3. Informar explicitamente: documentação atualizada **ou** conferida sem necessidade de alterações.

| Mudou... | Atualize |
|----------|----------|
| supabase/functions/**, supabase/config.toml | docs/reference/edge-functions.md |
| supabase/migrations/** | docs/reference/modelo-de-dados.md |
| termos de domínio | docs/reference/glossario.md |
| arquitetura, fluxos, integrações | docs/explanation/arquitetura.md + diagrams |
| scripts, setup | docs/how-to/desenvolvimento-local.md |
| deploy ou migrations | docs/how-to/deploy-e-migrations.md |
| procedimentos operacionais | docs/how-to/operacoes-rotineiras.md |
| nova decisão arquitetural | docs/decisions/ **e** obsidian-vault/04-Decisões/Índice de ADRs.md |
| fluxo do operador | docs/tutorials/ |
| docs/ROADMAP.md ou novo doc de roadmap estratégico | obsidian-vault/06-Roadmap/ |
| épico concluído/mudou (project-status.md) | obsidian-vault/06-Roadmap/Sprint Atual.md |

---

# Stack

- Infra: QStash, Redis | IA: OpenRouter (modelos OpenAI)

---

# Issue Tracker

GitHub Issues: `analistasistemas-bit/gtinmktplace`
Labels: `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`
Referências: CLAUDE.md, docs/README.md, docs/decisions/, docs/agents/

---

# ADRs recorrentes

Consulte `docs/decisions/`. Mais relevantes: 0003 (variações por pai), 0004 (cor), 0005 (lifecycle publish/update), 0006 (QStash), 0007 (modelo de dados), 0016 (UPDATE com reposição), 0018 (dimensões/peso), 0021 (catálogo), 0024 (abstração de canais), 0025 (multicanal), 0026 (IA p/ atributos), 0027 (multi-tenancy), 0028 (billing), 0043 (migrations canal único), 0061 (orquestração multicanal), 0077 (registry híbrido UI multicanal).

---

# O que nunca fazer

Nunca: inventar dados de produto; publicar sem revisão humana; quebrar idempotência; salvar tokens em texto puro; ignorar RLS; criar estrutura sem ADR; alterar anúncios reais fora do fluxo controlado; usar `familias.custo_centavos` como custo de produto; editar a main direto.
