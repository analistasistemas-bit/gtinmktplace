# ADR-0190 — Notificação gerencial de venda, resumo diário e comandos no Telegram

**Status:** Aceito — em produção desde 2026-10-25 (main `15e9c496`; migrations aplicadas, 23 edges implantadas, schedules ativos, validado na DSA). design fechado em entrevista (grill-with-docs, 2026-10-24), consultoria do Codex `gpt-6.1-sol` high incorporada com aprovação do Diego (2026-10-24); falta plano de implementação + revisão do plano
**Data:** 2026-10-24
**Decisores:** Diego
**Origem:** pedido do diretor de uma organização cliente (Hairfly, 2026-10-24): "a notificação deveria vir com o valor total da venda, não o do produto"; KPIs (acumulado do período, % de crescimento, ticket médio); "não preciso ficar entrando na ferramenta pra saber se preciso mexer em estratégia"; comando `/resumo`.
**Estende:** [ADR-0068](0068-notificacoes-telegram-por-destinatario-e-categoria.md) (assinatura por destinatário e categoria; revoga o "bot só envia" — passa a receber comandos)
**Relaciona:** [0047](0047-operacao-compartilhada-rbac-menu.md) (`is_admin`), [0109](0109-custo-congelado-por-venda.md) (custo congelado), [0150](0150-margem-um-rotulo-e-um-simulador-no-pulse.md) (rótulos Margem s/ venda / Markup), [0173](0173-fanout-por-org-workers-agendados-cpu.md) (fan-out por org, lotes retomáveis, notificação com chave), [0180](0180-cupom-do-vendedor-na-venda.md) (total pago), [0055](0055-imposto-por-origem-nacional-importado.md) (imposto), [0040](0040-financeiro-caixa-evolucao-notificacao.md) (liberação ≠ saldo da conta)
**Glossário:** `docs/reference/glossario.md` § Integrações externas — Carrinho, Notificação operacional de venda, Notificação gerencial de venda, Resumo diário, Crescimento do mês.

---

## Contexto

O alerta de venda (`sync-venda` → categoria `vendas`) sai **por order**. No ML, um carrinho com N produtos são N orders ligadas por `pack_id`, então o destinatário recebe N mensagens, cada uma com o valor só do seu item. Para quem separa e despacha isso é o certo (um produto por mensagem, com EAN). Para o dono do negócio, a unidade é o **carrinho** e o que importa é o resultado (lucro), não o produto.

Lucro, Margem s/ venda e Markup do pedido já existem (`cascataDoPedido`, Faturamento › Vendas), assim como os KPIs de período (Faturamento, Pedidos com carrinho = 1, Ticket médio). Nada disso chega ao Telegram.

## Decisão

**D-1. Duas categorias novas, sem mudar o modelo de assinatura.** `vendas_gerencial` (por carrinho) e `resumo_diario`, somadas a `CATEGORIAS_NOTIFICACAO` (e ao espelho do front). `vendas` continua igual: por pedido, instantânea. A mesma pessoa assina qualquer combinação.

**D-2. Unidade = Carrinho.** Uma mensagem gerencial por `pack_id` (pedido sem pack = carrinho de 1 item), com o total pago (regra ADR-0180), Lucro, Margem s/ venda e Markup do carrinho, mais o acumulado de **hoje** e do **mês corrente** (faturamento, pedidos, ticket médio) e o **Crescimento do mês**. As contas seguem Faturamento › Vendas: bruto, canceladas fora. O ticket médio dos acumulados sai da RPC `vendas_kpis_janela` em decimal exato (half-up) e pode diferir em até R$ 0,01 do da tela, que arredonda em float; faturamento e pedidos batem exatos.
- Lucro = margem de contribuição **antes de Ads**: líquido após comissão, frete do vendedor, cupom do vendedor e imposto, menos custo congelado.
- Item sem custo, ou imposto sem alíquota confirmada → lucro vazio com o motivo, nunca lucro = líquido. Regra da `cascataDoPedido` (custo completo exigido), **não** a de `calcularResumo`, que aceita custo parcial no pack.
- O frete do vendedor existe desde o checkout (`/shipments/{id}/costs`, lido no mesmo sync). Só a **falha dessa leitura** devolve `null`, que hoje `calcularLiquido` trata como R$ 0. Nesse caso a gerencial mostra `Lucro: — (frete não lido)`. Pedido sem envio continua com frete R$ 0, que é o valor correto.
- **Sem nome do comprador** na gerencial: não ajuda a decidir e só espalha dado pessoal. A operacional continua com o nome.

