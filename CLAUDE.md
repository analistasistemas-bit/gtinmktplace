# CLAUDE.md — Bootstrap do projeto PubliAI

> Este arquivo e o bootstrap curto do projeto. Leia primeiro. Estado atual e historico detalhado vivem fora daqui.

**Ultima atualizacao:** 2026-06-15

## O que e este projeto

PubliAI e um sistema interno que transforma planilhas de produtos em anuncios publicados em marketplaces, com foco inicial no Mercado Livre e evolucao para operacao multicanal.

- Usuario-operador principal: Diego
- Dominios principais: lotes, familias, variacoes, anuncios externos
- Primeiro marketplace em producao: Mercado Livre
- Proximo epico planejado: `E5` conector Shopee

## Ordem de leitura

Antes de tocar no codigo, leia nesta ordem:

1. [docs/README.md](/Users/diego/Desktop/IA/Anuncios%20MktPlace/docs/README.md)
2. [docs/project-status.md](/Users/diego/Desktop/IA/Anuncios%20MktPlace/docs/project-status.md)
3. [docs/ROADMAP.md](/Users/diego/Desktop/IA/Anuncios%20MktPlace/docs/ROADMAP.md)
4. [docs/TASKS.md](/Users/diego/Desktop/IA/Anuncios%20MktPlace/docs/TASKS.md)
5. ADR relevante em [docs/decisions](/Users/diego/Desktop/IA/Anuncios%20MktPlace/docs/decisions)

Se precisar de contexto historico ou de validacoes anteriores, consulte:

- [docs/project-history.md](/Users/diego/Desktop/IA/Anuncios%20MktPlace/docs/project-history.md)
- [docs/auditoria-e1-e4-browser-use.md](/Users/diego/Desktop/IA/Anuncios%20MktPlace/docs/auditoria-e1-e4-browser-use.md)

## MCPs prioritarios

Use MCP/CLI antes de sugerir operacao manual.

- `supabase-mcp-server`
- `upstash`
- `render`
- `shadcn`
- `context7`

## Regras operacionais inegociaveis

1. Leia o ADR relacionado antes de propor mudanca arquitetural.
2. Se a decisao for nova e nao-trivial, escreva ADR antes da implementacao.
3. Edge Functions devem ser idempotentes.
4. Tokens e segredos nunca vao para codigo ou repo.
5. RLS por `user_id` ou `org_id` e obrigatoria em tabela de dominio.
6. Revise humano antes de publicar em marketplace.
7. Prefira o caminho pragmatico e verificavel ao mais elegante.
8. Atualize `TASKS.md` e a documentacao afetada quando concluir trabalho relevante.

## Convencoes essenciais

### Stack

- Frontend: React 18 + TypeScript + Vite + shadcn/ui + Tailwind + TanStack Query + Zustand
- Backend: Supabase (Postgres, Edge Functions, Storage, Auth)
- Fila/cache: QStash + Redis
- IA: OpenRouter com modelos OpenAI

### Dominio

- `PAI = 0` na planilha significa agrupador, nunca item vendavel.
- Uma `familia` vira 1 anuncio.
- Uma `variacao` vira 1 SKU/cor dentro do anuncio.
- `CREATE` cria anuncio novo; `UPDATE` atualiza anuncio existente.

### Planilha

Colunas obrigatorias:

`CODIGO`, `PAI`, `NOME`, `UNIDADE`, `GTIN`, `CUSTO`, `PRECO`, `ESTOQUE`, `DESCRICAO_DETALHADO`, `PESO_GRAMAS`, `ALTURA_CM`, `LARGURA_CM`, `COMPRIMENTO_CM`, `FORNECEDOR`

### Arquivos

- Foto de variacao: `00CODIGO.ext`
- Capa comum: `CAPA_00CODIGO.ext`
- Segunda foto comum: `CAPA2_00CODIGO.ext`
- Terceira foto comum: `CAPA3_00CODIGO.ext`

## ADRs mais recorrentes

Consulte o arquivo completo em [docs/decisions](/Users/diego/Desktop/IA/Anuncios%20MktPlace/docs/decisions). Estes sao os que mais orientam mudancas do estado atual:

- `0003` variacoes agrupadas por pai
- `0004` atribuicao de cor
- `0005` lifecycle publish/update
- `0006` QStash em vez de fila no Postgres
- `0007` modelo de dados base
- `0016` UPDATE com reposicao/cor nova
- `0018` dimensoes e peso no payload
- `0021` vinculacao ao catalogo
- `0024` camada de abstracao de canais
- `0025` modelo multicanal `anuncios_externos`
- `0026` categoria generica + atributos por IA
- `0027` multi-tenancy
- `0028` billing

## Estado atual resumido

Resumo vivo em [docs/project-status.md](/Users/diego/Desktop/IA/Anuncios%20MktPlace/docs/project-status.md).

- E1, E1b, E2, E3 e E4 validados em producao
- `process-familia`, `publish-familia-ml` e `remover-publicado` acabaram de ser revalidados/deployados
- `anuncios_externos` ja e parte ativa do fluxo
- Taxonomia canonica ficou adiada para quando houver 2o canal
- Proximo passo de produto: Shopee (`E5`)

## O que nunca fazer

- Inventar dado de produto que nao existe na planilha, foto ou contexto real
- Publicar sem revisao humana
- Quebrar idempotencia de worker
- Salvar token em texto puro
- Ignorar policy de acesso
- Criar tabela/fluxo estrutural sem ADR
- Mexer em anuncio real de producao fora de fluxo controlado de teste/correcao

## Historico

Historico operacional e institucional em:

- [docs/project-history.md](/Users/diego/Desktop/IA/Anuncios%20MktPlace/docs/project-history.md)
- [docs/TASKS.md](/Users/diego/Desktop/IA/Anuncios%20MktPlace/docs/TASKS.md)
