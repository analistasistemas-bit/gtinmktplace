# Spike 037 — Botão "Cadastrar" na Análise de viabilidade

**Data:** 2026-08-08
**Status:** Viável. Escopo travado por Diego em 2026-08-08 (§5). Pronto para plano de implementação.
**Origem:** pedido do Diego (grill-with-docs + superpowers-sentinel, fase 1 Define)

## Pedido original

> Após consultar um ou vários EANs na tela de Viabilidade, ter um botão **Cadastrar** ao lado
> do produto. Ao clicar, a tela de cadastro já vem preenchida com título, descrição, foto
> principal, GTIN, peso, altura, largura e comprimento.

## Veredito em uma linha

**Viável, e mais barato do que parece — mas metade do que foi pedido não vem do ML.**
Título, GTIN, custo, mínimo/preço sugerido e as 4 dimensões já estão **em mãos no navegador**,
sem tocar em nenhuma API. **Foto e descrição** são a parte cara: exigem novo parse do payload do
ML, download+upload de imagem, e carregam o risco de propriedade intelectual que já cancelou um
anúncio nosso.

---

## 1. O que existe hoje (verificado no código)

| Peça | Arquivo | Fato relevante |
|---|---|---|
| Tela de viabilidade | `src/pages/Viabilidade.tsx` | Dois modos: planilha e GTINs colados. `editavel = (modo === 'gtins')`. |
| Linha do resultado | `src/components/viabilidade-linha.tsx` | Já tem `FormDimensoes` (L63) que coleta altura/largura/comprimento/peso quando o ML não achou dimensões. Já tem inputs de **mínimo** e **custo** (L176-183). |
| Edge de análise | `supabase/functions/analisar-viabilidade/index.ts` | Chama `buscarConcorrencia` e `buscarDimensoesSalvas` (L19). |
| Busca no catálogo | `supabase/functions/_shared/ml/concorrencia.ts` | **Já faz `GET /products/{id}`** (L102) e joga fora o payload inteiro. |
| Parse do catálogo | `supabase/functions/_shared/concorrencia/parse.ts` | De `/products/{id}` usa **só `buy_box_winner`** (L31-33). `pictures`, `short_description`, `main_features`, `attributes` são descartados. |
| Tela de cadastro | `src/components/estoque/dialog-cadastro-produto.tsx` (654 linhas) | Diálogo em 2 etapas, gated pelo módulo (ADR-0094 D-13). Estado local com `useState` de valores fixos — hoje **não aceita valores iniciais**. |
| Decisão de referência | ADR-0094 | Cadastro manual = 1 lote manual reusado por sessão (D-1.1), duplicata rejeitada LOUD (D-4), `origem` nunca default (adendo 1). |

### Achado que muda o desenho

`GET /products/{id}` **já é chamado hoje** para todo GTIN analisado. Não é uma chamada nova — é
um payload que a gente paga e descarta. Se `pictures`/`short_description` estiverem nele, a foto
e a descrição custam um parse + bump da chave de cache (`gtin:v3` → `v4`), não uma nova rodada de
rede.

### Achado que **derruba** parte do pedido

**As dimensões não vêm do ML.** `parseProdutoCatalogoBusca` (`_shared/ml/catalogo.ts:130`) mostra
que a ficha de catálogo carrega `SALE_FORMAT`, `UNITS_PER_PACK`, `LENGTH`, `domain_id` — atributos
**de especificação do produto**. Peso e dimensões de envio são `SELLER_PACKAGE_HEIGHT/WIDTH/
LENGTH/WEIGHT` (`_shared/ml/pacote.ts:36-39`): atributos **do anúncio de cada vendedor**, não da
ficha. Não existe "a dimensão do produto no catálogo" para ler.

**Mas isso não é um problema** — a Viabilidade já tem as dimensões por dois caminhos locais:

1. `buscarDimensoesSalvas` (edge, L19) já leu de `variacoes` se o produto existe na org;
2. `FormDimensoes` já pede as 4 medidas ao operador quando `dimensoesEncontradas === false`,
   e elas ficam no estado do componente, um nível abaixo do botão.

Levar esse estado para o cadastro é o caminho mais curto **e** o único correto.

---

## 2. Mapa campo a campo — o que dá para pré-preencher

Campos da tela de cadastro (`dialog-cadastro-produto.tsx` + `linha-variacao-form.tsx`):

