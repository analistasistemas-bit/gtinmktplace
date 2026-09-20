# Grade no ML: picker troca a cor ao trocar o tamanho

**Data:** 2026-09-20
**Severidade:** alta — primeiro produto de grade publicado (família 00000041, 30 SKUs, org DSA/Daludi Shop) está com a seleção de cor/tamanho inconsistente para o comprador.
**Status:** diagnóstico fechado com evidência; correção pendente de decisão (ver Track B).

---

## 1. Sintoma

Na PDP da família `8188099135990610` (Jaqueta Corta Vento Feminino), o comprador seleciona **Azul Royal**, troca o tamanho, e a cor selecionada vira **Azul Marinho** — e vice-versa.

A própria URL relatada já mostra a inconsistência:

```
/up/MLBU5257197494 ?attributes=COLOR:Azul+Royal,SIZE:MLBU5257197494
                   &pdp_filters=item_id:MLB5264889383
                   &applied_product_filters=MLBU5257209178
```

| Token da URL | O que é no nosso banco |
|---|---|
| `MLBU5257197494` (produto exibido) | **Azul-marinho M** |
| `COLOR:Azul Royal` (chip de cor) | outra cor |
| `SIZE:MLBU5257197494` | o picker de tamanho está chaveado por **product id**, não por valor de tamanho |
| `MLB5264889383` / `MLBU5257209178` | **Amarelo Manteiga M** |

---

## 2. O que NÃO é (verificado, não inferido)

- **Não há troca de dado no banco.** Os 30 SKUs têm `cor`/`tamanho` corretos (15 cores × M/G).
- **Não há troca de dado no ML.** Os 30 `user-products` foram consultados um a um via API autenticada: todos com COLOR e SIZE corretos e coerentes com o SKU (`SIZE_GRID_ROW_ID` `:2` = M, `:3` = G em 100% dos casos).
- **Não é a ordenação A→Z** dos eixos (`ordenarEixos`, `src/lib/cadastro-grade.ts:143`) nem casamento por índice: `reconciliarGrade` gera o produto cartesiano com loop aninhado e cada célula nasce com seu par `(cor, tamanho)` explícito, chaveado por `chaveGrade`. Os commits `d4bef116`/`bd140104`/`023785a7` são cosméticos da tela de Revisão.

Ou seja: **o payload que enviamos está correto**. O defeito é de *identidade de atributo*, não de associação.

---

## 3. Causa raiz

Na categoria `MLB108803`, o schema do ML diz:

| Atributo | `hierarchy` | `tags` | Valores no dicionário |
|---|---|---|---|
| `COLOR` | **CHILD_PK** | `allow_variations`, `defines_picture`, `required` | 51 |
| `SIZE` | **CHILD_PK** | `allow_variations`, `required` | 45 (inclui `M`=2282666, `G`=10490141) |
| `SIZE_GRID_ROW_ID` | CHILD_PK | `hidden`, `variation_attribute` | — |
| `SIZE_GRID_ID` | FAMILY | — | — |

`CHILD_PK` é a chave com que o ML identifica cada filho dentro da family e monta os pickers.

**Nós enviamos os dois CHILD_PK só com `value_name` livre, sem `value_id`:**

- `supabase/functions/_shared/ml/publicar.ts:84` → `return { id: 'COLOR', value_name: valor }`
- `supabase/functions/_shared/ml/publicar.ts:190` → `{ id: 'SIZE', value_name: v.sizeLabel ?? v.tamanho }`

Consequência medida nos 30 itens publicados:

- **SIZE: `value_id = null` em 100% dos itens** — mesmo com `M` e `G` existindo no dicionário. O picker de tamanho fica sem chave e degenera para indexação por `product_id` (é o `SIZE:MLBU…` da URL).
- **COLOR: o ML resolveu sozinho 6 de 15 cores** (reescrevendo o nome, conforme já documentado: `Azul Marinho` → `Azul-marinho`/283161, `Azul Claro` → `Azul-claro`/52029 …) e deixou **9 sem `value_id`**, porque não existem no dicionário da categoria:

  `Azul Royal`, `Chumbo`, `Cinza Claro`, `Amarelo Manteiga`, `Rosa Pink`, `Nude Rosado`, `Verde Militar`, `Caramelo`, `Salmão`.

Com o eixo de tamanho sem chave e 9 cores sem identidade, o ML não consegue manter o par (cor, tamanho) ao navegar: trocar o tamanho dentro de uma cor sem `value_id` cai no produto de outra cor. Por isso o par citado é justamente **Azul Royal (sem id) ↔ Azul-marinho (com id 283161)**.

> Nota: o ML aceitou tudo com HTTP 2xx. Nenhum erro foi devolvido na publicação — o defeito só aparece na vitrine.

