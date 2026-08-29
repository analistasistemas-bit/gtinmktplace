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

## 2026-07-13 a 2026-07-19

- Menus multi-marketplace entraram em produção (2026-07-15): registry único no frontend +
  habilitação por org, canal ativo global, tela `/canais`. Com 1 canal nenhum número muda
  ([ADR-0077](decisions/0077-registry-hibrido-menus-multicanal.md))
- Preço por variação e split por faixa de preço (2026-07-17), depois de o ML passar a rejeitar
  família com preço divergente entre variações — incidente real com 2 famílias em produção
  ([ADR-0078](decisions/0078-preco-por-variacao-split-por-faixa-e-controle-de-preco-no-update.md))
- Documentação visual de arquitetura via Archify entrou em `docs/architecture/`: 8 diagramas
  fixos (visão geral, arquitetura geral, fluxo de publicação, sync de marketplace, modelo de
  dados simplificado, multi-tenant, infraestrutura, TO-BE), gerados a partir das fontes de
  conhecimento existentes (vault/docs/Graphify), com revisão de overflow de texto e uma revisão
  final independente via Opus antes da entrega
- `obsidian-vault/` (Visão Geral, Arquitetura Geral) corrigido de uma nota desatualizada que
  ainda dizia "sem `org_id`" — multi-tenancy está em produção desde o E7 (2026-07-05)

## 2026-07-20 a 2026-07-26

- Corte de egress (2026-07-20): URL assinada persistida e poll de vendas em 3 minutos
  ([ADR-0081](decisions/0081-corte-de-egress-url-assinada-persistida.md)), com o poll passando a
  ser incremental por marca d'água `atualizado_em`
  ([ADR-0082](decisions/0082-poll-incremental-de-vendas-por-marca-dagua.md))
- Cursor (deslizador de zíper) virou o 5º tipo de aviamento determinístico
  ([ADR-0083](decisions/0083-cursor-de-zíper-tipo-aviamento-determinístico.md)) e `family_name`
  entrou no payload da categoria Zíperes
  ([ADR-0084](decisions/0084-family-name-categoria-zipper.md)) — generalizado dois dias depois em
  detecção reativa das categorias que exigem item plano, sem lista mantida à mão
  ([ADR-0087](decisions/0087-family-name-deteccao-reativa.md))
- Configuração org-scoped: leitura fechada por organização e imposto LOUD
  ([ADR-0086](decisions/0086-configuracao-org-scoped.md), 2026-07-21)
- Hardening de identidade e acesso (2026-07-25): escrita em `profiles` trancada — privilégio não
  se auto-concede ([ADR-0090](decisions/0090-lockdown-da-escrita-em-profiles.md)); a conexão do ML
  passa a ser gravada na org da **sessão**, não na do `state`
  ([ADR-0091](decisions/0091-conexao-ml-confirmada-pela-sessao.md)); identidade da plataforma
  separada das organizações clientes
  ([ADR-0092](decisions/0092-identidade-da-plataforma-e-acesso-super-admin.md))
- Notificação in-app espelhando todo alerta que já saía por Telegram, escrita pelo mesmo ponto
  único, sino no topbar (2026-07-21) ([ADR-0085](decisions/0085-notificacao-in-app.md))
- Publicação em User Products com N itens por família (2026-07-22/23): categorias que exigem
  "item plano" e têm mais de uma cor não aceitam `variations` — cada cor vira um item técnico
  linkado por `family_id`. Validado com família real de 9 cores; 5 pendências (reconciliadores
  de convergência e de backfill, descrição no UPDATE, guarda de remoção, realtime da Revisão)
  fechadas em 2026-07-24 ([ADR-0088](decisions/0088-publicacao-user-products-multi-item.md)).
  Achado a parte: `reconciliar-faturamento` nunca tivera schedule QStash desde a criação
- Atualização rápida de estoque (2026-07-24): atalho de 1 clique para reposição pura em famílias
  `UPDATE` sem pendência ([ADR-0089](decisions/0089-atualizacao-rapida-de-estoque.md))
- Financeiro do Mercado Pago passou a usar a conexão OAuth do ML (2026-07-26), derrubando a
  premissa sem spike do ADR-0031 e matando o fallback global `MP_ACCESS_TOKEN` que estava a um
  `if` de vazar a conta da Avil entre tenants; 2 bugs financeiros silenciosos corrigidos junto
  ([ADR-0093](decisions/0093-financeiro-mp-pela-conexao-ml.md))

## 2026-07-27 a 2026-08-03

- `E6b` Bloco A — estoque único cross-canal em produção (2026-07-29): ledger imutável e
  idempotente `estoque_movimentos` + RPCs `security definer`, venda paga baixa o saldo e
  enfileira push absoluto para os demais canais, reconciliação diária como rede de segurança
  ([ADR-0094](decisions/0094-estoque-unico-cadastro-manual.md))
- `E6b` Bloco B — cadastro manual de produto e entrada de mercadoria pela UI (2026-07-29),
  como módulo pago ligado por org pelo super-admin; nenhuma org enxerga até ser habilitada.
  Módulo de emissão de NF-e foi descartado na mesma sessão de design (commodity, passivo fiscal)
- Mercado Envios (me2) passou a ser detectado por `shipping_preferences`, não por
  `status.mercadoenvios`
  ([ADR-0095](decisions/0095-mercado-envios-via-shipping-preferences.md), 2026-07-31)
