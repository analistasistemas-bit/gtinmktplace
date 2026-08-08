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

### 3.2 `descricaoPai` é a base de evidência dos guards, não um campo de texto (ALTO)

A descrição publicada não é o que se digita no cadastro. `descricaoPai` é **insumo**, e o código
usa esse insumo em dois papéis, não um:

1. **Fonte da copy** — `process-familia` gera a descrição sob ADR-0098 (*copy ancorada na fonte*),
   ADR-0102 e ADR-0103.
2. **Permissão para afirmar coisas no título** — `titulo-guards.ts:237` monta
   `textoFonte = nomePai + "\n" + descricaoPai` e `validarSlotsAncorados` (L460-467) só deixa um
   termo entrar no título se ele **aparecer nesse texto**.

O papel (2) é o que pesa. O cabeçalho de `titulo-marcas.ts:9-12` é explícito:

> **O MAPA FORNECE A GRAFIA; A FONTE FORNECE A PERMISSÃO.** […] exigindo que apareça em
> `nome_pai` ou `descricao_pai`. Sem isso o sistema estaria afirmando uma marca a partir de um
> campo de fornecedor — o que o padrão do ML proíbe.

Ou seja: colar a descrição do catálogo em `descricaoPai` **concede permissão** para o título
afirmar tudo que aquele texto afirma — marca inclusive (ADR-0099/0100/0101). A trava construída
para impedir que a gente afirme marca a partir de dado não verificado passaria a ser satisfeita
por texto que não é nosso.

**Contra-argumento honesto:** o casamento é por EAN via `/products/search?product_identifier=`,
que é o lookup oficial do ML — se a ficha casou, a marca dela provavelmente **está certa**. O
problema não é o dado ser falso, é a *fonte da permissão* mudar de "o que o operador declarou"
para "o que o ML publicou". É uma decisão de desenho legítima; só não pode ser efeito colateral
de um botão.

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
produto existe: `buscarDimensoesSalvas` consulta `variacoes` por `(org_id, gtin)`, então o sinal de
existência é a **mesma query** — `jaCadastrado: boolean` é um `select` mais largo, não uma ida a
mais no banco. Com ele o botão vira **"Dar entrada"** em vez de "Cadastrar".

**Isso é pré-empção de UX, não substituição do guard.** A chave que o D-4 checa é `codigo_pai`, e
`codigo_pai` é gerado automaticamente (ADR-0096) — casar por GTIN é **heurística** para "já
cadastrado", não a mesma chave. A trava autoritativa continua sendo o 409 da edge
`cadastrar-produto`, e a UI continua tendo que tratá-lo.

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
| **V-1** | **Foto NÃO é pré-preenchida a partir do ML.** | Elimina §3.1: nenhuma imagem de terceiro entra no nosso anúncio, nenhum egress de imagem. Onde a foto do catálogo é legítima, o caminho já existe e é outro: vincular ao catálogo (ADR-0021). |
| **V-1b** | **Descrição: reaberta por Diego em 2026-08-08, decisão pendente.** Ver §3.2 e §7. | O corte original veio agrupado com a foto na mesma opção. Reaberta isolada, com um bloqueio técnico e uma decisão de desenho na frente — nenhum dos dois resolvido ainda. |
| **V-2** | **`preco` é pré-preenchido com `etiquetaParaMinimo(minimo, …)`**, editável — **e só quando `minimo != null`**. Sem mínimo digitado, o campo entra **vazio**; nunca cai para `item.mercado.menor`. | É o resultado que a Viabilidade existe para produzir — o preço de etiqueta que devolve o mínimo líquido depois de comissão, imposto (ADR-0055) e frete do vendedor (ADR-0050/0076). O cadastro não sabe calcular isso. Fica editável porque é sugestão, não trava. **A condição é obrigatória:** no modo GTIN colado `minimo` nasce `null` (`index.ts:140` só o preenche se o caller mandar número, e a UI nunca manda), e `etiquetaParaMinimo` devolve `null` nesse caso — quem implementar vai encontrar o `null` e ficar tentado a usar o menor preço do mercado como fallback. Esse é o preço **do concorrente**, não um preço que devolve o seu mínimo: entraria num campo financeiro com cara de valor calculado. Campo vazio é o comportamento correto. |
| **V-3** | **`origem` nunca é pré-preenchida.** Rádio sem seleção, botão de salvar travado. | §3.3. `analisar-viabilidade/index.ts:142` hardcoda `'nacional'` no modo GTIN; carregar esse valor reproduziria o incidente ORIGEM de 2026-07-14. Não negociável. |
| **V-4** | Botão só quando `existeNoML && editavel && módulo habilitado && !jaCadastrado`. | Modo planilha já vira lote; produto sem ficha no ML não tem título para herdar; módulo é opt-in (D-13); duplicata vira "Dar entrada" antes de virar 409 (§3.5). |
| **V-5** | Multi-GTIN = N cliques, mesmo lote manual. Sem "cadastrar todos" na v1. | ADR-0094 D-1.1 já reusa a sessão. YAGNI até alguém pedir. |

**Consequência do V-1 sobre o escopo estimado:** a fase 2 (spike do payload de `/products/{id}`,
parse de `pictures`/`short_description`, download+upload de imagem, bump `gtin:v3`→`v4`) **sai do
plano**. Sobra o que já estava barato: 3 arquivos, nenhum deles no caminho que publica anúncio real.

## 5.1 O formulário exatamente como ele abriria

Todo campo de `DialogCadastroProduto` + `LinhaVariacao`, sem omissão. Exemplo real: o produto do
print do Diego (Cicaplast Baume B5+ La Roche-Posay 40ml, GTIN 7908615000244, menor R$ 99,90,
1 vendedor, líquido se igualar R$ 67,57).

