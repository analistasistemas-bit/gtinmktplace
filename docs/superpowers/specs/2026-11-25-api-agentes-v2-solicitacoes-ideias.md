# API de agentes, v2 (solicitações): ideias guardadas

**Estado:** ideias, **não decidido, não iniciado**. Guardado em 2026-11-25, a pedido do Diego, para um segundo momento.

**Nome:** o Diego chama isto de "fatia 2 da API". Não é a fatia 2 da [ADR-0210](../../decisions/0210-acesso-de-agentes-mcp.md) (OAuth) nem a fatia 3 (chave de plataforma). Aqui é "v2 (solicitações)".

**Objetivo do Diego:** fazer solicitações por agentes de IA, com foco em facilitar a vida do administrador da loja.

**Origem:** consultas separadas a Fable 5.2, Codex gpt-6.2-sol (high) e Grok 4.7 (xhigh). Codex e Grok receberam um inventário sanitizado do repositório, sem as ideias do Fable e sem ver um ao outro. Nenhum dos dois leu o código. Ganhos de tempo citados por eles são estimativa, não medição.

## Ideias, por facilidade para o administrador

| # | O administrador diz | O que ganha | Quem sugeriu | Esforço |
|---|---|---|---|---|
| 1 | "Tenho 5 minutos. O que merece minha atenção hoje?" | Vendas de ontem e até 3 prioridades com motivo | Fable (vendas), Codex, Grok | M |
| 2 | "Quais anúncios estão abaixo de 15% de margem?" | Só os que importam; hoje o agente lê a loja de 50 em 50 | Grok | P |
| 3 | "Deixe este anúncio pronto para R$ 49,90" | Pedido pronto; a pessoa confere e aprova no app | os três | M |
| 4 | "Onde gastei em Ads abaixo do ROAS mínimo?" | Gasto e ROAS comparados com a margem | os três | M |
| 5 | "O que pode faltar antes da reposição chegar?" | Lista por urgência, sem fornecedor | os três | P |
| 6 | "Se eu entrar nesta promoção, quanto sobra?" | Líquido e prejuízo antes de aderir | os três (focos diferentes) | M |
| 7 | "Entre 49,90, 54,90 e 59,90, qual deixa 18%?" | Uma tabela em vez de três simulações | Codex | P |
| 8 | "O que está sem margem e por quê?" | Lista de cadastro a corrigir: custo, origem, dimensão | Grok | P |

Esforço: P, M ou G, relativo, sem medição; nos itens 5 e 8 é leitura do inventário, a confirmar no desenho.

**Para depois:** pausar e reativar um anúncio; preparar adesão ou saída de promoção; muita visita e pouca venda (Vitrine); pedidos em lote com lista fixa; motivo dos alertas de estoque e frete; "o que aprovei e o canal ainda não confirmou?" (ADR-0195).

## Primeira solicitação: mudança de preço

Os três escolheram a mesma. Fluxo: o agente simula → grava o pedido (Pedido de publicação da ADR-0210) → a pessoa abre o app, vê antes e depois e aprova com o próprio login → o fluxo de preço que já existe fala com o Mercado Livre → o agente só lê o estado.

Travas:

- Um anúncio, fora de promoção, alvo por MLB escolhido; busca por palavras nunca vira alvo (Codex e Grok; o Fable sugeria até 20).
- Aprovar só no app, nunca no chat nem por botão que o agente dispare.
- Recalcular na aprovação; recusar se preço, promoção ou insumo mudou. Pedido expira e reenvio não duplica.
- Custo, origem, alíquota ou tarifa ausente bloqueia o pedido; origem nunca presumida.
- Mostrar "aprovado" separado de "confirmado no Mercado Livre".
- Avisar no pedido que o cupom do vendedor não entra na conta.
- Organização sempre da conexão; conexão revogada não executa; auditoria guarda quem preparou e quem aprovou.

## Fora

- Agente publicando sozinho ou mexendo em orçamento de Ads (escrita em Ads já foi recusada com 401; reconferir).
- Pós-venda, dado de comprador ou de fornecedor; notas de compra.
- Parâmetro de organização ou chave única nesta v2 (o Diego decidiu em 25/11 manter uma chave por loja); scraping pago novo.

## Ordem recomendada

1. **Ganhos rápidos:** recorte de margem (2), comparar preços (7), sem margem e por quê (8). Reaproveitam a conta que já existe e não pedem permissão nova.
2. **Permissões por chave** e "meu dia" (1).
3. **Ads** (4), o motivo original da API.
4. **Pedido de preço** (3), com ADR própria.
5. **Reposição** (5) e **promoção** (6).

O passo 1 precisa de medição antes de promessa: calcular tudo numa loja grande pode estourar a cota diária de tarifa ou o tempo da função.

## Decisões em aberto (só o Diego)

1. **Faturamento e lucro:** o agente pode ver? Recomendado: só em chave marcada para isso.
2. **Margem mínima:** bloquear pedido abaixo de um piso? Recomendado: começar sem piso, recusando só margem zero ou negativa e mostrando o número.
3. **Quem aprova:** recomendado: só administrador da loja.

## Reaproveitamento a conferir no código

Conferido por leitura em 2026-11-25; linhas mudam, procurar pelo nome:

- Vendas do dia e do mês: `supabase/functions/_shared/notificacoes/gerencial/consultas.ts`. Categorias só de admin: `_shared/notificacoes/categorias.ts` (`CATEGORIAS_SO_ADMIN`).
- Reposição: `_shared/reposicao/dados.ts` e `calculo.ts`; os tipos trazem fornecedor e CNPJ, que **têm de ser cortados** antes de responder.
- Ads: `_shared/ads/campanhas.ts`. Promoções: `_shared/promocoes/alertas.ts` e `src/lib/sugestoes-promocao.ts`. Vitrine: `src/lib/vitrine.ts`.
- Rascunho e confirmação de preço: `supabase/functions/operacoes-massa/index.ts` (`previewReajuste`, `confirmarReajuste`; rascunho vale 30 minutos) e RPC `reajuste_confirmar`. `src/hooks/useOperacoes.ts` esconde rascunho da tela.

## Como retomar

1. Diego responde às três decisões (ou "recomendado").
2. Emenda da ADR-0210 com o passo 1 e as permissões, sem código, para aprovação. O pedido de preço tem ADR própria.
3. Medir cota e tempo do recorte com as lojas da época, antes de prometer.
4. Ferramenta nova ou alterada atualiza `INSTRUCOES` do `initialize`, o teste e o guia.
