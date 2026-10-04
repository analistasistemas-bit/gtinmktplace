# ADR-0178 — Reajuste de preço em massa (3º tipo do motor de operações)

**Status:** Proposto
**Data:** 2026-10-04
**Relacionado:** [ADR-0174](0174-operacoes-em-massa-promocoes-v2.md) (motor + emenda 2026-10-04),
[ADR-0020](0020-estrategia-de-preco-liquido-minimo.md) (piso/semáforo), [ADR-0055](0055-imposto-por-origem-nacional-importado.md) (imposto por origem),
[ADR-0078](0078-preco-por-variacao-split-por-faixa-e-controle-de-preco-no-update.md) (preço confirmado/split), [ADR-0160](0160-preco-por-variacao-sob-user-products.md) (UP),
[ADR-0016](0016-publicacao-update-reposicao-estoque.md) (UPDATE)
**Design:** `docs/superpowers/specs/2026-10-04-reajuste-preco-em-massa-design.md`
**Decisores:** GPT-6 Astra como representante do Diego (delegação explícita em 2026-10-04).

## Contexto

Preço hoje só vai ao ML pelo UPDATE completo (Revisão → Publicar). Reajuste feito no Seller Center diverge do
banco (`variacoes.preco_publicacao`) e é desfeito no próximo UPDATE; o re-ingest recalcula o preço das cores não
fixadas. A Avil repete reajustes coletivos (repasse de custo). O motor de operações em massa (ADR-0174) já tem
laço, claim, preview, trava e Reverter.

## Decisão

1. **Novo handler `reajustar`** no motor existente, sem caminho paralelo. Base = preço vivo de cada MLB;
   entrada ±% ou ±R$, alvo absoluto em centavos, editável por item; a mesma operação reverte com `origem_id`.
2. **Escrita só-preço no ML:** Legacy `PUT {variations:[{id, price}]}` com todas as variações do MLB (doc
   oficial; sem quantidade/fotos → sem corrida com estoque); item plano `PUT {price}`; UP `PUT {price}` por MLB.
   Confirmação por GET; preço não aplicado (automação de preços) = erro.
3. **Durável no banco:** confirmado no ML → `preco_publicacao` = novo, `preco_editado_pelo_operador = true`,
   `preco_publicado_ml` = confirmado (via RPC por MLB, escopada por org). **Isto muda a garantia do ADR-0020/0055
   de recalcular por custo no re-ingest** para as cores reajustadas — o preview avisa; o próximo repasse é outro
   reajuste.
4. **Trava financeira** com tarifa exata no preço novo e imposto pela origem; 🔴 e ⚪ só com confirmação separada;
   🟡 marcado com aviso. **Origem ausente → ⚪ (nunca default nacional)** — mais restrito que o texto original do ADR-0055.
5. **Fora do MVP:** promoção (pending/started), Kit Virtual, catálogo/par de catálogo, migração PxV, família
   publicando, moderado/encerrado, **atacado PxQ** (faixas absolutas).
6. **Reverter** restaura ML e banco (incluindo a marca `editado` anterior) só se ambos seguem como a operação deixou.

## Consequências

- Primeiro caminho de escrita de preço fora do UPDATE; o banco continua fonte de verdade (o próximo UPDATE
  republica o preço reajustado, não o antigo).
- Cores reajustadas ficam fixadas: repasse de custo automático por re-ingest deixa de valer para elas.
- Atacado, promoção e catálogo ficam para uma versão seguinte, depois de medir o efeito real no ML.

## Alternativas descartadas

- Escrever só no ML (revertido no próximo UPDATE).
- Gravar no banco sem fixar (re-ingest desfaz).
- Reaplicar atacado após o novo preço (falha deixaria base nova com faixas velhas).
- Spike de escrita direta no ML para medir promoção/catálogo (fora do fluxo do app).
