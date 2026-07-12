# PubliAI — Historico do projeto

> Memoria institucional resumida. Mantem os marcos que explicam como o projeto chegou ao estado atual sem transformar o `CLAUDE.md` em changelog.

## 2026-05-26 a 2026-05-28

- Fundacao do projeto: repo, Supabase, Render, Upstash e app base no ar
- M1 entregue com UI mockada navegavel
- M2 entregou ingestao real de planilha, auth e storage
- M3 entregou copy com IA, vision para cor e pipeline assíncrono
- M3.1 adicionou foto-capa por familia e polimentos de Revisao

## 2026-05-29 a 2026-06-01

- OAuth do Mercado Livre entrou em producao
- Concorrencia foi recalibrada para usar catalogo em vez do search por site que retornava `403`
- Estrategia de preco foi implementada e depois evoluiu para liquido minimo
- Categorias deterministicas iniciais de aviamentos foram validadas com IDs reais do ML
- Foto-capa `CAPA_` no ingest foi corrigida

## 2026-06-03 a 2026-06-07

- `CREATE` no Mercado Livre foi implementado
- Selecao granular do que publicar entrou na Revisao
- Relatorio real de publicacao foi conectado
- `EMPTY_GTIN_REASON`, descricao separada e fotos por variacao foram ajustados no bug bash real
- Card `Voce recebe por venda` entrou com tarifa real do ML
- Dimensoes e peso passaram a ir no payload para evitar problemas de frete
- UPDATE de descricao para refletir cores novas foi corrigido

## 2026-06-08 a 2026-06-10

- Exclusao de lotes preservando publicados entrou em producao
- Tela `Publicados` passou a refletir status ao vivo
- Redesign visual amplo do app foi feito por fases
- Dashboard ganhou KPIs
- Acessibilidade e contraste foram reforcados
- `CAPA2_` e depois `CAPA3_` foram incorporadas corretamente ao fluxo
- Catalogo do ML foi integrado com opt-in controlado

## 2026-06-09 a 2026-06-12

- Titulos passaram a preservar metragem obrigatoria
- Lotes travados em `processando` foram corrigidos para transicionar para `revisao`
- Ordem alfabetica das cores na descricao foi consolidada
- Incompletas na Revisao deixaram de contar familias ja publicadas
- Atributo `IS_DOUBLE_FACE` de fitas foi corrigido
- Retry de foto transiente foi refinado
- Cor falsa por descricao incidental (`Multicolor`) foi corrigida
- Paginacao client-side entrou em Dashboard, Revisao e Publicados
- Inclusao de cor nova no UPDATE foi estabilizada

## 2026-06-14

- `E1` consolidou a camada de abstracao de canais para `CREATE`
- `E1b` levou `UPDATE` e leitura de status para o conector
- `E2` introduziu `anuncios_externos` com dual-write e backfill
- `E3` generalizou categoria por `domain_discovery` + LLM closed-set
- `E4` passou a preencher atributos obrigatorios por IA closed-set
- O proximo passo de produto ficou definido como `E5` Shopee

## 2026-06-14 a 2026-06-15

- Reauditoria browser-use de `E1` a `E4` foi executada e documentada
- O fix inicial de E3 ainda deixava a furadeira cair em `MLB11400` quando o preditor nao trazia candidato compativel; o resolver foi reforcado com fallback validado para `MLB189007`
- O worker de `CREATE` passou a limpar caches efemeros de foto em erro transiente e a deixar o QStash retentar com upload fresco
- Publicacao real de prova da reauditoria: `MLB6967261422`
- Espelho em `anuncios_externos` foi confirmado
- `remover-publicado` passou a limpar tambem o espelho multicanal

## 2026-06-16 a 2026-07-06

- Fase de hardening/UX do MVP ML: fix de margem `-Infinity` no Faturamento, lazy routes,
  migração de segurança do SheetJS, categoria/título com tipo de produto genérico via IA
  ([ADR-0054](decisions/0054-categoria-titulo-tipo-produto-generico.md)), busca por
  código/EAN de variação, desconto sobre concorrência configurável
  ([ADR-0059](decisions/0059-desconto-concorrencia-configuravel.md)), pausar/reativar
  anúncio ([ADR-0060](decisions/0060-pausar-reativar-anuncio-ml.md))
- `E7` — Multi-tenancy entrou em produção: isolamento por `org_id`/`current_org_id()`
  substituindo `is_membro_operacao()` em toda tabela de domínio, estratégia
  expand→migrate→contract ([ADR-0027](decisions/0027-multi-tenancy-organizations.md))
- `E6` — Orquestração multicanal entrou em produção: worker genérico `publicar-anuncio`,
  fan-out por (família, canal), caminho ML intocado
  ([ADR-0061](decisions/0061-orquestracao-multicanal.md))
- Próximo épico de produto definido como `E5` (conector Shopee), com `E6b` (estoque único
  cross-canal) na sequência

## 2026-07-07 a 2026-07-12

- Módulo de mensagens pós-venda do ML entrou em produção, com notificações Telegram por
  destinatário e categoria ([ADR-0067](decisions/0067-mensagens-pos-venda-ml.md),
  [ADR-0068](decisions/0068-notificacoes-telegram-por-destinatario-e-categoria.md))
- Liveness da integração ML: classificação de erro de auth vs. transiente por conexão, a
  partir do spike 032 ([ADR-0069](decisions/0069-liveness-integracao-ml.md))
- Revisão de CTO do roadmap publicada — [Roadmap-Estrategico-PubliAI-v2.md](Roadmap-Estrategico-PubliAI-v2.md):
  reorganiza as 50 funcionalidades propostas em 8 fases de construção da empresa; principal
  mudança é antecipar Shopee (E5) em vez de adiá-lo, e reduzir billing ao mínimo viável
- `obsidian-vault/` (04-Decisões, 06-Roadmap) e `docs/README.md` sincronizados de volta com
  os 69 ADRs e o estado real de E6/E7 em produção, após ficarem desatualizados por semanas

## Onde aprofundar

- Estado atual: [project-status.md](/Users/diego/Desktop/IA/Anuncios%20MktPlace/docs/project-status.md)
- Checklist operacional: [TASKS.md](/Users/diego/Desktop/IA/Anuncios%20MktPlace/docs/TASKS.md)
- Reauditoria recente: [auditoria-e1-e4-browser-use.md](/Users/diego/Desktop/IA/Anuncios%20MktPlace/docs/auditoria-e1-e4-browser-use.md)
- Decisoes tecnicas: [decisions](/Users/diego/Desktop/IA/Anuncios%20MktPlace/docs/decisions)