**D-3. Crescimento = mesmo intervalo do mês anterior, em dias inteiros.** Do dia 1 até o dia correspondente do mês anterior, inteiro. É a regra de `janelaAnterior('mes_atual')` em `src/lib/metricas.ts`, decisão anterior do Diego para o número bater com a tela. Enquanto o dia corrente não fecha, o crescimento fica subestimado (aceito). Fuso `America/Sao_Paulo`. Mês anterior zerado → "sem base de comparação", não ∞%.

**D-4. Espera o carrinho, com teto de 10 min, por agendamento.** Envia quando todas as orders do pack (composição via `/packs/{id}`) estiverem sincronizadas e pagas. A espera é **estado persistido** (composição, primeiro recebimento, prazo) + uma execução agendada no vencimento, nunca uma edge parada esperando (limite de 2 s de CPU). No prazo, envia com o que houver e marca `(parcial: X de Y itens)`. Garantia: **no máximo uma** mensagem por carrinho e destinatário, com reserva idempotente por `pack_id`. Não é "exatamente uma": a reserva acontece antes do envio, e queda nesse intervalo perde aquele alerta, que o resumo diário cobre. É o mesmo contrato de `reservarNotificacao`.

**D-5. Alerta na hora só para prejuízo e sem custo.** A mensagem gerencial destaca item com líquido **após imposto** < custo (🔴) e item sem custo. "Abaixo do mínimo" (🟡) fica só no resumo diário, para não virar ruído em ramo competitivo.

**D-6. Resumo diário às 8h, com o dia anterior fechado.** Worker agendado, fan-out por org e lotes retomáveis (ADR-0173), agregação no banco (não recalcular o mês em memória), notificação com chave. Conteúdo:
- faturamento, pedidos, ticket médio, lucro, markup do dia; acumulado do mês + crescimento; top 3 produtos por lucro; contagem de 🟡/🔴/sem custo;
- **confiança do lucro**: "X% do faturamento tem custo; R$ Y sem custo ou com custo estimado" (classificação `real/estimado/parcial/sem_custo` já existente em Vendas SKU);
- **devoluções**: valor estornado no dia e reclamações abertas com prazo de ação próximo (`ml_devolucoes.acoes_pendentes`; não usar `valor_em_jogo`, que vem nulo);
- **promoções para revisar**: participações com prejuízo projetado e oportunidades rentáveis com adesão vencendo (`ml_promocao_itens.projecao`, regras de `_shared/promocoes/alertas.ts`), só para org com o módulo;
- **frete que subiu**: produtos com alta detectada pelo monitor de frete (ADR-0169);
- rodapé "dados apurados até HH:MM", porque reconciliações posteriores podem mudar o número.

**D-7. Só admin, só conversa privada.** `vendas_gerencial`, `resumo_diario` e qualquer comando só valem para profile **ativo**, da **mesma org**, com `is_admin` e `chat_id` **privado** (positivo). `chat_id` de grupo (negativo) nunca recebe nem consulta dado financeiro. A checagem acontece em dois pontos:
- **na assinatura**: a edge `usuarios` recusa essas categorias para não-admin ou chat de grupo;
- **no envio**: a leitura de destinatários dessas categorias filtra `is_admin` (hoje `queryAssinantes` não filtra), incluindo o registro in-app.

O chat privado é exigência **do canal Telegram**: a notificação in-app dessas categorias vale para todo admin assinante, mesmo sem `chat_id` ou com Telegram da org inativo. Rebaixar de admin desliga, na prática, o recebimento das duas categorias. O bot nunca mostra lucro a quem não é admin.

**D-8. Comandos de leitura: o bot passa a receber.** Uma edge nova recebe os updates do bot de cada org (`setWebhook` com `secret_token`, conferido no header `X-Telegram-Bot-Api-Secret-Token`; `verify_jwt=false`):
- o secret identifica **bot → org antes** de resolver a pessoa;
- deduplica por (bot, `update_id`);
- resolve `chat_id` privado → profile admin.

v1: `/hoje`, `/ontem`, `/mes`, `/top` (5 por lucro no mês), `/ajuda`. Chat desconhecido, grupo ou não-admin → resposta fixa sem dado. **Nenhum comando de escrita** (preço, pausa, estoque): exigiria ADR próprio por causa da regra de revisão humana antes de mexer em anúncio. **Sem `/saldo`**: o PubliAI tem a liberação das vendas, não o saldo da conta MP (ADR-0040).

