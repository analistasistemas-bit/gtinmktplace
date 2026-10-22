# Runbook — anúncios "Próximos a serem pausados" (catálogo)

**Para o operador.** O que fazer quando o Mercado Livre avisa que vai pausar anúncios por falta de
associação ao catálogo.

**Relacionados:** [ADR-0118](../decisions/0118-resolucao-em-massa-do-no-match-de-catalogo.md),
[ADR-0036](../decisions/0036-alerta-catalogo-no-match.md),
[ADR-0021](../decisions/0021-vinculacao-automatica-ao-catalogo-ml.md)

---

## O problema, em uma frase

Quando uma variação (cor) não tem ficha equivalente no catálogo do ML e você não declara isso, o ML
**pausa o anúncio inteiro** — inclusive as cores que estavam vendendo bem.

A declaração é o botão **"Não encontro minha variação"**, um clique por cor. Em 2026-08-13 os três
anúncios sinalizados somavam **66 cliques**.

---

## Passo 1 — Como você fica sabendo

Três caminhos, do mais cômodo ao mais manual:

1. **Card "Catálogo em risco"** na tela Publicados do PubliAI. Ele lista **apenas** os anúncios que
   o próprio ML sinalizou (tag `catalog_forewarning`) — a mesma lista do filtro "Próximos a serem
   pausados" do painel do ML. Se o card não aparece, não há nada a fazer.
2. **Telegram**, se você tiver configurado em Configurações → Alertas.
3. **Painel do ML** → Anúncios → filtro "Próximos a serem pausados".

> **Atenção:** card vazio quase sempre significa "nada em risco", mas também pode ser falta de
> conexão com o ML. Na dúvida, confira o filtro no painel do ML.

---

## Passo 2 — Resolver

> A extensão `extensao-ml/` (ADR-0118) foi **retirada do projeto em 2026-10-21** — era uma
> viabilidade que não chegou a uso rotineiro. A resolução é feita pelo ML, anúncio a anúncio.

### Na mão, pelo ML

1. No card, clique em **"Resolver no ML"** ao lado do anúncio (vai direto para a página certa)
2. Em cada cor sem ficha: **Buscar** → role até o fim → **"Não encontro minha variação"**
3. Confirme
4. Repita para as demais cores e conclua o fluxo

---

## Passo 3 — Conferir se resolveu

O ML leva **alguns minutos** para recomputar. Depois disso:

- O card "Catálogo em risco" deve encolher ou sumir
- O filtro "Próximos a serem pausados" no painel do ML deve reduzir
- O anúncio continua **ativo** e vendendo

Verificação técnica, se quiser certeza:

```
GET https://api.mercadolibre.com/users/{seller_id}/items/search?tags=catalog_forewarning
```

Deve deixar de listar o anúncio resolvido.

O status de cada cor fica assim:

| status | significado |
|---|---|
| `LOOPING_ITEM` | declarada como "não encontro" — não compete, mas **não pausa o anúncio** |
| `ALREADY_OPTED_IN` | vinculada e competindo — preservada |
| `FLEX_PRODUCT` | item UP que virou a oferta de uma ficha `flex` criada pelo ML — já compete, nada a fazer |

---

## O que NUNCA fazer

- **Não vincule uma cor a uma ficha que não seja equivalente** só para "resolver". Foi assim que em
  2026-06-15 um anúncio de 1 rolo ficou ligado a uma ficha de kit de 5 unidades, e um cliente
  comprou 1 esperando 5. O PubliAI recusa essas fichas de propósito (ADR-0021).

---

## Perguntas frequentes

**Por que o PubliAI não faz isso sozinho, sem eu clicar?**
Porque o "Não encontro minha variação" não existe na API do Mercado Livre. É um endpoint interno do
site, que só funciona com a sua sessão de navegador logada. O servidor do PubliAI recebe `403` ao
tentar.

**Perco venda ao declarar "não encontro"?**
Não. A cor deixa de **competir no catálogo** (a disputa pela caixa de compra), mas o anúncio segue
ativo e vendendo normalmente. O que faz perder venda é o anúncio ser **pausado** — que é o que isso
evita.

**E as cores que já estavam competindo?**
São preservadas: no fluxo do ML você só declara "não encontro" nas cores sem ficha; as que já
competem ficam como estão.

**Apareceu um anúncio novo na lista. É problema meu?**
Não necessariamente. O ML muda o catálogo dele com o tempo — uma ficha pode ser criada ou removida,
e um anúncio que estava bem passa a exigir declaração. É rotina.

---

## Limitações conhecidas

- **Item plano** (produto sem variações) usa outro fluxo no ML.
- **Cores em `family_diff`** (o ML recusou por família divergente) exigem análise caso a caso.
