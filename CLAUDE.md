# CLAUDE.md — Bootstrap do projeto PubliAI

> Este arquivo é o bootstrap curto do projeto. Leia primeiro. Estado atual e histórico detalhado vivem fora daqui.

**Última atualização:** 2026-06-15

## O que é este projeto

PubliAI é um sistema interno que transforma planilhas de produtos em anúncios publicados em marketplaces, com foco inicial no Mercado Livre e evolução para operação multicanal.

- Usuário-operador principal: Diego
- Domínios principais: lotes, famílias, variações, anúncios externos
- Primeiro marketplace em produção: Mercado Livre
- Próximo épico planejado: `E5` conector Shopee

## Ordem de leitura

Antes de tocar no código, leia nesta ordem:

1. [docs/README.md](/Users/diego/Desktop/IA/Anuncios%20MktPlace/docs/README.md)
2. [docs/project-status.md](/Users/diego/Desktop/IA/Anuncios%20MktPlace/docs/project-status.md)
3. [docs/ROADMAP.md](/Users/diego/Desktop/IA/Anuncios%20MktPlace/docs/ROADMAP.md)
4. [docs/TASKS.md](/Users/diego/Desktop/IA/Anuncios%20MktPlace/docs/TASKS.md)
5. ADR relevante em [docs/decisions](/Users/diego/Desktop/IA/Anuncios%20MktPlace/docs/decisions)

Se precisar de contexto histórico ou de validações anteriores, consulte:

- [docs/project-history.md](/Users/diego/Desktop/IA/Anuncios%20MktPlace/docs/project-history.md)
- [docs/auditoria-e1-e4-browser-use.md](/Users/diego/Desktop/IA/Anuncios%20MktPlace/docs/auditoria-e1-e4-browser-use.md)

## MCPs prioritários

Use MCP/CLI antes de sugerir operação manual.

- `supabase-mcp-server`
- `upstash`
- `render`
- `shadcn`
- `context7`

## Regras operacionais inegociáveis

