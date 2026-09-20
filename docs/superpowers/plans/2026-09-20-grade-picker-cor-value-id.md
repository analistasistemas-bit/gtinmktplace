# Grade no ML: picker troca a cor ao trocar o tamanho

**Data:** 2026-09-20
**Severidade:** alta — primeiro produto de grade publicado (família 00000041, 30 SKUs, org DSA/Daludi Shop) está com a seleção de cor/tamanho inconsistente para o comprador.
**Status:** causa raiz identificada na seção **2.1** (estoque zero pausa a combinação). As seções 3
e 5 são de uma hipótese anterior (cor sem `value_id`), que segue válida como problema de filtro/busca
mas **não** foi provada como causa deste sintoma — ler 2.1 primeiro.

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
| `SIZE:MLBU5257197494` | o chip de tamanho aponta para o produto por id (encoding normal do ML) |
| `MLB5264889383` / `MLBU5257209178` | **Amarelo Manteiga M** |

---

## 2. O que NÃO é (verificado, não inferido)

- **Não há troca de dado no banco.** Os 30 SKUs têm `cor`/`tamanho` corretos (15 cores × M/G).
- **Não há troca de dado no ML.** Os 30 `user-products` foram consultados um a um via API autenticada: todos com COLOR e SIZE corretos e coerentes com o SKU (`SIZE_GRID_ROW_ID` `:2` = M, `:3` = G em 100% dos casos).
- **Não é a ordenação A→Z** dos eixos (`ordenarEixos`, `src/lib/cadastro-grade.ts:143`) nem casamento por índice: `reconciliarGrade` gera o produto cartesiano com loop aninhado e cada célula nasce com seu par `(cor, tamanho)` explícito, chaveado por `chaveGrade`. Os commits `d4bef116`/`bd140104`/`023785a7` são cosméticos da tela de Revisão.

Ou seja: **o payload que enviamos está correto**. O defeito é de *identidade de atributo*, não de associação.

---

## 2.1. CAUSA RAIZ (achado de 20/09, tarde — corrige as seções 3 e 5)

**O que o Diego viu é causado por estoque zero, não por atributo.**

Status real dos 30 itens no ML (`GET /items/{id}`, todos consultados):

- **9 itens estão `paused` com `sub_status: ["out_of_stock"]`** — exatamente os 9 SKUs com estoque 0 no banco.
- Item pausado sai da vitrine, então **a combinação cor+tamanho deixa de existir para o comprador**.

O par relatado é o caso perfeito, porque as duas cores são complementares:

| Cor | M | G |
|---|---|---|
| **Azul Royal** | ❌ pausado (estoque 0) | ✅ ativo |
| **Azul Marinho** | ✅ ativo | ❌ pausado (estoque 0) |

O comprador abre Azul Royal (só existe G), clica em **M** — não há Azul Royal M à venda, e o ML
navega para o item que tem M dentro da família: **Azul Marinho M**. No sentido inverso, de Azul
Marinho (só M) para **G**, cai em Azul Royal G. É a troca bidirecional descrita, ponta a ponta.

Outras 7 cores estão no mesmo estado (um só tamanho ativo): Marrom, Azul-claro, Chumbo, Cinza
Claro, Nude Rosado, Verde Militar, Caramelo. As 6 com os dois tamanhos ativos (Preto, Branco,
Azul-celeste, Amarelo Manteiga, Rosa Pink, Salmão) não deveriam apresentar o sintoma.

**Consequências:**

1. Não há bug de dado nem de payload. Repor estoque na combinação faz o item voltar sozinho.
2. **A hipótese do `value_id` (seção 3) não está provada como causa.** Amarelo Manteiga e Rosa Pink
   não têm `value_id` e têm os dois tamanhos ativos: se a navegação funcionar nelas, o `value_id`
   não tem relação com o sintoma. Teste pendente com o Diego (a vitrine bloqueia leitura automática).
