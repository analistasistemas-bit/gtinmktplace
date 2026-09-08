# Plano v2 — Preço por variação sob User Products (ADR-0160 proposto)

**Data:** 2026-09-08
**Branch:** `worktree-preco-por-variacao-ml`
**Revisão independente:** Fable, 2026-09-08 — veredicto **APROVADO COM CORREÇÕES** (12). Esta v2
incorpora todas. As correções factuais estão marcadas com **[v1 errado]**.
**Origem:** Diego pediu preços diferentes por variação no "Tecido Oxford Liso 10m" (MLB4831319319),
depois que o painel do ML ofereceu "Oferecer preço por variação".

---

## 1. Fatos verificados

### 1.1 O que o ML chama de "preço por variação"

Doc oficial (`developers.mercadolivre.com.br/pt_br/preco-variacao`, `/pt_br/user-products`,
`/pt_br/automatizacoes-de-precos`), lida na íntegra via scraper — o site devolve 403 a fetch simples.

- **PxV não é campo novo em `variations[]`. É a migração do anúncio para User Products**, processo
  **UPtin**.
- Elegibilidade: `GET /items/$ITEM/user_product_listings/validate`. Disparo:
  `POST /sites/MLB/items/user_product_listings`. **Assíncrono.**
- Durante a migração o item original **permanece ativo**, com tags `variations_migration_pending` +
  `variations_migration_source`. Cada variação vira um **item MLB novo**, criado `paused`, com
  `variations_migration_pending` + `variations_migration_uptin`. Ao concluir: novos ativados, original
  **encerrado (`closed`)**.
- Depois de migrado, **`variations[]` deixa de existir**; enviar `variations` sob UP → **400**.
- `sold_quantity` é herdado; **as ordens antigas ficam no item antigo**.
- Não há sandbox. Dry-run: `POST /items/validate` (204 = ok), sem exemplo oficial para payload UP.

### 1.2 Alarme falso, registrado como dívida separada

A regra de **18/03/2026** (400 `item.price.not_modifiable`, ou 200 com `price` ignorado + warning)
vale **só para itens com Automatização de Preços ativa**, não para todo item. O app não está com
preço ignorado hoje por causa disso. Dívida separada, **fora deste plano**: nada consulta
`/pricing-automation/items/{id}/automation` antes de um PUT de preço.

### 1.3 O que o PubliAI já tem

- Publicação UP multi-item em produção (ADR-0088), com `anuncios_externos_itens` (um por SKU).
- Adoção de família migrada pelo ML (ADR-0104), com fallback correto para o item original não
  sobreviver — que é o que o UPtin faz (`adotar-familia-migrada.ts:151-154`).
- CREATE já monta `variations[].price` por variação (`_shared/ml/publicar.ts:196`).
- Revisão já é por variação (edição por cor, `gruposDePreco`, diálogo "aplicar às demais?").
- `variacoes` já tem `preco_publicacao`, `preco_publicado_ml`, `preco_editado_pelo_operador`,
  `exibir_com_desconto`, `desconto_pct`, `atacado` — todas por variação.

### 1.4 Correções factuais à v1

1. **[v1 errado]** O caminho UP **não passa pelo contrato canônico**: `atualizarFamiliaUP` chama
   `atualizarItemPlanoML` direto (`atualizar-familia-up.ts:245`). `AtualizacaoCanonica.precoFamilia`
   (`contrato.ts:169`) é consumido só por `mercado-livre.ts:261,310` (Legacy/item plano) e por
   `fake.ts`. **Mexer no contrato não muda o preço que chega ao UP** — e quebraria o fake.
2. **[v1 errado]** `preco_publicado_ml` **nunca é gravado no UPDATE UP**: `rodarUP` retorna em
   `update-familia-ml/processar.ts:208`, antes do bloco `:443-453`. Só o CREATE UP escreve
   (`publicar-familia-up.ts:132`). Consequência **hoje, em produção**: o badge "preço alterado" de
   família UP fica preso para sempre depois do primeiro reprice.
3. **[v1 errado]** `exigeDivisaoUpdate` (`src/lib/grupos-preco.ts:45`) já devolve `false` sob UP —
   filtra `x.mlVariationId`, que é null em UP. O que está errado sob UP é a **copy** do diálogo
   (`familia-expanded.tsx:878-880`) e o `ConfigGruposPreco` (`familia-row.tsx:434`).
4. **[v1 errado]** `formatoConhecido` é lido em `publish-familia-ml/processar.ts:202`, **depois** do
   guard `:138`. Em cache miss, o formato só se revela quando um POST Legacy falha (`:223`).
   Consequência: **categoria nunca vista + preços divergentes = LOUD sempre**, sem caminho de
   descoberta.
