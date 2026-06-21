# PubliAI — Status atual

> Documento vivo. Este e o retrato curto do estado atual do projeto. Historico detalhado fica em `project-history.md`.

**Ultima atualizacao:** 2026-06-21

## Snapshot

- Fase atual: Evolucao SaaS, Fase 1 concluida ate `E4`
- Epicos validados em producao: `E1`, `E1b`, `E2`, `E3`, `E4`
- Proximo epico de produto: `E5` conector Shopee
- Trilho de UX (preparacao para SaaS comercial): repaginacao visual premium + Tarefa 2/Onda 1 (workflow operacional) concluidas e em producao (2026-06-21)
- Marketplace ativo em producao: Mercado Livre

## Trilho de UX/design (2026-06-21, em producao)

Preparacao do app para virar SaaS comercial. Tudo light+dark, TDD na logica, sem tocar backend/lifecycle. Detalhe em `TASKS.md`.

- **Tarefa 1 + 1.5 — Repaginacao visual premium:** tokens de marca (gradiente roxo->indigo, sombras, elevacao por cor no dark), regra hibrida vitrine/dados, hero cards, hover padronizado; refinamento pos-review (hierarquia do Dashboard, OAuth colapsado, timestamp no Financeiro, acento por status na Revisao, dropzone da Viabilidade).
- **Tarefa 2 / Onda 1 — Workflow operacional (4 fatias):** jornada do lote visivel + "continuar de onde parei"; painel "Precisa da sua atencao"; Revisao por excecao (problemas-primeiro); pre-validacao das colunas da planilha no cliente. 772 testes, deploy live (commit `3ef0de9`).
- **Tarefa 2 / Onda 2 — Tirar atrito (2 fatias):** estado da Publicados (filtros/ordenacao/pagina) na URL + chips removiveis + "Limpar tudo"; paginacao default 10; estado vazio acionavel. 780 testes, validado light+dark.
- **Backlog (Onda 3):** breadcrumbs, busca global, periodo sincronizado Publicados<->Financeiro, drill-down de KPIs, acoes em massa na Revisao, a11y, links cruzados, scroll restoration, aviso global do worker.

## O que ja esta funcionando

- Upload e ingestao real de planilha + imagens
- Pipeline de copy com IA
- Resolucao de cor
- Concorrencia, precificacao e semaforo de viabilidade
- Publicacao `CREATE` e `UPDATE`
- Camada de abstracao de canais (`ChannelConnector`)
- Modelo multicanal `anuncios_externos`
- Categoria generica por preditor/LLM closed-set
- Atributos obrigatorios por IA closed-set
- Catalogo do ML integrado no fluxo atual

## Revalidacoes mais recentes

- Reauditoria browser-use de `E1` a `E4` registrada em [auditoria-e1-e4-browser-use.md](/Users/diego/Desktop/IA/Anuncios%20MktPlace/docs/auditoria-e1-e4-browser-use.md)
- Publicacao real de prova apos fix final de retry de foto: `MLB6967261422`
- Espelho em `anuncios_externos` validado e cleanup confirmado
- `remover-publicado` ajustado para limpar tambem o espelho multicanal

## Deploys operacionais mais recentes

- `process-familia` v41 (refactor A1: resolver de categoria sem fallback hard-coded)
- `publish-familia-ml` v31
- `remover-publicado` v7

## Revisão pós-auditoria (2026-06-15)

- A1 refatorado: removido o fallback hard-coded `MLB189007` do resolver de categoria. A pista forte só corrige o top-1 do preditor quando há candidato compatível; sem candidato compatível, devolve `manual` (operador define a categoria na Revisão via `definir-categoria-familia`). Evita auto-atribuir categoria errada e não inventa categoria fixa.
- Item residual da auditoria `MLB6967261422` confirmado no ML como `status=closed` (encerrado, não vendável) — estado terminal, sem ação pendente.

## Riscos e ressalvas abertas

- Retry de foto transiente no `CREATE` foi reforçado e validado; o mesmo padrão ainda merece extensão consistente no `UPDATE` quando houver necessidade operacional
- **E4 — publicação real de vertical nova (furadeira) ainda não comprovada ponta a ponta no ML.** Foi validada até Revisão/banco (categoria `MLB189007` + `VOLTAGE` closed-set + publicabilidade); o único CREATE real de prova da reauditoria foi com a família de fita. Decisão (2026-06-15): não forçar um publish sintético; fechar esse fluxo quando uma furadeira real entrar num lote de produção normal.
- `ROADMAP.md` ficou para contexto estratégico; o estado operativo confiável está neste arquivo e em `TASKS.md`

## Proximo foco recomendado

`E5` — conector Shopee:

- auth OAuth + assinatura HMAC
- mapeamento de item/variacoes
- upload de midia
- update de estoque/preco
- leitura de status

## Fontes de verdade

- Checklist operacional: [TASKS.md](/Users/diego/Desktop/IA/Anuncios%20MktPlace/docs/TASKS.md)
- Estrategia e fases: [ROADMAP.md](/Users/diego/Desktop/IA/Anuncios%20MktPlace/docs/ROADMAP.md)
- Decisoes: [decisions](/Users/diego/Desktop/IA/Anuncios%20MktPlace/docs/decisions)
- Historico: [project-history.md](/Users/diego/Desktop/IA/Anuncios%20MktPlace/docs/project-history.md)