3. A cor sem `value_id` continua sendo um problema **de filtro/busca** (a cor não entra nos filtros
   do ML), o que justifica o Track A — mas com outra severidade, não como causa deste incidente.

---

## 3. Investigado: cores sem identidade no dicionário (problema real, causa não provada)

Na categoria `MLB108803`, o schema do ML diz:

| Atributo | `hierarchy` | `tags` | Valores no dicionário |
|---|---|---|---|
| `COLOR` | **CHILD_PK** | `allow_variations`, `defines_picture`, `required` | 51 |
| `SIZE` | CHILD_PK | `allow_variations`, `required` | 45 |
| `SIZE_GRID_ROW_ID` | CHILD_PK | `hidden`, **`variation_attribute`** | — |
| `SIZE_GRID_ID` | FAMILY | — | — |

`CHILD_PK` é a chave com que o ML identifica cada filho dentro da family e monta os pickers.

Enviamos `COLOR` só com `value_name` livre, sem `value_id` — `supabase/functions/_shared/ml/publicar.ts:84`:

```ts
return { id: 'COLOR', value_name: valor };
```

Resultado medido nos 30 itens publicados: **o ML resolveu sozinho 6 das 15 cores** (reescrevendo o nome, como já documentado: `Azul Marinho` → `Azul-marinho`/283161, `Azul Claro` → `Azul-claro`/52029 …) e deixou **9 sem `value_id`**, porque simplesmente não existem no dicionário da categoria:

`Azul Royal`, `Chumbo`, `Cinza Claro`, `Amarelo Manteiga`, `Rosa Pink`, `Nude Rosado`, `Verde Militar`, `Caramelo`, `Salmão`.

`COLOR` é `defines_picture` + `CHILD_PK`: é o eixo com que o ML monta o seletor de cor e mantém a cor escolhida ao navegar entre tamanhos. Cor sem `value_id` não tem identidade nesse índice — trocar o tamanho dentro de uma dessas 9 cores cai no produto de outra cor. Por isso o par relatado é **Azul Royal (sem id) ↔ Azul-marinho (com id 283161)**.

> O ML aceitou tudo com HTTP 2xx. Nenhum erro na publicação — o defeito só aparece na vitrine.

### 3.1. O eixo tamanho foi investigado e está correto

`SIZE` também sai sem `value_id` nos 30 itens, mas **isso é o formato esperado quando há guia de tamanhos**, não um defeito. A guia usada (`/catalog/charts/8600765`, `main_attribute_id: SIZE`) traz cada linha assim:

```json
{"id": "8600765:2",
 "attributes": [{"id": "SIZE", "values": [{"name": "M"}]},
                {"id": "FILTRABLE_SIZE", "values": [{"id": "12917795", "name": "M"}]}]}
```

O próprio ML guarda `SIZE` como etiqueta sem id e coloca a identidade em `FILTRABLE_SIZE`. Nossos itens têm `SIZE_GRID_ROW_ID` distinto e correto em 100% dos casos (`:2` = M, `:3` = G) — e `SIZE_GRID_ROW_ID` é o atributo marcado `variation_attribute`, ou seja, o discriminador real de tamanho.

**Conclusão:** não mexer em `SIZE`. Mandar `SIZE.value_id` junto com uma size chart é, na melhor hipótese, redundante.

---

## 4. Track A — correção no código

Ordem obrigatória: ADR antes da implementação; TDD (RED antes do GREEN); deploy das edge functions é parte da entrega.

### A1. ADR (amendment ao 0166/0167) — política de cor em família de grade
Decidir e registrar:
1. `COLOR` vai ao ML **com `value_id`** resolvido contra o dicionário da categoria (não depender da normalização silenciosa do ML).
2. O que fazer quando a cor **não existe** no dicionário (as 9 acima):
   - **(recomendada) Falhar LOUD na validação, antes de publicar**, listando as cores recusadas e as válidas da categoria. O operador escolhe a cor canônica — decisão explícita, nunca automática.
   - Mapear automaticamente para a cor mais próxima — rejeitada: colapsaria duas cores comerciais no mesmo picker sem ninguém ver.