### Bloco PAI

| Campo | Vem preenchido? | Valor | De onde |
|---|---|---|---|
| `nomePai` | **sim** | `Creme Multirreparador Calmante, Cicaplast Baume B5+ La Roche-Posay, 40ml` | `item.nome` — é o `product_name` da ficha de catálogo, já na resposta da análise. É literalmente o texto que a tabela mostra na coluna Produto. |
| `descricaoPai` | **pendente** | — | §7. Bloqueado por spike + decisão. |
| `unidade` | não (default) | `UN` | Default que o formulário já tem hoje. O ML não diz sua unidade de venda. |
| `fornecedor` | não | vazio | O ML não sabe de quem você compra. |
| `origem` | **NUNCA** | sem seleção, salvar travado | V-3. Inegociável. |
| foto capa / capa2 / capa3 | não | vazio | V-1. |

### Bloco VARIAÇÃO (uma linha, o GTIN consultado)

| Campo | Vem preenchido? | Valor | De onde |
|---|---|---|---|
| `gtin` | **sim** | `7908615000244` | O GTIN que você bipou/colou. |
| `nome` | não | vazio | É o nome da **variação** (cor/tamanho). Uma consulta de EAN é um SKU só; não há o que herdar. |
| `preco` | **condicional** | vazio no seu print | V-2: só preenche se você tiver digitado "Seu mínimo". Com mínimo digitado, recebe **o mesmo número que a linha já exibe em "Pra receber seu mínimo, anuncie a"** do bloco **Clássico**. |
| `custo` | **sim, se digitado** | o que você pôs no campo Custo da linha | Você já digita isso para ver o semáforo. |
| `estoqueInicial` | não | vazio | O ML não sabe seu estoque. |
| `pesoGramas` | **sim, se conhecido** | — | Duas fontes locais: o que você digitou no `FormDimensoes` para recalcular o frete, ou o que a edge já achou em `variacoes` (`buscarDimensoesSalvas`). **Nunca do ML** (§1). |
| `alturaCm` | idem | — | idem |
| `larguraCm` | idem | — | idem |
| `comprimentoCm` | idem | — | idem |
| `foto` (por variação) | não | vazio | V-1. |

**No print específico do Diego** (sem mínimo, sem custo, sem dimensões digitadas) o formulário
abriria com **2 campos preenchidos**: `nomePai` e `gtin`. Com o mínimo, o custo e as 4 dimensões
digitados na própria linha da Viabilidade — que é o uso normal da tela — abriria com **8**.

**Ponto em aberto, pequeno:** `etiquetaParaMinimo` produz um valor por tipo de anúncio
(Clássico e Premium, os dois blocos da linha expandida). O pré-preenchimento usa o **Clássico**.
Registrado por ser escolha, não consequência.

## 6. Assumido sem perguntar

- Multi-GTIN reusa o lote manual (ADR-0094 D-1.1). Sem botão "cadastrar todos" na v1.
- `origem` nunca pré-preenchida (§3.3). Não negociável.
- Botão só no modo "Colar GTINs" (`editavel === true`) — no modo planilha o produto já vai subir
  como lote.
- Botão gated pelo módulo `cadastro_manual`.
- Cadastro continua **não publicando** nada; a publicação segue sendo ato explícito na Revisão.

---

## 7. Descrição — o que falta para decidir

Reaberta em 2026-08-08. Dois bloqueios independentes, nesta ordem:

### 7.1 Bloqueio técnico: ninguém nunca olhou o payload

`GET /products/{id}` é chamado em `concorrencia.ts:102` e só o `buy_box_winner` é lido
(`parse.ts:32`). **Não existe evidência no repositório de que `short_description` venha nesse
payload** — nem a favor, nem contra.

Tentei confirmar com chamada real e não consegui, por dois motivos, ambos registrados:

- `GET /products/…` sem token devolve **403** (`PolicyAgent`) — verificado.
- `grant_type=client_credentials` é **rejeitado pelo ML** (`unsupported_grant_type`, HTTP 400) —
  verificado. O ML só emite token por `authorization_code`/`refresh_token`, ou seja, exige a
  conexão OAuth real da org.
- Ler o token da conexão exige service_role no banco de produção — **negado pelo sandbox**, e
  corretamente. Não foi contornado.

Caminho limpo para desbloquear: um `console.log` do `produtoJson` dentro de
`concorrencia.ts:102`, deploy da `analisar-viabilidade`, uma consulta de GTIN pela tela e leitura
do log. ~15 min, sem escrita em nada.

### 7.2 Decisão de desenho: o que a descrição do ML passa a autorizar

Independente do payload existir, colar a descrição do catálogo em `descricaoPai` muda a **fonte
da permissão** dos guards de título (§3.2) — a marca, entre outras coisas, passa a poder entrar no
título por aparecer num texto do ML, não num texto que o operador declarou.

Três saídas, em ordem de risco:

| Opção | O que acontece |
|---|---|
| **A — não pré-preencher** | Estado atual. Operador escreve. Guards seguem ancorados no que é dele. |
| **B — pré-preencher em campo separado, só leitura** | A descrição do ML aparece ao lado como referência para o operador copiar/reescrever, mas **não** entra em `descricaoPai`. Guards intocados. Entrega a conveniência sem mexer na base de evidência. |
| **C — pré-preencher `descricaoPai` direto** | O pedido literal. Máxima conveniência; muda o que os guards de título aceitam como prova. Exigiria decisão registrada (ADR ou adendo ao 0099/0101). |
