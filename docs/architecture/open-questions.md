# Questões em aberto

> Divergências entre fontes encontradas durante a criação desta documentação, e como foram resolvidas.

## Resolvidas

### 1. Multi-tenancy: vault dizia "sem org_id ainda"

- **Fontes em conflito:** `obsidian-vault/00-Home/Visão Geral.md` (atualizado 2026-07-01) diz "Multiusuário com permissão de menu em produção (operação compartilhada, sem `org_id` ainda)". `docs/project-status.md` (atualizado 2026-07-17) e `docs/decisions/0027-multi-tenancy-organizations.md` (aceito 2026-07-05) dizem que o E7 (multi-tenancy por `org_id`) está **em produção** desde 2026-07-05.
- **Resolução:** `docs/project-status.md` e o ADR são mais recentes e mais específicos (datas de migration, suíte de isolamento com 39 asserções PASS contra produção). O grep em `docs/diagrams/*.drawio` confirmou que os diagramas C4 antigos (datados 2026-06-28) também são anteriores ao E7 e não mostram `org_id`. **A nota do vault está desatualizada** — o vault não foi atualizado após o E7/E6 (rollout autônomo rápido, 2026-07-05/06). Os diagramas 02 e 06 desta documentação refletem o estado pós-E7.
- **Classificação:** resolvida, não-bloqueante.
- **Ação sugerida (fora do escopo desta tarefa):** atualizar `obsidian-vault/00-Home/Visão Geral.md` e `obsidian-vault/01-Arquitetura/Arquitetura Geral.md` para remover a menção "sem org_id ainda" — registrado em `backlog.md`.

### 2. Numeração de ADR de orquestração multicanal

- **Fontes em conflito:** o plano E6 (2026-07-02) reservou "ADR-0053" para orquestração multicanal; esse número foi ocupado no mesmo dia pelo ADR de marca-saque.
- **Resolução:** o próprio ADR-0061 documenta a correção ("onde o plano/código citar ADR-0053 (orquestração), leia ADR-0061"). Usado ADR-0061 em toda esta documentação.
- **Classificação:** resolvida, não-bloqueante.

## Não-bloqueantes (não afetam os diagramas atuais)

- **`verify_jwt` divergente no `config.toml`** para funções acionadas por QStash/webhook — mencionado em `docs/explanation/arquitetura.md` como risco conhecido, não representado nos diagramas (é um detalhe de configuração função-a-função, não de arquitetura). Ver `docs/reference/edge-functions.md`.
- **`ml_credentials` ainda não removida** apesar da condição de "1 semana estável" (Task 17) já ter passado (E7 em produção desde 2026-07-05, hoje 2026-07-19 — 2 semanas). Refletido no diagrama 08 (TO-BE item #4) como pronto para execução, não como incerteza.

## Bloqueantes

Nenhuma. Todas as informações necessárias para os 8 diagramas principais foram encontradas e conciliadas nas fontes documentadas (Segundo Cérebro, `docs/`, Graphify, ADRs). Nenhuma pergunta foi levada ao usuário durante esta tarefa.