1. Leia o ADR relacionado antes de propor mudança arquitetural.
2. Se a decisão for nova e não-trivial, escreva ADR antes da implementação.
3. Edge Functions devem ser idempotentes.
4. Tokens e segredos nunca vão para código ou repo.
5. RLS por `user_id` ou `org_id` é obrigatória em tabela de domínio.
6. Revise humano antes de publicar em marketplace.
7. Prefira o caminho pragmático e verificável ao mais elegante.
8. Atualize `TASKS.md` e a documentação afetada quando concluir trabalho relevante.
9. **Toda mudança de código exige uma checagem de documentação** antes de concluir — ver
   [Manutenção da documentação](#manutenção-da-documentação).

## Manutenção da documentação

A documentação técnica vive em `docs/` no padrão [Diátaxis](https://diataxis.fr/)
(`explanation/`, `reference/`, `how-to/`, `tutorials/`). Índice em
[docs/README.md](/Users/diego/Desktop/IA/Anuncios%20MktPlace/docs/README.md).

**Regra:** ao terminar qualquer mudança em `src/`, `supabase/functions/`,
`supabase/migrations/` ou `supabase/config.toml`, **antes de concluir a tarefa**, consulte o
mapa abaixo, abra a doc correspondente e atualize-a se a mudança a tornou desatualizada. Se
não precisar mudar nada, diga explicitamente "docs conferidas, sem mudança". Não deixe a doc
defasar — é parte da definição de pronto, não um passo opcional.

### Mapa código → doc

| Mudou... | Confira/atualize |
|---|---|
| `supabase/functions/**` (qualquer função) | `docs/reference/edge-functions.md` |
| `supabase/config.toml` (`verify_jwt`) | `docs/reference/edge-functions.md` (tabela + inconsistências) |
| `supabase/migrations/**` (schema, RLS, enums) | `docs/reference/modelo-de-dados.md` |
| Termo de domínio novo/alterado (tipos, enums, conceito) | `docs/reference/glossario.md` |
| Fluxo ponta a ponta, fila, integração externa, stack | `docs/explanation/arquitetura.md` |
| Scripts (`package.json`), `.env.example`, setup local | `docs/how-to/desenvolvimento-local.md` |
| Processo de deploy / migrations | `docs/how-to/deploy-e-migrations.md` |
| Procedimento operacional (reprocessar, OAuth, faturamento) | `docs/how-to/operacoes-rotineiras.md` + `docs/runbooks/` |
| Decisão arquitetural nova/alterada | novo ADR em `docs/decisions/` (regra 2) |
| `src/pages/**` ou fluxo de uso visível ao operador | `docs/tutorials/` (docs de usuário, quando existirem) |

Decisões arquiteturais continuam virando ADR (regras 1 e 2); o mapa acima cobre a **doc viva**
que descreve o estado atual, não o registro imutável de decisão.

## Convenções essenciais

### Stack

- Frontend: React 18 + TypeScript + Vite + shadcn/ui + Tailwind + TanStack Query + Zustand
- Backend: Supabase (Postgres, Edge Functions, Storage, Auth)
- Fila/cache: QStash + Redis
- IA: OpenRouter com modelos OpenAI

### Domínio

- `PAI = 0` na planilha significa agrupador, nunca item vendável.
- Uma `familia` vira 1 anúncio.
- Uma `variacao` vira 1 SKU/cor dentro do anúncio.
- `CREATE` cria anúncio novo; `UPDATE` atualiza anúncio existente.

### Planilha

Colunas obrigatórias:

`CODIGO`, `PAI`, `NOME`, `UNIDADE`, `GTIN`, `CUSTO`, `PRECO`, `ESTOQUE`, `DESCRICAO_DETALHADO`, `PESO_GRAMAS`, `ALTURA_CM`, `LARGURA_CM`, `COMPRIMENTO_CM`, `FORNECEDOR`

### Arquivos

- Foto de variação: `00CODIGO.ext`
- Capa comum: `CAPA_00CODIGO.ext`
- Segunda foto comum: `CAPA2_00CODIGO.ext`
- Terceira foto comum: `CAPA3_00CODIGO.ext`

## ADRs mais recorrentes

Consulte o arquivo completo em [docs/decisions](/Users/diego/Desktop/IA/Anuncios%20MktPlace/docs/decisions). Estes são os que mais orientam mudanças do estado atual:

- `0003` variações agrupadas por pai
- `0004` atribuição de cor
- `0005` lifecycle publish/update
- `0006` QStash em vez de fila no Postgres
- `0007` modelo de dados base
- `0016` UPDATE com reposição/cor nova
- `0018` dimensões e peso no payload
- `0021` vinculação ao catálogo
- `0024` camada de abstração de canais
- `0025` modelo multicanal `anuncios_externos`
- `0026` categoria genérica + atributos por IA
- `0027` multi-tenancy
- `0028` billing

## Estado atual resumido

Resumo vivo em [docs/project-status.md](/Users/diego/Desktop/IA/Anuncios%20MktPlace/docs/project-status.md).

- E1, E1b, E2, E3 e E4 validados em produção
- `process-familia`, `publish-familia-ml` e `remover-publicado` acabaram de ser revalidados/deployados
- `anuncios_externos` já é parte ativa do fluxo
- Taxonomia canônica ficou adiada para quando houver 2º canal
- Próximo passo de produto: Shopee (`E5`)

## O que nunca fazer

- Inventar dado de produto que não existe na planilha, foto ou contexto real
- Publicar sem revisão humana
- Quebrar idempotência de worker
- Salvar token em texto puro
- Ignorar policy de acesso
- Criar tabela/fluxo estrutural sem ADR
- Mexer em anúncio real de produção fora de fluxo controlado de teste/correção

## Histórico

Histórico operacional e institucional em:

- [docs/project-history.md](/Users/diego/Desktop/IA/Anuncios%20MktPlace/docs/project-history.md)
- [docs/TASKS.md](/Users/diego/Desktop/IA/Anuncios%20MktPlace/docs/TASKS.md)
