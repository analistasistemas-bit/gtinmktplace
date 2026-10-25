# ADR-0190 — Notificação gerencial de venda, resumo diário e comandos no Telegram

**Status:** Proposto — design fechado em entrevista (grill-with-docs, 2026-10-24); falta plano de implementação + revisão do Codex
**Data:** 2026-10-24
**Decisores:** Diego
**Origem:** pedido do diretor de uma organização cliente (Hairfly, 2026-10-24): "a notificação deveria vir com o valor total da venda, não o do produto"; KPIs (acumulado do período, % de crescimento, ticket médio); "não preciso ficar entrando na ferramenta pra saber se preciso mexer em estratégia"; comando `/resumo`.
**Estende:** [ADR-0068](0068-notificacoes-telegram-por-destinatario-e-categoria.md) (assinatura por destinatário e categoria; revoga o "bot só envia" — passa a receber comandos)
**Relaciona:** [0047](0047-operacao-compartilhada-rbac-menu.md) (`is_admin`), [0109](0109-custo-congelado-por-venda.md) (custo congelado), [0150](0150-margem-um-rotulo-e-um-simulador-no-pulse.md) (rótulos Margem s/ venda / Markup), [0173](0173-fanout-por-org-workers-agendados-cpu.md) (fan-out por org, notificação com chave), [0180](0180-cupom-do-vendedor-na-venda.md) (total pago), [0055](0055-imposto-por-origem-nacional-importado.md) (imposto)
**Glossário:** `docs/reference/glossario.md` § Integrações externas — Carrinho, Notificação operacional de venda, Notificação gerencial de venda, Resumo diário, Crescimento do mês.

---

## Contexto

O alerta de venda (`sync-venda` → categoria `vendas`) sai **por order**. No ML, um carrinho com N produtos são N orders ligadas por `pack_id`, então o destinatário recebe N mensagens, cada uma com o valor só do seu item. Para quem separa e despacha isso é o certo (um produto por mensagem, com EAN). Para o dono do negócio, a unidade é o **carrinho** e o que importa é o resultado (lucro), não o produto.

Lucro, Margem s/ venda e Markup do pedido já existem (`cascataDoPedido`, Faturamento › Vendas), assim como os KPIs de período (Faturamento, Pedidos com carrinho = 1, Ticket médio). Nada disso chega ao Telegram.

## Decisão

**D-1. Duas categorias novas, sem mudar o modelo de assinatura.** `vendas_gerencial` (por carrinho) e `resumo_diario`, somadas a `CATEGORIAS_NOTIFICACAO` (e ao espelho do front). `vendas` continua igual: por pedido, instantânea. A mesma pessoa assina qualquer combinação.

**D-2. Unidade = Carrinho.** Uma mensagem gerencial por `pack_id` (pedido sem pack = carrinho de 1 item), com o total pago (regra ADR-0180), Lucro, Margem s/ venda e Markup do carrinho, mais o acumulado de **hoje** e do **mês corrente** (faturamento, pedidos, ticket médio) e o **Crescimento do mês**. Todas as contas são as de Faturamento › Vendas: bruto, canceladas fora. Sem custo em algum item → lucro vazio, nunca lucro = líquido.

**D-3. Crescimento = mesmo intervalo do mês anterior**, do dia 1 até o mesmo dia e horário. Dia sem equivalente (31) → mês anterior inteiro.

**D-4. Espera o carrinho, com teto de 10 min.** Envia quando todas as orders do pack (composição via `/packs/{id}`) estiverem sincronizadas e pagas. Passados 10 min da primeira, envia com o que houver e marca `(parcial: X de Y itens)`. Exatamente uma mensagem por carrinho, mesmo com retry do QStash (reserva idempotente por `pack_id`, como o `reservarNotificacao` atual faz por order).

**D-5. Alerta na hora só para prejuízo e sem custo.** A mensagem gerencial destaca item com líquido < custo (🔴) e item sem custo. "Abaixo do mínimo" (🟡) fica só no resumo diário, para não virar ruído em ramo competitivo.

**D-6. Resumo diário às 8h, com o dia anterior fechado.** Faturamento, pedidos, ticket médio, lucro, markup, acumulado do mês + crescimento, top 3 produtos por lucro e contagem de 🟡/🔴/sem custo. Worker agendado com fan-out por org e notificação com chave (padrão ADR-0173).

**D-7. Só admin.** `vendas_gerencial`, `resumo_diario` e qualquer comando só valem para profile **ativo**, da **mesma org** e com `is_admin`. A edge `usuarios` recusa assinar essas categorias para não-admin. Rebaixar alguém de admin desliga as duas assinaturas dessa pessoa. O bot nunca mostra lucro a quem não é admin.

**D-8. Comandos de leitura: o bot passa a receber.** Uma edge nova recebe os updates do bot da org (`setWebhook`, com secret token do Telegram, `verify_jwt=false`) e resolve `chat_id` → profile → org. v1: `/hoje`, `/ontem`, `/mes`, `/top` (5 por lucro no mês), `/ajuda`. Chat desconhecido ou não-admin → resposta fixa sem dado. **Nenhum comando de escrita** (preço, pausa, estoque): exigiria ADR próprio por causa da regra de revisão humana antes de mexer em anúncio.

**D-9. IA conversacional fica para a fase 2**, em cima das consultas da v1, que viram as ferramentas dela: só leitura, sempre filtradas pela org, sem SQL livre, e "não tenho esse dado" quando nenhuma ferramenta cobre. Ficam em aberto para a fase 2: dono do custo por pergunta (Daludi × condições comerciais da org) e limite de uso.

## Alternativas descartadas

- **Mudar a mensagem atual para carrinho**: quebra a separação, que precisa de um produto por mensagem.
- **Comparar com o mês anterior inteiro**: todo início de mês pareceria queda.
- **🟡 em toda venda**: ruído. A Avil precifica abaixo do mínimo de propósito no ramo competitivo (ADR-0065).
- **Acesso por menu `faturamento`**: Diego preferiu só admin, a regra mais restrita.
- **IA já na v1**: sem custo definido e sem uso real para escolher as ferramentas.

## Consequências

- O bot deixa de ser só emissor: o webhook do Telegram precisa ser registrado por org (o token é por org) e protegido por secret.
- O destinatário gerencial precisa ser admin. Se o diretor do cliente não for admin, alguém precisa promovê-lo.
- O glossário em § Categoria de notificação ("cinco fixas") já estava defasado (o código tem 9) e passa a ter 11.
