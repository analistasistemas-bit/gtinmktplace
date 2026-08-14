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

### Opção A — Pela extensão (rápido, recomendado)

**Só na primeira vez:** instalar a extensão.

1. Abra `chrome://extensions`
2. Ligue **"Modo do desenvolvedor"** (canto superior direito)
3. **"Carregar sem compactação"** → selecione a pasta `extensao-ml/` do repositório
4. Confirme que ela aparece na lista, sem erro

**A cada vez:**

1. Esteja **logado no Mercado Livre** no mesmo Chrome
2. Abra o PubliAI → **Publicados**
3. No card "Catálogo em risco", clique em **"Resolver todos no ML"**
4. A extensão mostra o que vai fazer, **sem enviar nada** (dry-run). Confira:
   - as cores que vão como "não encontro" são as que realmente não têm ficha
   - as cores que já competem aparecem como **preservadas**, com o mesmo código de catálogo
5. Confirme o envio
6. Aguarde alguns minutos e recarregue: o card deve encolher ou sumir

Se algum anúncio for marcado como **manual**, é proposital — a extensão viu algo que não conferia e
preferiu não arriscar. Resolva esse pela Opção B.

### Opção B — Na mão, pelo ML (sempre funciona)

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

---

## O que NUNCA fazer

- **Não vincule uma cor a uma ficha que não seja equivalente** só para "resolver". Foi assim que em
  2026-06-15 um anúncio de 1 rolo ficou ligado a uma ficha de kit de 5 unidades, e um cliente
  comprou 1 esperando 5. O PubliAI recusa essas fichas de propósito (ADR-0021).
- **Não use a extensão deslogado do ML.** Ela avisa, mas o sintoma é um erro de sessão.

---

## Perguntas frequentes

**Por que o PubliAI não faz isso sozinho, sem eu clicar?**
Porque o "Não encontro minha variação" não existe na API do Mercado Livre. É um endpoint interno do
site, que só funciona com a sua sessão de navegador logada. O servidor do PubliAI recebe `403` ao
tentar. A extensão existe justamente para usar a sua sessão sem guardar sua senha ou cookie em lugar
nenhum (ADR-0118).

**Perco venda ao declarar "não encontro"?**
Não. A cor deixa de **competir no catálogo** (a disputa pela caixa de compra), mas o anúncio segue
ativo e vendendo normalmente. O que faz perder venda é o anúncio ser **pausado** — que é o que isso
evita.

**E as cores que já estavam competindo?**
São preservadas. A extensão confere, antes de enviar, que cada vínculo bom vai com o mesmo código de
catálogo; se algo não bater, ela recusa o anúncio inteiro em vez de arriscar. Validado em produção:
9 vínculos preservados nos 3 anúncios de 2026-08-13.

**Apareceu um anúncio novo na lista. É problema meu?**
Não necessariamente. O ML muda o catálogo dele com o tempo — uma ficha pode ser criada ou removida,
e um anúncio que estava bem passa a exigir declaração. É rotina.

---

## Limitações conhecidas

- **Item plano** (produto sem variações) usa outro fluxo no ML — resolva pela Opção B.
- **Cores em `family_diff`** (o ML recusou por família divergente) não são tratadas pela extensão:
  ela marca o anúncio como manual, de propósito.
- A extensão só funciona com você presente e logado — não roda sozinha, por decisão de segurança.
