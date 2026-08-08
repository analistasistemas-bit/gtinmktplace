# Plano — Botão "Cadastrar" na Análise de viabilidade

**Data:** 2026-08-08
**Fonte da verdade do escopo:** `docs/spikes/037-cadastrar-a-partir-da-viabilidade.md` (decisões V-1 a V-5 travadas por Diego; **V-2 corrigida em 2026-08-08 — ler também V-2-bug antes de implementar**).
**Branch:** worktree `viabilidade-cadastrar`.

---

## 1. Objetivo e escopo

Botão **"Cadastrar"** em cada linha da tela Análise de viabilidade (modo "Colar GTINs") que abre
`DialogCadastroProduto` já pré-preenchido com o que a tela já sabe. Quando o GTIN já existe em
`variacoes` da org, o botão vira **"Dar entrada"** e navega para `/estoque`.

**Pré-preenchidos** (§5.1 do spike):

| Campo do cadastro | Fonte |
|---|---|
| `nomePai` | `item.nome` (product_name do catálogo ML, já na resposta) |
| `descricaoPai` | `short_description.content` de `GET /products/{id}` — **campo NOVO**, parseado e trafegado (V-1b) |
| `gtin` | `item.gtin` |
| `custo` | input "Custo" da linha (state local) |
| `preco` | valor **cru** do input "Seu mínimo" (`minimo`) da linha — **só quando `minimo != null`**; sem mínimo, vazio. "Seu mínimo" e "Preço mínimo (líquido)" são o mesmo conceito (líquido mínimo, ADR-0020): mapeamento identidade, **sem cálculo nenhum**. Nunca `item.mercado.menor`, nunca `etiquetaParaMinimo` (V-2 corrigida + V-2-bug: a etiqueta já é gross-up, e `process-familia` aplica `grossUp` sobre `variacoes.preco` — gravar a etiqueta causaria gross-up duplo no preço publicado) |
| `pesoGramas`/`alturaCm`/`larguraCm`/`comprimentoCm` | valores digitados no `FormDimensoes` (lift de estado — ver §2, nota N1) |

**NUNCA pré-preencher:** `origem` (rádio sem seleção, salvar travado — V-3, inegociável) e
qualquer foto (V-1). `unidade` mantém o default `'UN'`; `fornecedor` e `estoqueInicial` vazios.

**Gates do botão (V-4), todos obrigatórios:** `existeNoML` && `editavel` (modo GTIN) && módulo
`'estoque'` habilitado (`useModulosHabilitados`) && `!jaCadastrado`.

**FORA do escopo:**
- Foto do catálogo (V-1 — classe do incidente Aquaphor).
- Botão "cadastrar todos" (V-5 — N cliques, mesmo lote manual via D-1.1).
- Modo planilha (`editavel === false`).
- Corrigir a alíquota 8% assumida no modo GTIN colado (registrado no spike §3.3, não é desta feature).
- Qualquer mudança em `cadastrar-produto`, `process-familia`, `publish-familia-ml` ou qualquer
  código do caminho que publica anúncio real. **A edge `cadastrar-produto` fica INTACTA.**
- Deep-link do "Dar entrada" para o SKU específico (navega para `/estoque` e ponto).

---

## 2. Arquitetura da mudança — o que trafega da edge até o formulário

Dois dados novos atravessam a pilha; todo o resto já está no navegador.

### Dado 1 — `descricaoCatalogo` (novo, vem do payload que hoje é descartado)

```
GET /products/{id}  (já é chamado hoje em _shared/ml/concorrencia.ts:102)
  └─ parse.ts: parseDescricaoCatalogo(produtoJson) → short_description.content | null
       └─ ml/concorrencia.ts: entra no ProdutoConcorrencia do hit e no cache Redis
            chave BUMPADA: cache:concorrencia:gtin:v3:{gtin} → gtin:v4:{gtin}
            └─ agregar.ts: agregarConcorrencia devolve descricao_catalogo do REPRESENTATIVO
                 (mesmo trânsito que product_name já faz hoje)
                 └─ ResultadoConcorrencia.descricao_catalogo (concorrencia/tipos.ts)
                      └─ analisar-viabilidade/index.ts: ItemAnalisado.descricaoCatalogo
                           └─ src/lib/viabilidade.ts (espelho do tipo)
                                └─ viabilidade-linha.tsx → inicial.descricaoPai
                                     └─ DialogCadastroProduto (Textarea "Descrição")
```

**Nota A (adição forçada pelo caminho do código, não invenção de escopo):** o spike lista 6
arquivos; `_shared/concorrencia/agregar.ts` é o 7º, obrigatório, porque TODO resultado de
`buscarConcorrencia` — inclusive o de 1 GTIN só — passa por `agregarConcorrencia(hits)`
(ml/concorrencia.ts:139). Sem repassar o campo ali, ele morre antes de chegar à edge. É o mesmo
trânsito que `product_name` já faz: `ProdutoConcorrencia` ganha o campo, o retorno usa o do
`representativo`. Três linhas.

