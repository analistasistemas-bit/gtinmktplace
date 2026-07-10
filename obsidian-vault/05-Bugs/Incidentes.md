---
tags: [bugs, incidentes]
atualizado: 2026-07-08
---

# Incidentes

Ocorrências reais em produção, documentadas em ADRs e `docs/TASKS.md`/`project-history.md`. Ver
[[Bugs Conhecidos]] (o que ainda está aberto), [[Problemas Resolvidos]].

## Publicados "Indisponível" para membros não-donos (2026-07-03)

Com 3 membros na operação compartilhada (Diego admin, Michael, Samuel), a tela **Publicados**
mostrava tudo com status **"Indisponível"**, colunas Estoque/Preço/Vendas em `—`, card **Ativos
0/61** e **Encalhados 0** — para quem **não é dono** dos anúncios. Só o Diego via os dados
corretos.

**Causa raiz:** descompasso de multi-tenancy do ADR-0047. A **lista** de anúncios virou
compartilhada (RLS `is_membro_operacao()`), mas o **enriquecimento ao vivo** e as **ações** do ML
continuaram escopados ao chamador: `.eq('user_id', user.id)` + `getValidAccessToken(user.id)`. Só
o Diego é dono das 81 famílias e tem a **única** `ml_credentials` (conta AVILBV, `ml_user_id`
1003820507). Para Michael/Samuel, `status-publicados`/`metricas-vendas` devolviam `{ itens: [] }`
→ o front caía no fallback `'indisponivel'`. Não é concorrência (os 3 ao mesmo tempo foi
coincidência). O mesmo descompasso impedia publicar/remover/reprocessar/responder perguntas e
faria um lote ingerido por membro não-dono **duplicar** anúncios (viraria CREATE).

**Correção (ADR-0056 — `docs/decisions/0056-*`):** helper `_shared/ml/operacao.ts`
`userIdCredencialOperacaoML(admin)` (conexão ML da operação); 10 edge functions passam a usar
escopo + token + gravação da **operação**. `ingest-lote` grava `familias/variacoes.user_id` = dono
da conta ML (invariante que os 7 workers de publicação já assumem → intocados); operador fica em
`lotes.user_id`. Fila serial (ADR-0034) keyed por `familias.user_id`. Ponto único de troca para o
E7 (multi-org). Deploy CLI 10/10; `deno check` + `pnpm lint` + 1156 testes verdes.

## Título duplicado derruba anúncio (2026-06-22)

Duas famílias que diferem só na cor (ex.: "ALFINETE N.0 PRATA" e "ALFINETE N.0 DOURADO") viram
anúncios separados (1 família = 1 anúncio), mas o copywriter de IA removia a cor do título
(tratando como agrupado multi-cor) — os dois anúncios ficavam com título **100% idêntico**. O ML
detecta como duplicado e baixa o segundo (`under_review`, `sub_status=forbidden`). Item nesse
estado não é editável por API — só recriando.

**Impacto real:** 3 alfinetes Prata baixados (N.0/N.02/N.04); o N.03 Prata, cujo título já
continha "PRATA", permaneceu ativo — prova de que título diferenciado basta. Corrigido pelo
ADR-0044 (cor cravada no título de anúncios mono-cor). Ver `reference_ml_duplicado_titulo_cor`.

## Travamento em "publicando" por foto assíncrona (regressão)

Famílias ficavam muito tempo em `publicando` (parecendo travadas) ou caíam em `erro`. O ML
processa fotos de forma assíncrona: se a foto ainda não terminou, `POST /items` retorna
`item.pictures.unavailable`. Era uma **regressão**, não comportamento intrínseco. Corrigido pelo
ADR-0033 (parar de re-subir a foto no retry + retry interno).

## Vinculação de catálogo casando com ficha de kit (falso positivo)

