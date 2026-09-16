# ADR-0162 — Desconto visual (selo "% OFF") descartado definitivamente

**Status:** Aceito — revoga a parte de desconto do ADR-0017 e do ADR-0078
**Decisor:** Diego, 2026-09-16
**Relacionado:** ADR-0017 (selo de desconto via API de Promoções, estacionado), ADR-0041 (atacado PxQ),
ADR-0078 (split por faixa de preço), ADR-0129 (adicionar variação a família publicada), ADR-0160
(preço por variação sob User Products)

## Contexto

O ADR-0017 (2026-06-06) "estacionou" o selo de desconto: a via oficial (`/seller-promotions`) estava
bloqueada por permissão/reputação da conta, e a via alternativa (`original_price` no item plano) foi
confirmada **descartada pelo próprio ML** (o campo volta `null` na resposta, nenhum selo aparece). A
decisão foi manter a infraestrutura já construída **dormente** em vez de removê-la.

O código, porém, nunca ficou dormente: `original_price` continuou sendo enviado por **variação**
(itens com `variations[]` — caminho que o ADR-0017 não chegou a testar, só testou o item plano) tanto
no CREATE quanto no UPDATE, e a UI (toggle "Exibir com desconto" por família, por faixa de preço via
grupos de preço, e em lote) seguiu ativa e configurável até hoje.

Diego reportou (2026-09-16) que o Mercado Livre não permite desconto apenas visual em User Products, e
decidiu descontinuar a feature de vez, em vez de mantê-la dormente ou investir em reativá-la.

## Decisão

**Descartar definitivamente o mecanismo de desconto visual (`original_price`).** Deixa de ser "infra
estacionada" — sai do código:

- **Frontend:** toggle por família (`familia-row.tsx`), por faixa de preço (`config-grupos-preco.tsx`),
  em lote (`Revisao.tsx`) e o card "Desconto de marketing" na tela Configurações.
- **Backend:** envio de `original_price` no CREATE/UPDATE (`_shared/ml/publicar.ts`,
  `_shared/ml/atualizar.ts`), montagem do objeto desconto (`_shared/anuncios/montar-canonico.ts`,
  `update-familia-ml`, `publicar-split-ml`, `_shared/preco/config-grupo.ts`), e a capability
  `desconto`/erro `DESCONTO_INCOMPATIVEL` na abstração multicanal (`_shared/canais/*`).

**Schema — colunas ficam órfãs, sem migration de DROP.** `configuracoes.desconto_pct`,
`familias.exibir_com_desconto`, `familias.desconto_pct`, `variacoes.exibir_com_desconto`,
`variacoes.desconto_pct` permanecem no banco sem uso — mesmo padrão de "infra dormente" que o próprio
ADR-0017 já tinha adotado. Motivo: são tabelas centrais tocadas por muitas edge functions, 68 famílias
já publicadas têm o campo `true` hoje (é o único registro de quais anúncios tiveram desconto
configurado) e não há necessidade funcional de dropar — o código simplesmente para de ler/escrever.
Reversível de graça se algum dia for preciso reativar.

**68 anúncios Legacy já publicados com o campo ativo — sem ação de limpeza.** Não foi possível
confirmar empiricamente (a consulta pública `GET /items/{id}` retornou `403 PolicyAgent` para esta
conta) se o selo de fato aparece nesses itens hoje. O próprio ADR-0017 já havia constatado que o ML
descarta `original_price` no item **plano**; o caminho por **variação** nunca foi testado. Decisão de
Diego (2026-09-16): aceitar o estado atual desses 68 sem tocar nos anúncios publicados (regra do
projeto — nenhuma escrita fora do fluxo controlado). Se o selo estiver de fato visível em algum deles,
continua até uma alteração futura passar por esse item; se nunca esteve visível (cenário mais provável
dado o achado do ADR-0017), não há nada a corrigir.

**Fora de escopo — não confundir (nome ou código-irmão compartilhado, features distintas, seguem
ativas):**
- `configuracoes.desconto_concorrencia_pct` (ADR-0059) — desconto sobre concorrente para *sugerir*
  preço de venda.
- `kits_virtuais.desconto_pct` (ADR-0154) — campo homônimo, mas fração 0–1 e mecanismo
  `automatic_price.discount` do Kit Virtual, nada a ver com `original_price`.
- `atacado`/PxQ (ADR-0041) — entrelaçado no mesmo arquivo/função que o desconto em vários pontos
  (`resolverConfigGrupo`, `configGrupoPendente`), mas é feature independente.

## Consequências

- UI da Revisão fica mais simples (menos um controle por família/faixa/lote).
- Nenhum impacto em preço/estoque de anúncio publicado — o preço normal segue caminho independente do
  desconto (`_shared/ml/atualizar.ts`), confirmado antes da remoção.
- ADR-0017, ADR-0041, ADR-0078, ADR-0129 e ADR-0160 recebem errata pontual apontando para esta ADR.

## Como reverter

Reintroduzir leitura/escrita e UI a partir do histórico do git — a infra de banco nunca foi removida.
Reavaliar antes se os bloqueios do ADR-0017 (permissão de promoções, reputação/vendas da conta)
mudaram, e se o caminho por variação de fato renderiza o selo — o que este ADR não confirmou.
