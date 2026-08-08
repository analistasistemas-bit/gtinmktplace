# Spike 037 — Botão "Cadastrar" na Análise de viabilidade

**Data:** 2026-08-08
**Status:** Viável. Escopo travado por Diego em 2026-08-08 (§5), spike do payload executado (§7).
Pronto para plano de implementação.
**Origem:** pedido do Diego (grill-with-docs + superpowers-sentinel, fase 1 Define)

## Pedido original

> Após consultar um ou vários EANs na tela de Viabilidade, ter um botão **Cadastrar** ao lado
> do produto. Ao clicar, a tela de cadastro já vem preenchida com título, descrição, foto
> principal, GTIN, peso, altura, largura e comprimento.

## Veredito em uma linha

**Viável. Quase tudo que foi pedido é entregável; só a foto fica de fora.**
Título, GTIN, custo, preço sugerido e as 4 dimensões já estão **em mãos no navegador**, sem tocar
em API nenhuma. A **descrição** foi confirmada por spike no payload real (§7) e entra — porque a
IA reescreve título e descrição antes de publicar, então nada do ML sai verbatim. A **foto** fica
de fora justamente porque é o único artefato que **iria verbatim** para o anúncio.

**As dimensões não vêm do ML** — nem estão na ficha de catálogo (medido, §7.1). Vêm do que a
própria tela de Viabilidade já coleta.

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
| `descricaoPai` | `short_description.content` de `/products/{id}` | **baixo** | **Confirmado no payload real (§7.1).** O `GET` já é feito hoje e o campo é descartado — custa um parse + bump da chave de cache `gtin:v3`→`v4`. Zero rede nova. |
| foto capa | `pictures[0].url` de `/products/{id}` | **cortado** | Existe no payload (§7.1), mas fica de fora: é o único campo que iria **verbatim** para o anúncio (§3.1). |
| `unidade` | — | — | Já tem default `'UN'`. |
| `fornecedor` | — | — | ML não sabe quem é o seu fornecedor. |
| **`origem`** | — | — | **Proibido pré-preencher.** Ver §3.3. |
| `estoqueInicial` | — | — | ML não sabe seu estoque. |
| `codigo_pai` | automático | — | ADR-0096. |

**Resultado: 8 dos 13 campos saem de graça, sem tocar em API nenhuma; a descrição é o 9º e custa
um parse.** Único campo pedido que fica de fora é a foto — o único que iria verbatim ao anúncio.

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

O cadastro manual é opt-in por org (ADR-0094 D-13). O nome do módulo é **`'estoque'`** —
verificado: `cadastrar-produto/index.ts:66` faz `exigirModulo(admin, orgId, 'estoque')` e responde
**403** sem ele; no front o hook é `useModulosHabilitados` (RPC `modulos_habilitados_da_org`),
usado por `menu-guard.tsx` e `sidebar.tsx`. A Viabilidade **não** é gated. O botão precisa do
hook; a edge já tem o gate próprio, então esconder o botão é navegação, não fronteira (ADR-0047).

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
            descricaoPai   = item.descricaoCatalogo         (campo novo na resposta, V-1b)
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

**Diff estimado:** 6 arquivos, nenhum no caminho que publica anúncio real.

| Arquivo | Mudança |
|---|---|
| `src/components/estoque/dialog-cadastro-produto.tsx` | aceitar prop `inicial` opcional |
| `src/components/viabilidade-linha.tsx` | botão + estado + montagem do `inicial` |
| `src/lib/viabilidade.ts` | 2 campos novos em `ItemAnalisado` |
| `supabase/functions/analisar-viabilidade/index.ts` | propagar `descricaoCatalogo` + `jaCadastrado` |
| `supabase/functions/_shared/concorrencia/parse.ts` | ler `short_description.content` do payload que já chega |
| `supabase/functions/_shared/ml/concorrencia.ts` | carregar o campo novo + bump `gtin:v3` → `v4` |

**Atenção no bump de cache:** `gtin:v3` → `v4` invalida a concorrência inteira de todas as orgs.
Não é perda de dado, mas a primeira análise pós-deploy sai mais lenta e bate mais na API do ML.
Os dois últimos arquivos são de `_shared/` — **todas as funções que dependem deles precisam de
redeploy** (mapear com `deno info`, não com grep, conforme o incidente registrado no ADR-0087).

---

## 5. Decisões travadas (Diego, 2026-08-08)