| Campo do cadastro | Fonte | Custo | Observação |
|---|---|---|---|
| `nomePai` (título) | `item.nome` — `product_name` do catálogo ML | **zero** | Já está na resposta (`ItemAnalisado.nome`). |
| `gtin` (variação) | `item.gtin` | **zero** | Já está na tela. |
| `custo` | input "Custo" da linha | **zero** | O operador já digitou para ver o semáforo. |
| `preco` | `etiquetaParaMinimo(minimo, ...)` | **zero** | Cálculo já roda na linha. Valor que só a Viabilidade sabe produzir. |
| `pesoGramas` | `FormDimensoes` / `buscarDimensoesSalvas` | **zero** | **Não vem do ML.** |
| `alturaCm` / `larguraCm` / `comprimentoCm` | idem | **zero** | idem |
| `descricaoPai` | `short_description` de `/products/{id}` | **médio + risco** | Ver §3. Payload já baixado, mas descartado. |
| foto capa | `pictures[0]` de `/products/{id}` | **alto + risco** | Ver §3. Exige download + upload no storage. |
| `unidade` | — | — | Já tem default `'UN'`. |
| `fornecedor` | — | — | ML não sabe quem é o seu fornecedor. |
| **`origem`** | — | — | **Proibido pré-preencher.** Ver §3.3. |
| `estoqueInicial` | — | — | ML não sabe seu estoque. |
| `codigo_pai` | automático | — | ADR-0096. |

**Resultado: 8 dos 13 campos saem de graça, sem tocar em API nenhuma.**
Os 2 que exigem trabalho novo (foto, descrição) são exatamente os 2 que carregam risco jurídico.

---

## 3. Riscos — ranqueados

### 3.1 Foto do catálogo = exposição de propriedade intelectual (ALTO)

Em 2026-08-06 o ML cancelou o anúncio do Aquaphor por propriedade intelectual depois que uma
mudança re-disparou a moderação. O comentário em `_shared/ml/catalogo.ts:158-162` registra o
incidente no código. Copiar a imagem da ficha de catálogo (ou de um concorrente) para dentro do
nosso anúncio é exatamente a classe de coisa que a moderação do ML pega — e a foto de capa é o
gatilho de moderação mais comum (registrado na referência de ML na memória do projeto).

Além disso: **se o produto tem ficha de catálogo, o caminho certo não é copiar a foto — é vincular
ao catálogo** (ADR-0021), que já existe e já roda no pipeline.

### 3.2 `descricaoPai` é INPUT da IA, não output (ALTO)

A descrição publicada não é o que se digita no cadastro. O `process-familia` gera a copy a partir
do `descricaoPai` sob ADR-0098 (*copy ancorada na fonte*), ADR-0102 (*sem promessa logística*) e
ADR-0103. Pré-preencher com a `short_description` do catálogo faz a nossa copy gerada ficar
**ancorada no texto de outra pessoa** — não é "colar uma descrição", é redirecionar a fonte de
verdade do gerador de copy. Isso precisa ser decisão explícita, não efeito colateral de um botão.

### 3.3 `origem` — nunca pré-preencher (BLOQUEANTE se ignorado)

`analisar-viabilidade/index.ts:142` **hardcoda `origem: 'nacional'`** no modo GTIN colado. Se o
botão carregar `item.origem` para o cadastro, a gente reproduz o incidente de 2026-07-14 do
`ingest-lote` (ORIGEM dropada → tudo nacional → alíquota errada por ~2 semanas), agora com dois
ADRs a mais contra (0055, 0107) e a trava LOUD que o ADR-0094 já implementou.

**Regra travada:** o rádio de origem entra **sem seleção**, botão de salvar travado, exatamente
como está hoje. Zero exceção.

*(Separado, não é escopo desta feature, mas fica registrado: os números de viabilidade no modo
GTIN colado já assumem 8% para todo mundo. Produto importado aparece com viabilidade otimista.)*

### 3.4 Gate de módulo (MÉDIO, mecânico)

O cadastro manual é opt-in por org (`modulos_habilitados`, ADR-0094 D-13). A Viabilidade não é.
O botão precisa de `useModulosHabilitados`; a edge `cadastrar-produto` já tem o gate próprio
(D-15), então esconder o botão é só navegação, não fronteira.

### 3.5 Duplicata — oportunidade, não só risco (BAIXO)

D-4 rejeita `codigo_pai` já existente na org com 409. Hoje a edge de viabilidade **já sabe** se o
produto existe: `buscarDimensoesSalvas` só encontra algo se houver variação com aquele GTIN na
org. Vale devolver um `jaCadastrado: boolean` explícito (1 query) e o botão virar
**"Dar entrada"** em vez de "Cadastrar" — resolve o 409 antes de ele acontecer.

---

## 4. Desenho proposto (menor coisa que funciona)

Nenhuma tela nova, nenhuma edge nova.