5. **[v1 errado]** `publicar-anuncio` é **código morto** para ML (`CanalId = 'mercado_livre'` único,
   `contrato.ts:29`; header do próprio arquivo diz "UM canal ≠ ML"). Decisão fechada: trava LOUD.
6. **[v1 errado]** Estoque herdado do UP **já é o comportamento em produção** desde o ADR-0088
   (`atualizar-composicao.ts:146`). Não é risco novo desta entrega.
7. `resolverConfigGrupo` só roda em `publicar-split-ml/index.ts:234`. Pôr o LOUD de atacado em
   `config-grupo.ts` **não protegeria o UP**, que lê `familia.atacado` direto.

### 1.5 Bugs que a entrega destrava (hoje mascarados pela trava)

`garantirPrecoUniforme`, rodando **antes** do roteamento, bloqueia por acidente quatro caminhos que
F2 abriria. Todos entram no escopo — não como melhoria, como pré-requisito:

- **B1 — janela do UPtin.** `buscarItemML` não lê `tags` (`atualizar-item.ts:52-54`). Um "Atualizar
  tudo" durante a migração vê `variations` povoado, roteia Legacy, faz PUT, recebe **200**, grava
  `preco_publicado_ml` novo — e o ML encerra o original e ativa os clones **com o preço antigo**,
  clonados antes do PUT. Banco diz "confirmado", ML vende o preço velho, badge apagado. Mesmo furo em
  `atualizarEstoque` (`mercado-livre.ts:355`).
- **B2 — atacado UP não reaplica em reprice puro.** `efeitosPosComposicao` só reaplica PxQ quando
  `houveMudanca` (`atualizar-familia-up.ts:259`). Um "Atualizar tudo" que só muda preço →
  `sem_mudanca` → preço novo sobe, **PxQ fica sobre o preço antigo**. E `:374` usa `precoFamilia ?? 0`
  para todos os filhos: com preço por SKU, o PxQ do filho B sairia calculado sobre o preço do A.
- **B3 — config por faixa ignorada no UP.** `ConfigGruposPreco` grava `variacoes.atacado` /
  `exibir_com_desconto` por cor; o UP lê só `familia.atacado`
  (`atualizar-familia-up.ts:364`, `publicar-familia-up.ts:147`). O operador configura, o app aceita,
  publica com 200, e sobe o valor família-level. É default financeiro em silêncio — proibido
  (ADR-0055).
- **B4 — "adicionar variação" repreça as irmãs no UP.** `preservarPublicadas` é calculado em
  `processar.ts:281`, **depois** do `return rodarUP` (`:208`). No UP a saga roda com
  `somenteEstoque=false` e `reposicao` manda `price` a todas as cores vivas
  (`atualizar-composicao.ts:139-146`).

---

## 2. Decisões (Diego, 2026-09-08)

1. **Migração UPtin é disparada por Diego no painel.** O app não ganha botão e não chama
   `POST /sites/MLB/items/user_product_listings`. Detecta e adota (ADR-0104).
2. **Split por faixa continua para Legacy.** O ML só oferece PxV sob UP. Família UP com preço
   divergente vai direto, sem split.
3. **Atacado (PxQ) e desconto %OFF continuam uniformes por família.** Divergência com atacado ativo
   → LOUD.
4. **Nenhum anúncio real do Diego é tocado por mim.** Sem migração, sem publicação, sem PUT em
   produção. **O Oxford 10m fica fora**; Diego valida no produto que escolher, depois da entrega.

---

## 3. Escopo

### Dentro

- `precoPorSku` **substituindo** `precoFamilia` em `EntradaComposicao` (um caminho só).
- Trava da janela de migração UPtin (B1).
- Atacado UP: reaplicar em todo `!somenteEstoque`, com o preço do próprio filho (B2); LOUD de
  atacado + divergência.
- Config por cor sob UP: LOUD no backend, `ConfigGruposPreco` escondido no front (B3).
- `preservarPublicadas` chegando ao UP (B4).
- `preco_publicado_ml` gravado por item no UPDATE UP (corrige badge quebrado hoje).
- Roteamento: divergência → split só quando Legacy; formato resolvido por sinal correto em cada
  contexto.
- Frontend: copy do diálogo, `ConfigGruposPreco`, preço em Publicados.
- ADR novo + docs.

### Fora (declarado)