### Dado 2 — `jaCadastrado` (novo, sai da query que já existe)

```
analisar-viabilidade/index.ts: buscarDimensoesSalvas
  hoje:  select('peso_gramas, altura_cm, largura_cm, comprimento_cm') de variacoes por (org_id, gtin),
         chamada SÓ quando o caller não mandou dimensões
  vira:  select('id, peso_gramas, altura_cm, largura_cm, comprimento_cm'), chamada SEMPRE
         (no ramo existeNoML), devolvendo { dimensoes, jaCadastrado } — jaCadastrado = rows.length > 0
  └─ ItemAnalisado.jaCadastrado (_shared/analise/tipos.ts + espelho em src/lib/viabilidade.ts)
       └─ viabilidade-linha.tsx: decide "Cadastrar" vs "Dar entrada"
```

- A query passa a ser **incondicional** no ramo `existeNoML` (uma linha antes do
  `dimensoesInformadas`): com dimensões informadas pelo caller (recálculo do `FormDimensoes`) a
  query hoje é pulada — mas `jaCadastrado` precisa dela sempre, senão o recálculo apagaria o
  sinal. Continua **um** round-trip, o mesmo de hoje; só deixa de ser condicional. As dimensões
  informadas continuam tendo precedência sobre as salvas.
- **Heurística de UX, não fronteira:** o casamento é por GTIN; a chave do guard D-4 é
  `codigo_pai`. O 409 da edge `cadastrar-produto` continua autoritativo e o diálogo já o trata
  (`ProdutoJaExisteError` → banner de divergência + "Abrir na Revisão"). Nada disso muda.

### Nota N1 — dimensões NÃO trafegam pela edge (verificado, e por quê)

`ItemAnalisado` não carrega os **valores** das dimensões, só `dimensoesEncontradas: boolean` — e
não vai passar a carregar. As duas fontes do spike colapsam numa só na prática:

- `buscarDimensoesSalvas` só acha dimensões quando **existe linha em `variacoes`** para o GTIN →
  `jaCadastrado === true` → o botão é "Dar entrada" e o diálogo **nunca abre**. Esse ramo não
  alimenta prefill nenhum.
- Logo, o único caminho vivo para o prefill de dimensões é o `FormDimensoes` — que é estado local
  um nível abaixo do botão (spike §1: "elas ficam no estado do componente"). Basta um **lift**:
  `FormDimensoes.onAtualizado` passa a entregar também as dimensões digitadas
  (`onAtualizado(item, dimensoes)`), e `ViabilidadeLinha` guarda `dimensoesInformadas` em state.

### Contrato da prop `inicial` do diálogo

```ts
// dialog-cadastro-produto.tsx
export interface CadastroInicial {
  nomePai?: string;
  descricaoPai?: string;
  variacao?: Partial<Pick<LinhaVariacao,
    'gtin' | 'preco' | 'custo' | 'pesoGramas' | 'alturaCm' | 'larguraCm' | 'comprimentoCm'>>;
}
// props: { aberto, onFechar, inicial?: CadastroInicial, onCadastrado?: () => void }
```

- Campos de `LinhaVariacao` são **strings** (inputs controlados). O chamador converte número →
  string com vírgula decimal: `String(n).replace('.', ',')` (aceito por `parseNumeroPtBr`, que o
  form já usa como `parseNum`).
- **Aplicação sem quebrar `src/pages/Estoque.tsx`:** o `useEffect` de reset existente (roda quando
  `aberto` vira false, preserva `chaveCadastro` em resultado ambíguo) fica **intocado**. Entra um
  segundo `useEffect` que roda quando `aberto` vira **true** e `inicial != null`: aplica
  `setNomePai/setDescricaoPai` e `setLinhas([{ ...novaLinha(), ...inicial.variacao }])`. Com
  `inicial === undefined` (Estoque.tsx) o efeito é no-op → comportamento atual byte a byte.
- **Contrato de estabilidade:** `inicial` deve ser um **snapshot estável** enquanto o diálogo está
  aberto (o chamador guarda em `useState` no clique). Se a identidade mudasse a cada render do
  pai, o efeito reaplicaria o prefill por cima do que o operador está digitando. Documentar no
  JSDoc da prop.
- `onCadastrado` é chamado em `salvar()` imediatamente após `setResultado(r)` (sucesso da edge) —
  é o que permite à linha marcar `jaCadastrado` localmente.

### Ciclo de vida do diálogo na linha