3. O nome comercial ("Azul Royal") continua no título/descrição; o picker usa a cor canônica.

**Custo:** ~1h (escrita + revisão).

### A2. Resolver `value_id` de COLOR pelo schema da categoria
- Teste RED primeiro: item de grade cuja cor existe no dicionário → payload com `value_id`, não `value_name`.
- Reusar o padrão que já existe (`forcarSaleFormatKit`, `supabase/functions/_shared/categoria/atributos.ts:266`): casar contra o schema da categoria com normalização de acento/hífen/caixa (`Azul Marinho` ≡ `Azul-marinho`).
- Aplicar em `montarPayloadItem` (`_shared/ml/publicar.ts:84`). **Não tocar em `SIZE`** (ver 3.1).

**Custo:** ~1h30 com testes.

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

## 5. Track B — os 18 itens no ar: corrigem por PUT, sem recriar nada (testado em produção)

> **Revisão de 2026-09-20, com autorização do Diego para testar escrita.** A versão anterior
> desta seção afirmava que só recriando. **Errado** — medido contra a API real:

| Teste | Resultado |
|---|---|
| `PUT /user-products/{MLBU}` com `attributes:[{id:COLOR, value_id}]` | **404** — rota não existe |
| `PUT /items/MLB7673306888` (Azul Royal M, **pausado**, estoque 0) | **200** |
| `PUT /items/MLB5264889233` (Azul Royal G, **ativo**, estoque 1) | **200** |

Depois do PUT, em ambos:

- `COLOR` = `Azul` / **`value_id: 52028`** (era texto livre sem id);
- **o user product foi atualizado junto** — mesmo `MLBU`, nome corrigido para "… Azul M/G";
- `family_id` **inalterado** (8188099135990610) — não desagrupou;
- `SIZE` e `SIZE_GRID_ROW_ID` intactos; item ativo continuou `active` com o estoque;
- nenhum item novo criado, nenhum MLB perdido.

Ou seja: **corrigir os 18 itens custa 18 PUTs**, não uma recriação. O `available_quantity`/`price`
do UPDATE da nossa saga é limitação do *nosso* código (`atributos-divergentes.ts:19` exclui COLOR
do delta de propósito — "reescrever identidade desagrupa a família"), não da API. A premissa
daquele comentário não se confirmou neste caso: o `family_id` sobreviveu.

**Pendência ao corrigir por PUT:** o banco continua com o nome comercial (`Azul Royal`) enquanto o
ML passa a ter a cor canônica (`Azul`). Alinhar `variacoes.cor` na mesma operação, senão a tela e o
canal divergem e um re-ingest/republicação devolve a cor inválida.

### Estado atual (já aplicado nos testes)

4 dos 30 itens foram ajustados, **mantendo o nome de cadastro do PubliAI** — o ML aceita
`value_name` comercial junto com `value_id` do dicionário, e ainda aceita `MAIN_COLOR`:

| Item | COLOR | MAIN_COLOR |
|---|---|---|
| MLB7673306888 (Azul Royal M) | `Azul Royal` / 52028 | Azul |
| MLB5264889233 (Azul Royal G) | `Azul Royal` / 52028 | Azul |
| MLB7673212568 (Azul Marinho M) | `Azul Marinho` / 283161 | Azul |
| MLB5264889205 (Azul Marinho G) | `Azul Marinho` / 283161 | Azul |

Achado que muda o Track A: **`MAIN_COLOR`** (`CHILD_DEPENDENT`, `variation_attribute`, 16 valores
fechados) existe na categoria e nunca foi enviado por nós. O par correto é `COLOR` = nome comercial
livre + `MAIN_COLOR` = cor básica do filtro. Antes de decidir que o nome comercial precisa virar
canônico (A1), considerar esse par — ele preserva o nome do cadastro.

