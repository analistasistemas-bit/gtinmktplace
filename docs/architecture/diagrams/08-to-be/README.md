# 08 · Arquitetura Futura Simplificada

**Tipo Archify:** `architecture` · **Status:** TO-BE (proposto)

## Especificação (antes da geração)

- **Mensagem principal:** 5 melhorias pontuais e condicionais sobre a arquitetura atual — nenhuma reescrita, nenhuma peça nova de infraestrutura.
- **Público:** arquiteto, gestor decidindo prioridade.
- **Elementos:** 4 componentes existentes (Auth, Edge Functions, Postgres, marketplace_connections) + 3 propostas com nó no diagrama (audit_log, custom_access_token_hook, worker único de publicação); 2 propostas adicionais só em texto (ver card).
- **Relações:** cada proposta pendura de onde ela se conecta hoje.
- **Direção de leitura:** existente à esquerda/centro, proposto anexado (linha tracejada + tag "PROPOSTO").
- **Omitido:** qualquer redesenho de componente existente — todos os 4 aparecem exatamente como no diagrama 02.
- **Fontes principais:** `docs/decisions/0027-multi-tenancy-organizations.md` ("Questões em aberto"); `docs/decisions/0061-orquestracao-multicanal.md` ("Dívida explícita"); `docs/project-status.md` (Task 17, follow-ups do E6).

## O que mostra

As únicas 5 melhorias arquiteturais que os ADRs e o status atual do projeto já sinalizam como pendências conscientes — não uma visão de redesenho. Limitado a ≤20% do esforço do documento; **nenhuma** delas é microsserviço, Kubernetes, Kafka, novo banco ou nova plataforma.

## Como ler

3 propostas têm nó próprio (conectadas por linha tracejada a partir do componente existente de onde partem, com a tag "PROPOSTO"). 2 propostas são pequenas demais para merecer um nó (mudança de 1 coluna/1 linha de código) e aparecem só no card, com a mesma numeração.

| # | Proposta | Problema | Condição para fazer agora |
|---|----------|----------|---------------------------|
| 1 | `audit_log` por org | LGPD exige trilha de auditoria antes de vender para clientes fora da Avil | Antes de comercializar (E8.6) |
| 2 | `custom_access_token_hook` | `current_org_id()` faz 1 lookup por statement (cacheado, mas ainda existe) | Só se medição real mostrar gargalo |
| 3 | Worker único de publicação | 2 caminhos de publicação (ML dedicado + genérico) duplicam manutenção | Só depois do E5 provar o genérico com 2 canais reais |
| 4 | Drop `ml_credentials` + RPCs legadas | Tabela/RPCs congeladas desde o E7, confundem quem lê o schema | Condição (1 semana estável) já cumprida — pode fazer já |
| 5 | `canal` no `select` de `buscarVendas` | Faturamento não filtra por canal quando houver venda em 2º canal | Só quando existir 2º canal com vendas reais |

## Fontes

- `docs/decisions/0027-multi-tenancy-organizations.md` (seção "Questões em aberto")
- `docs/decisions/0061-orquestracao-multicanal.md` (seção "Consequências" — dívida explícita do cutover)
- `docs/project-status.md` (Task 17 diferida; follow-ups não-bloqueantes do release "menus multicanal")
- `docs/reference/modelo-de-dados.md` (seção "O que não existe (YAGNI consciente)")

## Limitações

- Archify não tem um estilo nativo de "borda tracejada em componente" — a distinção AS-IS/TO-BE usa a tag de texto "PROPOSTO", não um traço visual do próprio nó (só das conexões). Ver `docs/architecture/archify-usage.md`.
- Não é um roadmap de produto (isso é `docs/ROADMAP.md`) — é uma lista de dívidas arquiteturais já identificadas, não novas features.
- Duas propostas (#4 e #5) não têm nó — são pequenas demais para justificar um elemento visual (ver regra de proporcionalidade no prompt de origem desta documentação).

## Atualização

- **Última revisão:** 2026-07-19.
- **Regenerar quando:** qualquer uma das 5 propostas for implementada (remover do TO-BE) ou uma nova dívida arquitetural relevante for identificada em ADR.
- **Como regenerar:**
  ```bash
  node bin/archify.mjs validate architecture <caminho>/diagram.architecture.json --json
  node bin/archify.mjs render architecture <caminho>/diagram.architecture.json <caminho>/diagram.html
  ```
  Exportar SVG/PNG: ver `docs/architecture/archify-usage.md`.