| # | Decisão | Racional |
|---|---|---|
| **V-1** | **Foto NÃO é pré-preenchida a partir do ML.** | Elimina §3.1: nenhuma imagem de terceiro entra no nosso anúncio, nenhum egress de imagem. Onde a foto do catálogo é legítima, o caminho já existe e é outro: vincular ao catálogo (ADR-0021). |
| **V-1b** | **Descrição ENTRA**: `descricaoPai` recebe `short_description.content` da ficha. | Reaberta por Diego e resolvida no mesmo dia — spike executado (§7.1, campo confirmado no payload) e razão verificada no código (§7.2): a IA reescreve título e descrição no caminho para a Revisão, então o texto do ML é insumo, não publicação. |
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
| `descricaoPai` | **sim** | `REPARAÇÃO INTENSIVA DE TRIPLA AÇÃO PARA PELE SENSIBILIZADA, CORPO, ROSTO E LÁBIOS! / O Cicaplast Baume B5+ La Roche-Posay é um creme multirreparador calmante de tripla ação: repara, acalma e protege… Livre de fragrâncias, hipoalergênico e dermatologicamente testado. A nova fórmula conta com o complexo prebiótico exclusivo TRIBIOMA…` | `short_description.content` da ficha (V-1b). Confirmado no payload real, §7.1. Insumo da IA — é reescrito antes de publicar. |
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
abriria com **3 campos preenchidos**: `nomePai`, `descricaoPai` e `gtin`. Com o mínimo, o custo e
as 4 dimensões digitados na própria linha da Viabilidade — que é o uso normal da tela — abriria
com **9**.

**O que sobra para o operador digitar, sempre:** origem (obrigatório, trava o salvar), estoque
inicial e fornecedor. Nada mais.

**Ponto em aberto, pequeno:** `etiquetaParaMinimo` produz um valor por tipo de anúncio
(Clássico e Premium, os dois blocos da linha expandida). O pré-preenchimento usa o **Clássico**.
Registrado por ser escolha, não consequência.

## 6. Assumido sem perguntar

- Multi-GTIN reusa o lote manual (ADR-0094 D-1.1). Sem botão "cadastrar todos" na v1.
- `origem` nunca pré-preenchida (§3.3). Não negociável.
- Botão só no modo "Colar GTINs" (`editavel === true`) — no modo planilha o produto já vai subir
  como lote.
- Botão gated pelo módulo `'estoque'` (§3.4 — nome verificado no código).
- Cadastro continua **não publicando** nada; a publicação segue sendo ato explícito na Revisão.

---

## 6.1 Fluxo completo, do clique até o anúncio no ar

Traçado no código, não no ADR. Os passos 3 em diante já existem hoje — o botão só encurta a
entrada.

### Passo 1 — busca por EAN (INALTERADA)

Viabilidade → aba "Colar GTINs" → bipa/cola → **Pesquisar** → `POST analisar-viabilidade` →
tabela. Nada muda aqui.

### Passo 2 — o botão aparece na linha

Condições (todas): `existeNoML` **e** modo GTIN (`editavel`) **e** módulo `'estoque'` habilitado
**e** `!jaCadastrado`. Com `jaCadastrado`, o botão vira **"Dar entrada"** e leva para Estoque —
o produto já existe, o que falta é saldo, não cadastro.

### Passo 3 — clique abre o diálogo pré-preenchido

**Nada é gravado.** `DialogCadastroProduto` abre com os 9 campos de §5.1. O operador completa o
que o ML não sabe: **origem** (trava o salvar), **estoque inicial**, **fornecedor**.

### Passo 4 — "Cadastrar" → `POST cadastrar-produto`

Ordem real do handler (`cadastrar-produto/index.ts`):

1. `requireUserOrg(req, { access: 'write' })`
2. `exigirModulo(admin, orgId, 'estoque')` → **403** sem o módulo (L66)
3. `validarProdutoNovo` → **400**; `origem` ausente/inválida morre aqui, LOUD
4. **Idempotência** (L85): procura família por `chave_cadastro`. Achou → devolve a original em vez
   de criar a segunda. Duplo clique e retry de rede são seguros.
5. **Guards de duplicata**: `codigo_pai` já na org → **409** "use Entrada de estoque"; SKU repetido
   entre produtos → **409** com a lista
