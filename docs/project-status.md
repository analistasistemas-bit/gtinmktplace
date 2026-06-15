# PubliAI — Status atual

> Documento vivo. Este e o retrato curto do estado atual do projeto. Historico detalhado fica em `project-history.md`.

**Ultima atualizacao:** 2026-06-15

## Snapshot

- Fase atual: Evolucao SaaS, Fase 1 concluida ate `E4`
- Epicos validados em producao: `E1`, `E1b`, `E2`, `E3`, `E4`
- Proximo epico: `E5` conector Shopee
- Marketplace ativo em producao: Mercado Livre

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

- `process-familia` v40
- `publish-familia-ml` v31
- `remover-publicado` v7

## Riscos e ressalvas abertas

- Retry de foto transiente no `CREATE` foi reforcado e validado; o mesmo padrao ainda merece extensao consistente no `UPDATE` quando houver necessidade operacional
- Publicacao real da vertical nova (furadeira) foi validada ate Revisao/banco na reauditoria recente, mas o CREATE real de prova que fechou o fluxo completo dessa rodada foi com a familia de fita
- `ROADMAP.md` ficou para contexto estrategico; o estado operativo confiavel esta neste arquivo e em `TASKS.md`

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