**D-9. IA conversacional fica para a fase 2.** Ela usa as consultas da v1 como ferramentas: só leitura, sem SQL livre, e "não tenho esse dado" quando nenhuma ferramenta cobre. A v1 já deixa pronto:
- **identidade e autorização no servidor**: bot, pessoa, org e papel resolvidos e revalidados a cada execução. A IA nunca fornece nem escolhe `org_id`.
- **consultas estruturadas compartilhadas** entre comandos e IA, devolvendo valor, período, fuso, "apurado até", cobertura e motivo de indisponibilidade. Não dependem da sessão/RLS do front.
- **recebimento durável** (deduplicação, fila, auditoria mínima de duração e resultado), onde a fase 2 pendura orçamento de tokens por org.

Em aberto para a fase 2: dono do custo por pergunta (Daludi × condições comerciais da org), limite de uso e retenção da memória conversacional (isolada por org e pessoa).

## Alternativas descartadas

- **Mudar a mensagem atual para carrinho**: quebra a separação, que precisa de um produto por mensagem.
- **Comparar com o mês anterior inteiro**: todo início de mês pareceria queda.
- **Comparar até o mesmo horário**: o Telegram divergiria do card da tela (D-3).
- **🟡 em toda venda**: ruído. No ramo competitivo o preço pode ficar abaixo do mínimo de propósito (ADR-0065).
- **Acesso por menu `faturamento`**: Diego preferiu só admin, a regra mais restrita.
- **IA já na v1**: sem custo definido e sem uso real para escolher as ferramentas.
- **Para depois**, no resumo: variação do lucro explicada por SKU (`explicarVariacao`), campeões com poucos dias de estoque (`coberturaDias`), Ads consumindo a margem (coleta às 11h17, depois do resumo das 8h).

## Consequências

- O bot deixa de ser só emissor: o webhook do Telegram precisa ser registrado por org (o token é por org) e protegido por secret.
- O destinatário gerencial precisa ser admin e usar conversa privada com o bot. Se o diretor do cliente não for admin, alguém precisa promovê-lo.
- `notificarCategoria` ganha o filtro de admin para as categorias gerenciais. As demais categorias não mudam.
- O glossário em § Categoria de notificação ("cinco fixas") já estava defasado (o código tem 9) e passa a ter 11.

## Emenda de implementação (2026-10-25)

O que a implementação decidiu além do texto acima. Migrations `20261025013718` a `20261025030321`.