6. **Lote** (L184): reusa o lote manual aberto da org, ou cria um `origem='manual'` (D-1.1)
7. `insert familias` (operação CREATE) + `insert variacoes` com **`estoque = 0`** (L242)
8. Estoque inicial > 0 → RPC **`registrar_entrada`** (L284): grava o ledger, sobe o saldo e
   sobrescreve `variacoes.custo` (D-9)
9. Só **depois** do insert o lote vai para `status='processando'` (L264 — ordem deliberada, evita
   que um worker feche o lote antes da família existir)
10. **`enfileirarFamilia`** no QStash (L304) e grava `qstash_message_id`
11. Responde `{ loteId, familiaId, filaOk, falhasEstoque }`

### Passo 5 — volta no navegador, ainda dentro do `salvar()`

Invalida `['produtos-saldo']` → sobe as fotos escolhidas (nenhuma, no nosso caso) → invalida de
novo → o diálogo troca para a **etapa 2** (progresso + upload manual de correção) com o botão
**"Ir para a Revisão"**.

**Para cadastrar o próximo GTIN:** fechar o diálogo, não navegar. A tabela da análise continua
na tela e o próximo cadastro cai **no mesmo lote manual** (passo 6, D-1.1).

### Passo 6 — `process-familia` roda sozinho (QStash)

Assíncrono, é o mesmo worker da planilha:

1. **`gerarCopy`** (`index.ts:201`) — recebe `nome_pai` + `descricao_pai` e **reescreve** título e
   descrição. *É aqui que o texto do ML deixa de ser o texto do ML.*
2. `buscarConcorrencia` (ADR-0014)
3. `resolverCategoria` + atributos por IA (ADR-0026/0052)
4. Preço: gross-up com frete e imposto por origem (ADR-0055) — é onde a origem do passo 3 vale
5. Cor por Vision. **Limitação conhecida** (documentada no topo de `dialog-cadastro-produto.tsx`):
   a foto escolhida no cadastro não chega a tempo do enfileiramento, então a cor por Vision se
   resolve na Revisão
6. Família → `status='pronto'`

### Passo 7 — Revisão (humano)

O operador confere título, descrição, categoria, atributos e preço **gerados** e ajusta. O
cadastro **não publica nada**.

### Passo 8 — publicação

Ato explícito na Revisão → `publish-familia-ml` → anúncio no ML. A partir daí o estoque propaga
por venda/entrada/estorno (ADR-0094, bloco A).

### Detalhe de UI a resolver na implementação

`jaCadastrado` vem da resposta da análise e **não se atualiza sozinho** depois de um cadastro.
Sem estado local marcando a linha como feita, o botão continuaria dizendo "Cadastrar" para um
produto que acabou de ser criado — e o segundo clique só descobriria isso no **409** do passo 4.5.
Barato de resolver, fácil de esquecer.

---

## 7. Spike do payload — EXECUTADO em 2026-08-08

**Método:** `console.log` temporário do payload cru de `GET /products/{id}` dentro de
`analisar-viabilidade/index.ts` (deliberadamente **fora** de `_shared/`, para deployar 1 função e
não a cascata), deploy, uma consulta do GTIN `7908615000244` pela conta de validação, leitura via
Management API (`analytics/endpoints/logs.all`), **reversão do log e redeploy limpo**. Nenhuma
escrita no ML ou no banco. Verificado antes: `/products/…` sem token = 403 `PolicyAgent`, e o ML
rejeita `grant_type=client_credentials` (`unsupported_grant_type`) — só token OAuth real serve.

### 7.1 O que `GET /products/{id}` devolve (payload real)

Chaves do topo:

```
id, catalog_product_id, status, pdp_types, domain_id, permalink, name, family_name, type,
buy_box_winner, pickers, pictures, description_pictures, main_features, disclaimers,
attributes, short_description, parent_id, children_ids, settings, quality_type, release_info,
presale_info, enhanced_content, tags, date_created, authorized_stores, last_updated,
grouper_id, experiments
```

**`short_description` existe** e vem estruturada e substancial:

```json
{"type":"plaintext","content":"REPARAÇÃO INTENSIVA DE TRIPLA AÇÃO PARA PELE SENSIBILIZADA…
O Cicaplast Baume B5+ La Roche-Posay é um creme multirreparador calmante de tripla ação:
repara, acalma e protege a pele sensibilizada. […] Livre de fragrâncias, hipoalergênico e
dermatologicamente testado. A nova fórmula conta com o complexo prebiótico exclusivo TRIBIOMA…"}
```