`ViabilidadeLinha` monta o diálogo **lazy e permanente**: `const [inicial, setInicial] =
useState<CadastroInicial | null>(null)`; o clique faz `setInicial(montarInicial());
setCadastroAberto(true)`; renderiza `{inicial && <DialogCadastroProduto … />}`. Uma vez montado,
não desmonta ao fechar — preserva a semântica de `chaveCadastro`/`resultadoAmbiguo` (retry
idempotente) exatamente como no Estoque, onde o diálogo é sempre montado. Segundo clique gera
snapshot novo e o efeito de abertura reaplica. O diálogo renderiza só portais (Radix), então não
suja o DOM do `<tbody>`.

### Estado local pós-sucesso (spike §6.1, "Detalhe de UI a resolver")

`ViabilidadeLinha`: `const [cadastradoLocal, setCadastradoLocal] = useState(false)`;
`jaCadastrado efetivo = item.jaCadastrado || cadastradoLocal`. `onCadastrado` seta o flag → o
botão vira "Dar entrada" na hora, sem esperar nova análise, e o 2º clique não vai morrer no 409.

### Posição do botão

Última célula da linha principal (ao lado do `StatusPill` de viabilidade), com
`onClick={(e) => e.stopPropagation()}` para não disparar o expand da linha. Visível sem expandir
— "ao lado do produto", como no pedido original.

---

## 3. Tarefas

Cada tarefa é RED → GREEN: escrever o teste, vê-lo falhar, implementar, vê-lo passar.

### T1 — `parseDescricaoCatalogo` + campo em `ResultadoConcorrencia`

**Arquivos:** `supabase/functions/_shared/concorrencia/parse.ts`,
`supabase/functions/_shared/concorrencia/tipos.ts`,
`supabase/functions/_shared/concorrencia/__tests__/parse.test.ts`

**Teste que falha primeiro** (`parse.test.ts`, describe novo `parseDescricaoCatalogo`, no estilo
dos vizinhos `parseNomeProdutoBusca`):
- `'extrai short_description.content do payload de /products/{id}'` →
  `parseDescricaoCatalogo({ short_description: { type: 'plaintext', content: 'REPARAÇÃO INTENSIVA…' } })`
  retorna a string.
- `'content ausente/vazio, short_description ausente ou payload null → null'` → `toBeNull()` para
  `{ short_description: { content: '' } }`, `{ short_description: {} }`, `{}`, `null`.

**Implementação:** função `parseDescricaoCatalogo(json: unknown): string | null` em `parse.ts`
(mesmo padrão defensivo de `parseNomeProdutoBusca`); `ResultadoConcorrencia` ganha
`descricao_catalogo?: string | null` em `tipos.ts` com JSDoc citando a origem
(`short_description.content` de `/products/{id}`, V-1b).

**Pronto quando:** os 2 testes novos passam; `pnpm test` verde.

### T2 — campo atravessa a agregação e o tipo do cache

**Arquivos:** `supabase/functions/_shared/concorrencia/agregar.ts`,
`supabase/functions/_shared/redis/cache-concorrencia.ts`,
`supabase/functions/_shared/concorrencia/__tests__/agregar.test.ts`

**Teste que falha primeiro** (`agregar.test.ts`):
- `'devolve a descricao_catalogo do produto representativo (menor preco_min)'` → dois
  `ProdutoConcorrencia` com `descricao_catalogo` distintas; asserta que o retorno traz a do que
  tem menor `preco_min` (mesma regra do `product_name`).
- `'descricao_catalogo null quando o representativo não tem (cache legado)'` → produto sem o
  campo → retorno `null`.

**Implementação:** `ProdutoConcorrencia` ganha `descricao_catalogo: string | null` (com `?? null`
onde os hits são montados, para cache legado); `agregarConcorrencia` devolve
`descricao_catalogo: representativo.descricao_catalogo ?? null`. `CacheConcorrenciaEntrada`
(cache-concorrencia.ts) ganha `descricao_catalogo?: string | null` — mudança só de tipo.

**Pronto quando:** testes novos passam; os testes existentes de `agregar.test.ts` continuam verdes
sem alteração de asserção (campo é aditivo).

### T3 — chave de cache centralizada + bump `gtin:v3` → `gtin:v4` + wiring

**Arquivos:** `supabase/functions/_shared/concorrencia/cache-chave.ts` (novo, ~4 linhas),
`supabase/functions/_shared/ml/concorrencia.ts`,
`supabase/functions/_shared/concorrencia/__tests__/cache-chave.test.ts` (novo)

**Teste que falha primeiro** (`cache-chave.test.ts`):
- `'chaveCacheGtin monta o termo com a versão vigente v4'` →
  `expect(chaveCacheGtin('7908615000244')).toBe('gtin:v4:7908615000244')`.

Este teste não é teatro: hoje o literal `gtin:v3:` aparece em **3 call sites** de
`ml/concorrencia.ts` (GET L70, tombstone L95, SET L108) — um bump parcial deixaria leitura e
escrita em versões diferentes, envenenando o cache em silêncio. Centralizar em
`chaveCacheGtin(gtin)` (módulo puro, sem imports — por isso não vai em `redis/`, que puxa o
client) transforma o bump em mudança de 1 ponto e o teste pina a versão.