Os outros 26 itens seguem como publicados.

> Ponta solta a verificar antes de adotar `MAIN_COLOR`: `atributos-divergentes.ts:19` exclui COLOR
> do delta do UPDATE (então as edições de COLOR não são revertidas pela saga), mas **`MAIN_COLOR`
> não está nessa lista** e o app nem sabe que o atributo existe — não se sabe se o próximo UPDATE
> desta família preserva ou apaga o valor.

### Opção descartada (mantida como registro)

Antes de medir, as saídas consideradas eram apagar e recriar (a família inteira ou só as cores sem
`value_id`), assumindo que atributo só entra no CREATE.

| Opção | O que envolve | Custo / risco |
|---|---|---|
| **(recomendada) B-PUT. Corrigir os 16 itens restantes por PUT** | Um `PUT /items/{id}` por item com `COLOR.value_id` da cor canônica escolhida + `UPDATE variacoes.cor` no banco. | ~30min; itens, MLBs, family e estoque preservados. Exige escolher a cor canônica de cada uma das 8 cores restantes. |
| B1. Não mexer | A vitrine segue com a navegação trocada nas 8 cores ainda sem `value_id`. | Zero risco técnico; o comprador continua confundido. |
| B2/B3. Recriar (18 ou 30 itens) | Apagar e republicar. | Desnecessário — o PUT resolve. Só faria sentido se o PUT falhasse em algum item. |

A escolha da cor canônica de cada cor comercial é do Diego (decisão comercial): o dicionário da
categoria não tem `Azul Royal`, `Pink`, `Caramelo` nem `Salmão`, então alguma aproximação é
inevitável. Nada mais é executado no ML sem o "vai" dele.

### B-pré-requisito: o mapeamento é viável, sem colisão (verificado)

B2/B3 só fazem sentido se as 15 cores couberem em 15 valores **distintos** do dicionário de 51. Cabem:

| Cor comercial (hoje) | Cor canônica proposta | Situação |
|---|---|---|
| Preto / Branco / Marrom | Preto / Branco / Marrom | já resolvida pelo ML |
| Azul Marinho / Azul Claro / Azul Celeste | Azul-marinho / Azul-claro / Azul-celeste | já resolvida pelo ML |
| **Azul Royal** | Azul (ou Azul-escuro) | a escolher |
| **Chumbo** | Cinza-escuro | a escolher |
| **Cinza Claro** | Cinza | a escolher |
| **Amarelo Manteiga** | Amarelo | a escolher |
| **Rosa Pink** | Rosa-chiclete | a escolher |
| **Nude Rosado** | Nude | a escolher |
| **Verde Militar** | Verde-musgo | a escolher |
| **Caramelo** | Marrom-claro | a escolher |
| **Salmão** | Coral | a escolher |

Nenhum destino se repete — as 15 cores continuam distintas no picker. A escolha final é do Diego (é decisão comercial, não técnica); o dicionário da categoria não tem `Azul Royal`, `Pink`, `Caramelo` nem `Salmão`, então alguma aproximação é inevitável nessa categoria.

---

## 6. Sequência sugerida

1. **B-PUT primeiro** (~30min): o anúncio no ar volta a funcionar hoje, sem depender do código.
2. A1 (ADR) → revisão
3. A2 + A3 (TDD) → A4 (UI)
4. A5 (deploy) + merge

O Track B deixou de depender do Track A: o PUT não recria nada, então corrigir a vitrine agora não
reproduz o defeito. O Track A continua necessário para a **próxima** publicação de grade.

**Total Track A:** ~7h de trabalho efetivo. **B-PUT:** ~30min.

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

`COLOR` com `value_id: null` no retorno = cor fora do dicionário, ou seja, o defeito descrito aqui. `SIZE` com `value_id: null` é esperado (ver 3.1).