- Disparar UPtin pelo app.
- Atacado/desconto **por variação** (continuam família-level; o que muda é só não errar a base).
- Checagem de Automatização de Preços antes de PUT (§1.2).
- Preço divergente dentro de item Legacy — o ML não oferece.
- **Não mexer** em `AtualizacaoCanonica` nem em `precoVivo`: churn no Legacy sem consumidor no UP, e
  `fake.ts` quebra.
- Família **já dividida** em N partições cuja categoria migre para UP: continua beco sem saída
  (ADR-0105 §7). Não piora, mas o ADR-0160 registra.
- `dialog-reprecificar.tsx`: sob UP o fluxo já funciona via `updateVariacaoPreco` + "Atualizar tudo";
  basta corrigir a mensagem. Fase 5.

---

## 4. Arquitetura

O padrão já existe: `estoquePorSku: Record<string, number>`. O preço vira o simétrico.

```
EntradaComposicao.precoFamilia: number | null   →   precoPorSku: Record<string, number | null>
```

**Um caminho só** — `precoFamilia` é removido de `EntradaComposicao`, não mantido em paralelo.
`AtualizacaoCanonica.precoFamilia` fica intocado; só o comentário (`contrato.ts:168`) passa a dizer
"preço único do item Legacy/partição".

`preco_publicacao` é `number | string | null` (`atualizar-familia-up.ts:30`): **`Number()` explícito**
ao montar o mapa, com teste alimentando `'29.90'` e afirmando `price: 29.9`. Sem isso o PUT sai com
`"price":"29.90"` e nenhum mock pega.

### Invariantes (cada um com teste nomeado)

- **I1** — Legacy divergente continua roteando para split; `garantirPrecoUniforme` continua lançando
  400 nesse caminho.
- **I2** — Família UP divergente publica/atualiza sem split, cada item com **seu** preço.
- **I3** — `somenteEstoque` nunca envia preço, nos dois caminhos.
- **I4** — `preco_publicado_ml` de um SKU reflete o preço **daquele** SKU, gravado logo após o PUT
  daquele item.
- **I5** — Atacado ativo + preços divergentes na família UP → LOUD (400), nada enviado. Vive em
  `atualizarFamiliaUP` / `publicarFamiliaUP`, **não** em `config-grupo.ts`.
- **I6** — Cor nova em família UP entra com o próprio `preco_publicacao`; nulo ou ≤ 0 → LOUD **antes
  do POST** (hoje `publicar.ts:196` mandaria `price: 0`).
- **I7** — Nenhum `variacoes.atacado` / `exibir_com_desconto` não-nulo pode ser ignorado no UP: ou é
  honrado, ou LOUD.
- **I8** — Em `somenteEstoque`, `preco_publicado_ml` **não muda** (o valor anterior continua
  verdadeiro; sem GET extra).
- **I9** — Item com tag `variations_migration_pending` / `_source` **não recebe PUT**; candidato com
  `variations_migration_uptin` não é adotado. Erro retentável, não terminal.
- **I10** — `preservarPublicadas` no UP: cores existentes recebem só o `available_quantity` vivo — sem
  `price`, sem `attributes`. Distinto de `somenteEstoque`, que também zera `paraAdicionar`.

---

## 5. Fases (TDD: vermelho antes de cada implementação)

### F0 — Rede de segurança + baseline

Fixar por teste o que não pode regredir: Legacy divergente → split; `somenteEstoque` sem preço (já
coberto em `atualizar-composicao.test.ts:130`); trava lançando no ramo Legacy.
**Pré-requisito:** resolver as 3 falhas de teste do baseline (2 arquivos), provando se são
pré-existentes na `main` — nunca inferindo do diff.

### F1 — Trava da janela de migração (B1 / I9) — **antes de tudo**

1. `_shared/ml/atualizar-item.ts:52-54`: `buscarItemML` passa a pedir e devolver `tags`.
2. `mercado-livre.ts`: `atualizarAnuncio` e `atualizarEstoque` recusam item com
   `variations_migration_pending` / `_source` — 400 **retentável** com delay, não terminal.
3. `adotarFamiliaMigrada` / `descobrirFamiliaUP` recusam candidato com `variations_migration_uptin`.

### F2 — Núcleo: preço por SKU no UP

1. `atualizar-composicao.ts`: `precoFamilia` → `precoPorSku`; `reposicao()` usa
   `entrada.precoPorSku[f.sku]`, com `Number()`.
2. `atualizar-familia-up.ts:85-86`: monta o mapa a partir de `variacoes`.
3. `reconciliar-convergencia-up/processar.ts:93`: passa `precoPorSku` com **null = não envia**
   (preserva). Não LOUD — a validação de `:79-86` checa a linha, não o preço, e um SKU sem preço
   travaria o reconciliador.