---

## 4. Track A — correção no código

Ordem obrigatória: ADR antes da implementação; TDD (RED antes do GREEN); deploy das edge functions é parte da entrega.

### A1. ADR (amendment ao 0166/0167) — política de CHILD_PK
Decidir e registrar:
1. Todo atributo `CHILD_PK` da categoria vai ao ML **com `value_id`** sempre que o valor existir no dicionário.
2. O que fazer quando a cor **não existe** no dicionário (as 9 acima). Duas saídas:
   - **(recomendada) Falhar LOUD na validação, antes de publicar**, listando as cores inválidas e as válidas da categoria. Alinhado à regra de "nunca defaultar em silêncio".
   - Mapear para a cor canônica mais próxima — rejeitada como default: colapsa duas cores comerciais no mesmo picker em silêncio (Azul Royal e Azul-marinho virariam a mesma coisa).
3. O nome comercial da cor continua visível no título/descrição; o picker passa a usar a cor canônica.

**Custo:** ~1h (escrita + revisão).

### A2. Resolver `value_id` de SIZE e COLOR pelo schema da categoria
- Teste RED primeiro: item de grade cuja cor e tamanho existem no dicionário → payload deve conter `value_id`, não `value_name`.
- Reusar o padrão que já existe (`forcarSaleFormatKit`, `supabase/functions/_shared/categoria/atributos.ts:266`): casar contra o schema da categoria com normalização de acento/hífen/caixa (`Azul Marinho` ≡ `Azul-marinho`).
- Aplicar em `montarPayloadItem` (`_shared/ml/publicar.ts`), tanto no eixo cor quanto no eixo tamanho.

**Custo:** ~2h com testes.

### A3. Trava LOUD para cor fora do dicionário
- Validação na publicação da grade: aborta a família com mensagem nomeando SKU, cor recusada e as cores válidas.
- Teste cobrindo o ramo de recusa (ramo sem teste é onde o bug mora).

**Custo:** ~1h.

### A4. UI: escolher cor a partir do dicionário da categoria
- No cadastro em grade, o eixo Cor passa a oferecer as cores válidas da categoria (o schema já é buscado hoje), com o nome comercial livre apenas para o título.
- Sem isso, A3 vira um muro: o operador descobre a cor inválida só ao publicar.

**Custo:** ~3h.

### A5. Deploy
`supabase functions deploy` de todas as funções afetadas por `_shared/ml/publicar.ts` (o CI não deploya). Conferir a versão ativa pós-deploy.

**Custo:** ~30min.

---

## 5. Track B — os 30 anúncios já no ar (decisão do Diego)

**Não dá para consertar republicando.** Em família User Products, o UPDATE envia só `available_quantity`/`price`; atributo só vai no CREATE. Corrigir COLOR/SIZE dos itens vivos exige apagar e recriar no ML.

| Opção | O que envolve | Custo / risco |
|---|---|---|
| **B1. Não mexer** | A vitrine segue com a navegação trocada nas 9 cores sem `value_id`. Track A protege as próximas publicações. | Zero risco técnico; o anúncio atual continua confundindo o comprador. |
| **B2. Recriar só as 9 cores sem `value_id`** (18 itens) após renomeá-las para cores do dicionário | Apagar os 18 itens + UPs no ML, renomear na grade, republicar. As 6 cores com id ficam. | Perde histórico desses 18 itens; exige revisão humana; ~2h de operação. |
| **B3. Recriar a família inteira** (30 itens) | Mesma operação, família toda consistente de uma vez. | Perde o histórico dos 30; ~3h. |

Recomendo **B2 depois de A2–A4 estarem no ar** — recriar antes do fix reproduz o mesmo defeito. Nenhuma dessas opções é executada sem o "vai" do Diego (regra: nunca alterar anúncio publicado fora do fluxo controlado).

---

## 6. Sequência sugerida

1. A1 (ADR) → revisão
2. A2 + A3 (TDD) → A4 (UI)
3. A5 (deploy) + merge
4. Só então Track B, com a opção que o Diego escolher.

**Total Track A:** ~7h30 de trabalho efetivo.

---

## 7. Como reproduzir a evidência

```bash
# atributos da categoria (dicionário de COLOR e SIZE)
deno run --allow-net --allow-env --node-modules-dir=none \
  scripts/ops/ml-get.ts <connection_id> /categories/MLB108803/attributes

# um user product da família
deno run --allow-net --allow-env --node-modules-dir=none \
  scripts/ops/ml-get.ts <connection_id> /user-products/MLBU5257212414
```

`COLOR` com `value_id: null` no retorno = cor fora do dicionário; `SIZE` com `value_id: null` = o defeito descrito aqui.
