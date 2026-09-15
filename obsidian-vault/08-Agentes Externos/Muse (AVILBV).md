---
tags: [agentes-externos, muse, mercado-livre, atendimento]
atualizado: 2026-09-14
---

# Muse (AVILBV)

Primeiro agente externo em operação. Agente pessoal da Meta, conectado por OAuth à conta
**AVILBV** do Mercado Livre através de um app próprio. Ver [[Agentes Externos]],
[[Apps do Mercado Livre]], [[API do ML para Agentes]].

Em operação desde **2026-09-14**.

## O que faz

| Função | Status |
|---|---|
| Responder perguntas pré-venda | funcionando |
| Responder mensagens pós-venda | funcionando |
| Adicionar fotos a variações existentes | funcionando |
| Relatórios de métricas, vendas e publicidade | funcionando (leitura) |
| Vídeo | **só gera o arquivo** — upload é manual por Clips |

## Decisão de arquitetura: sem proxy

O desenho recomendado era um proxy fino entre o agente e o ML, expondo apenas as rotas
permitidas, com as credenciais do ML ficando só no proxy. **Diego optou por conectar direto**,
ciente do trade-off.

Consequências aceitas:

1. O `client_secret` e o `refresh_token` ficam no histórico do agente (infraestrutura da Meta).
2. O app tem escrita na área de Publicação, o que no ML significa também publicar, excluir,
   pausar e alterar estoque e preço — **não há como restringir por operação no portal**.
3. A fronteira "não publicar / não mexer em estoque" existe apenas como regra no prompt.
4. **O PUT de fotos reenvia `available_quantity` lido no GET** — isso *é* uma escrita de
   estoque. Venda paga entre o GET e o PUT do agente é sobrescrita com o saldo antigo, e nada
   reconcilia depois: só o próximo movimento de estoque corrige. Dentro do PubliAI essa mesma
   janela é serializada pela fila `estoque-{orgId}`; o agente externo está fora desse lock. Por
   isso a rotina de revisão em [[#Pendências]] não é opcional.

Freios reais disponíveis, já que a trava técnica não existe:

- revogar em Configurações da conta → **Aplicações autorizadas**
- resetar a Secret Key do app (mata só este agente, não o PubliAI)

Se um dia o escopo crescer, o proxy volta à mesa — ou, mais barato, um app por função com
permissão mínima, conforme a tabela em [[Apps do Mercado Livre]].

## Regras entregues ao agente

Coladas no Muse como instrução permanente:

```
PROIBIDO:
- POST /items (criar anúncio)
- Alterar available_quantity (estoque) de qualquer item ou variação
- Alterar price / original_price
- Alterar status (pausar, reativar, encerrar)
- Alterar title, category_id ou attributes
- DELETE de qualquer recurso

PERMITIDO:
- POST /pictures e PUT /items só com pictures / picture_ids
- POST /answers e mensagens pós-venda
- Qualquer GET (relatórios, métricas, publicidade, vendas)

Ao montar PUT /items com variations, incluir TODAS as variações do item
(o ML apaga as omitidas) e, nas que não mudam, enviar apenas
{id, available_quantity: <valor lido no GET>}.
```

## Convivência com o PubliAI

- **App distinto**, cadeia de tokens própria. Autorizar o Muse não interrompeu o PubliAI.
- **Fotos de variação não colidem:** o PubliAI nunca reescreve `picture_ids` de variação já
  publicada, e só reenvia `item.pictures` ao criar cor nova, partindo das fotos vivas do ML.
- **Perguntas não colidem:** o `responder-pergunta` do PubliAI exige JWT de operador e texto
  humano (ADR-0037, revisão humana sempre) — ele nunca responde sozinho. O cuidado é o operador
  não responder na tela algo que o agente já respondeu: o ML aceita uma resposta só.
- **Estoque e preço colidiriam:** por isso estão proibidos. O push do PubliAI é absoluto e
  sobrescreveria qualquer ajuste feito pelo agente.
- **Rate limit é parcialmente por vendedor.** Varredura agressiva do agente pode gerar 429 no
  PubliAI também.
- **Foto do agente existe só no ML.** Uma republicação (CREATE após Remover, kit, migração
  Legacy→User Products) parte do banco do PubliAI e perde as fotos adicionadas por fora.

## Incidentes da implantação

| Sintoma | Causa | Correção |
|---|---|---|
| 404 ao responder pergunta | caminho inexistente `POST /questions/{id}/answers` | `POST /answers` com `question_id` no corpo |
| Rate limit ao buscar mensagens | agente varria pedido a pedido | `GET /messages/unread?role=seller&tag=post_sale` |
| Mensagens respondidas seguiam "não lidas" | responder não marca como lida | `GET` no pack sem `mark_as_read=false`, depois do POST |
| Token perdido, pedindo reautorização | guardava o access_token em arquivo temporário | guardar o `refresh_token` em memória persistente e sobrescrever a cada renovação |
| 413 ao publicar vídeo | não existe endpoint de vídeo | gerar em 9:16 e subir manualmente por Clips |

## Pendências

- Registrar o App ID do Muse em [[Apps do Mercado Livre]] (fora do repositório — ele é público).
- Definir rotina de revisão: conferir periodicamente se estoque e preço permaneceram intactos
  nos anúncios que o agente tocou.