4. `preco_publicado_ml` gravado **por item, após o PUT daquele item** (porta nova em
   `PortasComposicao`), respeitando I8.

### F3 — Roteamento e travas financeiras

1. `update-familia-ml/processar.ts`: `garantirPrecoUniforme` sai de `:166` e passa a rodar **dentro
   do ramo Legacy, antes de `conn.atualizarAnuncio` (`:286`)**. Mensagem acionável: família migrada
   pelo ML → "rode 'somente estoque' uma vez para adotar" (senão a detecção `MIGRADO_PARA_UP`, que só
   ocorre dentro dessa chamada, nunca roda e o LOUD vira eterno).
2. `publish-familia-ml/processar.ts:138`: idem, e mensagem acionável para categoria desconhecida +
   divergente ("publique uniforme uma vez; o formato fica conhecido").
3. `decidir-split.ts`: recebe o formato. **Sinais distintos por contexto** — UPDATE: existência de
   linha em `anuncios_externos_itens`; CREATE: cache `ml_formato_publicacao` por categoria. Nunca o
   de categoria para decidir UPDATE.
4. Atacado UP (B2 / I5): reaplicar em todo `!somenteEstoque`, inclusive `sem_mudanca`, com o preço
   **daquele** filho; LOUD se atacado ativo + divergência.
5. Config por cor sob UP (B3 / I7): LOUD se qualquer `variacoes.atacado` / `exibir_com_desconto` for
   não-nulo em família UP.
6. `preservarPublicadas` (B4 / I10): mover `ehFluxoAddVariacao` de `:281` para **antes** do
   roteamento (`:203`) e passar à saga.
7. `publicar-anuncio/processar.ts`: trava LOUD (código morto para ML — §1.4.5).

### F4 — Frontend

1. `familia-expanded.tsx:878-880`: copy do diálogo deixa de afirmar "as faixas serão publicadas como
   anúncios separados" quando a família é UP.
2. `familia-row.tsx:434`: não renderizar `ConfigGruposPreco` sob UP (`skus_ativos_up` não vazio).
3. Formato no front: UPDATE por `jaCasadaUP` / `skus_ativos_up` (`queries.ts:262`), **não** por
   `formato_publicacao_ml` de categoria (`:264,322`) — este classificaria como UP uma família Legacy
   ainda não migrada, e a UI diria "não exige dividir" enquanto o backend Legacy LOUDa.
4. `Publicados.tsx:295,300`: `precoPublicacao` deixa de ser `Math.min` e vira faixa; `precoAtual` vem
   de `status-publicados` pelo 1º filho (`processar.ts:54-58`) — ou passa a ler todos os filhos, ou
   ganha rótulo honesto ("preço da 1ª cor"). Decidir na implementação pelo menor diff que não minta.

### F5 — Opcional

`dialog-reprecificar.tsx:74-91`: sob UP, trocar a mensagem de recusa (o fluxo já funciona). Se não
couber, sai como pendência escrita no ADR.

### F6 — Documentação (mesmo commit)

- **ADR-0160**: não revoga o ADR-0078 — **corrige a premissa**: preço único entre variações é
  restrição do modelo **Legacy**, não do ML inteiro. Registra o beco da família já dividida que migra
  (ADR-0105 §7) e a dívida da automação de preços (§1.2).
- Atualizar: `0078` §Contexto item 2, `0016:180-186`, `0041:56-57`, `0088:658`, `0104`,
  `docs/reference/edge-functions.md:365-382,474-521`, `docs/reference/modelo-de-dados.md:322-327`,
  `docs/explanation/arquitetura.md:165-167`, `obsidian-vault/06-Roadmap/Sprint Atual.md:517-523`,
  `obsidian-vault/04-Decisões/Índice de ADRs.md`, `docs/TASKS.md`.

---

## 6. Testes que mudam de propósito