- Cadastro manual ganhou código de produto automático
  ([ADR-0096](decisions/0096-codigo-produto-automatico.md), 2026-07-31) e a exclusão de
  produto/lote passou a limpar os movimentos de estoque órfãos
  ([ADR-0097](decisions/0097-exclusao-limpa-movimentos-orfaos.md), 2026-08-01)
- Redesenho da tela `/estoque` (2026-08-02): listagem e cadastro viraram cards, eliminando o
  scroll horizontal estrutural de `<table>` aninhada; corrigiu de quebra um bug financeiro real
  de parsing de milhar pt-BR (`"1.234"` gravava `R$ 1,23`)
- Reforma da copy do anúncio: copy ancorada na fonte e persuasiva
  ([ADR-0098](decisions/0098-copy-ancorada-na-fonte-e-persuasiva.md), 2026-08-02) e título no
  padrão do Mercado Livre como contrato de slots
  ([ADR-0099](decisions/0099-titulo-padrao-mercado-livre.md), 2026-08-03)

## 2026-08-04 a 2026-08-12

Sem épico numerado. Consolidação da apuração financeira e do módulo de estoque — ADRs 0100 a
0112, todos em produção. Detalhe por data em [TASKS.md](TASKS.md) e no
[project-status.md](project-status.md).

- Fechamento da reforma da copy (2026-08-04): `termos_com_risco` como válvula de escape para termo
  não comprovado ([ADR-0100](decisions/0100-termos-com-risco-valvula-de-escape.md)); o mapa de
  marca corrige a grafia e não troca a entidade
  ([ADR-0101](decisions/0101-marca-do-mapa-nao-troca-entidade.md)); a descrição não promete
  logística nem crava o conteúdo da embalagem
  ([ADR-0102](decisions/0102-descricao-sem-promessa-logistica.md)); `✅ BENEFÍCIOS` é cabeçalho, não
  item de lista ([ADR-0103](decisions/0103-cabecalho-beneficios-nao-vira-bullet.md))
- Produto gravado na organização errada (2026-08-04): não foi vazamento de RLS, e sim uma
  gravação SQL administrativa direta contornando o fluxo oficial. Árvore indevida removida, PAT
  rotacionado e migration de guard tornando a cadeia de `org_id` imutável e a escrita de estoque
  restrita às RPCs auditadas
- Família migrada pelo ML para User Products: UPDATE passou a detectar a migração pelo `GET` ao
  vivo e adotar a família ([ADR-0104](decisions/0104-update-de-familia-migrada-para-user-products.md),
  2026-08-04/05). A forma suposta estava **errada** — a primeira migração real (2026-08-06)
  mostrou que o ML **fecha** o anúncio Legacy e cria N itens novos sem nenhum ponteiro ligando os
  dois; re-vínculo por título e `COLOR.value_name`
  ([ADR-0105](decisions/0105-revinculo-de-familia-dissolvida-pelo-ml-em-user-products.md))
- Apuração financeira: devolução conta no período do estorno
  ([ADR-0106](decisions/0106-devolucao-conta-no-periodo-do-estorno.md)); `ORIGEM` obrigatória e
  explícita na planilha, vazio ou typo aborta o lote
  ([ADR-0107](decisions/0107-origem-obrigatoria-na-planilha.md)); variação duplicada passa a
  vencer pelo custo mais recente — 309 códigos estavam com custo inflado
  ([ADR-0108](decisions/0108-custo-duplicado-vence-o-mais-recente.md)); custo congelado no
  instante da venda ([ADR-0109](decisions/0109-custo-congelado-por-venda.md)); alíquota interna
  por UF da empresa, com trava LOUD de meia-configuração
  ([ADR-0112](decisions/0112-aliquota-interna-por-uf-da-empresa.md))
- Estoque operável: ajustar/zerar pelo PubliAI, admin-only e só para reduzir
  ([ADR-0110](decisions/0110-ajuste-de-estoque-so-reduz.md)) — editar estoque direto no canal
  virou proibido, porque o push é absoluto e a reconciliação restaura o número em até 24h; e
  reposição com saldo > 0 reativa o anúncio pausado
  ([ADR-0111](decisions/0111-reativacao-automatica-ao-repor-estoque.md)). Nesse deploy, um
  `revoke`/`grant` rodando **depois** do `alter owner` virou no-op com WARNING e deixou a RPC de
  ajuste exposta a qualquer usuário autenticado — encontrado e fechado no próprio deploy
- Incidente de moderação (2026-08-06): mirar ficha de catálogo de outro domínio levou o ML a
  re-moderar e **cancelar** o anúncio do Aquaphor por propriedade intelectual. Regra reforçada:
  nenhuma escrita direta em anúncio publicado fora do fluxo do app, nem em diagnóstico
- Venda não baixava estoque de produto cadastrado por outro membro da org (2026-08-11): resíduo
  pré-multi-tenancy filtrando `familias`/`variacoes` por `user_id`; 12 unidades venderam sem
  baixa e o motivo `venda_sku_nao_encontrado` tinha 0 linhas em todo o banco — a tabela vazia era
  o sintoma. Passou a filtrar por `org_id`, com notificação para venda paga sem SKU

## Onde aprofundar

- Estado atual: [project-status.md](project-status.md)
- Checklist operacional: [TASKS.md](TASKS.md)
- Reauditoria recente: [auditoria-e1-e4-browser-use.md](auditoria-e1-e4-browser-use.md)
- Decisoes tecnicas: [decisions](decisions)