```
ViabilidadeLinha
  └─ [Cadastrar]  (só quando: existeNoML && editavel && módulo habilitado && !jaCadastrado)
       └─ abre <DialogCadastroProduto inicial={...} />   ← única mudança no cadastro:
            nomePai        = item.nome                     aceitar valores iniciais opcionais
            gtin           = item.gtin
            custo          = custo (state da linha)
            preco          = etiquetaParaMinimo(minimo,…)
            peso/alt/larg/comp = dimensões do FormDimensoes ou do item
            origem         = null  ← SEMPRE
       └─ [Salvar] → edge cadastrar-produto (INTACTA) → lote manual reusado (D-1.1)
       └─ redireciona para /revisao/{loteId}  ← fluxo existente
```

**Multi-GTIN:** nada especial. N cliques = N famílias no **mesmo** lote manual aberto, porque o
D-1.1 já reusa a sessão. Não precisa de "cadastrar todos" para a v1.

**Diff estimado (só se a Fase 1 for aprovada sem foto/descrição):** 3 arquivos —
`dialog-cadastro-produto.tsx` (aceitar `inicial`), `viabilidade-linha.tsx` (botão + estado),
`analisar-viabilidade/index.ts` (+`jaCadastrado`). Nenhum arquivo do caminho que publica anúncio
real é tocado.

### Se foto/descrição entrarem (fase 2)

Um passo obrigatório antes: **spike de 15 min** — logar o payload cru de `/products/{id}` (a
chamada já existe em `concorrencia.ts:102`) e confirmar se `pictures` e `short_description` estão
lá. Sem esse payload não dá para estimar honestamente. Depois: parse novo + bump da chave de cache
`gtin:v3` → `v4` + download da imagem na edge + upload no storage (atenção ao ADR-0081, corte de
egress).

---

## 5. Decisões travadas (Diego, 2026-08-08)

| # | Decisão | Racional |
|---|---|---|
| **V-1** | **Foto e descrição NÃO são pré-preenchidas a partir do ML.** O escopo é título, GTIN, custo, preço e as 4 dimensões. | Elimina §3.1 e §3.2 por inteiro: nenhuma imagem de terceiro entra no nosso anúncio e a `descricaoPai` continua sendo a fonte que o operador escreve, não texto de outra pessoa ancorando a copy da IA (ADR-0098/0102/0103). Bônus: nenhuma chamada nova ao ML, nenhum parse novo, nenhum bump de cache, nenhum egress de imagem. Onde a foto do catálogo é legítima, o caminho já existe e é outro: vincular ao catálogo (ADR-0021). |
| **V-2** | **`preco` é pré-preenchido com `etiquetaParaMinimo(minimo, …)`**, editável. | É o resultado que a Viabilidade existe para produzir — o preço de etiqueta que devolve o mínimo líquido depois de comissão, imposto (ADR-0055) e frete do vendedor (ADR-0050/0076). O cadastro não sabe calcular isso. Fica editável porque é sugestão, não trava. |
| **V-3** | **`origem` nunca é pré-preenchida.** Rádio sem seleção, botão de salvar travado. | §3.3. `analisar-viabilidade/index.ts:142` hardcoda `'nacional'` no modo GTIN; carregar esse valor reproduziria o incidente ORIGEM de 2026-07-14. Não negociável. |
| **V-4** | Botão só quando `existeNoML && editavel && módulo habilitado && !jaCadastrado`. | Modo planilha já vira lote; produto sem ficha no ML não tem título para herdar; módulo é opt-in (D-13); duplicata vira "Dar entrada" antes de virar 409 (§3.5). |
| **V-5** | Multi-GTIN = N cliques, mesmo lote manual. Sem "cadastrar todos" na v1. | ADR-0094 D-1.1 já reusa a sessão. YAGNI até alguém pedir. |

**Consequência do V-1 sobre o escopo estimado:** a fase 2 (spike do payload de `/products/{id}`,
parse de `pictures`/`short_description`, download+upload de imagem, bump `gtin:v3`→`v4`) **sai do
plano**. Sobra o que já estava barato: 3 arquivos, nenhum deles no caminho que publica anúncio real.

## 6. Assumido sem perguntar

- Multi-GTIN reusa o lote manual (ADR-0094 D-1.1). Sem botão "cadastrar todos" na v1.
- `origem` nunca pré-preenchida (§3.3). Não negociável.
- Botão só no modo "Colar GTINs" (`editavel === true`) — no modo planilha o produto já vai subir
  como lote.
- Botão gated pelo módulo `cadastro_manual`.
- Cadastro continua **não publicando** nada; a publicação segue sendo ato explícito na Revisão.