**Gatilho real:** um cliente comprou pelo catálogo um anúncio de **1 rolo** que estava vinculado
à ficha `MLB25284234` = "Fita... Verde Menta... **Kit 5 Unidades**" — o título da ficha engana
(fichas-kit sem "kit"/quantidade no nome); a verdade está nos atributos estruturados
(`UNITS_PER_PACK`, `SALE_FORMAT`). Varredura em 3 famílias com catálogo achou **19 vinculações
erradas**: 17 fichas `SALE_FORMAT=Kit`/`UNITS_PER_PACK=5`, 1 `UNITS_PER_PACK=10`, 1 de dimensão
divergente. Os 19 foram **pausados no ML** (contenção). Corrigido pela trava `fichaEquivalente`
(anti-kit + metragem) no ADR-0021, com novo estado `catalog_status='ficha_divergente'`.

## Moderação sem visibilidade proativa

O ML modera anúncios (`under_review` + `poor_quality_thumbnail`/`forbidden`/
`waiting_for_patch`) e tira do ar sem avisar — o operador só percebia abrindo a tela Publicados.
A API do item só expõe o **código** do sub_status, sem texto do motivo; `/moderations/
infractions/search` (que teria o texto) retorna 401 (bloqueado por permissão, mesma classe do
`/orders`). Resolvido pelo ADR-0035: polling agendado (QStash a cada 6h) + alerta Telegram.

## Lote #41 travado com erro genérico "signal aborted" (2026-06-17)

A copy via IA (OpenRouter) excedeu o timeout de 30s no `process-familia`, e era a única etapa
sem fallback — derrubava a família inteira com mensagem genérica, sem indicar a causa real.
Corrigido pelo ADR-0030: `gerarCopy` com 1 retry + erro rotulado por etapa, nova edge function
`reprocessar-familia`, e botão "Reenviar" na UI.

## Colisão de numeração de ADRs (dois `0035`, dois `0037`)

Resolvida em 2026-06-27: `cor-no-titulo-mono-cor` virou **0044** (ex-0035) e
`vendas-catalogo-match-ean` virou **0045** (ex-0037). Detalhe em `docs/decisions/README.md`.

## Divergência de `verify_jwt` derruba o faturamento em tempo real (2026-06-28)

`ml-webhook`, `sync-venda`, `backfill-faturamento` e `reconciliar-faturamento` estavam com
`verify_jwt=true` no `config.toml`, mas são acionadas por QStash/webhook (sem JWT Supabase) — o
gateway rejeitava com **401 antes da função rodar**. `ml-webhook` enfileira `sync-venda`/
`sync-pergunta`/`sync-devolucao`; com ele rejeitado, nada era enfileirado → faturamento em tempo
real parado (dados só entravam por backfill manual).

**Impacto real (function_edge_logs, 24h):** `ml-webhook` 221 requisições, 401 em 100%;
`backfill-faturamento` 92 requisições, 401 em 100%. Mesma classe do incidente de
`process-familia` (`reference_workers_qstash_verify_jwt`). Corrigido pelo
[ADR-0046](../../docs/decisions/0046-verify-jwt-false-workers-webhook-faturamento.md):
`verify_jwt=false` nas quatro funções (autenticação real continua interna, por assinatura
QStash/`requireUser`).

## Nome do comprador: mascaramento intermitente do ML + regressão do fallback (2026-07-01)

Diego reportou que a coluna Comprador voltou a mostrar o nick em vez do nome real (ex.:
"TELE859877" em vez de "Leonardo Teixeira") num pedido onde o próprio Mercado Livre exibia o
nome completo na sua UI. Investigação (`systematic-debugging`) confirmou por dados reais de
produção (não suposição): `GET /orders/{id}` **mascara `buyer.first_name/last_name` de forma
intermitente** — o mesmo pedido (`2000017181156010`) veio com o dado completo às 14:55 e sem
ele 5 minutos depois, na sincronização seguinte. Não é bloqueio de permissão (hipótese do
endpoint CDA, `shops/cda/customers`, foi descartada com teste ao vivo).

**Regressão dentro da própria correção:** um commit anterior no mesmo dia (via Codex) tinha
removido o fallback pro `receiver_name` do envio achando que o buyer real sempre vinha — e como
cada sync recalculava `comprador_nome` do zero, um sync sem o buyer **apagava** um nome real já
capturado, substituindo pelo nome do destinatário do envio (que pode ser outra pessoa —
presente, portaria).