**Implementação:**
1. `cache-chave.ts` exporta `chaveCacheGtin(gtin: string): string` retornando `gtin:v4:${gtin}`.
2. `ml/concorrencia.ts`: substituir os 3 literais por `chaveCacheGtin(gtin)`.
3. No worker de miss: `const descricao_catalogo = parseDescricaoCatalogo(produtoJson)` (o
   `produtoJson` **já é buscado** na L101 — zero rede nova); incluir o campo no
   `cacheConcorrenciaSet` (inclusive `descricao_catalogo: null` no tombstone) e no
   `ProdutoConcorrencia` retornado.
4. No ramo de hit de cache: repassar `cached.descricao_catalogo ?? null` para o hit.

**Consequência declarada do bump (spike §4):** invalida a concorrência cacheada de **todas as
orgs** de uma vez. Não há perda de dado (TTL de 6h; entradas v3 expiram sozinhas), mas a primeira
análise/lote pós-deploy sai mais lenta e bate mais na API do ML. Ver §8 (riscos) e §7 (deploy).

**Pronto quando:** teste novo passa; `rg "gtin:v3" supabase/functions` retorna vazio; `pnpm test`
verde.

### T4 — edge: `jaCadastrado` + `descricaoCatalogo` em `ItemAnalisado`

**Arquivos:** `supabase/functions/_shared/analise/variacao-salva.ts` (novo),
`supabase/functions/_shared/analise/tipos.ts`,
`supabase/functions/analisar-viabilidade/index.ts`,
`supabase/functions/_shared/analise/__tests__/variacao-salva.test.ts` (novo)

`index.ts` não é importável no vitest (jsr:, xlsx.mjs) — a lógica testável vai para
`_shared/analise/`, seguindo o padrão que `extrairItensAnalise` já estabelece; o `index.ts` fica
com query + fiação.

**Teste que falha primeiro** (`variacao-salva.test.ts`, função pura
`resumirVariacoesSalvas(rows): { dimensoes: DimensoesPacote | null; jaCadastrado: boolean }`):
- `'sem linhas → { dimensoes: null, jaCadastrado: false }'` com `[]`.
- `'linha com dimensões válidas → dimensoes preenchidas e jaCadastrado true'`.
- `'linha existente com dimensões inválidas/null → dimensoes null mas jaCadastrado TRUE'` — o caso
  que separa os dois sinais: produto cadastrado sem dimensão continua "já cadastrado".
- `'escolhe a primeira linha com dimensões válidas entre várias'` (preserva o comportamento do
  loop atual de `buscarDimensoesSalvas`).

**Implementação:**
1. `variacao-salva.ts`: `resumirVariacoesSalvas` reutilizando `dimensoesValidas` de
   `_shared/ml/pacote.ts` — é o corpo do loop atual de `buscarDimensoesSalvas`, extraído.