- **D-4 durável: `notificacao_carrinho`.** O estado de espera do carrinho vive na tabela (PK `org_id, chave`; `status` `aguardando`/`enviado`/`descartado`; `esperadas` = orders do pack via `GET /packs/{id}`, nulo = composição não confirmada). `sync-venda` registra o carrinho (`registrarCarrinho`, best-effort, nunca lança) e publica o job no QStash; um sweeper `*/5` na própria `notificar-carrinho` (`{ "varrer": true }`) republica só linhas paradas. **Corte de histórico de 2 h**: a reconciliação de 72 h re-sincroniza pedidos pagos, e sem corte cada carrinho antigo viraria mensagem quando a org assinasse. Carrinho parado entre 600 s e 2 h processa imediato; acima de 2 h não notifica (só entra no resumo). O teto de 600 s segue absoluto desde o primeiro pagamento.
- **Carrinho incompleto**: se a composição do pack não foi confirmada no teto, a mensagem sai com `Lucro: — (carrinho incompleto)`, porque o líquido gravado já descontou o frete do envio inteiro (lucro pessimista).
- **D-8/D-9: inbox durável `telegram_updates`.** O webhook só grava o update (PK `bot_id, update_id` = deduplicação) e publica no QStash; o worker reivindica por **lease** de 60 s via RPCs `security definer` só `service_role` (`telegram_update_reivindicar`, `_confirmar_posse`, `_concluir`, `_devolver` — após 5 tentativas vira `falhou` — e `telegram_updates_parados`, que alimenta a varredura `*/5`). Motivo das RPCs: o PostgREST não expressa o CAS com incremento e `uuid` de lease. Worker que falha depois de enviar a resposta não devolve nem reenvia.
- **Identidade do bot**: `configuracoes.telegram_bot_id` (único) é gravado só pelo servidor (trigger `configuracoes_proteger_bot_id` barra `authenticated`/`anon` e zera o id ao trocar o token). O secret do webhook é `HMAC(TELEGRAM_WEBHOOK_KEY, org:bot)`, o que liga bot → org antes de resolver a pessoa. O registro é a action `registrar_webhook_telegram` da edge `usuarios` (admin da org; recusa bot já usado por outra org). `TELEGRAM_WEBHOOK_KEY` só em secret de edge.
- **D-2: RPC `vendas_kpis_janela(p_org, p_desde, p_ate)`** devolve faturamento, pedidos e ticket por agregação SQL (regras de `calcularResumo`, janela `[desde, ate)`); ticket decimal exato, half-up. Paridade com `platform_org_month_metrics` conferida em 28 org×mês fechados (abr–ago/2026), 0 divergências; a tolerância de R$ 0,01 já está no D-2. Setembro/2026 não está no cache; o mês corrente é validado visualmente na T10.
- **D-6, desvio**: o resumo diário **não** usa `_shared/rodada` (fan-out com cursor do ADR-0173). A edge, chamada pelo schedule sem body, publica um job por org no QStash; cada job lê vendas paginadas (`lerPaginas`) com teto de **5.000 vendas por execução** (`LIMITE_VENDAS_POR_EXECUCAO`; acima disso responde `VolumeAcimaDoLimite` em vez de truncar). Volume medido hoje fica abaixo do teto; a chave por dia evita duplicata em retry.
- **D-7, in-app**: a notificação in-app das duas categorias vale para todo admin assinante, mesmo sem `chat_id` ou com Telegram da org inativo; o chat privado é exigência só do canal Telegram. `usuarios` recusa assinar as categorias a não-admin.
- **Constraints**: `notificacoes_categoria_check` e `profiles_telegram_categorias_validas` passam a aceitar `vendas_gerencial` e `resumo_diario` (11 categorias).
- **Deploy (2026-10-25)**: merge fast-forward na main (`8d63592d`, depois `4d007a8f` e `15e9c496` com ajustes de texto vistos em dado real: top só com lucro positivo, títulos encurtados em 40 caracteres, sinal `−` nos percentuais); secret `TELEGRAM_WEBHOOK_KEY`; `db push` das 4 migrations; 23 edges implantadas; schedules `resumo-diario` `0 11 * * *`, varreduras `*/5` do carrinho e do bot (`Upstash-Retries: 1`). Pré-merge do Codex achou `registrarCarrinho` antes da baixa de estoque com `/packs` sem timeout (risco de sobrevenda) — corrigido antes do merge (`8d63592d`).
- **Layout para celular (2026-10-25, main `3f43e4f6` e `04b1def1`)**: todas as mensagens Telegram (gerenciais e as demais: venda, pergunta, mensagem, devolução, liberação, frete, moderados, catálogo, estoque, cancelamento, promoções, Pulse, migração PxV, falhas de descrição UP, `/ajuda`) saem em blocos: título com emoji, linha em branco, uma informação por linha (helper `blocos`). Só formatação, texto puro. `enviarTelegram` divide texto acima de 4096 entre blocos, depois linhas e, em último caso, por grafema; envia na ordem e para na 1ª falha. O sino recebe o texto inteiro.
- **D-8, indicador (2026-10-25, main `de884da6`)**: `telegram_config_status()` devolve `comandos_ativos` (bot vinculado, sem expor o id); Configurações › Notificações mostra "✓ Comandos ativos" e o botão vira "Reativar". Duas orgs com o mesmo token (Hairfly Cosmeticos × Hairflay): só uma pode ter o bot vinculado (`telegram_bot_id` único) e os comandos respondem com os números dela.
- **Resumo inteligente — fase 1 (2026-10-25)**: spec `docs/superpowers/specs/2026-10-25-resumo-diario-inteligente-design.md`. O resumo ganha **📦 Estoque acabando** (top 20 SKUs por lucro 30d, vendidos em ≥ 3 dias distintos; entra com cobertura < 7 dias, ou zerado com venda nos últimos 7 dias; kit fora; máx. 3 + `• e mais N`) e o prejuízo do **⚠️ Atenção** passa a ser nomeado. Seção isolada: falha de leitura/catálogo ou `VolumeAcimaDoLimite` na janela de 30 dias → o resumo sai sem ela. O lucro do ranking é o do resumo (`resultadoPorItem`), exceção de paridade com a tela Vendas SKU documentada no spec; a cobertura segue a tela. Cálculo puro medido: 5.000 vendas sintéticas ≈ 50 ms de CPU (teste `bench-resumo-estoque.test.ts`, teto 250 ms).