**Correção final:** nova função pura `escolherCompradorNome` prioriza nome real atual → nome já
salvo (nunca regride) → destinatário do envio (só quando nunca teve nada melhor). 1 pedido com
valor corrompido pela regressão corrigido manualmente via SQL (nome real já estava capturado no
`raw.buyer` de um sync anterior). Ver [ADR-0037](../../docs/decisions/0037-modulo-faturamento-webhooks-ml.md)
e `docs/TASKS.md` (2026-07-01).

## Cor do lote #24/#25: "Salmon"/"Rosa Pink" + rename e fotos no UPDATE (2026-07-06)

Diego enviou 4 cores para um tecido Oxford já publicado (`02989182`, anúncio `MLB4831319319`).
"Salmon" caiu em "Outra" e "Rosa Pink" virou só "Rosa". Investigação em três camadas:

**1. Dicionário de cores incompleto.** `_shared/cor/dicionario.ts` só tinha "salmão/salmao"
(faltava a grafia inglesa "salmon"), e "rosa"/"pink" tinham sinônimos do mesmo tamanho — o sort
por especificidade empatava e o match de primeiro-encontrado sempre pegava "rosa". Fix: sinônimo
`salmon` em Salmão + entrada composta `Rosa Pink`. Deploy das funções que bundlam `_shared/cor/`.