| Teste | Hoje afirma | Passa a afirmar |
|---|---|---|
| `_shared/preco/__tests__/grupos.test.ts:47-58` | trava lança em qualquer divergência | lança no ramo Legacy; UP não chama |
| `publicar-familias/__tests__/decidir-split.test.ts:12-13` | divergência ⇒ split sempre | divergência ⇒ split se Legacy |
| `_shared/ml/__tests__/atualizar.test.ts:89-93` | mesmo `price` em todas | inalterado (Legacy) |
| `_shared/canais/__tests__/mercado-livre.test.ts:95-96` | `precoFamilia` reaplicado | inalterado (Legacy) + novo caso I9 |
| `_shared/user-products/__tests__/atualizar-composicao.test.ts:125-126` | mesmo price em MLB1 e MLB2 | preços distintos por item |
| `_shared/user-products/__tests__/atualizar-familia-up.test.ts` | atacado família-level escalar | + I5 LOUD, + PxQ com o preço do próprio filho |
| `src/lib/__tests__/grupos-preco.test.ts:69-95` | divergência ⇒ exige divisão | inalterado (já é false sob UP) |
| `tests/components/familia-expanded.test.tsx:75-88` | copy "vai exigir dividir" | copy condicional ao formato |
| `_shared/preco/__tests__/config-grupo.test.ts:69-78` | config divergente ⇒ LOUD | inalterado |

---

## 7. Riscos

| Risco | Mitigação |
|---|---|
| **Janela do UPtin** (B1) — preço errado com 200, sem sinal | F1, antes de tudo; I9 com teste |
| **PxQ sobre preço errado** (B2) | F3.4; I5 |
| **Config por cor ignorada** (B3) | F3.5; I7 |
| **`price` como string** | `Number()` + teste com `'29.90'` |
| **Retry QStash parcial** | Preço lido do banco a cada tentativa (idempotente); gravar `preco_publicado_ml` por item evita banco 100% velho com ML 33% novo |
| **LOUD eterno** (Legacy migrado, ou categoria desconhecida divergente) | Mensagens acionáveis em F3.1/F3.2 |
| **Regressão no Legacy** | I1 + F0 escritos antes de qualquer mudança |

---

## 8. Critérios de aceite

**Código (eu executo):**
1. `pnpm lint` e `pnpm test` verdes nas três árvores; baseline explicado.
2. `pnpm preflight:static` verde antes do push.
3. I1–I10 com teste nomeado cada.
4. Nenhum teste apagado sem substituto na tabela §6.
5. Docs e ADR no mesmo commit.
6. Segunda revisão do Fable sobre o diff completo, antes de propor merge.

**Validação real (Diego executa — não no Oxford):**

A ordem importa. Um anúncio Legacy **não pode** ter duas cores com preços diferentes — é a restrição
que o split existe para contornar. Então a família de teste nasce **uniforme**, migra, e só depois
recebe preços distintos:

1. Publicar uma família de teste com 2 cores **no mesmo preço**.
2. Migrar pelo painel do ML ("Oferecer preço por variação") e esperar concluir.
3. **Checagem que decide se o resto funciona automaticamente:** `GET /items/{id-do-item-original}` e
   conferir se `variations[]` ainda traz `seller_custom_field` e o atributo COLOR de cada cor.
   - **Se vier povoado:** siga para o passo 4 — a adoção automática consegue casar as cores.
   - **Se vier vazio:** a descoberta por título (ADR-0105) não tem como casar SKU→cor, e a adoção
     automática vai falhar com "0 de N cores localizadas". Não é bug desta entrega; o caminho passa a
     ser a adoção manual do ADR-0104. Me avise antes de seguir.

   Motivo da checagem: na dissolução espontânea o ML deixava as `variations` no item encerrado, mas a
   doc do UPtin diz que "`variations[]` deixa de existir" sem esclarecer se vale também para o
   original. Não dá para provar sem migrar um anúncio de verdade.
4. Publicar uma vez como **"somente estoque"** — é o que faz o app adotar a migração (a família passa
   a ter itens em `anuncios_externos_itens`). Conferir na tela Publicados que o produto continua lá.
5. Agora sim: dar **preços diferentes** às duas cores na Revisão e publicar com **"Atualizar tudo"**.
   Conferir por `GET /items/{id}` de cada filho que **cada item ficou com o SEU preço**.
6. "Somente estoque" de novo → nenhum preço muda no ML.
7. Movimentar estoque de uma cor → só ela muda.
8. Publicados mostra a faixa (`R$ x – R$ y`), não um preço só.
9. Se conseguir pegar a janela: rodar um UPDATE **durante** a migração → o app recusa (I9) e não
   publica nada.

Se o passo 5 for tentado **antes** do 4, o app recusa com a mensagem que ensina exatamente o passo 4
— é o comportamento esperado, não um erro.

---

## 9. Ordem de execução

F0 → F1 → F2 → F3 → F4 → (F5) → F6 → `pnpm preflight` → **2ª revisão Fable do diff** → Diego valida →
merge + `supabase functions deploy` das funções afetadas.

**Deploy obrigatório** (CLAUDE.md): a entrega toca `supabase/functions/**` e `_shared/**`; o CI não
deploya. Sem migration prevista.
