---
tags: [roadmap, sprint]
atualizado: 2026-09-03
---

# Sprint Atual

Fonte de verdade viva: `docs/TASKS.md` (seções por data no topo do arquivo) e
`docs/project-status.md` (retrato curto, atualizado até **2026-08-11**, com a seção "Entregas de
agosto de 2026"). Ver [[Próximas Features]], [[Backlog]].

## 📍 Passo atual (2026-08-13) — Fase 3 EM PRODUÇÃO

> **📋 ADR-0151: Kit vinculado — criar anúncios de kit (N unidades) a partir de produto
> existente — IMPLEMENTADO (19 Edge Functions deployadas em 2026-09-03).** Extensão do módulo Estoque
> (ADR-0094): tela Estoque ganha "Criar kit vinculado" (admin-only) que gera família(s) nova(s)
> — `SALE_FORMAT=Kit`/`UNITS_PER_PACK=N` — com estoque 100% derivado da família-base
> (`floor(estoque_base/N)`, colunas `kit_base_codigo_pai`/`kit_multiplicador`, nunca uma coluna
> própria). Kit nunca passa por `process-familia`; nasce direto em `'pronto'` num lote técnico
> dedicado (`status='publicando'`) que nunca vira card na Revisão — publica só **depois** do
> CREATE da base confirmar. Baixa/estorno de venda e push cross-canal resolvem sempre para a
> base; push sem kit vinculado mantém a exclusão de canal de sempre, e com kit reempurra base +
> todos os tamanhos (simplificação deliberada, D-7 revisada). Guards de banco: SKU de kit sem
> escrita direta (entrada/ajuste), cor nova bloqueada com kit vivo, remoção da base bloqueada
> com kit vivo. Restrito na v1 a produto sem variação de cor. 11 tasks do plano de execução
> (`docs/superpowers/plans/2026-09-02-kit-vinculado-plan.md`) concluídas — `pnpm lint`/`pnpm
> vitest run`/`pnpm exec tsc -b --force`/`pnpm docs:links` verdes. **Deploy das Edge Functions
> em produção fica para depois, com autorização explícita separada** (blast radius grande: toca
> `_shared/estoque/*`). Ver ADR-0151, seção "Implementação".

> **✅ Pulse v1 — radar de concorrência EM PRODUÇÃO (ADR-0119, 2026-08-16, org DSA).** Menu
> "Pulse" org-gated: coletor server-side dual-mode, adicionar manual por catálogo/GTIN, 4 tabelas
> novas e UI (radar, margem estimada, alertas, reprecificar via Revisão). Migration, as 2 edge
> functions e os 2 schedules QStash deployados. Em 2026-08-20, os links individuais das ofertas
> passaram a ser derivados do `item_id` MLB, sem depender do endpoint que bloqueia detalhes de
> concorrentes (`pulse-coletar` v20). Ver `docs/project-status.md`.
>
> **✅ Pulse Sonar — garimpo on-demand por termo EM PRODUÇÃO (ADR-0120, 2026-08-17/18).** Nova
> aba "Sonar" dentro do Pulse: busca livre por termo (edge `pulse-sonar`, até 40 fichas via
> `/products/search`, cache Redis global 24h `sonar:v2:MLB:<termo>`), painel por ficha com preço,
> ofertas, % frete grátis, vendedores e visitas de 30 dias do item mais barato. `pulse-coletar`
> ganhou um passo 7: mede visitas de 30 dias de cada oferta viva no baseline diário (teto de 30s,
> fila com o menos medido primeiro), gravadas em `pulse_ofertas.visitas_30d` (migration
> `20260818012222_pulse_ofertas_visitas_30d.sql`) e exibidas também no detalhe do Radar.
> **Superado em parte em 2026-08-19 (ADR-0127):** a edge `pulse-sonar` (fichas de catálogo) foi
> deletada — a tabela do Sonar passou a listar anúncios reais, não fichas. Ver entrada abaixo.

> **✅ Sonar — vendas estimadas do nicho EM PRODUÇÃO (ADR-0122, 2026-08-18).** Fecha a lacuna
> contra o Hunter Spy: seção "Vendas do nicho" com vendas acumuladas, mercado endereçável (R$),
> produto destaque e palavras-chave dos títulos de anúncios reais. Fonte é a **Apify** (actor
> `karamelo/mercadolivre-scraper-brasil-portugues`), o scraping pago que o ADR-0120 tinha
> descartado com a ressalva de reavaliar — reavaliado e contratado. Edge separada
> `pulse-sonar-vendas` (a falha da Apify degrada só este bloco), cache Redis global 24h
> `sonar:vendas:v1:MLB:<termo>`, secret `APIFY_TOKEN`. O dado é o "+N vendidos" da página:
> **acumulado desde a criação do anúncio e arredondado pelo ML** (piso), exibido com "≈" — não é
> venda mensal nem exata. Visitas continuam vindo só da API oficial: nenhum scraper as entrega.

> **✅ Sonar — veredito de oportunidade EM PRODUÇÃO (ADR-0124, 2026-08-18).** Card no topo do
> Sonar com 🟢 alta / 🟡 média / 🔴 baixa + frase de motivo, para bater o olho e decidir sem
> calcular: Demanda (liquidez da amostra + piso de vendas), Disputa (vendedores + % frete grátis)
> e Tração (R$ por vendedor); Marca (% loja oficial) só alerta, não pontua. Função pura no
> frontend sobre os payloads que a tela já recebe — custo zero. Calibrado contra 3 nichos reais
> como gabarito de teste (tecido oxford = 🟢 é o critério de aceitação). Números grandes
> abreviados em pt-BR ("140,8 mil", "≈ R$ 58,8 mi", "10 mil+" nas fichas saturadas) e vendas
> rotuladas como **unidades**.

> **✅ Sonar por anúncio + histórico de snapshots EM PRODUÇÃO (ADR-0127, 2026-08-19).** A tabela
> do Sonar trocou de unidade: lista os até 20 **anúncios reais** da amostra Apify, não mais fichas
> de catálogo — interseção 0 medida entre os dois universos em produção (19/08). Edge `pulse-sonar`
> (fichas) **removida do repositório** (fonte + entrada no `config.toml`), mas ainda **deployada em
> produção**: o front no ar segue chamando-a, então o `supabase functions delete pulse-sonar` é
> pendência pós-merge (ver `docs/TASKS.md`); edge nova `pulse-sonar-visitas` assume o único uso
> restante da API oficial
> (visitas 30d por anúncio, cache `sonar:visitas:v1:{item_id}` TTL 24h); `pulse-sonar-vendas`
> (Apify) continua primária e passa a gravar histórico em `sonar_snapshots` (tabela nova, global
> sem `org_id`, RLS leitura autenticada/escrita service_role) a cada garimpo fresco — delta futuro
> de `vendidos` é sempre PISO do período, nunca total. Veredito recalibrado: Disputa vira
> pulverização de vendedores e Tração vira faturamento por vendedor da mesma subamostra, métricas
> invariantes ao tamanho da amostra, com trava de cobertura quando o nickname vem em <50% dos
> itens. Cruzamento ficha↔anúncio do ADR-0125/D4 e a busca de vendedores/UF por fonte oficial
> saem de circulação. ADR-0127 supersede em parte o ADR-0125/D4.

> **✅ Sonar — busca por EAN entrega a análise COMPLETA, sem escolha grátis/paga (ADR-0140, 2026-08-28).**
> Pedido do Diego: consultar por EAN tem de dar a mesma tela da consulta por descrição, com o
> recorte de um produto só, e sem perguntar "grátis ou paga". Medido antes de implementar (EAN
> `7891113175371`, o caso do ADR-0136): a busca da Apify aceita o EAN como keyword e devolve **20
> dos 24 anúncios** que o ML reporta, todos do produto certo e com vendidos — contra **1 oferta**
> pelo lookup oficial de catálogo, e cobrindo os anúncios fora do catálogo que o ADR-0136 tinha
> registrado como inalcançáveis. Então o EAN deixou de ter caminho próprio: vira `termoBuscado` e
> percorre o pipeline do termo (veredito, insights, pódio, vendas, visitas, filtros, simulador).
> **Revoga o ADR-0136 D-6** e o default grátis da Errata 1 do ADR-0127 — cada EAN novo custa
> ~US$ 0,10, com o mesmo cache de 7 dias. Sobrevive da view antiga só o cruzamento com o catálogo
> da org, agora com regra nova: `minhas` (GTIN exato) segue afirmando ausência, mas o **Radar só é
> afirmado no positivo**, porque os `catalog_product_id` passaram a vir da amostra e vieram em 7 de
> 20 anúncios. A edge `pulse-sonar-ean` fica deployada sem chamador (follow-up de remoção).

> **⚠️ Superado pelo ADR-0140 (acima) — Sonar — busca por EAN/GTIN (ADR-0127 Errata 1, 2026-08-22).** Além da
> busca por termo (nicho), o Sonar aceita EAN/GTIN, restrito a **1 produto específico**. Lookup
> oficial de catálogo grátis (edge nova `pulse-sonar-ean`); "vendidos" só entra sob escolha
> explícita do operador ("Consultar grátis" vs. "Consultar com vendidos", custo visível na UI),
> porque usa Apify — e mesmo pago, fica restrito por interseção de `item_id` ao produto do EAN
> (a busca Apify por termo é livre e pode trazer produtos vizinhos). Leitor de código de barras
> físico funciona sem lib nova (`autoFocus` + submit no Enter, padrão HTML); câmera do celular
> fica fora, é etapa futura separada. **✅ Deploy `pulse-sonar-ean` v1 ativo em produção (2026-08-22).**

> **✅ Pulse — frete na margem via shipping_options/free (ADR-0119 Errata 11, 2026-08-22).** `pulse-coletar/processar.ts` passo 5b: coleta frete com `buscarFreteVendedor` paralelo à comissão, grava `ptw_custos.frete`; passo 5 não sobrescreve mais com null do PTW esparso. Teste `frete=0` válido. Docs: Errata 11 ADR-0119, `docs/how-to/usar-o-pulse.md`.

> **✅ Apify — fallback multi-conta por saldo (ADR-0122 adendo 2026-08-22).** `_shared/apify/client.ts` tenta até 4 tokens (`APIFY_TOKEN` a `_4`) em ordem, checa saldo mensal (`GET /v2/users/me/limits`), pula se < US$ 0,15. Fallback reativo em HTTP 402, 401, 403 com `console.warn`. 4 contas Apify criadas, tokens confirmados válidos com saldo, `APIFY_TOKEN_2/_3/_4` subidos em produção. `pulse-sonar-vendas` já roda com fallback (sem redeploy extra).

> **✅ Sugestão de categoria pela ficha de catálogo EM PRODUÇÃO (ADR-0131, 2026-08-22).** Antes de publicar,
> `process-familia` compara o domínio da categoria escolhida (`GET /categories/{id}` → `settings.catalog_domain`,
> cache Redis 30d) com o domínio da ficha de catálogo do GTIN da variação principal; divergindo, e passando na
> trava anti-kit `fichaEquivalente`, persiste `catalogo_categoria_sugerida_id`/`_nome`/`_vendedores` em `familias`
> (migration `20260822201053_sugestao_categoria_catalogo.sql`). A Revisão ganha o card `SugestaoCatalogo`
> (`card-categoria.tsx`) e o alerta Telegram de `ficha_divergente` (`vincular-catalogo`) passa a citar a categoria
> sugerida. Estende o padrão não-vinculante do ADR-0057 para uma 2ª fonte — **nunca aplicada automaticamente**
> (ADR-0054 Fase 2); best-effort e **só no fluxo CREATE** (categoria de anúncio publicado não muda). Motivador:
> lote 21, Eucerin Aquaphor 55ml publicado em Bebês com a única ficha do GTIN em `MLB-BODY_SKIN_CARE_PRODUCTS`
> (7 vendedores). Fix `d309619c`: timeout de rede em `buscarDominioCategoria`/`buscarNomeCategoria`.

> **✅ Security scan `supabase/functions` (CLAUDE-SECURITY-20260822-113640): 6 de 9 achados corrigidos (2026-08-23).** F5 (token Telegram em texto puro) aplicado em produção — migration `20260822131053` revoga SELECT de `telegram_bot_token` para `authenticated`. F1/F3 registrados como risco aceito. F2 (IDOR cross-org storage), F4 (SSRF confinado), F6 (XLSX bomb), F7/F8/F9 (bypass entitlement Pulse) corrigidos no código.

> **📋 ADR-0141: Análise PubliAI — DESENHO FECHADO, não implementado (2026-08-28).** Revisão da D-3 da 0132 concluída em entrevista: 27 decisões. **Liberado para implementação** — a revisão adversarial (Spike 040) levantou o bloqueio jurídico e Diego confirmou no mesmo dia ter a autorização necessária. **Radar** troca a "Referência do ML" pela coluna "Análise PubliAI", com prévia de quem detém o buy-box (1 consulta por página) e painel + 1 frase de IA. **Sonar** ganha botão com relatório de 7 seções: 6 de mercado na hora, DRE sob demanda. **Apify fica** — nem toda org terá JoomPulse, então o Sonar precisa seguir íntegro sem ela. Fronteira rígida: MCP traz dado, código calcula todo valor financeiro, IA só redige. A **JoomAI não vem pelo MCP** (são 5 ferramentas de dados) e recusaria a DRE de qualquer forma (§5.6 do manual deles: margin calculator é out of scope). **Sobrevivem à liberação** ([Spike 040](../../docs/spikes/040-revisao-adversarial-adr-0141.md)): ~~D-9~~ **resolvida (2026-08-28)**: preço médio em reais só no modo EAN, percentual no modo termo — a saída da própria ADR-0138; ~~comissão e frete convertem falha em zero~~ **decidido (D-28)**: helpers atuais intactos (servem a publicação), DRE usa variante com proveniência e recusa fora de `official`. Medido antes: **o zero silencioso nunca ocorreu em produção** (Spike 042); os 5 cenários da DRE exigem 5 cotações, não uma; e faltam medir a cobertura do universo do Sonar e o lote real da consulta do Radar. **Cobertura medida (Spike 039, 2026-08-28):** catálogos **90%**, concorrentes **82%**, anúncios próprios **≈4%** — a JoomPulse cobre bem o mercado estabelecido e mal o vendedor novo (os anúncios da AVIL têm no máximo 3 meses). A coluna do Radar se sustenta com ~67% das linhas úteis, mas a D-4 foi emendada: o ganhador do buy-box é identificado por **vendedor** (`buyBoxShopId`), nunca pelo anúncio — senão a org quase nunca apareceria como ganhadora, mesmo ganhando. E **89% dos anúncios de concorrentes retornam venda zero**, confirmando em escala o achado que derrubou a D-3. **A D-4 mudou de novo (2026-08-29):** com a JoomPulse fora, o ganhador do buy-box teria que vir de `/products/{id}` → `buy_box_winner`, e **ele vem null em 40/40** catálogos com o nosso token. Identificar o ganhador virou **pergunta aberta**, e "o mais barato ganha" está **refutado** (o 1º da ponte é o mais barato em só 9 de 17 catálogos disputados) — seria repetir na coluna nova o defeito que a D-24 está removendo da antiga. O que sobra, o que está refutado e as 3 perguntas a fechar estão em [Lições da JoomPulse para o Radar](../../docs/reference/licoes-joompulse-para-o-radar.md), **leitura obrigatória antes da ADR do Radar**. **D-24 IMPLEMENTADA (2026-08-29):** a "Referência do ML" saiu da coluna do Radar e da linha do dialog, com o código órfão e os 16 testes que só serviam a ela; duas travas de regressão provadas RED sem a mudança. `ptw_custos` e a coleta ficam — remoção reversível. **A D-4 ficou bloqueada por decisão de produto, não por engenharia:** o [Spike 049](../../docs/spikes/049-buy-box-do-radar-o-que-e-mensuravel.md) mostrou que a causa nunca foi cobertura e sim **opt-in de catálogo** — a AVIL tem **0 de 137** anúncios com `catalog_listing: true`, então o `seller_id` dela nem aparece na ponte e casar "por vendedor" (a emenda do Spike 039) não muda um caso. Há ground truth de buy-box, mas só para anúncio próprio (`/items/{id}/price_to_win`, 403 para terceiro). Custo real: 17 s para os 229 catálogos com cache frio, ou seja **coletor e não abertura de página** — o que dissolve a exceção da D-7. **Resolvido e IMPLEMENTADO (ADR-0147):** Diego escolheu, entre três desenhos medidos, mostrar a **disputa** — "N anúncios relevantes disputam / faixa de preço / seu preço ficaria em Xº". Posição declarada como hipótese, porque o anúncio da org não está no catálogo. **Custo zero:** o dado já vive em `pulse_ofertas_atual`, que o `pulse-coletar` preenche pela mesma ponte `/products/{id}/items` — nenhuma chamada nova, nenhuma migration, nenhuma edge function, e os ~229 chamados/17 s do Spike 049 não são necessários. Fora do escopo: o painel com frase de IA, que existia para narrar o buy-box. **DRE — fatia 1 IMPLEMENTADA (ADR-0148, 2026-08-29):** a seção 6 do relatório calcula o lucro no preço do anúncio-âncora **ou recusa dizendo por quê**. O guard da D-28 entrou junto, como a decisão exigia: comissão e frete convertiam falha em ZERO e o zero de "o comprador paga" era indistinguível do zero de "o ML caiu". Agora cada helper tem variante com proveniência, os helpers antigos viraram wrapper (contrato intacto para a publicação) e `provenienciaDaTarifa` falha fechado. **Ficou de fora, por falta de definição do Diego:** os 5 cenários comerciais (nunca enumerados) e o ROI (sem quantidade, capital nem horizonte) — construí-los seria inventar regra financeira. **DEFINIDO E IMPLEMENTADO no mesmo dia (ADR-0149):** Diego respondeu as duas — cenários são **preços de venda**, retorno é sobre **capital de um lote**. Duas correções minhas entraram antes do código: o preço do buy-box **não é obtenível** (Spike 049) e virou o anúncio que mais vende; e ROI sobre capital é **igual ao markup**, porque a quantidade cancela em `(lucro×Q)÷(custo×Q)` — então a tela mostra capital imobilizado e lucro do lote (os absolutos, que a quantidade muda de verdade) e rotula o percentual como retorno sobre o custo. Cada um dos cinco preços é cotado no próprio valor, o que resolve o defeito da extrapolação linear apontado no Spike 040.
>
> **📋 ADR-0132: Análise Avançada com JoomPulse — D-3 SUPERSEDED pela 0141 (2026-08-23; spike parcial 2026-08-28).** O [Spike 038](../../docs/spikes/038-joompulse-parcial-correlacao-e-semantica.md) rodou contra o MCP real e fechou #1–#3. **Não existe GTIN na JoomPulse** — as chaves são `ml_item_id` → `id` e `catalog_product_id` → `productId`, ambas já no schema, então a correlação da D-10 não precisa de nada novo. **Mas a D-3 caiu:** `orderCount1m` só existe para o ganhador do buy-box; os outros 14–17 concorrentes devolvem `0`, que significa "não atribuído a esta listagem" e não "não vendeu". O v1 possível é *demanda do catálogo + quem tem o buy-box + estimativa do ganhador* — feature diferente de "vendas do rival", e a escolha volta ao Diego (D-17). Seguem bloqueando #4–#15 (OAuth multi-conta, credenciais, cache, quotas, ciclo de vida) e a nova #16: a parceria cobre uso server-to-server? A superfície entregue é um assistente analítico para agente, não uma API de dados. Direção arquitetural aprovada; questões "A definir" (D-5, D-9, D-10, D-11). Gateway próprio no Render como único cliente MCP/OAuth; módulo `analise_avancada` desligado por padrão; enriquece Radar (vendas/renda rival) e Viabilidade (demanda ao lado do semáforo). Sem fallback inventado, sem contaminação de margem/piso/semáforo/reprecificação. Credenciais ficam só no Gateway. Cache segregado por org+credencial. Chave canônica de correlação e TTLs A definir.

> **✅ Viabilidade — mercado relevante e tabela de frete EM PRODUÇÃO (2026-08-20/22).** Mercado relevante integrado (edge `buscar-mercado-relevante`); tabela compacta de frete Mercado Envios movida para fim da página; tolera payload sem observado durante skew de deploy.

> **✅ Resolução em massa do "Não encontro minha variação" (ADR-0118).** A fila "Próximos a serem
> pausados" **zerou**: os 3 anúncios sinalizados foram resolvidos, **66 cliques manuais viraram
> segundos**, e os **9 vínculos que competiam foram preservados** (`ALREADY_OPTED_IN`); o resto
> ficou em `LOOPING_ITEM` — o mesmo status do clique manual.
>
> **Como foi possível:** o ADR-0036 dava isso como impossível, e a conclusão dele continua correta
> (não há caminho OAuth). Mas respondia a pergunta errada — o backend não consegue, o **navegador do
> operador** consegue. Extensão MV3 em `extensao-ml/`, sem credencial armazenada, com dry-run
> obrigatório antes de qualquer envio.
>
> **Contrato** (extraído do bundle do próprio ML e validado ao vivo): duas chamadas por anúncio, e a
> segunda depende do desfecho da primeira — `invalidate_summary_confirm` quando nenhuma cor tem
> ficha, `massive_summary_confirm` quando sobra vinculada.
>
> **Escopo mudou:** o card passou a listar só o que o ML sinaliza (tag `catalog_forewarning`,
> legível pela API OAuth) — **3** anúncios, contra os 130 da heurística local anterior.
>
> **Dois bugs achados antes de causar dano**, ambos invisíveis a teste unitário: o mesmo
> `ml_variation_id` existe em duas famílias com status contraditórios (teria mandado `null` em 8
> variações que competiam no Ecoamigurumi); e no eco do servidor `entity_id` é o **item**, com a
> variação em `variation_id` (o guard rejeitaria a resposta correta).
>
> Runbook do operador: `docs/runbooks/catalogo-anuncios-a-pausar.md`.
> Pendência: o **painel** da extensão ainda não foi exercitado ponta a ponta — as chamadas foram
> disparadas direto na página. Aguarda o próximo anúncio sinalizado.

> **✅ Adicionar variação a produto publicado EM PRODUÇÃO (ADR-0129, 2026-08-20).** Menu "⋮" do
> card em `/estoque` (admin-only) ganha "Adicionar variação": clona a família publicada mais
> recente + variações vivas para um **lote dedicado de UPDATE**, insere N cores novas digitadas
> (foto obrigatória, CODIGO único por org, campos físicos pré-preenchidos de uma irmã), registra
> estoque inicial pelo ledger e encadeia `publicar-familias` — reaproveita 100% o pipeline de
> UPDATE existente (ADR-0016/0104), zero integração nova com o ML. Bloqueia (409) se já há lote
> não-terminal para a família (D-8); **nunca passa pela tela Revisão** (dado é 100% manual do
> admin, não saída de IA). Edge nova `adicionar-variacoes-familia` (v1) + `cadastrar-produto`/
> `update-familia-ml` redeployadas (blast radius de `_shared/produto/codigos.ts`). Migration
> `20260820143736` restringe a `operacao='CREATE'` o guard que exigia estoque zero no INSERT em
> lote manual — sem isso, clonar o estoque vivo das irmãs zeraria o saldo no ML.
>
> **Renumerado de ADR-0128 para ADR-0129 no merge:** outra sessão mergeou um ADR-0128 diferente
> (Sonar — veredito Demanda/Entrada) enquanto esta feature estava em revisão. A colisão só apareceu
> no `git fetch` pré-merge — os arquivos têm nomes diferentes, então não gerou conflito de git,
> só duplicidade semântica de número. Rebase + renumeração em todo o código/docs antes do merge.
> **Pendente:** validação E2E ao vivo (cor nova aparecendo de fato no anúncio publicado no ML).

> **📋 ADR-0135: Cadastro fiscal e Faturador do Mercado Livre (2026-08-25/26) — 15 tasks
> concluídas na branch `worktree-fiscal-cadastro-nfe`, aguardando CI verde + merge do Diego.**
> Supersede parcialmente o ADR-0114: o PubliAI **não transmite NF-e** — o Faturador grátis do
> próprio ML emite —, e passa a cadastrar empresa (`empresa_fiscal`, card "Empresa" em
> `/configuracoes`) e produto (NCM/CEST/origem fiscal/CSOSN por família), empurrar por SKU via a
> porta `DadosFiscaisCanal` (adaptador único ML) e mostrar a prontidão real (`can_invoice`) como
> semáforo em Publicados. `organizations.tipo_pessoa` com constraint no banco impede PF de ligar
> o módulo `fiscal`. Dialog de cadastro em 3 etapas + fila "fiscal pendente" em `/estoque`; NCM
> sugerido por IA, só grava com confirmação ativa. V1 Simples Nacional apenas. Ver [[Fiscal]].
> **Deploy das 3 edges novas + 6 afetadas por `_shared/fiscal` fica para depois do merge**
> (checklist em `docs/how-to/deploy-e-migrations.md`); as 3 migrations do schema já rodaram em
> produção (aditivo).

## 📍 Fase 1 (2026-08-13) — detecção

> **✅ Em produção.** O ML marcava anúncios como
> "Próximos a serem pausados" e o PubliAI não avisava nada. Causa: `pendente` devolvia 500 e vivia
> só do retry curto do QStash (minutos), enquanto a elegibilidade do ML leva horas ou dias — o retry
> esgotava e a família congelava; e o alerta do ADR-0036 exigia `pendente === 0`, então também nunca
> saía. **93 famílias / 296 variações** congeladas.
>
> Entregue e mergeado: `pendente` entra no backoff longo, falha de leitura da elegibilidade propaga
> em vez de finalizar a rodada zerada (Legacy **e** User Products), alerta cobre `pendente` residual,
> e o card **"Catálogo em risco"** aparece em Publicados. Sem migration. Backfill das 93 famílias
> executado em silêncio (sem enxurrada de Telegram). Ver ADR-0021 e ADR-0036 (revisões 2026-08-12).

## 📍 Passo anterior (2026-08-11)

> **✅ Ajuste/zeragem de estoque pelo PubliAI EM PRODUÇÃO (ADR-0110).** Motivo `ajuste` no ledger,
> RPC `ajustar_estoque` e edge `ajustar-estoque` (admin-only), diálogo por produto e variação na
> tela `/estoque`. **Só reduz ou zera** — aumentar continua sendo Entrada (que exige custo e
> alimenta markup/preço). Diagnóstico que originou tudo: cor zerada direto no ML voltava sozinha,
> porque `reconciliar-estoque` (`30 12 * * *`) re-empurra o saldo local com `canal_origem: null`.
> Vira regra operacional: **nunca editar estoque direto no canal** ([[Estoque]]).
>
> **Achado de segurança no próprio deploy:** os `grant`/`revoke` da RPC vieram **depois** do
> `alter function … owner to`, e o `supabase db push` não roda a migration em transação — os
> comandos viraram **no-op com WARNING, não erro**, e a função ficou publicada com `EXECUTE` para
> `PUBLIC`/`anon`/`authenticated`. Corrigido pela migration `20260811203500`.
>
> **✅ Repor estoque reativa o anúncio pausado EM PRODUÇÃO (ADR-0111).** O ML só desfaz sozinho a
> pausa que ele mesmo aplicou por falta de estoque (medido no `MLB5040504553`); pausa do vendedor
> fica de pé mesmo com o saldo já no canal. Agora um push de **reposição** com saldo > 0 lê o
> status ao vivo e devolve `pausado` → `ativo`. A intenção vem do **sinal da quantidade** no
> ledger (entrada e estorno reativam; venda e ajuste não), a reconciliação diária **não** reativa,
> e `moderado`/`encerrado`/`inativo`/`indisponivel` são intocados. 10 testes novos, RED confirmado.
>
> **✅ Alíquota interna por UF da empresa EM PRODUÇÃO (ADR-0112).** A AVIL é de PE e paga **1%**
> vendendo para cliente do próprio estado — com só as alíquotas por origem, toda venda
> intraestadual saía com imposto 8×/16× maior. `configuracoes.uf_empresa` +
> `aliquota_interna_pct` (migration `20260812004735`, nullable, sem default, CHECK de coerência),
> `AliquotaResolver` recebendo a UF em parâmetro **obrigatório** (opcional deixaria call site
> esquecido devolvendo número plausível e errado). Recálculo retroativo sai de graça — imposto e
> markup são derivados na leitura. Validado no pedido `2000017819569754` (entrega em PE): imposto
> R$ 0,85 (1%) contra R$ 6,78 (8%), markup +40% contra +26%. Configurado na org **Avil**
> (72 pedidos históricos em PE); DSA segue sem o parâmetro. **Escopo: só apuração pós-venda** —
> preço sugerido e gross-up continuam na origem.
>
> **🐞 Incidente fechado: venda não baixava estoque de produto cadastrado por outro membro da org.**
> 12 unidades do NIVEA (org DSA) venderam em 10 pedidos pagos e o saldo continuou 12.
> `carregarCatalogo` filtrava `familias`/`variacoes` por **`user_id`** (o `criado_por` da conexão),
> resíduo pré-multi-tenancy — agora filtra por `org_id`. E `selecionarBaixas` descartava item sem
> código **em silêncio**: o motivo `venda_sku_nao_encontrado` existia no ledger com 0 linhas em
> todo o banco. Agora vira movimento informativo + notificação. Alcance medido: Avil 0/297
> famílias, DSA 2/6. Os 10 pedidos foram re-enfileirados, o saldo foi a 0 e o ML pausou o anúncio
> sozinho — **sem nenhum ajuste manual**, o histórico ficou com a causa certa. 8 functions
> redeployadas.
>
> **✅ MLB do anúncio de catálogo entra no catálogo do faturamento (ADR-0021).**
> `carregarCatalogo` só conhecia `familias.ml_item_id`, mas o vínculo de catálogo cria um anúncio
> **separado** (`variacoes.catalog_listing_id`) — a venda dele só era reconhecida pelo fallback de
> GTIN, e produto sem EAN ficaria sem código (logo, sem baixa de estoque). Sem dado errado hoje:
> nenhum SKU vinculado está sem GTIN (288 Avil, 4 DSA).
>
> **⏸️ Pendente de decisão do Diego:** 7 de 147 produtos sem foto na tela Estoque
> ([[Bugs Conhecidos]]).
>
> **Depois: E5 Shopee.**

## Passo anterior (2026-07-29 → 2026-08-02)

> **✅ E6b BLOCO A EM PRODUÇÃO (2026-07-29).** Ledger `estoque_movimentos`, baixa automática na
> venda paga, estorno no cancelamento pré-despacho, push absoluto cross-canal e reconciliação
> diária. Migration aplicada, `sincronizar-estoque` (v1) e `reconciliar-estoque` (v1) deployadas
> com `verify_jwt=false`, `sync-venda` redeployada (v50), schedule QStash `30 12 * * *` criado e
> **confirmado na listagem**. Suíte 2181 → 2215. Invariantes verificados ao vivo em produção:
> RLS ligada com uma única policy (SELECT/authenticated), trigger de bloqueio de escrita direta
> habilitado, e as 3 RPCs executáveis só por `service_role`.
>
> **Bug achado rodando, não pela revisão:** faltava `grant select ... to authenticated` na tabela.
> A policy de RLS existia, mas privilégio de tabela e RLS são checagens independentes — sem o
> grant, a tela de movimentos daria "permission denied". (Em produção os grants já vinham por
> default privileges; local não. Só apareceu ao assumir o papel `authenticated` de fato.)
>
> **Bloco A não tem mais pendência:** a UI de movimentos foi mergeada e está no ar (deploy
> `823843e9` no Render), e a suíte `verificar-isolamento-tenant.ts` rodou contra produção com
> 54 asserções passando.
>
> **✅ E6b BLOCO B EM PRODUÇÃO (2026-07-29).** Cadastro manual de produto
> (edge `cadastrar-produto`), entrada de mercadoria (edge `entrada-estoque`), tela `/estoque`,
> módulo pago ligado por org pelo super-admin (`organizations.modulos_habilitados` +
> `set_modulos_org` no `/admin`), chip Planilha/Cadastro manual no LoteCard. Migration
> `20260729124711_e6b_origem_lote_e_modulos.sql` aplicada, 6 edge functions deployadas
> (`cadastrar-produto` v1 e `entrada-estoque` v1 com `verify_jwt=true`), frontend `live` no
> Render (`2d94b4e9`) e CI verde. Suíte 2215 → 2255.
> **Nenhuma org enxerga o módulo ainda** — `modulos_habilitados` nasce vazio; ligar em `/admin`
> → botão "Módulos" na linha da empresa.
>
> **Corrigido de quebra (defeito pré-existente, valia também para planilha):**
> `talvezFinalizarLote` marcava o lote como `concluido` — status terminal — mesmo com família
> em `pendente`, e o trigger de transição só resgata lote em `processando`, então o lote ficava
> concluído com família publicável dentro. Eram TRÊS cópias idênticas; viraram uma em
> `_shared/lote/finalizar.ts`.
>
> **Ordem de deploy usada (e obrigatória em qualquer repetição):** `db push` →
> `functions deploy` → merge na main. O frontend chama `modulos_habilitados_da_org` dentro do
> MenuGuard e o Render auto-deploya no push — inverter deixaria toda org na tela de carregando.
>
> **E2E manual concluído 2026-07-29** (Playwright CLI, org DSA ao vivo, módulo ligado em
> `/admin`): cadastro real com 2 variações, IA rodando de verdade, D-1.1 (mesmo lote), 409 de
> duplicata, ledger — tudo confirmado. Parado antes do clique de publicar de verdade no ML
> (decisão do Diego). **4 bugs de UI achados e corrigidos no mesmo dia** (deploy `7efb89a`):
> dialog de cadastro cortando a tabela de variações (classe Tailwind sem prefixo `sm:`, `min-w-0`
> faltando, e largura insuficiente — `sm:max-w-4xl` → `sm:max-w-5xl`) e GTIN/dimensões/descrição
> ausentes na tela `/estoque` (dado já gravado, agora também exibido). Suíte 2255 → 2256.
> Produtos de teste (`99000001`/`99000002`) seguem na DSA — procedimento de limpeza em
> `docs/how-to/operacoes-rotineiras.md`.
>
> **✅ Redesenho da tela `/estoque` EM PRODUÇÃO (2026-08-02, PR #56).** O `sm:max-w-5xl` do
> Bloco B (linha acima) aliviou o corte da tabela de variações no cadastro, mas a causa raiz
> era estrutural: `<table>` aninhada dentro de `<TableCell>` forçava scroll horizontal em telas
> estreitas — no cadastro, na listagem, e em `/publicados` (compartilha `MovimentosEstoque`).
> Listagem e cadastro viraram cards, sem nenhuma `<table>` no caminho. Busca ampliada
> (GTIN/fornecedor); filtro "não publicado" corrigido pra derivar de `familias.ml_item_id`
> (fonte canônica) em vez de só `anuncios_externos` (espelho que pode ficar furado sem erro —
> upsert falha só com `console.error`, sem desfazer a publicação real).
>
> **Duas rodadas de revisão** (12 tasks TDD via `subagent-driven-development` + revisão final
> de branch + `code-review-fable5` independente) acharam e corrigiram, cada achado re-revisado
> antes de aceitar: um bug financeiro real herdado da própria tela (`"1.234"` gravava preço/custo
> como `R$ 1,23` — parsing de milhar pt-BR ausente; `parseNumeroPtBr` em `src/lib/formato.ts`),
> idempotência do cadastro em retry ambíguo (risco de duplicar produto), casamento
> posicional de foto travado quando a contagem diverge do formulário, mais 3 achados baixos.
> 10/10 checagens reais de scroll horizontal via `playwright-cli` (5 cenários × 2 viewports).
>
> **100% frontend** — nenhuma mudança em edge function, migration ou RLS. Decisão consciente
> registrada (§8.2 da spec): a foto do cadastro não participa do enriquecimento por IA nesta
> entrega (a edge enfileira antes do upload terminar).
>
> **Fora do escopo, registrado para entrega própria:** `src/components/variacao-card.tsx`
> (edição de preço em `/publicados`) tem o mesmo bug de parsing de milhar pt-BR corrigido aqui —
> não tocado neste PR.
>
> **Depois: E5 Shopee.**

> **Contexto da decisão (2026-07-28).** O E6b foi **ampliado** (deixou de ser só "estoque único"
> e passou a incluir cadastro de produto sem planilha e entrada de mercadoria) e **antecipado na
> frente do E5 Shopee**. Motivo: hoje um produto só entra por planilha (`ingest-lote`), o que exige
> que o cliente **já tenha um ERP** para usar o PubliAI — o funil ficava restrito exatamente ao
> público que menos precisa do produto.
>
> **Descartado na mesma sessão: módulo de emissão de NF-e.** Commodity (6 providers entregam igual),
> passivo e não ativo (nota errada vira chamado de suporte contábil), manutenção fiscal perpétua
> (reforma tributária em transição) e não multiplica nada do que o PubliAI já construiu. Racional
> completo e dados dos providers na seção 11 da spec.
>
> **Decisão de arquitetura do Bloco B:** cadastro manual **não** usa `lote_id` nulo — "sessão de
> cadastro = um lote" (`lotes.origem = 'manual'`). Verificado no código que `lote_id` é `NOT NULL`
> e sustenta `process-familia`, `finalizarLote` nos TRÊS workers de publicação, todo o roteamento
> da Revisão e a unique `(lote_id, codigo_pai)` — que ficaria furada com `NULL`.
>
> **Spec:** `docs/superpowers/specs/2026-07-28-cadastro-manual-e-estoque-design.md`
> **ADR:** [[Índice de ADRs|ADR-0094]] (o número 0054 do plano original já estava ocupado).
> Os planos passaram por 1 revisão do Fable + 7 rodadas adversariais com o Codex (`gpt-5.6-sol`),
> convergindo em APPROVED; 9 bloqueadores corrigidos. Log em `PLAN-REVIEW-LOG-E6B.md`.

## Entregas mais recentes já em produção

> Fonte: `docs/project-status.md` (seção "Entregas de agosto de 2026" para 04–11/08) e
> `docs/TASKS.md`.

- **Custo congelado no instante da venda** (ADR-0109) — em produção 2026-08-07: o markup de uma
  venda passada parava de ser reproduzível, porque o custo usado era o **cadastrado hoje** —
  medido: 307 dos 1164 itens vendidos exibiam custo diferente do que vigorava na data da venda.
  Agora o custo é copiado para a tabela satélite `venda_item_custo` (`unique nulls not distinct`),
  **insert-once** com trigger que faz qualquer `UPDATE` de `custo_unitario` falhar. Satélite e não
  coluna porque `_shared/faturamento/io.ts` apaga e reinsere os itens a cada sync do pedido. O
  congelamento mora **dentro** de `upsertVenda`, com o resolver como campo obrigatório de `opts` —
  o compilador quebra qualquer um dos 4 callers que esqueça. Backfill pelo lote mais recente
  anterior à venda (`fonte = 'backfill'`, aproximação assumida). Comissão, frete e imposto
  continuam **dinâmicos**. Ver [[Índice de ADRs]].
- **Com variação duplicada, vence o custo mais recente** (ADR-0108) — em produção 2026-08-07:
  o desempate era pelo **maior custo** (desde 2026-06-23, sem ADR), então uma redução de custo
  nunca aparecia enquanto a linha antiga existisse. Caso real: COLA EM BASTÃO (`02841037`) em
  3 famílias com **todas as chaves idênticas**, exibindo R$ 34,24 no lugar de R$ 31,71. Passa a
  vencer a linha mais recente por `atualizado_em` (que precisou entrar no `select` de
  `buscarCustos`). Varredura: **309 códigos** com custo inflado, todos com markup subestimado.
- **ORIGEM obrigatória e explícita na planilha** (ADR-0107) — em produção 2026-08-07: parâmetro
  fiscal nunca defaulta em silêncio; vazio ou typo **aborta o lote**. Ver [[Upload Planilha]].
- **Devolução conta no período em que o dinheiro saiu** (ADR-0106) — em produção 2026-08-06: o
  filtro usava `aberto_em` (abertura do claim), então um claim aberto em 31/07 e reembolsado em
  03/08 contava em julho e agosto não via nada. Passa a usar `claim.resolution.date_created`
  (coluna nova `ml_devolucoes.fechado_em`, migration `20260806151323` com backfill do `raw`) —
  conferida contra o estorno no Mercado Pago em 5 devoluções reais (Δ de 2 a 64 segundos). Junto:
  devolução **fechada** deixou de ser contada como aberta no card "Precisa de atenção" (o ML segue
  devolvendo `available_actions` em claim já finalizado). O critério de "concluída" não mudou.
- **Atualização rápida de estoque** (ADR-0089) — em produção 2026-07-24: atalho de 1-clique em
  `Progresso.tsx` que publica automaticamente o estoque de famílias `UPDATE` sem nenhuma
  pendência (nunca `CREATE`, nunca cor nova mesmo completa, preço sempre ignorado) — elimina a
  seleção manual família a família na Revisão pra reposições puras de estoque. `/relatorio/{loteId}`
  ganhou seção de variações/famílias que zeraram estoque na rodada. 100% frontend (zero
  migration/edge nova), 24 testes novos. Plano revisado adversarialmente pelo Fable 5 antes de
  codar (achou e evitou 1 furo real: cor nova completa não podia entrar no atalho) e revisado
  com `/code-review-fable5` depois de pronto (88/100, 2 achados médios corrigidos no mesmo dia).
  Merge direto pra `main`, sem PR. Ver [[Índice de ADRs]].
- **Publicação em User Products com N itens por família (multi-cor)** (ADR-0088) — em produção
  2026-07-22/23: categorias do ML que exigem "item plano" (ADR-0084/0087) e têm >1 cor não aceitam
  o array `variations` — cada cor vira um item técnico separado, linkado por `family_id`, agregado
  pelo ML numa única página com seletor de cor. Fase 1 (saga `publicar-grupo.ts`, criar-pausado→
  confirmar→ativar, `agregarEstado` total dos 10 casos da ADR) validada com família real de 9 cores
  (PAI `03103331`). Fase 2: vinculação de catálogo por item + UPDATE por item filho com mini-saga de
  mudança de composição (add/retirar cor) — grava `skus_esperados`/`mudando_composicao` ANTES de
  mutar remoto, confirma sempre por `GET`; fix do gate de publicabilidade do frontend que travava
  qualquer UPDATE de família UP na Revisão. Validado end-to-end em produção real (Playwright):
  adicionar cor → caso real de `family_id` divergente isolado corretamente pela mini-saga (9 cores
  reais intocadas) → remover cor com sucesso. As 5 pendências (reconciliador de convergência,
  reconciliador de backfill, sincronizar descrição no UPDATE UP, guarda completa de remoção,
  fix de realtime na tela de Revisão)
  **implementadas, revisadas e deployadas em produção (2026-07-24)** — cada uma aprovada pelo
  Codex após 3-4 rodadas de revisão adversarial (achados reais corrigidos por rodada, ver
  `docs/TASKS.md`); suíte inteira verde, `deno check`/lint limpos; migrations aplicadas + 12
  functions redeployadas (blast radius recalculado via `deno info`); schedule QStash do
  reconciliador de convergência criado (`*/15 * * * *`). **Achado à parte, também corrigido:**
  `reconciliar-faturamento` (ADR-0037) nunca teve schedule QStash desde a criação — rodou zero
  vezes em ~1 mês; corrigido junto. Ver [[Índice de ADRs]].
- **UPDATE de família migrada pelo ML para User Products** (ADR-0104) — em produção 2026-08-04/05.
  O ML migra categorias para UP **sozinho**, em anúncios já publicados. Duas lacunas fechadas antes
  de a migração alcançar as famílias multi-cor do Diego. **(1) Bug latente que já existia:** no
  caminho UP, `somente estoque` **mudava a composição** — a composição vinha da planilha, então uma
  cor ausente virava "retirada" e o item era **pausado no ML** numa reposição pura. O Legacy nunca
  fez isso (`montarVariacoesUpdate` mapeia sobre as variações VIVAS do `GET` e preserva a cor
  omitida), e contradizia o texto do ADR-0089 ("não pausa nada automaticamente no ML"). Guard dentro
  de `atualizarComposicao`: composição virou exclusiva de "Atualizar tudo". **(2) A ponte que
  faltava:** o roteamento UP do UPDATE lia estado **local** (linhas em `anuncios_externos_itens`),
  que uma família migrada nunca teve → caía no Legacy → erro 400 pedindo reposição manual no painel,
  por família, em cada lote. Agora o conector detecta pelo `GET` ao vivo e devolve `MIGRADO_PARA_UP`
  tipado (simétrico ao `FORMATO_INCOMPATIVEL` do CREATE; **zero `GET` extra**), e o worker adota os
  itens irmãos por SKU — tudo-ou-nada, **só leitura remota** — antes de entregar à saga UP.
  A forma exata da migração era **hipótese validada em runtime** — e **a hipótese estava errada**;
  ver ADR-0105 logo abaixo. **Limite conhecido:** irmãos fora da planilha do lote ficam sem vínculo
  local (vendas não atribuídas até um lote futuro incluir a cor).
  2498 testes verdes, migration aplicada, 15 functions redeployadas (+1 confirmado).
  Ver [[Índice de ADRs]].
- **Re-vínculo de família DISSOLVIDA pelo ML em User Products** (ADR-0105) — em produção 2026-08-06.
  A primeira migração real chegou (lote #45, `PAI 02186551`) e o ML **não converte** o item: ele
  **fecha** o anúncio Legacy (`status: closed`, `sub_status: []` vazio, sem
  `family_id`/`family_name`/`parent_item_id`) e cria N itens novos sob um `family_id`, **todos sem
  `seller_custom_field`** — e **nada** liga o velho ao novo. Logo, o guard de anúncio morto disparava
  antes de qualquer detecção de UP ("republique o produto") e a busca por SKU do ADR-0104 acharia
  0 de 17. **Correção:** `status` terminal **sem** `sub_status` de remoção vira `MIGRADO_PARA_UP`
  (com título, categoria e o mapa `SKU → COR` do item morto); `descobrirFamiliaUP` acha a família por
  `?q=<título>` (fail-closed: um único `family_id`) e a enumera por `?family_id=`; o casamento é por
  **`COLOR.value_name`**, com os dois lados vindos do próprio ML — `variacoes.cor` do nosso banco
  **nunca** entra. A adoção do ADR-0104 é reusada inteira; só a porta `buscarPorSku` muda. A RPC
  re-aponta `ml_item_id` **e `ml_permalink`** em todas as famílias do `codigo_pai` (§5.1 — todo link
  "ver anúncio" da UI sai desses campos; sem isso o operador ia parar no anúncio finalizado).
  **Validado ponta a ponta:** 17 filhos, estoque batendo 1:1 com a API do ML.
  **Limites:** o push rápido de estoque não re-vincula sozinho (§6) e família **dividida** (split,
  ADR-0048) também não — falha com a causa certa, porque a forma que o ML dá a um produto dividido
  ao dissolvê-lo é desconhecida e este ADR decidiu não supor (§7). Ver [[Índice de ADRs]].
- **Config org-scoped + imposto LOUD + token MP por org** (ADR-0086) — em produção 2026-07-22:
  `configuracoes` virou 1 linha por org (`org_id` PK, `user_id` = auditoria); o imposto por origem
  **falha LOUD** se a org não confirmou as alíquotas (`aliquotas_confirmadas_em`) em vez de aplicar
  8/16 em silêncio (Configurações tem banner + botão "Confirmar alíquotas"); e o token do Mercado
  Pago é por org — fechando um vazamento cross-tenant que ficou **vivo** ao surgir a 2ª org
  (DSA/diego-souza), que lia a conta MP da Avil. Ver `docs/decisions/0086-configuracao-org-scoped.md`.
- **Preço por variação + split por faixa** (ADR-0078) — em produção 2026-07-17: o ML passou a
  rejeitar publicação de famílias com preço divergente entre variações (`Found different prices in
  variations`, incidente real — PAI 02841240/02841290). Fase 2 entrega o motor de split por faixa
  de preço (`particionarPorPreco`/`decidirSplit` roteiam pro worker `publicar-split-ml`, ancoragem
  preservada) + guards LOUD de uniformidade + UI de configuração por faixa (`ConfigGruposPreco`,
  prompt "aplicar às demais?", badge por variação, aviso LOUD no diálogo de publicação). Validado
  com dados reais: as 2 famílias do incidente republicadas de verdade (split funcionando, 3 e 2
  anúncios) e UI validada pelo Diego. Ver [[Índice de ADRs]].
- **Notificação in-app** (ADR-0085) — em produção 2026-07-21: espelho no app de todo alerta já
  enviado por Telegram, com tabela `notificacoes`, sino no topbar e badge de não lidas; a RPC
  `marcar_notificacoes_lidas` marca as notificações do usuário. Migration aplicada, 8 edge
  functions redeployadas e frontend confirmado `live` no Render.
- **UI multi-marketplace (menus/tabs/registry)** — spec 2026-07-14, em produção 2026-07-15:
  registry único no frontend (`src/lib/canais.ts`, 5 marketplaces) + `organizations.canais_habilitados`
  por org (rollout piloto sem deploy); canal ativo global (`?canal=` + sessão) com tabs em
  Dashboard/Publicados/Faturamento/Financeiro; menu+tela `/canais` (OAuth do ML migrado de
  Configurações); Revisão registry-driven; editor de canais no `/admin`. Com 1 canal, nenhum
  número de nenhuma tela muda. **E5 (Shopee) vira só "preencher o conector"** — a UI e o
  rollout por org já existem.
- **E6 — Orquestração multicanal** (ADR-0061) — em produção 2026-07-06: fan-out por
  `(família, canal)`; caminho ML **intocado** (roda dentro de `if(incluiML)`); worker genérico
  `publicar-anuncio`; estado por canal em `anuncios_externos` (claim atômico); UI de seleção de
  canal aparece só com >1 canal. Default `['mercado_livre']` → chamadas atuais 100% compatíveis.
- **E7 — Multi-tenancy** (ADR-0027) — em produção 2026-07-05/06: isolamento por `org_id`
  (`current_org_id()`) substitui `is_membro_operacao()` em toda tabela de domínio; estratégia
  `expand → migrate → contract`; suíte hermética de isolamento (39 asserções) validada contra
  produção; zero regressão na conta Avil.

- **Marca manual de saque no Financeiro** (ADR-0053) — deployada 2026-07-02: estado `sacado` no
  Detalhe do líquido (checkbox + `Registrar`/`Desfazer saque` + filtro `Sacados`); campos
  `sacado_em`/`sacado_por` em `ml_vendas` via RPCs `security definer`. Migration aplicada via MCP
  (CLI bloqueado por IPv6 nesta rede).
- **Módulo Financeiro impecável** (ADR-0040) — validado e deployado 2026-07-02 (migration +
  `notificar-liberacao` + schedule QStash diário)
- **Módulo Faturamento** (ADR-0037) — webhooks ML no DevCenter + schedule QStash horário
  ativos (2026-07-02)
- **Lote #49 barbante** (ADR-0051) — fix deployado e 3 famílias reprocessadas (2026-07-02)
- Camadas 2A + 2B de atributos por IA com fallback do operador (ADR-0052, 2026-07-01)
- Split de produto em N anúncios para produtos com >100 cores (ADR-0048, 2026-06-29)
- Multiusuário com permissão de menu (ADR-0047, 2026-06-29) — antecipa parte do `E7`

- **Copy da descrição de anúncio ancorada na fonte** (ADR-0098, 2026-08-02) — prompt
  reescrito com R1–R9 após análise externa de conversão. Achado central: o próprio prompt
  prescrevia os bullets genéricos ("Alta resistência" em 75% do catálogo). Experimento
  A/B/C provou que o ganho é do prompt, não do modelo — `gpt-4o-mini` mantido. Rollout sob
  demanda via `regenerar-copy-familia`; nada regerado em lote.

## Ver também

- [[Estoque]] — o módulo que o E6b entregou (ledger, ajuste, push cross-canal)
- [[Backlog]] — os épicos da evolução SaaS (agora com E6b)
- [[Publicação Shopee]] — pesquisa do épico `E5`, agora antecipado (roadmap v2, 2026-07-12)