**2. Reprocessar não conserta cor já publicada.** No UPDATE, `ingest-lote` **herda** a cor da
família publicada (`cor: h?.cor ?? null`) e `process-familia` pula a resolução quando a cor já vem
setada (`if (v.cor) return v`). Além disso, "reprocessar" no app = **excluir o lote e re-ingerir**
(novo `numero_org`), então a correção manual feita no lote antigo (#24) foi descartada ao virar #25.
Cores já publicadas ficam congeladas; o fix do dicionário só age em cor genuinamente nova. Corrigido
editando a cor direto nas `variacoes` da família **publicada** (fonte da herança) + do lote em revisão.

**3. Publicar o UPDATE não propagava ao ML (ADR-0062).** Dois bugs no fluxo de publicação:
(a) `montarVariacoesUpdate` nunca enviava COLOR das variações **existentes** (só das novas) → rename
não ia ao ML; (b) fotos comuns CAPA2/CAPA3 duplicavam porque o dedupe comparava id de **upload**
cacheado vs id **re-hospedado** pelo ML — nunca casava, reinserindo a cada publish (até em reposição).
Fix: `buscarItemML` captura a cor atual (`corDaVariacaoML`); envia COLOR só quando muda; fotos comuns
só (re)enviadas ao criar cor nova. Ver [ADR-0062](../../docs/decisions/0062-update-cor-existente-e-fotos-comuns.md).

**Limitações (ADR-0062):** o ML pode recusar rename de COLOR em variação com vendas → anúncio já
quebrado se limpa manual no painel; adicionar cor nova a anúncio com capa2/capa3 ainda pode duplicar
(falta rastrear o id re-hospedado — ADR futuro).

## Lote #27: 4 bugs de publicação (kit, preço, categoria, concorrência) + resíduo BRILHO (2026-07-06)

Barbante Barroco Maxcolor (3 famílias). Cada família expôs uma falha diferente — "cada lote, um
erro novo". Todas corrigidas ([ADR-0063](../../docs/decisions/0063-publicacao-kit-preco-categoria-concorrencia.md)):

1. **"Unidades por kit" num produto avulso.** `UNITS_PER_PACK` é `conditional_required` no ML (só
   obrigatório SE for kit — confirmado na API para MLB271471), mas `atributosFaltantesGenerico`
   tratava todo `conditional_required` como obrigatório-duro → travava a Revisão. Fix:
   `preencherUnitsPerPack` assume 1 (produto avulso) quando não há contagem clara.
2. **Preço competitivo no prejuízo.** O ramo competitivo do `sugerirPrecoVenda` cravava
   `concorrente × (1−desc%)` ignorando custo/comissão/frete/imposto. Para barbante barato + frete
   por conta do vendedor, o preço saía abaixo do custo. Fix (decisão do Diego): `max(competitivo,
   gross-up)` — nunca abaixo do piso viável; avisa quando o piso passa da concorrência. Comissão/
   frete passaram a ser buscados também no caminho competitivo. Efeito: cores que apareciam
   "Prejuízo"/"Abaixo do mínimo" viraram "Vale a pena".
3. **Categoria "Outros".** O preditor de categoria é textual; nomes ruidosos ("BARROCO MAXCOLOR
   BRILHO 200GR") caíam na genérica. Fix: quando cai em genérico E a concorrência achou o produto
   no catálogo, re-roda o preditor com o **nome canônico do catálogo** (`concorrencia.product_name`,
   "Fio Barroco Maxcolor Brilho ... Crochê") → resolve "Lãs". **Verificado ao vivo via extensão
   `http` do Postgres** (token no Vault, RPC `get_connection_tokens`): o `category_id` do produto de
   catálogo NÃO é exposto pela API (só `domain_id=MLB-YARNS`), por isso a resolução é pelo nome.
4. **"Sem concorrência" com concorrência óbvia.** `buscarConcorrencia` usava
   `/products/search?q={gtin}` (busca textual frágil) em vez de `product_identifier={gtin}` (lookup
   oficial de EAN — que o módulo de catálogo já acertava, `catalogo.ts`), e tentava só 1 EAN. Fix:
   `product_identifier` + tenta até 5 EANs. Resultado: 01890131 subiu de 0→4 concorrentes.

**Resíduo aceito (não é bug):** o BRILHO segue **concorrência 0** — o produto de catálogo dele
(MLB22537928 etc.) genuinamente tem **0 vendedores ativos**. A concorrência que existe está em
anúncios sem vínculo de catálogo / outro EAN; pegá-los exigiria fallback por título (opção não
escolhida). A categoria do BRILHO foi corrigida para "Lãs".

Validado ao vivo (banco + browser-use no Chrome do Diego) reprocessando as 3 famílias do lote #27.

## Lote #28: concorrência só olhava a 1ª cor (menor preço falso) + copy inventava "NOVO" (2026-07-08)

Linha Anne 500m (46 cores, cada uma um produto de catálogo distinto no ML) expôs dois bugs
independentes na mesma entrega.

**Parte 1 — Concorrência agregada (ADR-0064):**

A busca de concorrência parava no **1º GTIN que casava** no catálogo do ML — premissa do lote
#27 (todas as cores = mesmo produto). Falsa para o Anne: cada cor tem GTIN + produto de catálogo
(MLB ID) próprios, com preços diferentes. A 1ª cor que casou foi a Sereia 9490 (`MLB28400021`,
R$ 32,90), reportada como "menor preço da concorrência" da família toda — silenciando cores bem
mais baratas nunca consultadas (ex.: Branca 8001 → `MLB26672898`, R$ 22,39). Operador via um
"menor preço" acima do mercado real, com risco de precificação errada.

**Correção:** `buscarConcorrencia` passou a resolver **TODAS as variações válidas** em paralelo
(pool 6 workers, cap 60 GTINs) + nova função pura `agregarConcorrencia` combina os produtos: menor
preço = mínimo global, faixa = min–max global, vendedores = união distinta de seller_ids, ofertas
somadas, produto representativo = o da cor mais barata. Adicionado **negative caching** (tombstone
por GTIN) para EANs sem produto, evitando refazer as buscas inúteis a cada reprocess; erro
transitório (timeout/rede) não vira tombstone e não descarta os hits já resolvidos. Sem mudança de
schema nem de frontend (mesmos campos, valores corrigidos). Contrato de `buscarConcorrencia`
inalterado — callers `process-familia` e `analisar-viabilidade` seguem funcionando. Ver
[ADR-0064](../../docs/decisions/0064-concorrencia-agregada-por-variacao.md).

**Parte 2 — Copy IA inventava "NOVO":**

No mesmo lote, o copywriter de IA (OpenRouter) inventou "NOVO" no título ("NOVO NOVELO ANNE 500MT
| 100% ALGODÃO MERCERIZADO") — palavra que não existe na planilha nem na descrição fonte (provável
eco de "NOVELO"). A regra anti-alucinação do prompt só cobria specs técnicas; foi estendida para
proibir **adjetivos de marketing não-grounded** ("novo", "lançamento", "exclusivo", "original",
"premium", "importado") salvo se a palavra constar no nome/descrição de origem. Fix já em `main`
(commit `0254e70`), listado aqui por proximidade de timing.

**Validação (Parte 1):** ao vivo contra a API do ML (token real da org Avil) exercitando parse +
`agregarConcorrencia` sobre os 44 GTINs válidos do Anne → 43 cores com catálogo, menor preço
agregado **R$ 22,39** (Branca 8001) vs. R$ 32,90 do código antigo; 48 vendedores distintos.
Testes unitários do agregador: 11 casos. Suíte completa verde.

---

## 2026-07-10 — Publish despencou para >5 min/anúncio (era segundos) — propagação da foto no caminho crítico

**Sintoma:** operador relatou que dias antes publicava vários anúncios em segundos e passou a levar
>5 min por anúncio de 1 foto. Regressão iniciada no mesmo dia.

**Causa-raiz** (confirmada nos logs reais do QStash): o fix da manhã (retry 90s×5 para o
`item.pictures.unavailable`) deixou a espera da propagação da foto **no caminho crítico**. O
`subirFoto` (`POST /pictures`) rodava dentro do worker de publish, então o ML não tinha vantagem
nenhuma: todo publish de foto nova falhava na 1ª tentativa e ficava preso nos `retryDelay` de 90s até
a foto ficar utilizável no `POST /items` (~2,5–5 min). Log real: `CREATED 1:48:20 → 4×RETRY(90s) →
DELIVERED 1:54:39` = 6min19s. Fila serial (`parallelism:1`) amplificava: lote de N = N×6 min.

**Correção (2 etapas):**
1. **Pré-upload** das fotos no `process-familia` (`_shared/anuncios/pre-subir-fotos.ts`): a propagação
   corre antes do publish → `POST /items` acha o `picture_id` pronto → publica em segundos.
2. **Invalidação** do `*_ml_picture_id` na troca/remoção de foto (`upload-imagens-lote/processar.ts`,
   `src/lib/upload-imagens.ts`) — sem isso, reusaríamos a imagem antiga cacheada pelo ML. Corrige
   também bug latente do UPDATE.
3. Retry vira rede de segurança fina: 30s×10 (era 90s×5).

Ver [ADR-0033](../../docs/decisions/0033-retry-interno-foto-em-processamento.md) (adendo da tarde).

---

## 2026-07-10 — Cor "Outra" vazando: gap no UPDATE ao vivo + 14 anúncios já publicados com o defeito

**Sintoma:** Diego reportou "OUTRA" no título de um produto (screenshot). Investigação mostrou que
não era regressão do fix da manhã (`ehCorIndefinida`) — era dado processado ANTES do fix (título/
descrição só são calculados no processamento, publicar não recalcula).

**Alcance real, achado ao investigar:** 15 famílias no banco com o vazamento, **14 já publicadas
no Mercado Livre**, retroagindo a 12/06 (quase um mês). Uma publicou hoje 18:20 — **depois** do fix
— porque o texto já persistido (de antes do fix) foi simplesmente reusado no publish.

**Bug ativo adicional (não só dado velho):** o fluxo de UPDATE em anúncio já publicado
(`update-familia-ml` → `sincronizarDescricao`) filtrava só `cor != null`, sem excluir o sentinela
`'Outra'` — o mesmo vazamento, caminho diferente, ainda no código em produção. Corrigido com o
mesmo guard `ehCorIndefinida()` do CREATE.

**Gap de capacidade:** não existia mecanismo para corrigir o **título** de um anúncio já publicado
(só a descrição tinha push pós-publicação). Título só era editável antes de publicar. Adicionada
`atualizarTituloML()`.

**Remediação:** corrigidos título+descrição das 15 famílias no banco e ressincronizados no ML para
as 14 já publicadas, priorizando as 9 com "OUTRA" visível no título.

Ver [ADR-0044](../../docs/decisions/0044-cor-no-titulo-mono-cor.md) (adendo 2026-07-10).