2. `_shared/analise/tipos.ts`: `ItemAnalisado` ganha `descricaoCatalogo?: string | null`
   (JSDoc: "short_description da ficha de catálogo; insumo p/ pré-preencher o cadastro, V-1b")
   e `jaCadastrado?: boolean` (JSDoc: "heurística por (org_id, gtin) em variacoes; o 409 de
   cadastrar-produto continua autoritativo").
3. `index.ts`: `buscarDimensoesSalvas` vira `buscarVariacaoSalva` — widening do select para
   `'id, peso_gramas, altura_cm, largura_cm, comprimento_cm'`, devolve
   `resumirVariacoesSalvas(data ?? [])`. Em `analisarItem`, a chamada passa a ser
   **incondicional** no ramo `existeNoML` (antes do cálculo de `dimensoes`); as dimensões
   informadas pelo caller mantêm precedência: `dimensoes = dimensoesInformadas ? item.dimensoes!
   : salva.dimensoes`. O retorno ganha `descricaoCatalogo: conc.descricao_catalogo ?? null` e
   `jaCadastrado: salva.jaCadastrado`.

**Pronto quando:** os 4 testes novos passam; `pnpm test` verde; nenhum round-trip novo ao banco
(a mesma query única, agora incondicional no ramo que antes podia pulá-la).

### T5 — front: espelho de tipos + prop `inicial`/`onCadastrado` no diálogo

**Arquivos:** `src/lib/viabilidade.ts`, `src/components/estoque/dialog-cadastro-produto.tsx`,
`src/components/estoque/__tests__/dialog-cadastro-produto.test.tsx`

**Testes que falham primeiro** (describe novo
`DialogCadastroProduto — prop inicial (pré-preenchimento da Viabilidade)`, reusando
`renderDialogCom`/`renderDialogControlado`):
- `'aplica inicial ao abrir: nome, descrição e campos da variação preenchidos'` → render com
  `inicial={{ nomePai: 'Cicaplast Baume B5+', descricaoPai: 'REPARAÇÃO…', variacao: { gtin:
  '7908615000244', preco: '70', custo: '67,57', pesoGramas: '300', alturaCm: '6', larguraCm:
  '11', comprimentoCm: '16' } }}` → asserta `getByLabelText('Nome')` com value,
  `getByLabelText('Descrição')`, `getByLabelText('GTIN da variação 1')`,
  `getByLabelText('Preço mínimo (líquido) da variação 1')` etc.
- `'inicial NÃO seleciona origem: rádios desmarcados e "Cadastrar" desabilitado'` → mesmo render
  completo acima; `getByRole('radio', { name: 'Nacional' })` e `'Importado'` com
  `checked === false`; botão `Cadastrar` disabled. **É o teste-trava da V-3.**
- `'sem inicial, o formulário abre como hoje (Estoque intacto)'` → `renderDialog()` sem a prop →
  todos os campos vazios, unidade `'UN'` (protege `src/pages/Estoque.tsx`).
- `'fechar e reabrir com inicial novo reaplica o snapshot novo'` → wrapper controlado com
  `inicial` trocado no reabrir → campos refletem o novo valor (cobre o efeito de abertura vs. o
  reset de fechamento).
- `'onCadastrado é chamado uma vez após sucesso do cadastro'` → `cadastrarProdutoMock` resolve
  `ResultadoCadastro` fake; `preencherEEnviar`; `expect(onCadastrado).toHaveBeenCalledTimes(1)`.

**Implementação:**
1. `src/lib/viabilidade.ts`: `ItemAnalisado` ganha `descricaoCatalogo?: string | null` e
   `jaCadastrado?: boolean` (espelho do `_shared/analise/tipos.ts`, como o comentário do arquivo
   já manda).
2. `dialog-cadastro-produto.tsx`: exporta `CadastroInicial` (§2); props ganham
   `inicial?: CadastroInicial` e `onCadastrado?: () => void`. Novo `useEffect` de **abertura**
   (`[aberto, inicial]`, early-return se `!aberto || !inicial`) aplicando
   `setNomePai(inicial.nomePai ?? '')`, `setDescricaoPai(inicial.descricaoPai ?? '')`,
   `setLinhas([{ ...novaLinha(), ...inicial.variacao }])`. **Não tocar** no useEffect de reset
   existente nem em `origem`/`fotosCapa`/`chaveCadastro`. `salvar()` chama `onCadastrado?.()`
   logo após `setResultado(r)`.

**Pronto quando:** 5 testes novos passam E todos os testes existentes do arquivo (ciclo de vida
da `chaveCadastro`, lote de fotos) continuam verdes sem alteração.

### T6 — `ViabilidadeLinha`: botão, gates, "Dar entrada", estado local, montagem do `inicial`

**Arquivos:** `src/components/viabilidade-linha.tsx`,
`src/components/__tests__/viabilidade-linha-cadastrar.test.tsx` (novo)

**Testes que falham primeiro** (novo arquivo; mocks: `useModulosHabilitados` →
`{ data: ['estoque'] }` por default, `useAliquotas`, e `DialogCadastroProduto` mockado capturando
props — o diálogo real já é testado em T5; render dentro de `<table><tbody>` para o `<tr>` ser
válido; item base com `existeNoML: true`, `classico`/`premium`/`mercado` preenchidos):
- `'mostra "Cadastrar" quando existeNoML && editavel && módulo estoque && !jaCadastrado'`.
- `'esconde o botão sem o módulo estoque'` → mock devolve `[]` → `queryByRole('button', { name:
  'Cadastrar' })` null.
- `'esconde o botão quando editavel=false (modo planilha)'`.
- `'mostra "Dar entrada" quando item.jaCadastrado e navega para /estoque'` → `MemoryRouter` +
  rota fake; clique → location `/estoque`; diálogo não abre.
- `'clique monta inicial com nomePai, descricaoPai, gtin e custo digitado'` → digita `67,57` no
  input Custo, clica Cadastrar → prop `inicial` capturada tem `nomePai: item.nome`,
  `descricaoPai: item.descricaoCatalogo`, `variacao.gtin: item.gtin`, `variacao.custo: '67,57'`.
- `'preco vazio sem mínimo digitado — NUNCA usa o menor do mercado'` → sem digitar mínimo, clica →
  `inicial.variacao.preco` ausente/`''` mesmo com `item.mercado.menor = 99.9`. **Teste-trava da
  V-2.**
- `'preco = mínimo CRU, e NÃO etiquetaParaMinimo (trava contra gross-up duplo, V-2-bug)'` →
  montar o item com comissão/imposto/frete que separem os dois números com folga (ex.:
  `percentual: 14`, `aliquotaPct: 8`, `frete: 10`; mínimo digitado `70` →
  `etiquetaParaMinimo(70, 14, 8, 10) ≈ 102,60`); clica → asserta **as duas pontas**:
  `inicial.variacao.preco === '70'` **e**
  `inicial.variacao.preco !== String(etiquetaParaMinimo(70, 14, 8, 10)).replace('.', ',')`.
  Se alguém "recorrigir" para a etiqueta, o teste falha nas duas asserções — `variacoes.preco` é
  o líquido mínimo (ADR-0020) e `process-familia` aplica `grossUp` em cima dele; a etiqueta já é
  gross-up, gravá-la publicaria preço regrossado (~R$ 152 para um mínimo de R$ 70).
- `'dimensões digitadas no FormDimensoes entram no inicial'` → item com
  `dimensoesEncontradas: false`, expandir, preencher os 4 campos, recalcular (mock de
  `analisarComDimensoes`), clicar Cadastrar → `variacao.pesoGramas: '300'` etc.
- `'após onCadastrado, o botão vira "Dar entrada"'` → dispara o `onCadastrado` capturado do mock →
  rerender mostra "Dar entrada". **Teste-trava do estado local (spike §6.1).**
- `'clicar no botão não expande/colapsa a linha'` → linha fechada, clique no botão → detalhe não
  abre (stopPropagation).

**Implementação:**
1. `FormDimensoes`: assinatura de `onAtualizado` vira
   `(item: ItemAnalisado, dimensoes: DimensoesPacote) => void` (lift — nota N1).
2. `ViabilidadeLinha`: `useModulosHabilitados()`, `useNavigate()`; states
   `dimensoesInformadas: DimensoesPacote | null`, `cadastradoLocal: boolean`,
   `cadastroAberto: boolean`, `inicial: CadastroInicial | null` (snapshot estável — §2).
3. Helper local `numParaInput(n: number | null | undefined): string` →
   `n != null ? String(n).replace('.', ',') : ''`.
4. `montarInicial()`: mapeamento exato da tabela do §1 deste plano; `preco: numParaInput(minimo)`
   só quando `minimo != null`, senão preco fica fora do objeto. `etiquetaParaMinimo` **não é
   chamada em lugar nenhum do prefill**. **Comentário obrigatório no código de produção**, junto
   ao mapeamento do preco (texto a manter na implementação):
   `// preco = mínimo CRU, não a etiqueta: variacoes.preco é o líquido mínimo (ADR-0020) e
   // process-familia aplica grossUp em cima dele — etiquetaParaMinimo já é gross-up, gravá-la
   // publicaria preço regrossado (spike 037, V-2-bug). Não "corrigir" para a etiqueta.`
5. Botão na última célula da linha principal: rótulo `Cadastrar` | `Dar entrada` conforme
   `item.jaCadastrado || cadastradoLocal`; `size="sm" variant="outline"`; visível só com os 4
   gates; "Dar entrada" → `navigate('/estoque')`.
6. `{inicial && <DialogCadastroProduto aberto={cadastroAberto} inicial={inicial}
   onFechar={() => setCadastroAberto(false)} onCadastrado={() => setCadastradoLocal(true)} />}`
   após o fragment das `<tr>` (renderiza só portal — DOM do tbody intacto).

**Sem mudanças em** `src/pages/Viabilidade.tsx` e `src/hooks/useModulosHabilitados.ts` — foram
lidos e não precisam de nada (o `editavel` já desce; o hook já existe e é usado como está).

**Pronto quando:** os 10 testes novos passam; `pnpm lint` e `pnpm test` verdes.

### T7 — verificação integrada + documentação

**Arquivos:** `docs/reference/edge-functions.md` (resposta de `analisar-viabilidade` ganha
`descricaoCatalogo`/`jaCadastrado`; nota do bump `gtin:v4`), `docs/TASKS.md`,
`obsidian-vault/` (fluxo do operador da Viabilidade → cadastro, se o vault documenta a tela).

Rodar o roteiro completo da seção 6 (testes, lint, validação visual). Nenhum teste novo — é o
gate de saída.

**Pronto quando:** roteiro da seção 6 cumprido, docs atualizadas no mesmo commit da entrega.

### T8 — deploy das edge functions (cascata `_shared/`)

Seção 7 na íntegra. Só depois do merge com CI verde.

---

## 4. Ordem de execução e dependências

```
T1 ─→ T2 ─→ T3 ─→ T4 ─┐
                       ├─→ T7 ─→ T8
T5 ─→ T6 ─────────────┘
```

- **Cadeia backend (T1→T2→T3→T4):** cada uma consome o tipo/campo da anterior. T4 depende de T3
  porque `conc.descricao_catalogo` só existe com o wiring feito.
- **Cadeia front (T5→T6):** T6 consome `CadastroInicial`/`onCadastrado` de T5. A cadeia front é
  **paralela** à backend — os tipos do front são espelhos manuais (`viabilidade.ts` declara isso),
  então T5/T6 podem rodar antes de T4 existir; `descricaoCatalogo` chega `undefined` até lá e o
  prefill degrada para vazio.
- T7 exige tudo; T8 exige T7 (nunca deployar sem validação visual e testes verdes).

## 5. Roteamento de modelo por tarefa

| Tarefa | Modelo | Por quê |
|---|---|---|
| T1, T2, T3 | sonnet | implementação já planejada, testes nomeados, escopo fechado |
| T4 | sonnet | idem; a decisão de arquitetura (query incondicional, helper em `_shared/analise/`) já está tomada aqui |
| T5, T6 | sonnet | implementação de UI com testes prescritos; **atenção**: T5/T6 carregam as travas V-2 e V-3 (campo financeiro `preco`, `origem`) — os testes-trava são inegociáveis e revisão final no loop principal (opus) antes do commit |
| T7 | loop principal (opus) | validação visual + conferência de docs + revisão das travas financeiras |
| T8 | loop principal (opus) | deploy toca produção e invalida cache global — não delegar |

Nenhuma tarefa envolve migration, RLS ou o caminho de publicação — mas `preco`/`origem` são
financeiros por tabela do CLAUDE.md: os testes-trava de V-2/V-3 não podem ser afrouxados por
nenhum executor.

## 6. Plano de verificação

**Automatizada (a cada tarefa e no fim):**
```bash
pnpm lint
pnpm test            # exige .env.test (copiar no worktree, senão supabase.ts lança no boot)
```
Suítes que TÊM que continuar verdes além das novas: `dialog-cadastro-produto.test.tsx` (ciclo da
chaveCadastro, fotos), `parse.test.ts`, `agregar.test.ts`, `analise-viabilidade.test.ts`.

**Visual (obrigatória antes de commit/merge — skill playwright-cli/browser-use, screenshots
reais, não só snapshot de acessibilidade):**

1. Copiar `.env.local` para o worktree, `pnpm dev`.
2. A conta VALIDATION_* está em org sem os produtos — **injetar a resposta da edge** via
   `playwright-cli route` no endpoint `**/functions/v1/analisar-viabilidade` + `reload` (senão o
   react-query serve cache). Preparar 3 payloads de `RespostaAnalise`:
   a. item com `existeNoML: true`, `descricaoCatalogo` longa, `jaCadastrado: false`,
      `dimensoesEncontradas: false`;
   b. mesmo item com `jaCadastrado: true`;
   c. item com `existeNoML: false`.
3. Roteiro em `/viabilidade`, aba **Colar GTINs**, GTIN `7908615000244`, Pesquisar:
   - payload (a): botão **"Cadastrar"** visível na linha; clicar **não** expande a linha;
   - clicar Cadastrar → diálogo abre com Nome e Descrição da ficha, GTIN preenchido; **origem sem
     seleção e botão "Cadastrar" do diálogo desabilitado**; fotos vazias; screenshot;
   - fechar; expandir a linha; digitar Custo `67,57` e Seu mínimo `60`; preencher as 4 dimensões
     no FormDimensoes e Recalcular; clicar Cadastrar → conferir **1:1 com a tela**: campo
     "Preço mínimo (líquido)" do diálogo == `60` — o valor **cru** digitado em "Seu mínimo", e
     **explicitamente diferente** do número que a linha exibe em "Pra receber seu mínimo, anuncie
     a" (esse é a etiqueta grossada; se aparecer no diálogo, é o bug V-2-bug) — mais custo e
     peso/altura/largura/comprimento; screenshot;
   - sem mínimo digitado: reabrir → campo preço **vazio** (nunca 99,90 do mercado);
   - payload (b): linha mostra **"Dar entrada"**; clicar navega para `/estoque`;
   - payload (c): nenhum botão;
   - mock de módulos: org sem `'estoque'` (interceptar a RPC `modulos_habilitados_da_org` → `[]`)
     → nenhum botão.
4. (Pós-deploy, org real do Diego, leitura apenas) uma análise de GTIN conhecido: conferir
   descrição real da ficha no diálogo e log da edge sem erro. **Nenhum salvamento em produção sem
   Diego presente** — o fluxo completo até a Revisão é validação dele.

## 7. Plano de deploy

Push/merge na main **não** deploya Edge Functions — deploy é etapa obrigatória da entrega
(incidente 2026-07-24).

1. **Mapear a cascata com `deno info` — nunca com grep** (ADR-0087, incidente real):
   ```bash
   cd supabase/functions
   for d in */; do
     fn="${d%/}"; [ -f "$d/index.ts" ] || continue
     deno info "$d/index.ts" 2>/dev/null | grep -q -E \
       "concorrencia/(parse|tipos|agregar|cache-chave)\.ts|ml/concorrencia\.ts|redis/cache-concorrencia\.ts|analise/tipos\.ts|analise/variacao-salva\.ts" \
       && echo "$fn"
   done
   ```
   Candidatos esperados pelo grafo de imports diretos: **`analisar-viabilidade`** (também mudou o
   próprio index.ts) e **`process-familia`** (importa `buscarConcorrencia`). A saída do `deno info`
   é a autoridade — se aparecer mais função (import transitivo), ela entra na lista.
2. Deploy via CLI completa, uma a uma: `supabase functions deploy <fn>` para **todas** as listadas.
3. **Conferir a versão pós-deploy** de cada função (dashboard/`supabase functions list`) — regra
   do CLAUDE.md para mudanças em `_shared/`.
4. Janela: fora de pico (o bump v4 força miss geral — primeira análise/lote de cada org depois do
   deploy fica mais lenta e consome mais cota da API do ML; auto-resolve em uma passada, TTL 6h).
5. Smoke pós-deploy: passo 4 da seção 6.
6. Fluxo git: branch → CI verde (`frontend`, `backend-lint`) → merge → deletar branch → remover
   worktree.

## 8. Riscos e o que pode dar errado

| # | Risco | Mitigação |
|---|---|---|
| 1 | **Bump v4 invalida o cache de concorrência de todas as orgs** — primeira análise pós-deploy lenta, mais chamadas à API do ML (rate limit). | Deploy fora de pico (§7.4); miss se auto-resolve; `POOL_CONCORRENCIA=6` já limita o paralelismo. |
| 2 | **Função esquecida na cascata `_shared/`** continua gravando `gtin:v3` — sem corrupção (chaves distintas, campo aditivo), mas cache rachado e chamadas ML dobradas até o TTL. | `deno info` como autoridade (§7.1) + conferência de versão pós-deploy (§7.3). |
| 3 | **Efeito de abertura reaplica o prefill por cima do que o operador digita** se `inicial` mudar de identidade com o diálogo aberto. | Contrato de snapshot estável (`useState` no clique, §2) + teste `'fechar e reabrir com inicial novo reaplica o snapshot novo'` + JSDoc na prop. |
| 4 | **Regressão no Estoque.tsx** (uso atual sem `inicial`). | Efeito de abertura é no-op sem a prop; teste explícito `'sem inicial, o formulário abre como hoje'`; suíte existente do diálogo intocada e verde. |
| 5 | **`origem` pré-preenchida por descuido de executor** (repetiria o incidente ORIGEM de 2026-07-14; ADR-0055/0107). | `CadastroInicial` **não tem** campo `origem` (impossível por tipo); teste-trava V-3 em T5; revisão opus antes do commit. |
| 6 | **Fallback para `item.mercado.menor` no preco** quando `minimo == null` — preço do concorrente entraria num campo com cara de valor calculado. | `minimo == null` → preco fora do objeto; teste-trava V-2 em T6 (`'preco vazio sem mínimo digitado'`). |
| 7 | **Regressão do gross-up duplo (V-2-bug):** um leitor futuro "corrige" o prefill para `etiquetaParaMinimo` por parecer "o número que a Viabilidade calcula" — mas `variacoes.preco` é o líquido mínimo (ADR-0020) e `process-familia/index.ts:419` aplica `grossUp` em cima dele; a etiqueta já é gross-up, e o anúncio sairia regrossado (mínimo R$ 70 → publicado ~R$ 152), silencioso e plausível (classe do incidente ORIGEM). | Três travas: teste de T6 com caso numérico onde mínimo ≠ etiqueta (falha se trocarem), comentário obrigatório no código citando ADR-0020/V-2-bug (T6.4), e a linha V-2-bug registrada no spike 037. |
| 8 | **`jaCadastrado` é heurística por GTIN** — falso negativo (produto cadastrado sem GTIN na variação) leva ao 409. | O diálogo já trata `ProdutoJaExisteError` (banner + "Abrir na Revisão"); nada a fazer além de não remover esse tratamento. |
| 9 | **Ficha sem `short_description`** (payload antigo/incompleto) → `descricaoCatalogo: null`. | Prefill degrada para Descrição vazia — comportamento de hoje; nenhum erro. |
| 10 | **`descricao_catalogo` some no caminho** por esquecer o repasse em `agregar.ts` (arquivo fora da lista do spike). | Nota A do §2 documenta a necessidade; teste de T2 falha se o repasse faltar. |
| 11 | **Query incondicional em T4** muda o perfil de acesso: 1 select por item analisado mesmo com dimensões informadas. | Mesmo custo unitário de hoje (select por índice `(org_id, gtin)`, limit 5); era condicional só como acidente do fluxo antigo. |
| 12 | **Resíduo aceito do spike (V-1b):** `validarSlotsAncorados` passa a receber permissão de marca vinda de texto do ML. | Decisão registrada no spike §7.2 — consequência conhecida, nenhuma ação neste plano. |