**`pictures` existe**, com `id` + `url` no CDN do ML:
`https://http2.mlstatic.com/D_NQ_NP_630919-MLA114210163571_072026-F.jpg` (+ `max_width`,
`max_height`, `tags`).

**`attributes` — e é aqui que a confirmação importa.** Os IDs devolvidos para este produto:

```
MANUFACTURER, BRAND, LINE, NAME, SKIN_TYPE, APPLICATION_MOMENT, SALE_FORMAT, UNIT_VOLUME,
UNITS_PER_PACK, FUNCTIONS, IS_HYPOALLERGENIC_PRODUCT, WITH_SUN_PROTECTION, PRODUCT_FORMAT,
IS_PARABENS_FREE, IS_DERMATOLOGICALLY_TESTED, SPF, WITH_EXPIRATION_DATE, IS_FRAGRANCE_FREE,
IS_OIL_FREE, WITH_COLOR, IS_CRUELTY_FREE, IS_SUITABLE_FOR_EYE_CONTOUR, IS_COMEDOGENIC, IS_VEGAN
```

**Nenhum `PACKAGE_*`, nenhum `WEIGHT`, nenhum `HEIGHT`/`WIDTH`/`LENGTH` de embalagem.** O §1
deixa de ser inferência a partir de `pacote.ts` e passa a ser fato medido: **as dimensões não
existem na ficha de catálogo.** Continuam vindo do `FormDimensoes` / `buscarDimensoesSalvas`.

### 7.2 Decisão (Diego, 2026-08-08)

> "título e descrição entram como estão, pois quando eu cadastrar o item, quando ele vai pra
> revisão o título e descrição são refeitas pela IA"

**Verificado e correto.** `process-familia/index.ts:201` chama
`gerarCopy({ nome: claimed.nome_pai, descricao_detalhado: claimed.descricao_pai ?? '', … })`, e o
cadastro manual passa por esse mesmo caminho (ADR-0094: `enfileirarFamilia` → IA intacta). Logo
`nome_pai`/`descricao_pai` são **insumo**; nada do texto do ML chega verbatim ao anúncio
publicado. O risco de plágio de copy — que era o medo original — **não se aplica**.

| # | Decisão | Racional |
|---|---|---|
| **V-1b (final)** | **`descricaoPai` é pré-preenchido com `short_description.content` da ficha.** `nomePai` idem, com `name`. | A IA reescreve os dois antes da publicação (verificado acima). O texto do ML nunca é publicado como está — ele serve de insumo, exatamente como a coluna `DESCRICAO_DETALHADO` da planilha serve hoje. |
| **V-1 (mantida)** | **Foto continua NÃO pré-preenchida.** | Não foi reaberta. E a assimetria é real: a descrição é reescrita pela IA antes de ir ao ar; a **foto vai verbatim**. É o único campo em que o artefato de terceiro chegaria intacto ao anúncio — a classe do incidente Aquaphor (§3.1). |

**Resíduo aceito, registrado:** `validarSlotsAncorados` (`titulo-guards.ts:460`) usa
`nomePai + descricaoPai` como base de evidência para liberar termos no título, marca inclusive
(`titulo-marcas.ts:9-12`). Com V-1b, essa permissão passa a vir de texto do ML em vez de texto do
operador. Mitigante real: o casamento é por EAN no lookup oficial
(`/products/search?product_identifier=`), então a marca da ficha é a marca do produto. Fica como
consequência conhecida, não como surpresa.

### 7.3 Achados extras do payload (fora do escopo desta feature)

Registrados porque o payload agora é conhecido e ninguém precisa re-descobrir:

- **`BRAND` e `MANUFACTURER` vêm como atributo da ficha.** Hoje a marca sai do mapa curado
  razão-social→marca em `titulo-marcas.ts` (ADR-0099). A ficha entrega a marca direto, casada
  por EAN. Pode simplificar aquele mapa um dia — não é escopo aqui.
- **`permalink`** — link direto da página do produto no ML. Barato e útil na própria tela de
  Viabilidade.
- **`main_features`** e **`description_pictures`** existem e não foram inspecionados.
- `SALE_FORMAT` e `UNITS_PER_PACK` confirmados no payload — são os que `fichaEquivalente` já usa
  na trava de kit (ADR-0071).
