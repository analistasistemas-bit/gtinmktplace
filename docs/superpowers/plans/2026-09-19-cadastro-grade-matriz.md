# Cadastro em grade — matriz Cor × Tamanho — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar a lista vertical de cards do cadastro em grade por uma matriz Cor × Tamanho tipo mini-planilha, com 4 modos de edição, preenchimento em massa, navegação por teclado e um drawer de detalhes por SKU — sem tocar no modelo de dados nem no payload enviado à edge.

**Architecture:** A matriz é **uma view nova sobre o array `linhas` que o dialog já possui**, não um modelo novo. `src/lib/cadastro-grade.ts` ganha 3 funções puras (`ordenarEixos`, `totaisDaGrade`, `aplicarEmMassa`) e **nenhuma alteração de assinatura pública** em `resolverLinha`/`reconciliarGrade`. `src/components/estoque/linha-grade-form.tsx` é substituído por três componentes novos (`matriz-grade.tsx`, `detalhes-sku.tsx`, `preencher-em-massa.tsx`) que reaproveitam `ui/table.tsx`, `ui/tabs.tsx`, `ui/sheet.tsx`, `ui/popover.tsx` e `ui/radio-group.tsx`, todos já presentes no projeto.

**Tech Stack:** React 19 + TypeScript, Vite, Tailwind v4, shadcn/ui (Radix), vitest + @testing-library/react + @testing-library/user-event.

**Spec:** `docs/superpowers/specs/2026-09-19-cadastro-grade-matriz-design.md`
(o spec anterior, `docs/superpowers/specs/2026-09-19-cadastro-grade-roupa-calcado-design.md`, continua valendo para tudo que não seja apresentação.)

---

## Global Constraints

Valem para **todas** as tasks. Um requisito de task nunca revoga um destes.

1. **`resolverLinha` e `reconciliarGrade` não mudam de assinatura pública.** `LinhaGrade`, `LinhaResolvida`, `CamposHerdaveis`, `CAMPOS_HERDAVEIS`, `chaveGrade`, `novaLinhaGrade`, `totalDaGrade` e `Reconciliacao` ficam exatamente como estão. As 3 funções novas são ADIÇÕES ao mesmo arquivo.
2. **Casamento posicional é a única fonte de verdade.** `linhas[i] ↔ resolvidas[i]`. A matriz **não tem estado próprio de linhas**: deriva `Map<chaveGrade, índice>` a cada render a partir de `linhas`. Nenhum componente novo guarda cópia de linha, índice, cor ou tamanho em `useState`.
3. **Trava central de congelamento (fix do commit `f4a6df68` replicado).** Toda função do dialog que altera **contagem ou ordem** de `linhas` abre com `if (api.salvando) return;`. Lista fechada, **7 pontos de entrada**: `mudarCores`, `mudarTamanhos`, `removerLinha`, `reincluirLinha`, `aplicarMassa`, `trocarTipo` **e o `useEffect` de reconciliação** (`dialog-cadastro-grade.tsx:137-157`). O efeito é o que mais mexe em ordem: a partir da Task 1 ele depende de `tipoEscolhido`, que vem de `useTiposProdutoHabilitados` (react-query) — um refetch durante o salvamento que mude os tipos da org recalcularia `ordenarEixos` e **reordenaria `linhas` no meio do save**. `EtapaFotos` casa por índice (`arquivoPorIndice(i)`, `onPatchFotoLinha(i)`) e o único guard existente (`batem`) compara **contagem**, não ordem — a foto iria para o SKU errado, em silêncio. O `desabilitado`/`disabled` nos componentes é **affordance**, não a trava: a trava vive no dono do estado. Nunca patch por ponto de entrada.
4. **Nunca gerar GTIN automaticamente.** Nem em `aplicarEmMassa`, nem no drawer, nem na matriz. Não existe botão "gerar GTIN" em lugar nenhum desta entrega.
5. **Célula vazia após digitar continua sendo override.** Apagar o texto de uma célula herdável NÃO volta a herdar: vira override `''`. Voltar a herdar é só por ação explícita (botão na célula, radio no drawer, ou "Voltar ao herdado" no preencher em massa). Mesma regra que `resolverLinha` já usa para `foto` (presença da chave em `overrides` é a decisão, não o conteúdo).
6. **Digitar numa célula herdada cria o override com o TEXTO DIGITADO**, nunca com o valor resolvido semeado antes. Não existe estado "travado" prévio na matriz.
7. **Teto de `LIMITE_VARIACOES_GERADAS = 60` (ADR-0094) sem virtualização.** A matriz renderiza todas as células. Nada de `react-window`/`react-virtual`.
8. **`src/lib/` não importa de `src/components/`.** As funções puras recebem as ordens canônicas por parâmetro. (Motivo da única divergência de assinatura em relação ao spec — ver "Divergências".)
9. **Fora de escopo nesta entrega (v1.1):** colar da área de transferência, seleção múltipla de células, validação de dígito verificador de GTIN, estado de salvamento por célula, edição de grade já publicada. Não implementar, não deixar hook preparado, não deixar TODO.
9a. **Também fora de escopo, e registrado de propósito:** layout de viewport estreito (celular/tablet). Uma grade de 15 cores × 10 numerações num `sm:max-w-5xl` rola na horizontal e ponto — o cadastro em grade é operação de desktop (é onde o operador está, com a planilha do fornecedor aberta ao lado). Não inventar layout responsivo alternativo; a validação visual da entrega é em desktop.
10. **`TODO`, `test.skip` e stub são bloqueadores, não entrega.** Toda task termina com a suíte verde.
11. **Prefixo `sm:` obrigatório em qualquer `max-w-*` aplicado ao `DialogContent`** deste dialog: o default do componente é `sm:max-w-sm` e `max-w-5xl` sem o mesmo prefixo não vence a cascata (tailwind-merge trata como grupos diferentes). Já é o padrão na linha 331 do arquivo atual.
12. **Comentários em português**, no estilo do arquivo que está sendo editado (explicam *por quê*, não *o quê*).

---

## Contrato de `aria-label` (fonte única — toda task cita daqui, ninguém reinventa)

`nome` = `` `${cor} · ${tamanho}` `` (ex.: `Preto · P`). `rotulo` vem de `ROTULOS[campo].rotulo`.

| Elemento | `aria-label` exato | Nasce na |
|---|---|---|
| Botão de modo (role `button`, com `aria-pressed`) | `Estoque` / `GTIN` / `Preço` / `Custo` | Task 4 |
| Célula, modo Estoque | `` `Estoque inicial de ${nome}` `` | Task 4 |
| Célula, modo GTIN | `` `GTIN de ${nome}` `` | Task 4 |
| Célula, modo Preço | `` `Preço mínimo (líquido) de ${nome}` `` | Task 4 |
| Célula, modo Custo | `` `Custo de ${nome}` `` | Task 4 |
| Botão "voltar ao herdado" na célula | `` `Voltar a herdar ${rotulo} de ${nome}` `` | Task 4 |
| Botão remover na célula | `` `Remover ${nome}` `` | Task 4 |
| Botão detalhes na célula | `` `Detalhes de ${nome}` `` | Task 5 |
| Campos dentro do drawer | `` `${rotulo}${sufixo ? ` (${sufixo})` : ''} de ${nome}` `` | Task 5 |
| Radio do drawer | `` `Herdar do produto — ${rotulo}` `` / `` `Usar valor específico — ${rotulo}` `` | Task 5 |
| Botão "+" de célula removida | `` `Reincluir ${nome}` `` | Task 6 |
| Cabeçalho de linha (cor) | `` `Preencher em massa na cor ${cor}` `` | Task 8 |
| Cabeçalho de coluna (tamanho) | `` `Preencher em massa no tamanho ${tamanho}` `` | Task 8 |
| Botão geral de massa | `Preencher em massa` | Task 8 |

**Colisão conhecida:** os rótulos de Preço e Custo do drawer são idênticos aos das células de Preço e Custo da matriz. Com o drawer aberto, `screen.getByLabelText('Preço mínimo (líquido) de Azul · M')` acha **dois** elementos. Toda consulta em teste que abre o drawer usa `within(screen.getByRole('dialog'))`. Está escrito assim nas tasks 5 e 8 — não "consertar" mudando o rótulo.

---

## Divergências em relação ao spec (deliberadas, registradas)

**D1 — terceiro parâmetro de `ordenarEixos`.** O spec escreve `ordenarEixos(cores, tamanhos, ordemCanonica: string[])`. São necessárias **duas** ordens canônicas (cores e tamanhos) e `src/lib/` não pode importar `CORES_POPULARES` de `src/components/estoque/gerador-variacoes.tsx` (Global Constraint 8). Assinatura real: terceiro parâmetro é `{ cores: readonly string[]; tamanhos: readonly string[] }`.

**D2 — "os 27 testes existentes continuam passando com os mesmos `aria-label`" é parcialmente falso.** Os `aria-label` de célula (`GTIN de …`, `Estoque inicial de …`, `Preço mínimo (líquido) de …`) sobrevivem intactos. Mas `screen.getByText('Preto · P')` — usado como "existe uma linha dessa combinação" em 8 testes de `dialog-cadastro-grade.test.tsx` — **não tem nó de texto numa matriz** (a cor vira cabeçalho de linha, o tamanho vira cabeçalho de coluna). A Task 4 traz a tabela de conversão assertiva-a-assertiva. O fluxo `Editar nesta linha` → `Destravar …` também desaparece (o cadeado não existe na matriz) e é reescrito na Task 4.

**D3 — o botão "Remover" fica na célula, não dentro do drawer.** Mantém o `aria-label` `Remover ${nome}` intacto (o teste de congelamento existente passa sem edição) e evita um botão morto na Task 4, antes de o drawer existir. Célula tem dois ícones (remover + detalhes), ambos revelados por hover/foco (`opacity-0 group-hover:opacity-100 focus-visible:opacity-100`) — continuam no DOM e portanto consultáveis por testing-library.

**D4 — Tasks 4 e 5 do esboço do Fable estão fundidas** (matriz + tabs de modo + herança na célula). Uma matriz só de Estoque deixaria o teste `override de uma linha vence o cabeçalho no payload` sem caminho verde entre as duas tasks — e `test.skip` é bloqueador (CLAUDE.md). O plano tem 10 tasks; a numeração abaixo é a definitiva.

**D5 — os "modos" são um grupo de botões `aria-pressed`, não `<Tabs>` do Radix.** O spec fala em "Tabs de modo". A aparência é idêntica (o componente exporta `tabsListVariants`/`tabsTriggerClassName` exatamente para isto), mas a semântica de `tab` exige um painel por aba, e aqui a MESMA tabela serve os 4 modos. Um `TabsTrigger` sem `TabsContent` emite `aria-controls` apontando para um id inexistente — e é a saída que `src/components/ui/tabs.tsx:58-60` documenta no próprio código. Consequência para os testes: `getByRole('button', { name: 'GTIN' })`, nunca `getByRole('tab', …)`.

**D6 — uma instância de `PreencherEmMassa` por gatilho.** `ui/popover.tsx` não exporta `PopoverAnchor`, então um Popover único reposicionado não é possível sem editar o componente de UI. Cada cabeçalho renderiza o seu (o `PopoverContent` do Radix só monta quando aberto: custo ~zero). O seletor de escopo dentro do popover continua existindo, conforme o spec — o gatilho só o pré-seleciona.

---

## File Structure

**Criados:**
- `src/components/estoque/matriz-grade.tsx` — a matriz. `<table>` com linhas = cores, colunas = tamanhos + coluna Total, `<tfoot>` com a linha Total. Tabs de modo. Teclado. Célula = `<Input>` + 2 ícones. Não tem estado de linhas; só `modo` (string) e `detalhes` (clientId aberto).
- `src/components/estoque/detalhes-sku.tsx` — `Sheet` com os 6 campos herdáveis por SKU, radio herdar/específico. Herda o conteúdo do bloco expandido de `linha-grade-form.tsx`.
- `src/components/estoque/preencher-em-massa.tsx` — `Popover` com escopo + campo + valor + ações.
- `src/components/estoque/__tests__/matriz-grade.test.tsx`
- `src/components/estoque/__tests__/detalhes-sku.test.tsx`
- `src/components/estoque/__tests__/preencher-em-massa.test.tsx`

**Modificados:**
- `src/lib/cadastro-grade.ts` — +`ordenarEixos`, +`totaisDaGrade`, +`aplicarEmMassa`, +tipos `EscopoMassa`/`OpcoesMassa`/`TotaisGrade`/`OrdemCanonica`.
- `src/lib/__tests__/cadastro-grade.test.ts` — +3 describes.
- `src/components/estoque/dialog-cadastro-grade.tsx` — aplica `ordenarEixos` antes de `reconciliarGrade`; troca o `linhas.map(LinhaGradeForm)` por `<MatrizGrade>`; ganha `reincluirLinha` e `aplicarMassa`; passa a consumir `totaisDaGrade`; ganha as travas centrais.
- `src/components/estoque/__tests__/dialog-cadastro-grade.test.tsx` — assertivas adaptadas (tabela na Task 4) + testes novos.
- `docs/decisions/0166-tipo-de-produto-por-organizacao.md` — amendment.

**Movido para `ROTULOS` compartilhado:** `ROTULOS` sai de `linha-grade-form.tsx` (que é apagado na Task 5) e passa a ser exportado por `detalhes-sku.tsx`. `dialog-cadastro-grade.tsx` e `matriz-grade.tsx` importam de lá.

**Apagados (Task 5):**
- `src/components/estoque/linha-grade-form.tsx`
- `src/components/estoque/__tests__/linha-grade-form.test.tsx` (conteúdo portado para `detalhes-sku.test.tsx`)

---

## Interfaces públicas novas (referência para todas as tasks)

```ts
// src/lib/cadastro-grade.ts
export interface OrdemCanonica { cores: readonly string[]; tamanhos: readonly string[] }

export function ordenarEixos(
  cores: ReadonlySet<string>,
  tamanhos: ReadonlySet<string>,
  ordemCanonica: OrdemCanonica,
): { cores: string[]; tamanhos: string[] };

export interface TotaisGrade {
  porCor: Record<string, number>;
  porTamanho: Record<string, number>;
  geral: number;
  semGtin: number;
}

export function totaisDaGrade(
  resolvidas: readonly LinhaResolvida[],
  cores: readonly string[],
  tamanhos: readonly string[],
): TotaisGrade;

export type CampoMassa = 'estoqueInicial' | 'gtin' | CampoHerdavel;
export type EscopoMassa =
  | { tipo: 'todos' }
  | { tipo: 'cor'; valor: string }
  | { tipo: 'tamanho'; valor: string };
export interface OpcoesMassa { campo: CampoMassa; escopo: EscopoMassa; valor: string | null }

export function aplicarEmMassa(
  linhas: readonly LinhaGrade[],
  opts: OpcoesMassa,
): LinhaGrade[];
```

```tsx
// src/components/estoque/matriz-grade.tsx
export type ModoGrade = 'estoqueInicial' | 'gtin' | 'preco' | 'custo';

export function MatrizGrade(props: {
  linhas: readonly LinhaGrade[];
  resolvidas: readonly LinhaResolvida[];
  cores: readonly string[];       // eixo JÁ ordenado por ordenarEixos
  tamanhos: readonly string[];    // idem
  removidas: ReadonlySet<string>;
  tentouSalvar: boolean;
  desabilitado: boolean;
  onMudarLinha: (clientId: string, patch: Partial<Pick<LinhaGrade, 'gtin' | 'estoqueInicial'>>) => void;
  onMudarOverride: (clientId: string, campo: CampoHerdavel, valor: string) => void;
  /** Acrescentada na Task 5 (drawer): semeia o override com o valor resolvido. */
  onDestravar: (clientId: string, campo: CampoHerdavel) => void;
  onVoltarAHerdar: (clientId: string, campo: CampoHerdavel) => void;
  onRemoverCelula: (cor: string, tamanho: string) => void;
  onReincluirCelula: (cor: string, tamanho: string) => void;
  onAplicarMassa: (opts: OpcoesMassa) => void;
}): JSX.Element;
```

```tsx
// src/components/estoque/detalhes-sku.tsx
export const ROTULOS: Record<CampoHerdavel, { rotulo: string; prefixo?: string; sufixo?: string }>;

export function DetalhesSku(props: {
  linha: LinhaGrade | null;        // null = fechado
  resolvida: LinhaResolvida | null;
  tentouSalvar: boolean;
  desabilitado: boolean;
  onFechar: () => void;
  onMudarOverride: (campo: CampoHerdavel, valor: string) => void;
  onDestravar: (campo: CampoHerdavel) => void;
  onVoltarAHerdar: (campo: CampoHerdavel) => void;
}): JSX.Element;
```

```tsx
// src/components/estoque/preencher-em-massa.tsx
export function PreencherEmMassa(props: {
  escopoInicial: EscopoMassa;
  cores: readonly string[];
  tamanhos: readonly string[];
  desabilitado: boolean;
  gatilho: React.ReactNode;        // conteúdo do PopoverTrigger
  rotuloGatilho: string;           // aria-label do trigger
  onAplicar: (opts: OpcoesMassa) => void;
}): JSX.Element;
```

---

## Comandos

- Rodar um arquivo de teste: `pnpm vitest run src/lib/__tests__/cadastro-grade.test.ts`
- Rodar um teste isolado: `pnpm vitest run src/lib/__tests__/cadastro-grade.test.ts -t "nome do teste"`
- Suíte inteira: `pnpm test`
- Portão de pré-push: `pnpm preflight:static` (~27s). Roda **uma vez no fim**, não por task.
- Git neste worktree: usar `/usr/bin/git` (o hook RTK barra `git` composto).

---

## Task 1: `ordenarEixos` + ordem canônica na reconciliação

**Files:**
- Modify: `src/lib/cadastro-grade.ts` (acrescenta ao fim do arquivo)
- Test: `src/lib/__tests__/cadastro-grade.test.ts`
- Modify: `src/components/estoque/dialog-cadastro-grade.tsx:137-157` (o `useEffect` da reconciliação)
- Test: `src/components/estoque/__tests__/dialog-cadastro-grade.test.tsx`

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: `ordenarEixos(cores, tamanhos, ordemCanonica)` e o tipo `OrdemCanonica`, usados pela Task 4 (eixos da matriz) e pelo dialog.

- [ ] **Step 1: Escrever o teste unitário que falha**

Acrescentar ao fim de `src/lib/__tests__/cadastro-grade.test.ts`:

```ts
describe('ordenarEixos', () => {
  const ORDEM = {
    cores: ['Preto', 'Branco', 'Cinza'] as const,
    tamanhos: ['P', 'M', 'G', 'GG'] as const,
  };

  // O bug latente que esta função corrige: `Set` preserva ORDEM DE CLIQUE, e o operador que
  // marcou G antes de P via a coluna "G, M, P". Na lista de cards ninguém percebia.
  it('tamanho marcado fora de ordem sai na ordem canônica', () => {
    const r = ordenarEixos(new Set(['Preto']), new Set(['G', 'P', 'M']), ORDEM);
    expect(r.tamanhos).toEqual(['P', 'M', 'G']);
  });

  it('cor marcada fora de ordem sai na ordem de CORES_POPULARES', () => {
    const r = ordenarEixos(new Set(['Cinza', 'Preto']), new Set(['P']), ORDEM);
    expect(r.cores).toEqual(['Preto', 'Cinza']);
  });

  // Cor personalizada não está na lista canônica: ordem de inserção do Set é a única ordem
  // estável que existe para ela, e é a ordem em que o operador digitou.
  it('cor personalizada vai depois das populares, na ordem em que foi inserida', () => {
    const cores = new Set<string>();
    cores.add('Vinho'); cores.add('Branco'); cores.add('Caqui'); cores.add('Preto');
    const r = ordenarEixos(cores, new Set(['P']), ORDEM);
    expect(r.cores).toEqual(['Preto', 'Branco', 'Vinho', 'Caqui']);
  });

  it('eixo vazio devolve array vazio, sem inventar valor', () => {
    expect(ordenarEixos(new Set(), new Set(['P']), ORDEM)).toEqual({ cores: [], tamanhos: ['P'] });
  });

  // Numeração de calçado: a ordem canônica é a da lista, não a alfabética nem a numérica —
  // '33/34' vem DEPOIS de '46' em NUMERACOES_CALCADO, e ordenar por número quebraria isso.
  it('respeita a ordem da lista, não a ordem numérica', () => {
    const ordem = { cores: ['Preto'] as const, tamanhos: ['39', '40', '39/40'] as const };
    const r = ordenarEixos(new Set(['Preto']), new Set(['39/40', '40', '39']), ordem);
    expect(r.tamanhos).toEqual(['39', '40', '39/40']);
  });
});
```

Acrescentar `ordenarEixos` ao import do topo do arquivo:

```ts
import {
  chaveGrade, novaLinhaGrade, ordenarEixos, reconciliarGrade, resolverLinha, totalDaGrade,
  type CamposHerdaveis,
} from '@/lib/cadastro-grade';
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm vitest run src/lib/__tests__/cadastro-grade.test.ts -t "ordenarEixos"`
Expected: FAIL — `ordenarEixos is not a function` / erro de tipo no import.

- [ ] **Step 3: Implementar**

Acrescentar ao fim de `src/lib/cadastro-grade.ts`:

```ts
/** Ordem canônica de cada eixo. Vem por PARÂMETRO porque `src/lib` não importa de
 *  `src/components` — `CORES_POPULARES` mora em `gerador-variacoes.tsx` e os tamanhos vêm de
 *  `opcoesDeTamanho`, que depende do tipo habilitado na org. */
export interface OrdemCanonica { cores: readonly string[]; tamanhos: readonly string[] }

function porOrdem(valores: ReadonlySet<string>, canonica: readonly string[]): string[] {
  // Duas passadas, não um `sort` com `indexOf`: o que NÃO está na lista canônica precisa manter a
  // ordem de inserção do `Set` (é a ordem em que o operador digitou a cor personalizada), e um
  // comparador com `-1` para ausentes embaralharia justamente esse grupo.
  const naLista = canonica.filter((v) => valores.has(v));
  const fora = [...valores].filter((v) => !canonica.includes(v));
  return [...naLista, ...fora];
}

/** Ordena os dois eixos da grade. Corrige um bug latente: `[...cores]`/`[...tamanhos]` preservam
 *  ORDEM DE CLIQUE, então marcar G antes de P produzia a sequência "G, M, P". Na lista de cards
 *  passava despercebido; em colunas de matriz fica visível e errado. Aplicada ANTES de
 *  `reconciliarGrade`, ela fixa a ordem de `linhas` também — e portanto a dos códigos de SKU. */
export function ordenarEixos(
  cores: ReadonlySet<string>,
  tamanhos: ReadonlySet<string>,
  ordemCanonica: OrdemCanonica,
): { cores: string[]; tamanhos: string[] } {
  return {
    cores: porOrdem(cores, ordemCanonica.cores),
    tamanhos: porOrdem(tamanhos, ordemCanonica.tamanhos),
  };
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm vitest run src/lib/__tests__/cadastro-grade.test.ts`
Expected: PASS (todos, inclusive os antigos).

- [ ] **Step 5: Escrever o teste de dialog que falha**

Acrescentar ao describe `DialogCadastroGrade — passo 2 (seleção) reconcilia a grade` em `src/components/estoque/__tests__/dialog-cadastro-grade.test.tsx`:

```tsx
  // Ordem de CLIQUE não pode virar ordem de LINHA: `Set` preserva inserção, e sem `ordenarEixos`
  // marcar G antes de P produzia "Preto · G" antes de "Preto · P" — e o mesmo desalinho nos
  // códigos de SKU reservados. (Esta assertiva é reescrita na Task 4 para a ordem das COLUNAS.)
  it('ordem de clique não decide a ordem da grade — a ordem canônica decide', async () => {
    const user = userEvent.setup();
    renderGrade();
    await user.click(screen.getByRole('checkbox', { name: 'Preto' }));
    await user.click(screen.getByRole('checkbox', { name: 'G' }));
    await user.click(screen.getByRole('checkbox', { name: 'P' }));
    const textos = screen.getAllByText(/^Preto · /).map((e) => e.textContent);
    expect(textos).toEqual(['Preto · P', 'Preto · G']);
  });
```

- [ ] **Step 6: Rodar e confirmar que falha**

Run: `pnpm vitest run src/components/estoque/__tests__/dialog-cadastro-grade.test.tsx -t "ordem de clique"`
Expected: FAIL — recebido `['Preto · G', 'Preto · P']`.

- [ ] **Step 7: Aplicar `ordenarEixos` no dialog**

Em `src/components/estoque/dialog-cadastro-grade.tsx`, acrescentar `ordenarEixos` ao import de `@/lib/cadastro-grade` (linhas 27-30):

```tsx
import {
  chaveGrade, novaLinhaGrade, ordenarEixos, reconciliarGrade, resolverLinha, totalDaGrade,
  type CampoHerdavel, type CamposHerdaveis, type LinhaGrade,
} from '@/lib/cadastro-grade';
```

Substituir o corpo do `useEffect` das linhas 137-157 por:

```tsx
  useEffect(() => {
    // TRAVA CENTRAL (Global Constraint 3), 7º ponto de entrada. `tipoEscolhido` entra nas
    // dependências abaixo e vem de react-query: um refetch durante o salvamento que mude os tipos
    // da org recalcularia `canonicos` → `ordenarEixos` → REORDENARIA `linhas` no meio do save.
    // `EtapaFotos` casa por índice e o guard `batem` compara contagem, não ordem — a foto iria
    // para o SKU errado, em silêncio.
    if (api.salvando) return;

    // A ordem canônica é DERIVADA aqui dentro, a partir de `tipoEscolhido` (primitivo). Pôr
    // `gruposTamanho` nas dependências rodaria o efeito a cada render — `opcoesDeTamanho` devolve
    // array NOVO sempre. Não entraria em loop (o bail-out do `return prev` segura), e é justamente
    // por isso que seria pior: mataria em silêncio a garantia que o comentário acima descreve.
    const canonicos = opcoesDeTamanho(tipoEscolhido ? [tipoEscolhido] : []).flatMap((g) => g.valores);
    const eixos = ordenarEixos(cores, tamanhos, { cores: CORES_POPULARES, tamanhos: canonicos });

    // Poda das exclusões ANTES do updater: é o único efeito colateral do ciclo e não pertence
    // dentro de um setState (que o React pode reexecutar).
    const podadas = reconciliarGrade(eixos.cores, eixos.tamanhos, removidas, []).removidas;
    if (podadas.size !== removidas.size) { setRemovidas(podadas); return; }

    setLinhas((prev) => {
      const r = reconciliarGrade(eixos.cores, eixos.tamanhos, removidas, prev);
      // `prev` inalterado = bail-out do React: sem novo render, sem ciclo.
      if (r.novas.length === 0 && r.remover.length === 0) return prev;
      const fora = new Set(r.remover);
      const todas = [
        ...prev.filter((l) => !fora.has(chaveGrade(l.cor, l.tamanho))),
        ...r.novas.map((c) => novaLinhaGrade(c.cor, c.tamanho)),
      ];
      const pos = new Map(r.ordem.map((k, i) => [k, i]));
      return todas.sort((a, b) => (
        (pos.get(chaveGrade(a.cor, a.tamanho)) ?? 0) - (pos.get(chaveGrade(b.cor, b.tamanho)) ?? 0)
      ));
    });
  }, [cores, tamanhos, removidas, tipoEscolhido, api.salvando]);
```

`api.salvando` entra nas dependências junto com a guarda: sem isso, o efeito que voltou cedo durante o save nunca reexecutaria ao terminar, e uma seleção feita nesse intervalo ficaria fora de `linhas` para sempre.

Nota para quem revisar: as outras chamadas de `totalDaGrade` (linhas 168, 185, 228-239) continuam com `[...cores]`/`[...tamanhos]` — elas só contam, e contagem não depende de ordem. Não "padronizar".

- [ ] **Step 8: Rodar e confirmar que passa**

Run: `pnpm vitest run src/components/estoque/__tests__/dialog-cadastro-grade.test.tsx`
Expected: PASS (todos os testes do arquivo).

- [ ] **Step 9: Commit**

```bash
/usr/bin/git add src/lib/cadastro-grade.ts src/lib/__tests__/cadastro-grade.test.ts src/components/estoque/dialog-cadastro-grade.tsx src/components/estoque/__tests__/dialog-cadastro-grade.test.tsx
/usr/bin/git commit -m "feat(grade): ordenarEixos fixa a ordem canonica dos eixos da grade"
```

---

## Task 2: `totaisDaGrade`

**Files:**
- Modify: `src/lib/cadastro-grade.ts`
- Test: `src/lib/__tests__/cadastro-grade.test.ts`

**Interfaces:**
- Consumes: `LinhaResolvida` (já existe).
- Produces: `totaisDaGrade(resolvidas, cores, tamanhos): TotaisGrade` com `{ porCor, porTamanho, geral, semGtin }`. Consumida pela Task 9 (rodapé/resumo) e pelo dialog.

**Nota de semântica (vale para as tasks 4 e 9):** os totais são **sempre unidades de estoque**, independentemente do modo de edição ativo na matriz. Não existe "total de preço". `semGtin` conta SKUs com `gtin.trim() === ''`.

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar ao fim de `src/lib/__tests__/cadastro-grade.test.ts`:

```ts
describe('totaisDaGrade', () => {
  const CAB: CamposHerdaveis = {
    preco: '99,90', custo: '40', pesoGramas: '300',
    alturaCm: '5', larguraCm: '20', comprimentoCm: '30',
  };
  const linha = (cor: string, tam: string, estoque: string, gtin = '') => resolverLinha(
    CAB, {}, { ...novaLinhaGrade(cor, tam), estoqueInicial: estoque, gtin },
  );

  it('soma unidades por cor, por tamanho e no geral', () => {
    const t = totaisDaGrade(
      [linha('Preto', 'P', '2'), linha('Preto', 'M', '3'), linha('Branco', 'P', '4')],
      ['Preto', 'Branco'], ['P', 'M'],
    );
    expect(t.porCor).toEqual({ Preto: 5, Branco: 4 });
    expect(t.porTamanho).toEqual({ P: 6, M: 3 });
    expect(t.geral).toBe(9);
  });

  // Eixo cujas células foram TODAS removidas na mão continua sendo coluna/linha da matriz — o
  // total dele é 0, não "ausente". Sem isto o rodapé perderia a coluna e desalinharia da tabela.
  it('eixo sem nenhuma linha resolvida vale 0, não some', () => {
    const t = totaisDaGrade([linha('Preto', 'P', '2')], ['Preto', 'Branco'], ['P', 'M']);
    expect(t.porCor).toEqual({ Preto: 2, Branco: 0 });
    expect(t.porTamanho).toEqual({ P: 2, M: 0 });
  });

  // `parseNum` devolve NaN em texto inválido e null em vazio — nenhum dos dois pode contaminar a
  // soma com NaN, senão o rodapé inteiro exibe "NaN unidades" por causa de UMA célula.
  it('estoque vazio ou inválido conta 0, nunca NaN', () => {
    const t = totaisDaGrade(
      [linha('Preto', 'P', ''), linha('Preto', 'M', 'abc'), linha('Preto', 'G', '7')],
      ['Preto'], ['P', 'M', 'G'],
    );
    expect(t.geral).toBe(7);
    expect(t.porCor.Preto).toBe(7);
  });

  it('conta SKUs sem GTIN', () => {
    const t = totaisDaGrade(
      [linha('Preto', 'P', '1', '789'), linha('Preto', 'M', '1'), linha('Preto', 'G', '1', '   ')],
      ['Preto'], ['P', 'M', 'G'],
    );
    expect(t.semGtin).toBe(2);
  });

  it('grade vazia devolve zeros, não erro', () => {
    expect(totaisDaGrade([], [], [])).toEqual({ porCor: {}, porTamanho: {}, geral: 0, semGtin: 0 });
  });
});
```

Acrescentar `totaisDaGrade` ao import do topo (junto com `ordenarEixos`, já adicionado na Task 1).

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm vitest run src/lib/__tests__/cadastro-grade.test.ts -t "totaisDaGrade"`
Expected: FAIL — `totaisDaGrade is not a function`.

- [ ] **Step 3: Implementar**

No topo de `src/lib/cadastro-grade.ts`, acrescentar o import (é `src/lib` importando `src/lib` — permitido):

```ts
import { parseNumeroPtBr } from '@/lib/formato';
```

Acrescentar ao fim do arquivo:

```ts
export interface TotaisGrade {
  /** Unidades de estoque por cor. Toda cor do eixo aparece, inclusive com 0. */
  porCor: Record<string, number>;
  porTamanho: Record<string, number>;
  geral: number;
  /** SKUs com GTIN em branco. Alimenta o resumo do topo — é o que trava a publicação depois. */
  semGtin: number;
}

/** Totais da matriz. SEMPRE unidades de estoque, qualquer que seja o modo de edição ativo na
 *  tela: não existe "total de preço". Os eixos vêm por parâmetro (e não derivados de
 *  `resolvidas`) para que uma cor/tamanho cujas células foram todas removidas na mão ainda
 *  apareça com 0 — a matriz continua exibindo a linha/coluna. */
export function totaisDaGrade(
  resolvidas: readonly LinhaResolvida[],
  cores: readonly string[],
  tamanhos: readonly string[],
): TotaisGrade {
  const porCor: Record<string, number> = {};
  const porTamanho: Record<string, number> = {};
  for (const c of cores) porCor[c] = 0;
  for (const t of tamanhos) porTamanho[t] = 0;

  let geral = 0;
  let semGtin = 0;
  for (const r of resolvidas) {
    // `|| 0` cobre os DOIS retornos não-numéricos de `parseNumeroPtBr`: `null` (vazio) e `NaN`
    // (texto inválido) — ambos são falsy. Um NaN escapando aqui transforma o rodapé inteiro em
    // "NaN unidades" por causa de UMA célula.
    const unidades = parseNumeroPtBr(r.estoqueInicial) || 0;
    if (r.cor in porCor) porCor[r.cor]! += unidades;
    if (r.tamanho in porTamanho) porTamanho[r.tamanho]! += unidades;
    geral += unidades;
    if (r.gtin.trim() === '') semGtin += 1;
  }
  return { porCor, porTamanho, geral, semGtin };
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm vitest run src/lib/__tests__/cadastro-grade.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add src/lib/cadastro-grade.ts src/lib/__tests__/cadastro-grade.test.ts
/usr/bin/git commit -m "feat(grade): totaisDaGrade calcula unidades por eixo e SKUs sem GTIN"
```

---

## Task 3: `aplicarEmMassa`

**Files:**
- Modify: `src/lib/cadastro-grade.ts`
- Test: `src/lib/__tests__/cadastro-grade.test.ts`

**Interfaces:**
- Consumes: `LinhaGrade`, `CampoHerdavel`, `CAMPOS_HERDAVEIS`.
- Produces: `aplicarEmMassa(linhas, opts): LinhaGrade[]`, e os tipos `CampoMassa`, `EscopoMassa`, `OpcoesMassa` — usados pelas tasks 4 e 8 e pelo dialog.

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar ao fim de `src/lib/__tests__/cadastro-grade.test.ts`:

```ts
describe('aplicarEmMassa', () => {
  const grade = () => [
    novaLinhaGrade('Preto', 'P'), novaLinhaGrade('Preto', 'G'),
    novaLinhaGrade('Branco', 'P'), novaLinhaGrade('Branco', 'G'),
  ];

  it('escopo "todos" atinge a grade inteira', () => {
    const r = aplicarEmMassa(grade(), {
      campo: 'estoqueInicial', escopo: { tipo: 'todos' }, valor: '10',
    });
    expect(r.map((l) => l.estoqueInicial)).toEqual(['10', '10', '10', '10']);
  });

  it('escopo "cor" atinge só as linhas daquela cor', () => {
    const r = aplicarEmMassa(grade(), {
      campo: 'estoqueInicial', escopo: { tipo: 'cor', valor: 'Preto' }, valor: '5',
    });
    expect(r.map((l) => l.estoqueInicial)).toEqual(['5', '5', '', '']);
  });

  // O fluxo real do Diego: preço diferente só no tamanho maior, resto continua herdando.
  it('escopo "tamanho" cria override só naquela coluna; o resto segue herdando', () => {
    const r = aplicarEmMassa(grade(), {
      campo: 'preco', escopo: { tipo: 'tamanho', valor: 'G' }, valor: '64,90',
    });
    expect(r.map((l) => l.overrides.preco)).toEqual([undefined, '64,90', undefined, '64,90']);
    // `undefined` por AUSÊNCIA da chave, não por valor `undefined` gravado: `resolverLinha` usa
    // `campo in overrides`, então uma chave presente com undefined resolveria para undefined.
    expect('preco' in r[0]!.overrides).toBe(false);
  });

  it('valor null num campo herdável REMOVE o override (volta a herdar)', () => {
    const linhas = grade().map((l) => ({ ...l, overrides: { preco: '129,90', custo: '50' } }));
    const r = aplicarEmMassa(linhas, {
      campo: 'preco', escopo: { tipo: 'todos' }, valor: null,
    });
    expect('preco' in r[0]!.overrides).toBe(false);
    // Só o campo pedido: o custo destravado continua destravado.
    expect(r[0]!.overrides.custo).toBe('50');
  });

  it('valor null em estoque/GTIN LIMPA para string vazia, não remove nada', () => {
    const linhas = grade().map((l) => ({ ...l, gtin: '789', estoqueInicial: '3' }));
    const r = aplicarEmMassa(linhas, { campo: 'gtin', escopo: { tipo: 'todos' }, valor: null });
    expect(r.map((l) => l.gtin)).toEqual(['', '', '', '']);
    expect(r.map((l) => l.estoqueInicial)).toEqual(['3', '3', '3', '3']);
  });

  // Regra inegociável: nenhuma função desta entrega inventa GTIN. Um "preencher em massa" que
  // gerasse sequência produziria código de barras falso num anúncio real.
  it('nunca gera GTIN — só escreve o que foi passado', () => {
    const r = aplicarEmMassa(grade(), { campo: 'gtin', escopo: { tipo: 'todos' }, valor: '789' });
    expect(r.map((l) => l.gtin)).toEqual(['789', '789', '789', '789']);
  });

  // TRAVA DO CASAMENTO POSICIONAL: a função é um `map` e nada mais. Um `filter`/`sort`/`concat`
  // aqui dentro desalinharia `linhas[i] ↔ resolvidas[i]` — o mesmo desalinho do bug f4a6df68.
  it('preserva contagem, ordem e identidade das linhas', () => {
    const entrada = grade();
    const saida = aplicarEmMassa(entrada, {
      campo: 'preco', escopo: { tipo: 'cor', valor: 'Preto' }, valor: '1',
    });
    expect(saida).toHaveLength(entrada.length);
    expect(saida.map((l) => l.clientId)).toEqual(entrada.map((l) => l.clientId));
    expect(saida.map((l) => `${l.cor}/${l.tamanho}`))
      .toEqual(entrada.map((l) => `${l.cor}/${l.tamanho}`));
  });

  it('não muta o array nem as linhas de entrada', () => {
    const entrada = grade();
    aplicarEmMassa(entrada, { campo: 'estoqueInicial', escopo: { tipo: 'todos' }, valor: '9' });
    expect(entrada.map((l) => l.estoqueInicial)).toEqual(['', '', '', '']);
  });
});
```

Acrescentar `aplicarEmMassa` ao import do topo do arquivo.

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm vitest run src/lib/__tests__/cadastro-grade.test.ts -t "aplicarEmMassa"`
Expected: FAIL — `aplicarEmMassa is not a function`.

- [ ] **Step 3: Implementar**

Acrescentar ao fim de `src/lib/cadastro-grade.ts`:

```ts
export type CampoMassa = 'estoqueInicial' | 'gtin' | CampoHerdavel;

export type EscopoMassa =
  | { tipo: 'todos' }
  | { tipo: 'cor'; valor: string }
  | { tipo: 'tamanho'; valor: string };

export interface OpcoesMassa {
  campo: CampoMassa;
  escopo: EscopoMassa;
  /** `null` em campo herdável = REMOVE o override (volta a herdar). `null` em estoque/GTIN =
   *  limpa para `''` (não existe "herdar estoque"). Nunca significa "gerar valor". */
  valor: string | null;
}

function noEscopo(linha: LinhaGrade, escopo: EscopoMassa): boolean {
  if (escopo.tipo === 'todos') return true;
  if (escopo.tipo === 'cor') return linha.cor === escopo.valor;
  return linha.tamanho === escopo.valor;
}

/** Preenchimento em massa. É um `map` e NADA MAIS: não filtra, não concatena, não ordena. A
 *  contagem e a ordem de `linhas` são o casamento posicional com `resolvidas` — mexer nelas aqui
 *  reintroduz o desalinho do bug f4a6df68 por um caminho que nenhum teste de UI pegaria.
 *
 *  NUNCA gera GTIN: o único valor escrito é o que veio em `opts.valor`. */
export function aplicarEmMassa(
  linhas: readonly LinhaGrade[],
  opts: OpcoesMassa,
): LinhaGrade[] {
  const herdavel = (CAMPOS_HERDAVEIS as readonly string[]).includes(opts.campo);
  return linhas.map((linha) => {
    if (!noEscopo(linha, opts.escopo)) return linha;
    if (!herdavel) {
      // Estoque e GTIN moram na linha crua; `null` aqui é "limpar", não "voltar a herdar".
      return { ...linha, [opts.campo]: opts.valor ?? '' };
    }
    const campo = opts.campo as CampoHerdavel;
    if (opts.valor === null) {
      // Remover a CHAVE, não gravar undefined: `resolverLinha` decide por `campo in overrides`.
      const { [campo]: _removido, ...resto } = linha.overrides;
      return { ...linha, overrides: resto };
    }
    return { ...linha, overrides: { ...linha.overrides, [campo]: opts.valor } };
  });
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm vitest run src/lib/__tests__/cadastro-grade.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add src/lib/cadastro-grade.ts src/lib/__tests__/cadastro-grade.test.ts
/usr/bin/git commit -m "feat(grade): aplicarEmMassa por escopo todos/cor/tamanho, sem gerar GTIN"
```

---

## Task 4: `matriz-grade.tsx` — matriz, 4 modos e herança na célula

Esta é a task maior. Ela substitui `linhas.map(LinhaGradeForm)` dentro do dialog, então precisa nascer com os 4 modos: sem o modo Preço não existe caminho verde para o teste `override de uma linha vence o cabeçalho no payload` (o fluxo `Editar nesta linha` → `Destravar …` deixa de existir no mesmo commit).

**Files:**
- Create: `src/components/estoque/matriz-grade.tsx`
- Create: `src/components/estoque/__tests__/matriz-grade.test.tsx`
- Modify: `src/components/estoque/dialog-cadastro-grade.tsx` (troca a renderização da grade; acrescenta `patchOverride`/`voltarAHerdar`; trava central em `removerLinha`)
- Modify: `src/components/estoque/__tests__/dialog-cadastro-grade.test.tsx` (adaptação das assertivas — tabela abaixo)

**Interfaces:**
- Consumes: `ordenarEixos` (Task 1), `chaveGrade`/`resolverLinha`/`LinhaGrade`/`LinhaResolvida`/`CampoHerdavel`, `ROTULOS` (ainda exportado por `linha-grade-form.tsx` nesta task; migra na Task 5).
- Produces: `MatrizGrade` e `ModoGrade`, consumidos pelas tasks 5-9. Props na seção "Interfaces públicas novas". Os `data-r`/`data-c` colocados aqui são o contrato que a Task 7 usa.

### Tabela de adaptação dos testes existentes (`dialog-cadastro-grade.test.tsx`)

Aplicar exatamente estas trocas. Nada além delas.

| Teste | Assertiva antiga | Assertiva nova |
|---|---|---|
| `trocar o tipo com linhas já geradas…` | linha 92: `await user.type(screen.getByLabelText('GTIN de Preto · P'), '789')` — e depois `expect(screen.queryByText('Preto · P')).not.toBeInTheDocument()` | inserir `await user.click(screen.getByRole('button', { name: 'GTIN' }));` **antes** do `type` (o modo padrão é Estoque), e trocar a assertiva final por `expect(screen.queryByLabelText('Estoque inicial de Preto · P')).not.toBeInTheDocument()` (a troca de tipo reseta a matriz para o modo padrão) |
| `marcar cor e tamanho gera as linhas na hora…` | `queryByText(/Preto · /)` / `getByText('Preto · P')` / `getByText('Preto · M')` | `queryByLabelText(/^Estoque inicial de Preto · /)` / `getByLabelText('Estoque inicial de Preto · P')` / `getByLabelText('Estoque inicial de Preto · M')` |
| `marcar mais uma cor ACRESCENTA…` | `getByText('Branco · P')` | `getByLabelText('GTIN de Branco · P')` (o modo GTIN precisa estar ativo: `await user.click(screen.getByRole('button', { name: 'GTIN' }))` antes de digitar) |
| `desmarcar cor de linha AINDA VAZIA…` | `queryByText('Preto · P')` | `queryByLabelText('Estoque inicial de Preto · P')` |
| `desmarcar cor com dado digitado…` | `getByText('Preto · P')` / `queryByText('Preto · P')` | `getByLabelText('Estoque inicial de Preto · P')` / `queryByLabelText('Estoque inicial de Preto · P')` |
| `remover linha na mão mantém a grade parcial` | `queryByText('Preto · P')` / `getByText('Branco · P')` | `queryByLabelText('Estoque inicial de Preto · P')` / `getByLabelText('Estoque inicial de Branco · P')` |
| `desmarcar a cor inteira e remarcar LIMPA…` | `getByText('Preto · P')` | `getByLabelText('Estoque inicial de Preto · P')` |
| `chip que estouraria 60…` e `Enter no campo de nova cor…` | `screen.getByText('Laranja · GG')` / `queryByText('Caqui · GG')` / `queryByText(/Caqui/)` | `const grade = within(screen.getByText('Grade').parentElement!.parentElement!);` e então `grade.getByLabelText('Estoque inicial de Laranja · GG')` / `expect(screen.queryByLabelText(/de Caqui · /)).not.toBeInTheDocument()` (duas vezes, no lugar das duas últimas). **Não** usar `getByRole('table')` nem `getByRole('rowheader')` aqui: o comentário das linhas 178-185 desse arquivo mede que um `getByRole` com 60 linhas custa 2,5s (o teste já estourou 20s antes de ser escopado), enquanto `getByText`/`queryByLabelText` não varrem papéis. |
| `ordem de clique não decide a ordem da grade` (Task 1) | ordem dos textos `Preto · X` | ordem dos cabeçalhos de coluna: `expect(screen.getAllByRole('columnheader').map((e) => e.textContent)).toEqual(['Cor', 'P', 'G', 'Total'])` |
| `preço do cabeçalho aparece resumido em toda linha…` | `getByText(/R\$ 99,90/)` | ativar o modo Preço e `expect(screen.getByLabelText('Preço mínimo (líquido) de Preto · P')).toHaveValue('99,90')` |
| `mudar o cabeçalho propaga sozinho…` | `getByText(/R\$ 150/)` | idem, `toHaveValue('150')` |
| `override de uma linha vence o cabeçalho no payload` | `Editar nesta linha` → `Destravar Preço…` → `clear` → `type` | ativar o modo Preço → `clear` → `type '129,90'` direto na célula (a célula já é editável; digitar cria o override com o texto digitado) |
| `durante o salvamento a grade fica congelada` | — | **sem mudança**: `getByRole('button', { name: 'Remover Preto · P' })` continua existindo (a remoção fica na célula, ver D3) |

O escopo `seletor` do teste de teto de 60 (`within(screen.getByText('Cores e tamanhos').parentElement!)`) **fica como está**: é o que mantém aquele teste abaixo do timeout. Se o relógio dele subir depois desta task, é o custo documentado de container maior — não é regressão de componente.

- [ ] **Step 1: Escrever o teste de unidade da matriz (falha)**

Criar `src/components/estoque/__tests__/matriz-grade.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MatrizGrade } from '@/components/estoque/matriz-grade';
import {
  novaLinhaGrade, resolverLinha, type CamposHerdaveis, type LinhaGrade,
} from '@/lib/cadastro-grade';

const CABECALHO: CamposHerdaveis = {
  preco: '99,90', custo: '40', pesoGramas: '300',
  alturaCm: '5', larguraCm: '20', comprimentoCm: '30',
};

function montar(linhas: LinhaGrade[], props: {
  cores?: string[]; tamanhos?: string[]; desabilitado?: boolean; removidas?: Set<string>;
} = {}) {
  const spies = {
    onMudarLinha: vi.fn(), onMudarOverride: vi.fn(), onVoltarAHerdar: vi.fn(),
    onRemoverCelula: vi.fn(), onReincluirCelula: vi.fn(), onAplicarMassa: vi.fn(),
  };
  render(
    <MatrizGrade
      linhas={linhas}
      resolvidas={linhas.map((l) => resolverLinha(CABECALHO, {}, l))}
      cores={props.cores ?? ['Preto', 'Branco']}
      tamanhos={props.tamanhos ?? ['P', 'M']}
      removidas={props.removidas ?? new Set()}
      tentouSalvar={false}
      desabilitado={props.desabilitado ?? false}
      {...spies}
    />,
  );
  return spies;
}

const gradeCheia = () => [
  novaLinhaGrade('Preto', 'P'), novaLinhaGrade('Preto', 'M'),
  novaLinhaGrade('Branco', 'P'), novaLinhaGrade('Branco', 'M'),
];

describe('MatrizGrade — estrutura', () => {
  it('linhas são cores e colunas são tamanhos, com coluna Total', () => {
    montar(gradeCheia());
    expect(screen.getAllByRole('columnheader').map((e) => e.textContent))
      .toEqual(['Cor', 'P', 'M', 'Total']);
    // 3 rowheaders, não 2: o `<th scope="row">Total</th>` do rodapé também tem esse papel
    // (aria-query mapeia `th[scope=row]` para `rowheader`, tanto no tbody quanto no tfoot).
    expect(screen.getAllByRole('rowheader').map((e) => e.textContent))
      .toEqual(['Preto', 'Branco', 'Total']);
  });

  // Frame pré-reconciliação: a linha ainda não existe e a combinação NÃO foi removida na mão.
  // Célula inerte — nem campo, nem affordance de reinclusão (o "+" só chega na Task 6).
  it('combinação sem linha fica inerte, sem campo', () => {
    montar([novaLinhaGrade('Preto', 'P')]);
    expect(screen.queryByLabelText('Estoque inicial de Preto · M')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reincluir Preto · M' })).not.toBeInTheDocument();
  });

  it('cada combinação tem uma célula editável com o aria-label canônico', () => {
    montar(gradeCheia());
    expect(screen.getByLabelText('Estoque inicial de Preto · P')).toBeInTheDocument();
    expect(screen.getByLabelText('Estoque inicial de Branco · M')).toBeInTheDocument();
  });

  it('digitar numa célula reporta a mudança da linha certa', async () => {
    const user = userEvent.setup();
    const linhas = gradeCheia();
    const { onMudarLinha } = montar(linhas);
    await user.type(screen.getByLabelText('Estoque inicial de Branco · P'), '7');
    expect(onMudarLinha).toHaveBeenCalledWith(linhas[2]!.clientId, { estoqueInicial: '7' });
  });

  // Metade GTIN do teste `estoque e GTIN são por linha` de `linha-grade-form.test.tsx`: os dois
  // campos crus da linha reportam por caminhos diferentes do código, e só um estar coberto
  // deixaria o outro sem rede.
  it('GTIN também é por linha e reporta a mudança', async () => {
    const user = userEvent.setup();
    const linhas = gradeCheia();
    const { onMudarLinha } = montar(linhas);
    await user.click(screen.getByRole('button', { name: 'GTIN' }));
    await user.type(screen.getByLabelText('GTIN de Preto · M'), '7');
    expect(onMudarLinha).toHaveBeenCalledWith(linhas[1]!.clientId, { gtin: '7' });
  });

  it('a célula sem override anuncia "herdado" para quem passa o mouse ou foca', async () => {
    const user = userEvent.setup();
    const linhas = gradeCheia();
    linhas[0] = { ...linhas[0]!, overrides: { preco: '129,90' } };
    montar(linhas);
    await user.click(screen.getByRole('button', { name: 'Preço' }));
    // Uma por célula SEM override: 3 das 4. A da célula com override não existe.
    expect(screen.getAllByText('herdado')).toHaveLength(3);
  });
});

describe('MatrizGrade — modos', () => {
  it('as 4 abas trocam o campo editado, mantendo a mesma matriz', async () => {
    const user = userEvent.setup();
    montar(gradeCheia());
    await user.click(screen.getByRole('button', { name: 'GTIN' }));
    expect(screen.getByLabelText('GTIN de Preto · P')).toBeInTheDocument();
    expect(screen.queryByLabelText('Estoque inicial de Preto · P')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Preço' }));
    expect(screen.getByLabelText('Preço mínimo (líquido) de Preto · P')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Custo' }));
    expect(screen.getByLabelText('Custo de Preto · P')).toBeInTheDocument();
  });
});

describe('MatrizGrade — herança na célula', () => {
  it('célula sem override mostra o valor herdado do cabeçalho', async () => {
    const user = userEvent.setup();
    montar(gradeCheia());
    await user.click(screen.getByRole('button', { name: 'Preço' }));
    expect(screen.getByLabelText('Preço mínimo (líquido) de Preto · P')).toHaveValue('99,90');
  });

  // Regra explícita do spec: a célula JÁ é editável — não existe passo "destravar" antes. UMA
  // tecla numa célula herdando basta para reportar o override.
  //
  // Por que NÃO usar `clear()` aqui: o helper `montar` renderiza uma árvore estática com spies,
  // o pai nunca re-renderiza, e o `<Input>` é controlado — o React restaura '99,90' no DOM
  // depois do `clear`, e a asserção mediria o artefato do harness, não o componente. O que prova
  // a regra é o número de interações: uma só, sem clique em cadeado nenhum.
  it('digitar numa célula herdada já reporta o override, sem passo de destravar', async () => {
    const user = userEvent.setup();
    const linhas = gradeCheia();
    const { onMudarOverride } = montar(linhas);
    await user.click(screen.getByRole('button', { name: 'Preço' }));
    expect(screen.queryByRole('button', { name: /^Destravar/ })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Preço mínimo (líquido) de Preto · P'), '5');
    expect(onMudarOverride).toHaveBeenCalledTimes(1);
    expect(onMudarOverride).toHaveBeenCalledWith(linhas[0]!.clientId, 'preco', '99,905');
  });

  it('"Voltar a herdar" só aparece na célula que TEM override', async () => {
    const user = userEvent.setup();
    const linhas = gradeCheia();
    linhas[0] = { ...linhas[0]!, overrides: { preco: '129,90' } };
    const { onVoltarAHerdar } = montar(linhas);
    await user.click(screen.getByRole('button', { name: 'Preço' }));
    expect(screen.queryByRole('button', {
      name: 'Voltar a herdar Preço mínimo (líquido) de Preto · M',
    })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', {
      name: 'Voltar a herdar Preço mínimo (líquido) de Preto · P',
    }));
    expect(onVoltarAHerdar).toHaveBeenCalledWith(linhas[0]!.clientId, 'preco');
  });

  // Estoque e GTIN não têm herança nenhuma: não existe "GTIN único" numa grade.
  it('modo Estoque e GTIN não oferecem "Voltar a herdar"', async () => {
    const user = userEvent.setup();
    montar(gradeCheia());
    expect(screen.queryByRole('button', { name: /^Voltar a herdar/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'GTIN' }));
    expect(screen.queryByRole('button', { name: /^Voltar a herdar/ })).not.toBeInTheDocument();
  });
});

describe('MatrizGrade — casamento posicional', () => {
  // Grade parcial: 3 linhas para 2×2 células. O índice é derivado por chave, nunca por posição
  // na varredura cor×tamanho — esta é a forma exata do bug que f4a6df68 corrigiu.
  it('grade parcial não desloca o alvo das células seguintes', async () => {
    const user = userEvent.setup();
    const linhas = [
      novaLinhaGrade('Preto', 'M'), novaLinhaGrade('Branco', 'P'), novaLinhaGrade('Branco', 'M'),
    ];
    const { onMudarLinha } = montar(linhas, { removidas: new Set(['Preto\u0000P']) });
    await user.type(screen.getByLabelText('Estoque inicial de Branco · M'), '9');
    expect(onMudarLinha).toHaveBeenCalledWith(linhas[2]!.clientId, { estoqueInicial: '9' });
  });
});

describe('MatrizGrade — congelamento', () => {
  it('desabilitado congela células e o botão de remover', async () => {
    const user = userEvent.setup();
    const { onRemoverCelula } = montar(gradeCheia(), { desabilitado: true });
    expect(screen.getByLabelText('Estoque inicial de Preto · P')).toBeDisabled();
    const remover = screen.getByRole('button', { name: 'Remover Preto · P' });
    expect(remover).toBeDisabled();
    await user.click(remover);
    expect(onRemoverCelula).not.toHaveBeenCalled();
  });

  it('remover uma célula reporta a combinação, não o índice', async () => {
    const user = userEvent.setup();
    const { onRemoverCelula } = montar(gradeCheia());
    await user.click(screen.getByRole('button', { name: 'Remover Branco · M' }));
    expect(onRemoverCelula).toHaveBeenCalledWith('Branco', 'M');
  });
});

describe('MatrizGrade — totais', () => {
  it('coluna e rodapé Total somam unidades, em qualquer modo', async () => {
    const user = userEvent.setup();
    const linhas = gradeCheia();
    linhas[0] = { ...linhas[0]!, estoqueInicial: '2' };
    linhas[1] = { ...linhas[1]!, estoqueInicial: '3' };
    montar(linhas);
    // `getByText(...).closest('tr')`, NÃO `getByRole('rowheader', { name: 'Preto' })`: a Task 8
    // embrulha o conteúdo do `<th scope="row">` num botão com `aria-label="Preencher em massa na
    // cor Preto"`, e o aria-label do descendente passa a ser o nome acessível do próprio th —
    // um match exato por 'Preto' quebraria lá na frente, sem esta task ter mudado nada.
    const linhaPreto = screen.getByText('Preto').closest('tr')!;
    expect(within(linhaPreto).getByText('5')).toBeInTheDocument();
    // Trocar de modo não muda o total: ele é SEMPRE unidades de estoque.
    await user.click(screen.getByRole('button', { name: 'Preço' }));
    expect(within(linhaPreto).getByText('5')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm vitest run src/components/estoque/__tests__/matriz-grade.test.tsx`
Expected: FAIL — não resolve `@/components/estoque/matriz-grade`.

- [ ] **Step 3: Implementar `matriz-grade.tsx`**

Criar `src/components/estoque/matriz-grade.tsx`:

```tsx
// Matriz Cor × Tamanho do cadastro em grade (spec 2026-09-19 "matriz"). É uma VIEW sobre o array
// `linhas` do dialog — nunca um segundo modelo de dados. A matriz não guarda linha, índice, cor
// nem tamanho em estado: deriva `Map<chaveGrade, índice>` a cada render. Um estado próprio de
// linhas aqui reintroduziria, por um caminho novo, o desalinho corrigido em f4a6df68.
//
// Estado interno é SÓ o modo de edição (uma string). Célula ativa NÃO é estado React: seria um
// rerender da matriz inteira a cada tecla, com até 60 células (ver Task 7, navegação por foco DOM).
import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { tabsListVariants, tabsTriggerClassName } from '@/components/ui/tabs';
import {
  Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { erroCampo } from '@/components/estoque/linha-variacao-form';
import { ROTULOS } from '@/components/estoque/linha-grade-form';
import {
  CAMPOS_HERDAVEIS, chaveGrade, totaisDaGrade,
  type CampoHerdavel, type LinhaGrade, type LinhaResolvida, type OpcoesMassa,
} from '@/lib/cadastro-grade';
import { cn } from '@/lib/utils';

export type ModoGrade = 'estoqueInicial' | 'gtin' | 'preco' | 'custo';

const MODOS: { valor: ModoGrade; aba: string; rotulo: string; prefixo?: string }[] = [
  { valor: 'estoqueInicial', aba: 'Estoque', rotulo: 'Estoque inicial' },
  { valor: 'gtin', aba: 'GTIN', rotulo: 'GTIN' },
  { valor: 'preco', aba: 'Preço', rotulo: ROTULOS.preco.rotulo, prefixo: ROTULOS.preco.prefixo },
  { valor: 'custo', aba: 'Custo', rotulo: ROTULOS.custo.rotulo, prefixo: ROTULOS.custo.prefixo },
];

function ehHerdavel(modo: ModoGrade): modo is CampoHerdavel {
  return (CAMPOS_HERDAVEIS as readonly string[]).includes(modo);
}

export function MatrizGrade({
  linhas, resolvidas, cores, tamanhos, removidas, tentouSalvar, desabilitado,
  onMudarLinha, onMudarOverride, onVoltarAHerdar, onRemoverCelula, onReincluirCelula,
  onAplicarMassa,
}: {
  linhas: readonly LinhaGrade[];
  resolvidas: readonly LinhaResolvida[];
  /** Eixo JÁ ordenado por `ordenarEixos` — a matriz não reordena nada. */
  cores: readonly string[];
  tamanhos: readonly string[];
  removidas: ReadonlySet<string>;
  tentouSalvar: boolean;
  /** true durante `salvando`. Affordance — a trava de verdade está no dono do estado (dialog). */
  desabilitado: boolean;
  onMudarLinha: (clientId: string, patch: Partial<Pick<LinhaGrade, 'gtin' | 'estoqueInicial'>>) => void;
  onMudarOverride: (clientId: string, campo: CampoHerdavel, valor: string) => void;
  onVoltarAHerdar: (clientId: string, campo: CampoHerdavel) => void;
  onRemoverCelula: (cor: string, tamanho: string) => void;
  onReincluirCelula: (cor: string, tamanho: string) => void;
  onAplicarMassa: (opts: OpcoesMassa) => void;
}) {
  const [modo, setModo] = useState<ModoGrade>('estoqueInicial');
  const def = MODOS.find((m) => m.valor === modo)!;
  // Derivado A CADA RENDER, nunca memoizado num estado: `linhas` é a fonte, e um cache aqui
  // divergiria na primeira reconciliação.
  const indice = new Map(linhas.map((l, i) => [chaveGrade(l.cor, l.tamanho), i]));
  const totais = totaisDaGrade(resolvidas, cores, tamanhos);

  function celula(cor: string, tamanho: string, c: number, r: number) {
    const chave = chaveGrade(cor, tamanho);
    const i = indice.get(chave);
    // Sem linha = célula inerte. A Task 6 distingue aqui a combinação removida na mão (que ganha
    // um "+") do frame pré-reconciliação (que continua inerte).
    if (i === undefined) {
      return <span className="text-xs text-muted-foreground" aria-hidden="true">—</span>;
    }
    const linha = linhas[i]!;
    const resolvida = resolvidas[i]!;
    const nome = `${cor} · ${tamanho}`;
    const herdavel = ehHerdavel(modo);
    const temOverride = herdavel && modo in linha.overrides;
    const valor = herdavel ? resolvida[modo] : linha[modo];
    const erro = erroCampo(modo, valor);

    return (
      <div className="group/celula relative flex items-center gap-0.5">
        {herdavel && !temOverride && (
          // Sufixo só em foco/hover: 60 células gritando "herdado" ao mesmo tempo é ruído, e a
          // cor `muted` sozinha não diz O QUE o cinza significa na primeira vez que se vê a tela.
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -top-3 left-1 z-10 rounded bg-background px-1 text-[10px] text-muted-foreground opacity-0 transition-opacity group-focus-within/celula:opacity-100 group-hover/celula:opacity-100"
          >
            herdado
          </span>
        )}
        <div className="relative flex-1">
          {def.prefixo && (
            <span className="pointer-events-none absolute inset-y-0 left-1.5 flex items-center text-[10px] text-muted-foreground">
              {def.prefixo}
            </span>
          )}
          <Input
            aria-label={`${def.rotulo} de ${nome}`}
            // Alvo do foco programático da Task 7. O par (r, c) é POSIÇÃO VISUAL na matriz, não
            // índice em `linhas` — a grade parcial faz os dois divergirem de propósito.
            data-r={r}
            data-c={c}
            // Um só alvo para todas as células herdando, igual ao `gerador-motivo-limite`.
            aria-describedby={herdavel && !temOverride ? 'matriz-herdado' : undefined}
            className={cn(
              'h-8 text-sm',
              def.prefixo && 'pl-6',
              herdavel && !temOverride && 'text-muted-foreground',
              erro && tentouSalvar && 'border-destructive',
            )}
            value={valor}
            disabled={desabilitado}
            onChange={(e) => (herdavel
              // Digitar numa célula herdada cria o override com o TEXTO DIGITADO. Não existe
              // estado "travado" prévio para semear com o valor resolvido (regra do spec).
              ? onMudarOverride(linha.clientId, modo, e.target.value)
              : onMudarLinha(linha.clientId, { [modo]: e.target.value }))}
          />
        </div>
        {temOverride && (
          <Button
            type="button" variant="ghost" size="sm"
            className="h-6 w-6 shrink-0 p-0 text-[10px]"
            disabled={desabilitado}
            aria-label={`Voltar a herdar ${def.rotulo} de ${nome}`}
            onClick={() => onVoltarAHerdar(linha.clientId, modo as CampoHerdavel)}
          >
            ↺
          </Button>
        )}
        <Button
          type="button" variant="ghost" size="sm"
          className="h-6 w-6 shrink-0 p-0 opacity-0 focus-visible:opacity-100 group-hover/celula:opacity-100"
          disabled={desabilitado}
          aria-label={`Remover ${nome}`}
          onClick={() => onRemoverCelula(cor, tamanho)}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {/* Grupo de botões `aria-pressed`, NÃO `<Tabs>` do Radix: não existe painel por modo (a
          mesma tabela serve os 4), e um `TabsTrigger` sem `TabsContent` emite `aria-controls`
          apontando para um id inexistente. É exatamente a saída que `ui/tabs.tsx` documenta ao
          exportar `tabsTriggerClassName` — mesma aparência, semântica correta. */}
      <div className={tabsListVariants()} role="group" aria-label="Modo de edição da grade">
        {MODOS.map((m) => (
          <button
            key={m.valor}
            type="button"
            className={tabsTriggerClassName}
            data-active={modo === m.valor ? '' : undefined}
            aria-pressed={modo === m.valor}
            onClick={() => setModo(m.valor)}
          >
            {m.aba}
          </button>
        ))}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Cor</TableHead>
            {tamanhos.map((t) => <TableHead key={t} scope="col">{t}</TableHead>)}
            <TableHead scope="col">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {cores.map((cor, r) => (
            <TableRow key={cor}>
              <TableHead scope="row">{cor}</TableHead>
              {tamanhos.map((tamanho, c) => (
                <TableCell key={tamanho}>{celula(cor, tamanho, c, r)}</TableCell>
              ))}
              <TableCell className="text-sm tabular-nums">{totais.porCor[cor] ?? 0}</TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableHead scope="row">Total</TableHead>
            {tamanhos.map((t) => (
              <TableCell key={t} className="text-sm tabular-nums">{totais.porTamanho[t] ?? 0}</TableCell>
            ))}
            <TableCell className="text-sm font-medium tabular-nums">{totais.geral}</TableCell>
          </TableRow>
        </TableFooter>
      </Table>

      <span id="matriz-herdado" className="sr-only">Valor herdado do produto.</span>
    </div>
  );
}
```

> **Nota ao implementador:** `removidas`, `onReincluirCelula` e `onAplicarMassa` já estão na assinatura mas só entram em uso nas tasks 6 (as duas primeiras) e 8. Desestruturar as três com alias `_` — `removidas: _removidas, onReincluirCelula: _onReincluirCelula, onAplicarMassa: _onAplicarMassa,` — que é o que o `varsIgnorePattern: '^_'` do `eslint.config.js:31-34` já cobre, e renomear de volta nas tasks 6 e 8. Nada de `<span>` de andaime no DOM.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm vitest run src/components/estoque/__tests__/matriz-grade.test.tsx`
Expected: PASS.

- [ ] **Step 5: Trocar a lista de cards pela matriz no dialog**

Em `src/components/estoque/dialog-cadastro-grade.tsx`:

(a) Trocar o import de `LinhaGradeForm` (linha 33) por:

```tsx
import { ROTULOS } from '@/components/estoque/linha-grade-form';
import { MatrizGrade } from '@/components/estoque/matriz-grade';
```

(b) Acrescentar ao import de `@/lib/cadastro-grade` o tipo `OpcoesMassa` (usado já nesta task, em `aplicarMassa`). **Não** importar `totaisDaGrade` aqui: ele só entra na Task 9, e `noUnusedLocals: true` (`tsconfig.app.json:18`) faria o `tsc -b` do `preflight:static` falhar com TS6133 — um erro que o vitest não pega e que só apareceria na Task 10, com 9 commits em cima.

(c) Acrescentar, logo depois de `patchLinha` (linha 222-224):

```tsx
  function patchOverride(clientId: string, campo: CampoHerdavel, valor: string) {
    setLinhas((prev) => prev.map((x) => (
      x.clientId === clientId ? { ...x, overrides: { ...x.overrides, [campo]: valor } } : x
    )));
  }

  function voltarAHerdar(clientId: string, campo: CampoHerdavel) {
    setLinhas((prev) => prev.map((x) => {
      if (x.clientId !== clientId) return x;
      // Remover a CHAVE: `resolverLinha` decide por `campo in overrides`, então gravar
      // `undefined` deixaria o campo resolvendo para undefined em vez de voltar ao cabeçalho.
      const { [campo]: _removido, ...resto } = x.overrides;
      return { ...x, overrides: resto };
    }));
  }
```

(d) Trocar `removerLinha` (linhas 202-205) pela versão com a trava central:

```tsx
  // Exclusão manual é permanente ENQUANTO os dois eixos continuarem marcados — é o que permite a
  // grade parcial. Desmarcar o eixo inteiro limpa a memória (`podar`, em cadastro-grade.ts).
  //
  // A guarda `api.salvando` é a TRAVA CENTRAL (mesmo desenho do fix f4a6df68): toda função que
  // muda contagem/ordem de `linhas` abre com ela. O `disabled` do botão é affordance — quem
  // garante o casamento posicional é este `return`.
  function removerLinha(cor: string, tamanho: string) {
    if (api.salvando) return;
    setRemovidas((prev) => new Set(prev).add(chaveGrade(cor, tamanho)));
    setLinhas((prev) => prev.filter((x) => !(x.cor === cor && x.tamanho === tamanho)));
  }
```

(e) Acrescentar a mesma guarda no início de `mudarCores` (antes da checagem de limite), `mudarTamanhos` e da `acao` interna de `trocarTipo`:

```tsx
    if (api.salvando) return;
```

(f) Substituir o bloco `linhas.length > 0 && (…)` (linhas 568-607) por:

```tsx
              {linhas.length > 0 && (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Grade</span>
                    <span className="text-xs text-muted-foreground">
                      {linhas.length} SKUs · {unidades} unidades · {semFoto} sem foto
                    </span>
                  </div>
                  <MatrizGrade
                    linhas={linhas}
                    resolvidas={resolvidas}
                    cores={eixos.cores}
                    tamanhos={eixos.tamanhos}
                    removidas={removidas}
                    tentouSalvar={tentouSalvar}
                    desabilitado={api.salvando}
                    onMudarLinha={patchLinha}
                    onMudarOverride={patchOverride}
                    onVoltarAHerdar={voltarAHerdar}
                    onRemoverCelula={removerLinha}
                    onReincluirCelula={reincluirLinha}
                    onAplicarMassa={aplicarMassa}
                  />
                </div>
              )}
```

(g) Acrescentar, junto de `resolvidas` (linha 247), os eixos ordenados para render — **chamada duplicada da função pura, de propósito**:

```tsx
  // `ordenarEixos` é chamada de novo aqui (o efeito também chama). Duplicar uma função pura e
  // barata é mais seguro que um `useMemo` cujas dependências o próximo editor desalinha — e os
  // dois pontos de chamada TÊM de concordar, senão a matriz desenha colunas fora da ordem das
  // linhas. Não "otimizar" isto com estado.
  const eixos = ordenarEixos(cores, tamanhos, {
    cores: CORES_POPULARES,
    tamanhos: gruposTamanho.flatMap((g) => g.valores),
  });
```

(h) Acrescentar os dois stubs que as tasks 6 e 8 preenchem — com a trava central já no lugar:

```tsx
  // Task 6 preenche o corpo; a trava central já nasce aqui porque ela é a invariante, não o
  // recurso.
  function reincluirLinha(cor: string, tamanho: string) {
    if (api.salvando) return;
    setRemovidas((prev) => {
      const next = new Set(prev);
      next.delete(chaveGrade(cor, tamanho));
      return next;
    });
  }

  // Task 8 liga a UI; a função já é a definitiva.
  function aplicarMassa(opts: OpcoesMassa) {
    if (api.salvando) return;
    setLinhas((prev) => aplicarEmMassa(prev, opts));
  }
```

(i) Acrescentar `aplicarEmMassa` ao import de `@/lib/cadastro-grade`.

- [ ] **Step 6: Adaptar os testes existentes do dialog**

Aplicar a tabela de conversão da abertura desta task em `src/components/estoque/__tests__/dialog-cadastro-grade.test.tsx`. Duas notas obrigatórias:

- O modo padrão da matriz é **Estoque**. Todo teste que digita GTIN precisa clicar na aba antes: `await user.click(screen.getByRole('button', { name: 'GTIN' }));`
- `override de uma linha vence o cabeçalho no payload` fica assim (a parte alterada):

```tsx
    await user.click(screen.getByRole('checkbox', { name: 'P' }));
    await user.click(screen.getByRole('button', { name: 'Preço' }));
    const celula = screen.getByLabelText('Preço mínimo (líquido) de Preto · P');
    await user.clear(celula);
    await user.type(celula, '129,90');
    await user.click(screen.getByRole('button', { name: 'Cadastrar' }));

    await waitFor(() => expect(cadastrarProdutoMock).toHaveBeenCalledTimes(1));
    expect(cadastrarProdutoMock.mock.calls[0][0].variacoes[0].preco).toBe(129.9);
```

Acrescentar também este teste novo ao describe `DialogCadastroGrade — herança de campo`:

```tsx
  // Regra explícita do spec: apagar a célula até vazio NÃO volta a herdar — vira override ''.
  // Voltar a herdar é só por ação explícita. Sem este teste, "célula vazia herda de novo" seria
  // uma mudança de comportamento que a suíte inteira aprovaria em silêncio.
  it('esvaziar a célula vira override vazio, não volta a herdar', async () => {
    const user = userEvent.setup();
    renderGrade();
    await user.type(screen.getByLabelText('Preço mínimo (líquido)'), '99,90');
    await user.click(screen.getByRole('checkbox', { name: 'Preto' }));
    await user.click(screen.getByRole('checkbox', { name: 'P' }));
    await user.click(screen.getByRole('button', { name: 'Preço' }));
    const celula = screen.getByLabelText('Preço mínimo (líquido) de Preto · P');
    await user.clear(celula);
    expect(celula).toHaveValue('');
    // O botão de voltar ao herdado existe justamente porque o vazio NÃO volta sozinho.
    expect(screen.getByRole('button', {
      name: 'Voltar a herdar Preço mínimo (líquido) de Preto · P',
    })).toBeInTheDocument();
    await user.click(screen.getByRole('button', {
      name: 'Voltar a herdar Preço mínimo (líquido) de Preto · P',
    }));
    expect(screen.getByLabelText('Preço mínimo (líquido) de Preto · P')).toHaveValue('99,90');
  });
```

- [ ] **Step 7: Rodar a suíte dos dois arquivos**

Run: `pnpm vitest run src/components/estoque/__tests__/dialog-cadastro-grade.test.tsx src/components/estoque/__tests__/matriz-grade.test.tsx`
Expected: PASS em todos.

- [ ] **Step 8: Rodar a suíte inteira (a matriz mexe num componente compartilhado de tabela)**

Run: `pnpm test`
Expected: PASS. `linha-grade-form.test.tsx` continua verde — o componente ainda existe, só saiu do dialog; ele é apagado na Task 5.

- [ ] **Step 9: Commit**

```bash
/usr/bin/git add src/components/estoque/matriz-grade.tsx src/components/estoque/__tests__/matriz-grade.test.tsx src/components/estoque/dialog-cadastro-grade.tsx src/components/estoque/__tests__/dialog-cadastro-grade.test.tsx
/usr/bin/git commit -m "feat(grade): matriz Cor x Tamanho com 4 modos substitui a lista de cards"
```

---

## Task 5: `detalhes-sku.tsx` (drawer) e fim do `linha-grade-form.tsx`

**Files:**
- Create: `src/components/estoque/detalhes-sku.tsx`
- Create: `src/components/estoque/__tests__/detalhes-sku.test.tsx`
- Delete: `src/components/estoque/linha-grade-form.tsx`
- Delete: `src/components/estoque/__tests__/linha-grade-form.test.tsx`
- Modify: `src/components/estoque/matriz-grade.tsx` (botão "Detalhes" na célula + monta o Sheet)
- Modify: `src/components/estoque/dialog-cadastro-grade.tsx` (import de `ROTULOS` passa a vir de `detalhes-sku`)

**Interfaces:**
- Consumes: `MatrizGrade` (Task 4), `CAMPOS_HERDAVEIS`, `resolverLinha`, `erroCampo`.
- Produces: `DetalhesSku` e `ROTULOS` (reexportado deste arquivo a partir de agora). Nenhuma task posterior muda a assinatura.

**Atenção à colisão de rótulo:** com o drawer aberto, `Preço mínimo (líquido) de Azul · M` existe na célula **e** no drawer. Todas as consultas dos testes deste arquivo e dos que abrem o drawer usam `within(screen.getByRole('dialog'))`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/components/estoque/__tests__/detalhes-sku.test.tsx` (porte de `linha-grade-form.test.tsx` — o cadeado vira radio):

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DetalhesSku } from '@/components/estoque/detalhes-sku';
import {
  novaLinhaGrade, resolverLinha, type CamposHerdaveis, type LinhaGrade,
} from '@/lib/cadastro-grade';

const CABECALHO: CamposHerdaveis = {
  preco: '99,90', custo: '40', pesoGramas: '300',
  alturaCm: '5', larguraCm: '20', comprimentoCm: '30',
};

function montar(linha: LinhaGrade = novaLinhaGrade('Azul', 'M'), props: {
  desabilitado?: boolean; tentouSalvar?: boolean;
} = {}) {
  const spies = {
    onFechar: vi.fn(), onMudarOverride: vi.fn(), onDestravar: vi.fn(), onVoltarAHerdar: vi.fn(),
  };
  render(
    <DetalhesSku
      linha={linha}
      resolvida={resolverLinha(CABECALHO, {}, linha)}
      tentouSalvar={props.tentouSalvar ?? false}
      desabilitado={props.desabilitado ?? false}
      {...spies}
    />,
  );
  return spies;
}

describe('DetalhesSku', () => {
  it('identifica o SKU por "Cor · Tamanho", nunca por "Variação N"', () => {
    montar();
    expect(screen.getByText('Azul · M')).toBeInTheDocument();
    expect(screen.queryByText(/Variação \d/)).not.toBeInTheDocument();
  });

  it('mostra os 6 campos herdáveis, todos herdando por padrão', () => {
    montar();
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByLabelText('Preço mínimo (líquido) de Azul · M')).toBeDisabled();
    expect(within(drawer).getByLabelText('Custo de Azul · M')).toBeDisabled();
    expect(within(drawer).getByLabelText('Peso (g) de Azul · M')).toBeDisabled();
    expect(within(drawer).getByLabelText('Comprimento (cm) de Azul · M')).toBeDisabled();
  });

  it('mostra o indicador visual de unidade (R$/g/cm), não só no aria-label', () => {
    montar();
    const drawer = within(screen.getByRole('dialog'));
    expect(drawer.getAllByText('R$')).toHaveLength(2);   // preço e custo
    expect(drawer.getByText('g')).toBeInTheDocument();    // peso
    expect(drawer.getAllByText('cm')).toHaveLength(3);    // altura, largura, comprimento
  });

  // O cadeado do card virou radio (mockup do Diego): a escolha fica visível sem hover e o estado
  // "herdando" deixa de ser um ícone que o operador precisa decodificar.
  it('escolher "Usar valor específico" destrava SÓ aquele campo', async () => {
    const user = userEvent.setup();
    const { onDestravar } = montar();
    await user.click(screen.getByRole('radio', { name: 'Usar valor específico — Custo' }));
    expect(onDestravar).toHaveBeenCalledWith('custo');
    expect(onDestravar).toHaveBeenCalledTimes(1);
  });

  it('campo com override nasce em "Usar valor específico" e é editável', async () => {
    const user = userEvent.setup();
    const linha = { ...novaLinhaGrade('Azul', 'M'), overrides: { preco: '129,90' } };
    const { onMudarOverride } = montar(linha);
    const drawer = within(screen.getByRole('dialog'));
    expect(drawer.getByRole('radio', { name: 'Usar valor específico — Preço mínimo (líquido)' }))
      .toBeChecked();
    const campo = drawer.getByLabelText('Preço mínimo (líquido) de Azul · M');
    expect(campo).toBeEnabled();
    await user.type(campo, '9');
    expect(onMudarOverride).toHaveBeenCalledWith('preco', '129,909');
  });

  it('escolher "Herdar do produto" num campo com override devolve a herança', async () => {
    const user = userEvent.setup();
    const linha = { ...novaLinhaGrade('Azul', 'M'), overrides: { preco: '129,90' } };
    const { onVoltarAHerdar } = montar(linha);
    await user.click(screen.getByRole('radio', {
      name: 'Herdar do produto — Preço mínimo (líquido)',
    }));
    expect(onVoltarAHerdar).toHaveBeenCalledWith('preco');
  });

  it('campo destravado com valor inválido mostra o erro depois de tentar salvar', () => {
    const linha = { ...novaLinhaGrade('Azul', 'M'), overrides: { preco: '0' } };
    montar(linha, { tentouSalvar: true });
    expect(screen.getByText(/obrigatório e deve ser maior que zero/i)).toBeInTheDocument();
  });

  // Pedido do Diego (2026-09-19): a foto é escolhida uma vez por cor, no passo anterior.
  it('não existe campo de foto por SKU — a foto é só por cor', () => {
    montar();
    expect(screen.queryByLabelText(/Foto de Azul · M/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Escolher foto/i)).not.toBeInTheDocument();
  });

  // A linha PRECISA ter override: num campo herdando, `disabled={desabilitado || !especifico}`
  // já seria `true` pelo segundo termo, e apagar o `desabilitado ||` passaria verde.
  it('desabilitado congela os campos e os radios', () => {
    const linha = { ...novaLinhaGrade('Azul', 'M'), overrides: { preco: '129,90' } };
    montar(linha, { desabilitado: true });
    const drawer = within(screen.getByRole('dialog'));
    expect(drawer.getByRole('radio', { name: 'Usar valor específico — Custo' })).toBeDisabled();
    expect(drawer.getByLabelText('Preço mínimo (líquido) de Azul · M')).toBeDisabled();
  });

  // Portado de `linha-grade-form.test.tsx`: cor e tamanho são a chave da reconciliação e não
  // podem virar campo em lugar nenhum — nem no drawer.
  it('cor e tamanho são texto, não campos editáveis', () => {
    montar();
    const drawer = within(screen.getByRole('dialog'));
    expect(drawer.queryByLabelText(/^Cor/)).not.toBeInTheDocument();
    expect(drawer.queryByLabelText(/^Tamanho/)).not.toBeInTheDocument();
  });

  it('linha null mantém o drawer fechado', () => {
    render(
      <DetalhesSku
        linha={null} resolvida={null} tentouSalvar={false} desabilitado={false}
        onFechar={vi.fn()} onMudarOverride={vi.fn()} onDestravar={vi.fn()} onVoltarAHerdar={vi.fn()}
      />,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
```

Acrescentar `within` ao import de `@testing-library/react` no topo do arquivo.

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm vitest run src/components/estoque/__tests__/detalhes-sku.test.tsx`
Expected: FAIL — não resolve `@/components/estoque/detalhes-sku`.

- [ ] **Step 3: Implementar `detalhes-sku.tsx`**

Criar `src/components/estoque/detalhes-sku.tsx`:

```tsx
// Detalhes do SKU (spec 2026-09-19 "matriz"): segundo nível da matriz. É o bloco expandido que
// vivia em `linha-grade-form.tsx`, com uma troca deliberada — o cadeado virou um par de radios
// "Herdar do produto" / "Usar valor específico" (mockup do Diego). O estado de herança deixa de
// ser um ícone a decodificar.
//
// Sem estado próprio: a decisão de herdar é a PRESENÇA da chave em `linha.overrides`, exatamente
// como `resolverLinha` lê. Um `useState` de "destravado" aqui divergiria do dado na primeira
// aplicação em massa vinda de fora.
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { erroCampo } from '@/components/estoque/linha-variacao-form';
import {
  CAMPOS_HERDAVEIS, type CampoHerdavel, type LinhaGrade, type LinhaResolvida,
} from '@/lib/cadastro-grade';
import { cn } from '@/lib/utils';

// Exportado daqui a partir da Task 5 (antes vivia em `linha-grade-form.tsx`, apagado nesta mesma
// task). Gera warning de `react-refresh/only-export-components`, aceito: o
// `allowConstantExport: true` (eslint.config.js:26-29) só isenta literal primitivo, e `ROTULOS`
// é um objeto — mesmo caso já documentado em `gerador-variacoes.tsx` para `CORES_POPULARES`.
export const ROTULOS: Record<CampoHerdavel, { rotulo: string; prefixo?: string; sufixo?: string }> = {
  // Rótulo idêntico ao de `linha-variacao-form.tsx` — é a ponte com a Revisão, que exibe este
  // mesmo valor como "mín. líquido".
  preco: { rotulo: 'Preço mínimo (líquido)', prefixo: 'R$' },
  custo: { rotulo: 'Custo', prefixo: 'R$' },
  pesoGramas: { rotulo: 'Peso', sufixo: 'g' },
  alturaCm: { rotulo: 'Altura', sufixo: 'cm' },
  larguraCm: { rotulo: 'Largura', sufixo: 'cm' },
  comprimentoCm: { rotulo: 'Comprimento', sufixo: 'cm' },
};

export function DetalhesSku({
  linha, resolvida, tentouSalvar, desabilitado,
  onFechar, onMudarOverride, onDestravar, onVoltarAHerdar,
}: {
  /** `null` = drawer fechado. A matriz guarda só o `clientId` aberto. */
  linha: LinhaGrade | null;
  resolvida: LinhaResolvida | null;
  tentouSalvar: boolean;
  desabilitado: boolean;
  onFechar: () => void;
  onMudarOverride: (campo: CampoHerdavel, valor: string) => void;
  /** Destravar semeia o override com o valor RESOLVIDO (decisão do dialog) — não viola "nunca
   *  copiar o herdado": um campo deliberadamente destravado parou de seguir o cabeçalho. */
  onDestravar: (campo: CampoHerdavel) => void;
  onVoltarAHerdar: (campo: CampoHerdavel) => void;
}) {
  if (!linha || !resolvida) return null;
  const nome = `${linha.cor} · ${linha.tamanho}`;
  const id = (campo: string) => `sku-${linha.clientId}-${campo}`;

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onFechar(); }}>
      <SheetContent className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{nome}</SheetTitle>
          <SheetDescription>
            Cada campo herda do produto por padrão. Marque "Usar valor específico" só no que for
            exceção deste SKU.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-4 pb-4">
          {CAMPOS_HERDAVEIS.map((campo) => {
            const { rotulo, prefixo, sufixo } = ROTULOS[campo];
            const especifico = campo in linha.overrides;
            const erro = erroCampo(campo, resolvida[campo]);
            return (
              <div key={campo} className="flex flex-col gap-1.5 border-b pb-3 last:border-b-0">
                <label htmlFor={id(campo)} className="text-sm font-medium">{rotulo}</label>
                <RadioGroup
                  className="flex items-center gap-4"
                  value={especifico ? 'especifico' : 'herdado'}
                  disabled={desabilitado}
                  onValueChange={(v) => (v === 'especifico' ? onDestravar(campo) : onVoltarAHerdar(campo))}
                >
                  <span className="flex items-center gap-1.5 text-xs">
                    <RadioGroupItem
                      value="herdado"
                      id={`${id(campo)}-herdado`}
                      aria-label={`Herdar do produto — ${rotulo}`}
                      disabled={desabilitado}
                    />
                    Herdar do produto
                  </span>
                  <span className="flex items-center gap-1.5 text-xs">
                    <RadioGroupItem
                      value="especifico"
                      id={`${id(campo)}-especifico`}
                      aria-label={`Usar valor específico — ${rotulo}`}
                      disabled={desabilitado}
                    />
                    Usar valor específico
                  </span>
                </RadioGroup>
                <div className="relative">
                  {prefixo && (
                    <span className="pointer-events-none absolute inset-y-0 left-2 flex items-center text-xs text-muted-foreground">
                      {prefixo}
                    </span>
                  )}
                  <Input
                    id={id(campo)}
                    aria-label={`${rotulo}${sufixo ? ` (${sufixo})` : ''} de ${nome}`}
                    className={cn('h-8 text-sm', prefixo && 'pl-8', sufixo && 'pr-7')}
                    value={resolvida[campo]}
                    disabled={desabilitado || !especifico}
                    onChange={(e) => onMudarOverride(campo, e.target.value)}
                  />
                  {sufixo && (
                    <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs text-muted-foreground">
                      {sufixo}
                    </span>
                  )}
                </div>
                {erro && tentouSalvar && especifico && (
                  <span className="text-xs text-destructive">{erro}</span>
                )}
              </div>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm vitest run src/components/estoque/__tests__/detalhes-sku.test.tsx`
Expected: PASS.

- [ ] **Step 5: Ligar o drawer na matriz**

Em `src/components/estoque/matriz-grade.tsx`:

(a) Trocar o import `from '@/components/estoque/linha-grade-form'` por `from '@/components/estoque/detalhes-sku'`, importando também `DetalhesSku`:

```tsx
import { DetalhesSku, ROTULOS } from '@/components/estoque/detalhes-sku';
```

(b) Acrescentar `SlidersHorizontal` ao import de `lucide-react`.

(c) Acrescentar à assinatura de props (e ao tipo):

```tsx
  onDestravar: (clientId: string, campo: CampoHerdavel) => void;
```

(d) Acrescentar, junto do `useState` de `modo`:

```tsx
  // SÓ o clientId, nunca a linha: a linha vem sempre de `linhas`, que é a fonte.
  const [detalhesDe, setDetalhesDe] = useState<string | null>(null);
```

(e) Acrescentar o botão na célula, logo antes do botão "Remover":

```tsx
        <Button
          type="button" variant="ghost" size="sm"
          className="h-6 w-6 shrink-0 p-0 opacity-0 focus-visible:opacity-100 group-hover/celula:opacity-100"
          disabled={desabilitado}
          aria-label={`Detalhes de ${nome}`}
          onClick={() => setDetalhesDe(linha.clientId)}
        >
          <SlidersHorizontal className="h-3 w-3" />
        </Button>
```

(f) Montar o drawer no fim do JSX, depois do `<span id="matriz-herdado">`:

```tsx
      {(() => {
        // Índice por clientId derivado na hora: o drawer nunca guarda posição.
        const i = linhas.findIndex((l) => l.clientId === detalhesDe);
        return (
          <DetalhesSku
            linha={i >= 0 ? linhas[i]! : null}
            resolvida={i >= 0 ? resolvidas[i]! : null}
            tentouSalvar={tentouSalvar}
            desabilitado={desabilitado}
            onFechar={() => setDetalhesDe(null)}
            onMudarOverride={(campo, valor) => onMudarOverride(linhas[i]!.clientId, campo, valor)}
            onDestravar={(campo) => onDestravar(linhas[i]!.clientId, campo)}
            onVoltarAHerdar={(campo) => onVoltarAHerdar(linhas[i]!.clientId, campo)}
          />
        );
      })()}
```

(g) Acrescentar o teste correspondente em `matriz-grade.test.tsx`:

```tsx
describe('MatrizGrade — drawer de detalhes', () => {
  it('abre o drawer do SKU e destrava um campo ali', async () => {
    const user = userEvent.setup();
    const linhas = gradeCheia();
    const { onDestravar } = montar(linhas);
    await user.click(screen.getByRole('button', { name: 'Detalhes de Preto · M' }));
    const drawer = within(screen.getByRole('dialog'));
    expect(drawer.getByText('Preto · M')).toBeInTheDocument();
    await user.click(drawer.getByRole('radio', { name: 'Usar valor específico — Altura' }));
    expect(onDestravar).toHaveBeenCalledWith(linhas[1]!.clientId, 'alturaCm');
  });
});
```

Acrescentar `onDestravar: vi.fn()` ao objeto `spies` do helper `montar`.

- [ ] **Step 6: Ligar `onDestravar` no dialog**

Em `src/components/estoque/dialog-cadastro-grade.tsx`:

(a) Trocar o import de `ROTULOS`:

```tsx
import { ROTULOS } from '@/components/estoque/detalhes-sku';
```

(b) Acrescentar a função e passá-la à matriz:

```tsx
  // Destravar semeia o override com o valor RESOLVIDO: o campo parou de seguir o cabeçalho, então
  // guardar o valor não viola "nunca copiar o herdado". É o oposto da célula da matriz, onde o
  // operador já está digitando o valor que quer.
  function destravar(clientId: string, campo: CampoHerdavel) {
    setLinhas((prev) => prev.map((x) => (
      x.clientId === clientId
        ? { ...x, overrides: { ...x.overrides, [campo]: resolverLinha(cabecalho, fotoPorCor, x)[campo] } }
        : x
    )));
  }
```

```tsx
                    onDestravar={destravar}
```

- [ ] **Step 7: Apagar `linha-grade-form.tsx` e seu teste**

```bash
/usr/bin/git rm src/components/estoque/linha-grade-form.tsx src/components/estoque/__tests__/linha-grade-form.test.tsx
```

Conferir que nenhum import sobrou:

Run: `grep -rn "linha-grade-form" src/`
Expected: nenhuma linha.

- [ ] **Step 8: Rodar a suíte inteira**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
/usr/bin/git add src/components/estoque/detalhes-sku.tsx src/components/estoque/__tests__/detalhes-sku.test.tsx src/components/estoque/matriz-grade.tsx src/components/estoque/__tests__/matriz-grade.test.tsx src/components/estoque/dialog-cadastro-grade.tsx
/usr/bin/git commit -m "feat(grade): drawer Detalhes do SKU substitui o card expandido"
```

---

## Task 6: célula removida oferece "+" para reincluir

**Files:**
- Modify: `src/components/estoque/matriz-grade.tsx` (a Task 4 renderiza `—` para toda célula sem linha; esta task distingue a combinação removida na mão, que ganha o `+`)
- Test: `src/components/estoque/__tests__/matriz-grade.test.tsx`
- Test: `src/components/estoque/__tests__/dialog-cadastro-grade.test.tsx` (ciclo completo pelo dialog)

**Interfaces:**
- Consumes: `MatrizGrade` com `removidas` e `onReincluirCelula` (Task 4), `reincluirLinha` do dialog (Task 4, step 5h).
- Produces: nada novo.

- [ ] **Step 1: Escrever os testes que falham**

Em `src/components/estoque/__tests__/matriz-grade.test.tsx`:

```tsx
describe('MatrizGrade — célula removida', () => {
  // O card antigo simplesmente sumia da lista. Na matriz a célula continua visível no espaço, e
  // sem affordance vira um buraco mudo que o operador não sabe desfazer.
  it('combinação removida na mão mostra "+" no lugar do campo', () => {
    const linhas = [
      novaLinhaGrade('Preto', 'M'), novaLinhaGrade('Branco', 'P'), novaLinhaGrade('Branco', 'M'),
    ];
    montar(linhas, { removidas: new Set(['Preto\u0000P']) });
    expect(screen.queryByLabelText('Estoque inicial de Preto · P')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reincluir Preto · P' })).toBeInTheDocument();
  });

  it('clicar no "+" reporta a combinação a reincluir', async () => {
    const user = userEvent.setup();
    const linhas = [novaLinhaGrade('Preto', 'M'), novaLinhaGrade('Branco', 'P'), novaLinhaGrade('Branco', 'M')];
    const { onReincluirCelula } = montar(linhas, { removidas: new Set(['Preto\u0000P']) });
    await user.click(screen.getByRole('button', { name: 'Reincluir Preto · P' }));
    expect(onReincluirCelula).toHaveBeenCalledWith('Preto', 'P');
  });

  // A contraparte ("sem linha e sem exclusão → inerte") já está coberta desde a Task 4, no teste
  // `combinação sem linha fica inerte, sem campo`. É ela que impede esta task de oferecer "+" no
  // frame pré-reconciliação — não duplicar aqui.

  it('"+" congela durante o salvamento', () => {
    montar([novaLinhaGrade('Preto', 'M')], {
      removidas: new Set(['Preto\u0000P']), desabilitado: true, cores: ['Preto'], tamanhos: ['P', 'M'],
    });
    expect(screen.getByRole('button', { name: 'Reincluir Preto · P' })).toBeDisabled();
  });
});
```

Em `src/components/estoque/__tests__/dialog-cadastro-grade.test.tsx`, no describe `passo 2 (seleção) reconcilia a grade`:

```tsx
  // Ciclo completo: remover, ver o "+", reincluir. A reinclusão limpa a chave de `removidas`, e
  // o efeito de reconciliação recria a linha — com GTIN/estoque em branco, porque é uma linha
  // nova, não a antiga ressuscitada.
  it('reincluir pelo "+" devolve a combinação removida', async () => {
    const user = userEvent.setup();
    renderGrade();
    await user.click(screen.getByRole('checkbox', { name: 'Preto' }));
    await user.click(screen.getByRole('checkbox', { name: 'P' }));
    await user.click(screen.getByRole('checkbox', { name: 'M' }));
    await user.click(screen.getByRole('button', { name: 'Remover Preto · P' }));
    expect(screen.queryByLabelText('Estoque inicial de Preto · P')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reincluir Preto · P' }));
    expect(screen.getByLabelText('Estoque inicial de Preto · P')).toBeInTheDocument();
    expect(screen.getByLabelText('Estoque inicial de Preto · P')).toHaveValue('');
  });
```

- [ ] **Step 2: Rodar e confirmar que falham**

Run: `pnpm vitest run src/components/estoque/__tests__/matriz-grade.test.tsx -t "célula removida" && pnpm vitest run src/components/estoque/__tests__/dialog-cadastro-grade.test.tsx -t "Reincluir"`
Expected: FAIL nos 3 testes que esperam o botão `Reincluir …` (a Task 4 renderiza `—` para toda célula sem linha). O teste `célula sem linha e sem exclusão registrada fica inerte` passa desde a Task 4 — é a rede que impede esta task de oferecer `+` no frame pré-reconciliação.

- [ ] **Step 3: Implementar a distinção**

Em `src/components/estoque/matriz-grade.tsx`, renomear `_removidas` → `removidas` e `_onReincluirCelula` → `onReincluirCelula` na desestruturação, e trocar o ramo `i === undefined` de `celula(...)`:

```tsx
    const i = indice.get(chave);
    if (i === undefined) {
      // Combinação removida na mão → affordance de reinclusão. O card antigo simplesmente sumia
      // da lista; a célula continua visível no espaço, e sem isto vira um buraco mudo que o
      // operador não sabe desfazer.
      //
      // SEM chave em `removidas` é outra coisa: um frame pré-reconciliação, em que a linha ainda
      // não foi criada. Oferecer "+" ali convidaria a reincluir algo que nunca saiu.
      if (!removidas.has(chave)) {
        return <span className="text-xs text-muted-foreground" aria-hidden="true">—</span>;
      }
      return (
        <Button
          type="button" variant="ghost" size="sm"
          className="h-8 w-full p-0 text-muted-foreground"
          // `data-r`/`data-c` também aqui: sem eles o Enter da Task 7 morre em silêncio exatamente
          // onde a grade parcial existe.
          data-r={r}
          data-c={c}
          disabled={desabilitado}
          aria-label={`Reincluir ${cor} · ${tamanho}`}
          onClick={() => onReincluirCelula(cor, tamanho)}
        >
          +
        </Button>
      );
    }
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm vitest run src/components/estoque/__tests__/matriz-grade.test.tsx src/components/estoque/__tests__/dialog-cadastro-grade.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add src/components/estoque/matriz-grade.tsx src/components/estoque/__tests__/matriz-grade.test.tsx src/components/estoque/__tests__/dialog-cadastro-grade.test.tsx
/usr/bin/git commit -m "feat(grade): celula removida oferece + para reincluir a combinacao"
```

---

## Task 7: navegação por teclado

**Files:**
- Modify: `src/components/estoque/matriz-grade.tsx`
- Test: `src/components/estoque/__tests__/matriz-grade.test.tsx`

**Interfaces:**
- Consumes: os atributos `data-r`/`data-c` já emitidos pela célula editável **e** pelo botão "+" (Task 4).
- Produces: nada exportado. O contrato é o DOM.

**Regra inegociável:** célula ativa **não** é estado React. Um `useState` de célula ativa rerenderiza as até 60 células a cada tecla. O movimento é `document`/`container.querySelector('[data-r=…][data-c=…]')` + `element.focus()`.

- [ ] **Step 1: Escrever os testes que falham**

Em `src/components/estoque/__tests__/matriz-grade.test.tsx`:

```tsx
describe('MatrizGrade — teclado', () => {
  it('Enter move para a célula de baixo, na mesma coluna', async () => {
    const user = userEvent.setup();
    montar(gradeCheia());
    const topo = screen.getByLabelText('Estoque inicial de Preto · M');
    topo.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByLabelText('Estoque inicial de Branco · M')).toHaveFocus();
  });

  it('Enter na última linha não rouba o foco nem submete nada', async () => {
    const user = userEvent.setup();
    montar(gradeCheia());
    const base = screen.getByLabelText('Estoque inicial de Branco · P');
    base.focus();
    await user.keyboard('{Enter}');
    expect(base).toHaveFocus();
  });

  // Grade parcial: a célula de baixo é um "+", não um campo. Sem `data-r`/`data-c` no botão, o
  // Enter morre em silêncio exatamente onde a grade parcial existe.
  it('Enter cai no "+" quando a célula de baixo foi removida', async () => {
    const user = userEvent.setup();
    const linhas = [novaLinhaGrade('Preto', 'P'), novaLinhaGrade('Preto', 'M'), novaLinhaGrade('Branco', 'M')];
    montar(linhas, { removidas: new Set(['Branco\u0000P']) });
    const topo = screen.getByLabelText('Estoque inicial de Preto · P');
    topo.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'Reincluir Branco · P' })).toHaveFocus();
  });

  it('ArrowDown/ArrowUp andam na coluna', async () => {
    const user = userEvent.setup();
    montar(gradeCheia());
    screen.getByLabelText('Estoque inicial de Preto · P').focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByLabelText('Estoque inicial de Branco · P')).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(screen.getByLabelText('Estoque inicial de Preto · P')).toHaveFocus();
  });

  // A seta lateral só muda de célula na BORDA do valor — no meio do texto ela é o cursor, e
  // roubar isso torna impossível corrigir um dígito no meio de um GTIN de 13 caracteres.
  it('ArrowRight no meio do texto move o cursor, não a célula', async () => {
    const user = userEvent.setup();
    const linhas = gradeCheia();
    linhas[0] = { ...linhas[0]!, estoqueInicial: '123' };
    montar(linhas);
    const campo = screen.getByLabelText('Estoque inicial de Preto · P') as HTMLInputElement;
    campo.focus();
    campo.setSelectionRange(1, 1);
    await user.keyboard('{ArrowRight}');
    expect(campo).toHaveFocus();
  });

  it('ArrowRight na borda direita do valor pula para a célula ao lado', async () => {
    const user = userEvent.setup();
    const linhas = gradeCheia();
    linhas[0] = { ...linhas[0]!, estoqueInicial: '123' };
    montar(linhas);
    const campo = screen.getByLabelText('Estoque inicial de Preto · P') as HTMLInputElement;
    campo.focus();
    campo.setSelectionRange(3, 3);
    await user.keyboard('{ArrowRight}');
    expect(screen.getByLabelText('Estoque inicial de Preto · M')).toHaveFocus();
  });

  // Tab/Shift+Tab são do NAVEGADOR: a ordem do DOM já é coluna-dentro-de-linha. Interceptá-los
  // quebraria a saída da matriz para o resto do formulário.
  it('Tab não é interceptado — segue a ordem do DOM', async () => {
    const user = userEvent.setup();
    montar(gradeCheia());
    screen.getByLabelText('Estoque inicial de Preto · P').focus();
    await user.tab();
    expect(screen.getByLabelText('Estoque inicial de Preto · P')).not.toHaveFocus();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm vitest run src/components/estoque/__tests__/matriz-grade.test.tsx -t "teclado"`
Expected: FAIL — o foco não se move (Enter/setas não fazem nada).

- [ ] **Step 3: Implementar**

Em `src/components/estoque/matriz-grade.tsx`, acrescentar `useRef` ao import do React e, dentro do componente:

```tsx
  // A referência é do CONTAINER, não de célula nenhuma: o alvo é encontrado por seletor a cada
  // tecla. Guardar "célula ativa" em estado React rerenderizaria as até 60 células por tecla.
  const containerRef = useRef<HTMLDivElement>(null);

  /** Move o foco para a célula (r, c). Alvo pode ser o `<input>` OU o botão "+" de uma célula
   *  removida — os dois carregam `data-r`/`data-c` justamente por isto. Fora da matriz, no-op:
   *  na borda o foco fica onde está, sem beep e sem pular para outro canto do formulário. */
  function focarCelula(r: number, c: number) {
    const alvo = containerRef.current
      ?.querySelector<HTMLElement>(`[data-r="${r}"][data-c="${c}"]`);
    alvo?.focus();
  }

  function teclado(e: React.KeyboardEvent<HTMLDivElement>) {
    const alvo = e.target as HTMLElement;
    const r = Number(alvo.dataset.r);
    const c = Number(alvo.dataset.c);
    if (Number.isNaN(r) || Number.isNaN(c)) return;

    if (e.key === 'Enter' || e.key === 'ArrowDown') {
      // `preventDefault` no Enter também impede o submit implícito do formulário do dialog.
      e.preventDefault();
      focarCelula(r + 1, c);
      return;
    }
    if (e.key === 'ArrowUp') { e.preventDefault(); focarCelula(r - 1, c); return; }

    // Setas laterais só saem da célula na BORDA do valor. No meio do texto elas são o cursor —
    // sem isso ninguém corrige um dígito no meio de um GTIN de 13 caracteres.
    const input = alvo instanceof HTMLInputElement ? alvo : null;
    if (e.key === 'ArrowLeft') {
      if (input && input.selectionStart !== 0) return;
      e.preventDefault(); focarCelula(r, c - 1); return;
    }
    if (e.key === 'ArrowRight') {
      if (input && input.selectionEnd !== input.value.length) return;
      e.preventDefault(); focarCelula(r, c + 1);
    }
    // Tab/Shift+Tab: NÃO interceptar. A ordem do DOM já é coluna-dentro-de-linha, e capturá-los
    // impediria o operador de sair da matriz para o resto do formulário.
  }
```

Pôr `ref` e `onKeyDown` no `<div>` externo do componente:

```tsx
    <div ref={containerRef} onKeyDown={teclado} className="flex min-w-0 flex-col gap-2">
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm vitest run src/components/estoque/__tests__/matriz-grade.test.tsx`
Expected: PASS.

- [ ] **Step 5: Rodar a suíte do dialog (o Enter agora dá `preventDefault`)**

Run: `pnpm vitest run src/components/estoque/__tests__/dialog-cadastro-grade.test.tsx`
Expected: PASS — inclusive `Enter no campo de nova cor não passa por cima do teto de 60`, que é um `onKeyDown` de `gerador-variacoes.tsx`, fora do container da matriz.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add src/components/estoque/matriz-grade.tsx src/components/estoque/__tests__/matriz-grade.test.tsx
/usr/bin/git commit -m "feat(grade): navegacao por teclado na matriz via foco DOM, sem estado por celula"
```

---

## Task 8: `preencher-em-massa.tsx` e cabeçalhos clicáveis

**Files:**
- Create: `src/components/estoque/preencher-em-massa.tsx`
- Create: `src/components/estoque/__tests__/preencher-em-massa.test.tsx`
- Modify: `src/components/estoque/matriz-grade.tsx` (cabeçalhos de linha/coluna viram gatilhos; botão geral)
- Test: `src/components/estoque/__tests__/dialog-cadastro-grade.test.tsx` (fluxo real do Diego, ponta a ponta até o payload)

**Interfaces:**
- Consumes: `aplicarEmMassa`, `OpcoesMassa`, `EscopoMassa` (Task 3), `aplicarMassa` do dialog (Task 4, step 5h), `ROTULOS` (Task 5).
- Produces: `PreencherEmMassa` — assinatura na seção "Interfaces públicas novas".

- [ ] **Step 1: Escrever o teste do popover (falha)**

Criar `src/components/estoque/__tests__/preencher-em-massa.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PreencherEmMassa } from '@/components/estoque/preencher-em-massa';

type Escopo = Parameters<typeof PreencherEmMassa>[0]['escopoInicial'];

// O rótulo é DERIVADO do escopo, igual ao que a matriz faz: um helper que sempre dissesse
// "no tamanho GG" faria os testes de escopo por cor lerem como se o gatilho fosse a coluna GG.
function rotuloDe(e: Escopo): string {
  if (e.tipo === 'todos') return 'Preencher em massa';
  return e.tipo === 'cor'
    ? `Preencher em massa na cor ${e.valor}`
    : `Preencher em massa no tamanho ${e.valor}`;
}

function montar(escopoInicial: Escopo, desabilitado = false) {
  const onAplicar = vi.fn();
  const rotulo = rotuloDe(escopoInicial);
  render(
    <PreencherEmMassa
      escopoInicial={escopoInicial}
      cores={['Preto', 'Branco']}
      tamanhos={['P', 'GG']}
      desabilitado={desabilitado}
      gatilho={escopoInicial.tipo === 'todos' ? 'Preencher em massa' : escopoInicial.valor}
      rotuloGatilho={rotulo}
      onAplicar={onAplicar}
    />,
  );
  return { onAplicar, rotulo };
}

describe('PreencherEmMassa', () => {
  it('abre com o escopo do gatilho já selecionado', async () => {
    const user = userEvent.setup();
    const { rotulo } = montar({ tipo: 'tamanho', valor: 'GG' });
    await user.click(screen.getByRole('button', { name: rotulo }));
    expect(screen.getByLabelText('Aplicar em')).toHaveValue('tamanho');
    expect(screen.getByLabelText('Tamanho')).toHaveValue('GG');
  });

  it('aplica o valor no campo e escopo escolhidos', async () => {
    const user = userEvent.setup();
    const { onAplicar, rotulo } = montar({ tipo: 'tamanho', valor: 'GG' });
    await user.click(screen.getByRole('button', { name: rotulo }));
    await user.selectOptions(screen.getByLabelText('Campo'), 'preco');
    await user.type(screen.getByLabelText('Valor'), '64,90');
    await user.click(screen.getByRole('button', { name: 'Aplicar' }));
    expect(onAplicar).toHaveBeenCalledWith({
      campo: 'preco', escopo: { tipo: 'tamanho', valor: 'GG' }, valor: '64,90',
    });
  });

  it('trocar o escopo para "todos" some com o seletor de valor do eixo', async () => {
    const user = userEvent.setup();
    const { onAplicar, rotulo } = montar({ tipo: 'tamanho', valor: 'GG' });
    await user.click(screen.getByRole('button', { name: rotulo }));
    await user.selectOptions(screen.getByLabelText('Aplicar em'), 'todos');
    expect(screen.queryByLabelText('Tamanho')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Valor'), '3');
    await user.click(screen.getByRole('button', { name: 'Aplicar' }));
    expect(onAplicar).toHaveBeenCalledWith({
      campo: 'estoqueInicial', escopo: { tipo: 'todos' }, valor: '3',
    });
  });

  // `valor: null` em campo herdável = remover o override. É a ÚNICA forma de voltar a herdar em
  // massa; o botão não pode mandar string vazia, que é override vazio (regra do spec).
  it('"Voltar ao herdado" manda valor null, só em campo herdável', async () => {
    const user = userEvent.setup();
    const { onAplicar, rotulo } = montar({ tipo: 'cor', valor: 'Preto' });
    await user.click(screen.getByRole('button', { name: rotulo }));
    await user.selectOptions(screen.getByLabelText('Campo'), 'custo');
    await user.click(screen.getByRole('button', { name: 'Voltar ao herdado' }));
    expect(onAplicar).toHaveBeenCalledWith({
      campo: 'custo', escopo: { tipo: 'cor', valor: 'Preto' }, valor: null,
    });
  });

  it('campo herdável não oferece "Limpar"; estoque/GTIN não oferecem "Voltar ao herdado"', async () => {
    const user = userEvent.setup();
    const { rotulo } = montar({ tipo: 'todos' });
    await user.click(screen.getByRole('button', { name: rotulo }));
    expect(screen.getByRole('button', { name: 'Limpar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Voltar ao herdado' })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Campo'), 'preco');
    expect(screen.queryByRole('button', { name: 'Limpar' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Voltar ao herdado' })).toBeInTheDocument();
  });

  // Regra inegociável: nada nesta tela inventa código de barras.
  it('não existe botão de gerar GTIN', async () => {
    const user = userEvent.setup();
    const { rotulo } = montar({ tipo: 'todos' });
    await user.click(screen.getByRole('button', { name: rotulo }));
    await user.selectOptions(screen.getByLabelText('Campo'), 'gtin');
    expect(screen.queryByRole('button', { name: /gerar/i })).not.toBeInTheDocument();
  });

  it('desabilitado não abre', async () => {
    const user = userEvent.setup();
    const { rotulo } = montar({ tipo: 'todos' }, true);
    const gatilho = screen.getByRole('button', { name: rotulo });
    expect(gatilho).toBeDisabled();
    await user.click(gatilho);
    expect(screen.queryByLabelText('Campo')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm vitest run src/components/estoque/__tests__/preencher-em-massa.test.tsx`
Expected: FAIL — não resolve `@/components/estoque/preencher-em-massa`.

- [ ] **Step 3: Implementar**

Criar `src/components/estoque/preencher-em-massa.tsx`:

```tsx
// Preencher em massa (spec 2026-09-19 "matriz"). Uma instância POR GATILHO: `ui/popover.tsx` não
// exporta `PopoverAnchor`, então um popover único reposicionado exigiria editar o componente de
// UI. O `PopoverContent` do Radix só monta quando aberto — 15 cabeçalhos de linha custam ~zero.
//
// O gatilho PRÉ-SELECIONA o escopo; o operador ainda pode trocá-lo dentro do popover.
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ROTULOS } from '@/components/estoque/detalhes-sku';
import {
  CAMPOS_HERDAVEIS, type CampoMassa, type EscopoMassa, type OpcoesMassa,
} from '@/lib/cadastro-grade';

const CAMPOS: { valor: CampoMassa; rotulo: string }[] = [
  { valor: 'estoqueInicial', rotulo: 'Estoque inicial' },
  { valor: 'gtin', rotulo: 'GTIN' },
  ...CAMPOS_HERDAVEIS.map((c) => ({ valor: c as CampoMassa, rotulo: ROTULOS[c].rotulo })),
];

const CLASSE_SELECT =
  'h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';

export function PreencherEmMassa({
  escopoInicial, cores, tamanhos, desabilitado, gatilho, rotuloGatilho, onAplicar,
}: {
  escopoInicial: EscopoMassa;
  cores: readonly string[];
  tamanhos: readonly string[];
  desabilitado: boolean;
  gatilho: React.ReactNode;
  rotuloGatilho: string;
  onAplicar: (opts: OpcoesMassa) => void;
}) {
  // `useId`, não id fixo: a Task 8 renderiza uma instância por cabeçalho (até ~36 numa grade de
  // calçado). Hoje só não colide porque o `PopoverContent` do Radix desmonta fechado — depender
  // disso é depender de detalhe de implementação de terceiro para a associação label/input.
  const uid = useId();
  const [aberto, setAberto] = useState(false);
  const [escopo, setEscopo] = useState<EscopoMassa>(escopoInicial);
  const [campo, setCampo] = useState<CampoMassa>('estoqueInicial');
  const [valor, setValor] = useState('');
  const herdavel = (CAMPOS_HERDAVEIS as readonly string[]).includes(campo);

  function emitir(v: string | null) {
    onAplicar({ campo, escopo, valor: v });
    setAberto(false);
    setValor('');
  }

  function trocarTipo(tipo: EscopoMassa['tipo']) {
    if (tipo === 'todos') { setEscopo({ tipo: 'todos' }); return; }
    // Primeiro valor do eixo como default: um escopo sem valor não atingiria linha nenhuma e o
    // "Aplicar" viraria um no-op silencioso.
    setEscopo(tipo === 'cor'
      ? { tipo: 'cor', valor: cores[0] ?? '' }
      : { tipo: 'tamanho', valor: tamanhos[0] ?? '' });
  }

  return (
    <Popover
      open={aberto}
      onOpenChange={(o) => {
        // Reabrir sempre volta ao escopo do gatilho: o cabeçalho clicado é a intenção declarada.
        if (o) setEscopo(escopoInicial);
        setAberto(o);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button" variant="ghost" size="sm"
          className="h-auto px-1 py-0.5 font-medium"
          aria-label={rotuloGatilho}
          disabled={desabilitado}
        >
          {gatilho}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="flex w-64 flex-col gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${uid}-escopo`} className="text-xs text-muted-foreground">Aplicar em</label>
          <select
            id={`${uid}-escopo`} className={CLASSE_SELECT}
            value={escopo.tipo}
            onChange={(e) => trocarTipo(e.target.value as EscopoMassa['tipo'])}
          >
            <option value="todos">Toda a grade</option>
            <option value="cor">Uma cor</option>
            <option value="tamanho">Um tamanho</option>
          </select>
        </div>

        {escopo.tipo !== 'todos' && (
          <div className="flex flex-col gap-1">
            <label htmlFor={`${uid}-eixo`} className="text-xs text-muted-foreground">
              {escopo.tipo === 'cor' ? 'Cor' : 'Tamanho'}
            </label>
            <select
              id={`${uid}-eixo`} className={CLASSE_SELECT}
              value={escopo.valor}
              onChange={(e) => setEscopo({ tipo: escopo.tipo, valor: e.target.value })}
            >
              {(escopo.tipo === 'cor' ? cores : tamanhos)
                .map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
        )}

        <div className="flex flex-col gap-1">
          <label htmlFor={`${uid}-campo`} className="text-xs text-muted-foreground">Campo</label>
          <select
            id={`${uid}-campo`} className={CLASSE_SELECT}
            value={campo}
            onChange={(e) => setCampo(e.target.value as CampoMassa)}
          >
            {CAMPOS.map((c) => <option key={c.valor} value={c.valor}>{c.rotulo}</option>)}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={`${uid}-valor`} className="text-xs text-muted-foreground">Valor</label>
          <Input
            id={`${uid}-valor`} className="h-8 text-sm"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); emitir(valor); } }}
          />
        </div>

        <div className="flex items-center gap-2">
          <Button type="button" size="sm" onClick={() => emitir(valor)}>Aplicar</Button>
          {herdavel ? (
            // `null`, não `''`: string vazia é override vazio (o operador decidiu "sem valor"),
            // e só a AUSÊNCIA da chave devolve a herança.
            <Button type="button" size="sm" variant="outline" onClick={() => emitir(null)}>
              Voltar ao herdado
            </Button>
          ) : (
            <Button type="button" size="sm" variant="outline" onClick={() => emitir(null)}>
              Limpar
            </Button>
          )}
        </div>
        {/* Não existe "gerar GTIN": cadastro nunca inventa código de barras. */}
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm vitest run src/components/estoque/__tests__/preencher-em-massa.test.tsx`
Expected: PASS.

- [ ] **Step 5: Ligar nos cabeçalhos da matriz**

Em `src/components/estoque/matriz-grade.tsx`:

(a) Importar: `import { PreencherEmMassa } from '@/components/estoque/preencher-em-massa';`

(b) Renomear `_onAplicarMassa` → `onAplicarMassa` na desestruturação das props (o alias `_` veio da Task 4, quando a prop ainda não tinha uso).

(c) Trocar o cabeçalho de coluna:

```tsx
            {tamanhos.map((t) => (
              <TableHead key={t} scope="col">
                <PreencherEmMassa
                  escopoInicial={{ tipo: 'tamanho', valor: t }}
                  cores={cores}
                  tamanhos={tamanhos}
                  desabilitado={desabilitado}
                  gatilho={t}
                  rotuloGatilho={`Preencher em massa no tamanho ${t}`}
                  onAplicar={onAplicarMassa}
                />
              </TableHead>
            ))}
```

(d) Trocar o cabeçalho de linha:

```tsx
              <TableHead scope="row">
                <PreencherEmMassa
                  escopoInicial={{ tipo: 'cor', valor: cor }}
                  cores={cores}
                  tamanhos={tamanhos}
                  desabilitado={desabilitado}
                  gatilho={cor}
                  rotuloGatilho={`Preencher em massa na cor ${cor}`}
                  onAplicar={onAplicarMassa}
                />
              </TableHead>
```

(e) Acrescentar o gatilho geral ao lado das tabs, dentro do mesmo flex:

```tsx
      <div className="flex items-center justify-between gap-2">
        <div className={tabsListVariants()} role="group" aria-label="Modo de edição da grade">
          {MODOS.map((m) => (
            <button
              key={m.valor}
              type="button"
              className={tabsTriggerClassName}
              data-active={modo === m.valor ? '' : undefined}
              aria-pressed={modo === m.valor}
              onClick={() => setModo(m.valor)}
            >
              {m.aba}
            </button>
          ))}
        </div>
        <PreencherEmMassa
          escopoInicial={{ tipo: 'todos' }}
          cores={cores}
          tamanhos={tamanhos}
          desabilitado={desabilitado}
          gatilho="Preencher em massa"
          rotuloGatilho="Preencher em massa"
          onAplicar={onAplicarMassa}
        />
      </div>
```

(f) Ajustar os testes de `matriz-grade.test.tsx` afetados pelo botão dentro do `<th>`:

- As assertivas de `textContent` (`['Cor','P','M','Total']`, `['Preto','Branco','Total']`) seguem valendo — o botão é descendente do `<th>`. Se vier espaço extra, usar `.map((e) => e.textContent?.trim())`.
- **Nome acessível muda:** o `aria-label` do botão passa a ser o nome acessível do próprio `<th>`, então `getByRole('rowheader', { name: 'Preto' })` e `getByRole('columnheader', { name: 'P' })` deixam de casar. Nenhum teste deste plano usa essas consultas (o teste de totais já usa `getByText('Preto').closest('tr')`, por esse motivo) — conferir com `grep -n "rowheader', { name: '" src/components/estoque/__tests__/` e, se aparecer alguma, trocar para regex ou `getByText`.

- [ ] **Step 6: Escrever o teste ponta a ponta do fluxo do Diego**

Em `src/components/estoque/__tests__/dialog-cadastro-grade.test.tsx`, no describe `DialogCadastroGrade — salvar`:

```tsx
  // O fluxo que o Diego descreveu: preço diferente só no GG, resto continua herdando. A prova é
  // o PAYLOAD, não o valor do input — só ele mostra que o override chegou a `resolverLinha`.
  it('preço em massa no tamanho GG não contamina os outros tamanhos', async () => {
    cadastrarProdutoMock.mockResolvedValueOnce({
      loteId: 'l1', familiaId: 'f1', filaOk: true, falhasEstoque: [],
      variacoes: [{ id: 'v1', codigo: '00000001' }, { id: 'v2', codigo: '00000002' }],
    });
    const user = userEvent.setup();
    renderGrade();
    await user.type(screen.getByLabelText('Nome'), 'Camiseta');
    await user.click(screen.getByRole('radio', { name: 'Nacional' }));
    await user.selectOptions(screen.getByLabelText(/^Gênero/i), 'masculino');
    await user.type(screen.getByLabelText('Preço mínimo (líquido)'), '49,90');
    await user.click(screen.getByRole('checkbox', { name: 'Preto' }));
    await user.click(screen.getByRole('checkbox', { name: 'P' }));
    await user.click(screen.getByRole('checkbox', { name: 'GG' }));

    await user.click(screen.getByRole('button', { name: 'Preencher em massa no tamanho GG' }));
    await user.selectOptions(screen.getByLabelText('Campo'), 'preco');
    await user.type(screen.getByLabelText('Valor'), '64,90');
    await user.click(screen.getByRole('button', { name: 'Aplicar' }));
    await user.click(screen.getByRole('button', { name: 'Cadastrar' }));

    await waitFor(() => expect(cadastrarProdutoMock).toHaveBeenCalledTimes(1));
    const variacoes = cadastrarProdutoMock.mock.calls[0][0].variacoes;
    expect(variacoes).toHaveLength(2);
    expect(variacoes[0]).toMatchObject({ tamanho: 'P', preco: 49.9 });
    expect(variacoes[1]).toMatchObject({ tamanho: 'GG', preco: 64.9 });
  });

  it('preencher em massa não altera a contagem nem a ordem das linhas', async () => {
    cadastrarProdutoMock.mockResolvedValueOnce({
      loteId: 'l1', familiaId: 'f1', filaOk: true, falhasEstoque: [],
      variacoes: [{ id: 'v1', codigo: '00000001' }, { id: 'v2', codigo: '00000002' },
        { id: 'v3', codigo: '00000003' }, { id: 'v4', codigo: '00000004' }],
    });
    const user = userEvent.setup();
    renderGrade();
    await user.type(screen.getByLabelText('Nome'), 'Camiseta');
    await user.click(screen.getByRole('radio', { name: 'Nacional' }));
    await user.selectOptions(screen.getByLabelText(/^Gênero/i), 'masculino');
    await user.type(screen.getByLabelText('Preço mínimo (líquido)'), '49,90');
    await user.click(screen.getByRole('checkbox', { name: 'Preto' }));
    await user.click(screen.getByRole('checkbox', { name: 'Branco' }));
    await user.click(screen.getByRole('checkbox', { name: 'P' }));
    await user.click(screen.getByRole('checkbox', { name: 'M' }));

    await user.click(screen.getByRole('button', { name: 'Preencher em massa na cor Preto' }));
    await user.type(screen.getByLabelText('Valor'), '4');
    await user.click(screen.getByRole('button', { name: 'Aplicar' }));
    await user.click(screen.getByRole('button', { name: 'Cadastrar' }));

    await waitFor(() => expect(cadastrarProdutoMock).toHaveBeenCalledTimes(1));
    const variacoes = cadastrarProdutoMock.mock.calls[0][0].variacoes;
    expect(variacoes.map((v: { nome: string; tamanho: string }) => `${v.nome}/${v.tamanho}`))
      .toEqual(['Preto/P', 'Preto/M', 'Branco/P', 'Branco/M']);
    // `null`, não `0`: `montarPayload` passa por `numOuNull` (use-cadastro-produto.ts:33-36) e
    // `parseNum('')` devolve `null`, que não é `typeof 'number'`. Estoque em branco chega à edge
    // como `null`. `montarPayload` está FORA do escopo desta entrega — não ajustar a função.
    expect(variacoes.map((v: { estoqueInicial: number | null }) => v.estoqueInicial))
      .toEqual([4, 4, null, null]);
  });
```

- [ ] **Step 7: Provar a trava central (não o `disabled`)**

O plano insiste que `disabled` é affordance e que a trava é o `return`. Sem estes dois testes, trocar `if (api.salvando) return;` por nada deixaria a suíte verde. Acrescentar ao describe `DialogCadastroGrade — salvar` de `dialog-cadastro-grade.test.tsx`:

```tsx
  // Prova o `return`, não o `disabled`: dispara o clique num gatilho JÁ desabilitado via
  // `fireEvent` (que não respeita `pointer-events`/`disabled` como o `userEvent` faz) e confirma
  // que a contagem de linhas não se mexeu. Se a guarda sumir, a linha some no meio do save e o
  // casamento posicional de `EtapaFotos` manda a foto para o SKU errado.
  it('durante o salvamento nem remover nem preencher em massa mexem nas linhas', async () => {
    let liberar: (v: unknown) => void = () => {};
    cadastrarProdutoMock.mockReturnValueOnce(new Promise((res) => { liberar = res; }));
    const user = userEvent.setup();
    renderGrade();
    await user.type(screen.getByLabelText('Nome'), 'Camiseta');
    await user.click(screen.getByRole('radio', { name: 'Nacional' }));
    await user.selectOptions(screen.getByLabelText(/^Gênero/i), 'masculino');
    await user.type(screen.getByLabelText('Preço mínimo (líquido)'), '99,90');
    await user.click(screen.getByRole('checkbox', { name: 'Preto' }));
    await user.click(screen.getByRole('checkbox', { name: 'P' }));
    await user.click(screen.getByRole('checkbox', { name: 'M' }));
    await user.click(screen.getByRole('button', { name: 'Cadastrar' }));

    const antes = screen.getAllByLabelText(/^Estoque inicial de /).length;
    fireEvent.click(screen.getByRole('button', { name: 'Remover Preto · P' }));
    fireEvent.click(screen.getByRole('button', { name: 'Preencher em massa na cor Preto' }));
    expect(screen.getAllByLabelText(/^Estoque inicial de /)).toHaveLength(antes);
    expect(screen.queryByRole('button', { name: 'Reincluir Preto · P' })).not.toBeInTheDocument();

    liberar({
      loteId: 'l1', familiaId: 'f1', filaOk: true, falhasEstoque: [],
      variacoes: [{ id: 'v1', codigo: '00000001' }, { id: 'v2', codigo: '00000002' }],
    });
    await waitFor(() => expect(screen.getByText('Foto por variação')).toBeInTheDocument());
  });
```

Acrescentar `fireEvent` ao import de `@testing-library/react` no topo do arquivo.

- [ ] **Step 8: Rodar tudo**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
/usr/bin/git add src/components/estoque/preencher-em-massa.tsx src/components/estoque/__tests__/preencher-em-massa.test.tsx src/components/estoque/matriz-grade.tsx src/components/estoque/__tests__/matriz-grade.test.tsx src/components/estoque/__tests__/dialog-cadastro-grade.test.tsx
/usr/bin/git commit -m "feat(grade): preencher em massa por escopo, a partir dos cabecalhos da matriz"
```

---

## Task 9: resumo com "sem GTIN", sticky e scroll horizontal

**Files:**
- Modify: `src/components/estoque/dialog-cadastro-grade.tsx` (resumo do topo passa a usar `totaisDaGrade`; dialog mais largo)
- Modify: `src/components/estoque/matriz-grade.tsx` (sticky + container que rola)
- Test: `src/components/estoque/__tests__/dialog-cadastro-grade.test.tsx`
- Test: `src/components/estoque/__tests__/matriz-grade.test.tsx`

**Interfaces:**
- Consumes: `totaisDaGrade` (Task 2), `MatrizGrade` (Task 4).
- Produces: nada novo.

- [ ] **Step 1: Escrever os testes que falham**

Em `src/components/estoque/__tests__/dialog-cadastro-grade.test.tsx`, substituir o teste `conta SKUs, unidades e linhas sem foto` por:

```tsx
  it('conta SKUs, unidades, linhas sem foto e SKUs sem GTIN', async () => {
    const user = userEvent.setup();
    renderGrade();
    await user.click(screen.getByRole('checkbox', { name: 'Preto' }));
    await user.click(screen.getByRole('checkbox', { name: 'P' }));
    await user.click(screen.getByRole('checkbox', { name: 'M' }));
    await user.type(screen.getByLabelText('Estoque inicial de Preto · P'), '4');
    await user.click(screen.getByRole('button', { name: 'GTIN' }));
    await user.type(screen.getByLabelText('GTIN de Preto · P'), '7891234567895');
    expect(screen.getByText(/2 SKUs/)).toBeInTheDocument();
    expect(screen.getByText(/4 unidades/)).toBeInTheDocument();
    expect(screen.getByText(/2 sem foto/)).toBeInTheDocument();
    // Alimenta a decisão do operador ANTES de salvar: SKU sem GTIN é o que trava a publicação
    // depois, em categoria que o exige.
    expect(screen.getByText(/1 sem GTIN/)).toBeInTheDocument();
  });
```

Em `src/components/estoque/__tests__/matriz-grade.test.tsx`:

```tsx
describe('MatrizGrade — grade larga', () => {
  // Calçado chega a 10+ colunas. Sem um scrollport próprio, a matriz empurra a largura do dialog
  // e o operador perde a coluna da cor de vista ao rolar.
  it('a tabela vive num container que rola na horizontal e é alcançável por teclado', () => {
    montar([novaLinhaGrade('Preto', '33')], { cores: ['Preto'], tamanhos: ['33'] });
    const scrollport = screen.getByRole('region', { name: 'Grade de variações' });
    expect(scrollport).toHaveAttribute('tabindex', '0');
    expect(scrollport.className).toMatch(/overflow-x-auto/);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falham**

Run: `pnpm vitest run src/components/estoque/__tests__/dialog-cadastro-grade.test.tsx -t "sem GTIN" src/components/estoque/__tests__/matriz-grade.test.tsx -t "grade larga"`
Expected: FAIL nos dois.

- [ ] **Step 3: Implementar o resumo**

Em `src/components/estoque/dialog-cadastro-grade.tsx`, acrescentar `totaisDaGrade` ao import de `@/lib/cadastro-grade` (a Task 4 deliberadamente não o importou — só agora ele passa a ser usado) e trocar a linha 248 (`const unidades = …`) por:

```tsx
  // Fonte ÚNICA dos totais: o mesmo `totaisDaGrade` que a matriz usa no rodapé. Manter o `reduce`
  // inline aqui daria dois números para a mesma pergunta, que divergiriam na primeira mudança.
  const totais = totaisDaGrade(resolvidas, eixos.cores, eixos.tamanhos);
  const unidades = totais.geral;
```

E o resumo (dentro do bloco `linhas.length > 0`):

```tsx
                    <span className="text-xs text-muted-foreground">
                      {linhas.length} SKUs · {unidades} unidades · {semFoto} sem foto
                      {totais.semGtin > 0 && ` · ${totais.semGtin} sem GTIN`}
                    </span>
```

- [ ] **Step 4: Implementar sticky e scroll**

Em `src/components/estoque/matriz-grade.tsx`, trocar o `<Table>` por:

```tsx
      <Table
        // O scrollport é o DIV do próprio `ui/table` — um `overflow-x-auto` por fora criaria dois
        // scrollports aninhados e o de fora nunca rolaria. `role`/`tabIndex` ficam em QUEM ROLA
        // (WCAG 2.1.1): sem eles a grade de calçado é inalcançável por teclado.
        //
        // SÓ o eixo X. Um `max-h`/`overflow-y-auto` aqui criaria, no eixo Y, exatamente o
        // aninhamento que a linha acima evita no X: o `DialogContent` já é
        // `max-h-[90vh] overflow-y-auto`, e dois scrollports verticais empilhados fazem a roda
        // do mouse rolar o de dentro até o fim antes de mover a página. O sticky do cabeçalho
        // funciona igual contra o scroll do dialog.
        containerProps={{ role: 'region', tabIndex: 0, 'aria-label': 'Grade de variações' }}
        className="min-w-max"
      >
```

Acrescentar as classes sticky:

- `<TableHeader>` → `<TableHeader className="sticky top-0 z-20 bg-background">`
- Cabeçalho de linha (`<TableHead scope="row">` dentro do `<TableBody>`) → `className="sticky left-0 z-10 bg-background"`
- Primeira coluna do `<TableFooter>` (`<TableHead scope="row">Total</TableHead>`) → `className="sticky left-0 z-10 bg-background"`
- `<TableFooter>` → `className="sticky bottom-0 z-20 bg-background"`

- [ ] **Step 5: Alargar o dialog**

Em `src/components/estoque/dialog-cadastro-grade.tsx`, linha 331:

```tsx
          {/* sm: obrigatório: o default do componente é `sm:max-w-sm` e `max-w-5xl` sem o mesmo
              prefixo não vence a cascata (tailwind-merge trata como grupos diferentes). Alargado
              de 3xl para 5xl na matriz: calçado chega a 10+ colunas. */}
          className="max-h-[90vh] sm:max-w-5xl overflow-y-auto"
```

- [ ] **Step 6: Rodar e confirmar que passam**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
/usr/bin/git add src/components/estoque/dialog-cadastro-grade.tsx src/components/estoque/matriz-grade.tsx src/components/estoque/__tests__/dialog-cadastro-grade.test.tsx src/components/estoque/__tests__/matriz-grade.test.tsx
/usr/bin/git commit -m "feat(grade): resumo com sem GTIN, totais no rodape e matriz sticky com scroll"
```

---

## Task 10: amendment no ADR-0166 e portão de pré-push

**Files:**
- Modify: `docs/decisions/0166-tipo-de-produto-por-organizacao.md`

**Interfaces:**
- Consumes: nada.
- Produces: nada de código.

- [ ] **Step 1: Acrescentar a seção de amendment**

Inserir em `docs/decisions/0166-tipo-de-produto-por-organizacao.md`, **entre** o fim da seção `## Amendment (2026-09-19) — o eixo de grade saiu do dialog de cadastro normal` e o `## Como reverter`. Não editar o amendment anterior — a convenção do arquivo é acrescentar, e o de 2026-09-19 descreve com precisão a decisão que foi tomada naquele dia.

```markdown
## Amendment (2026-09-19b) — a grade é apresentada em matriz, não em lista de cards

O amendment anterior criou a tela própria de cadastro em grade com uma linha (card) por SKU. Com
a tela rodando, o dono do produto apontou que preencher 12 a 60 cards verticais é longo e
repetitivo: o operador repete o mesmo gesto por combinação e perde a visão do conjunto.

Fica revisado assim, conforme
`docs/superpowers/specs/2026-09-19-cadastro-grade-matriz-design.md` e o plano
`docs/superpowers/plans/2026-09-19-cadastro-grade-matriz.md`:

- A etapa de preenchimento da grade é uma **matriz Cor × Tamanho** (linhas = cores, colunas =
  tamanhos), com abas de modo (Estoque / GTIN / Preço / Custo), totais por linha, por coluna e
  geral, navegação por teclado, preenchimento em massa por escopo (toda a grade / uma cor / um
  tamanho) e um drawer "Detalhes do SKU" para os 6 campos herdáveis. `linha-grade-form.tsx`
  deixa de existir.
- A herança por campo continua exatamente a mesma decisão do amendment anterior — muda só como
  ela aparece: o cadeado por campo vira valor em cinza na célula (com botão de voltar ao herdado
  quando há override) e um par de radios "Herdar do produto" / "Usar valor específico" no drawer.
- Uma regra de herança fica explícita porque a matriz a torna alcançável: **apagar o conteúdo de
  uma célula não volta a herdar** — vira override vazio. Voltar a herdar é sempre ação explícita.
  É a mesma regra que `resolverLinha` já aplicava a `foto` (a presença da chave em `overrides` é
  a decisão do operador, não o conteúdo).
- Bug latente corrigido junto: os eixos passam por `ordenarEixos` antes de `reconciliarGrade`, e
  a grade deixa de seguir a ordem de CLIQUE do operador. Em lista de cards isso passava
  despercebido; em colunas de matriz "G, M, P" é visivelmente errado — e a ordem também define a
  sequência dos códigos de SKU reservados.

O que **não** muda: o modelo de dados, `resolverLinha`/`reconciliarGrade` (assinatura pública
intacta), o payload enviado à edge `cadastrar-produto` (continua um valor resolvido por variação,
campo a campo), o teto de 60 variações (ADR-0094), a revisão humana antes de publicar e a
validação de whitelist no backend. Nenhuma migration.

Ficou fora, por decisão: colar da área de transferência, seleção múltipla de células, validação de
dígito verificador de GTIN, estado de salvamento por célula e edição de grade já publicada.
```

- [ ] **Step 2: Conferir que o amendment anterior não foi tocado**

Run: `/usr/bin/git diff --stat docs/decisions/0166-tipo-de-produto-por-organizacao.md`
Expected: só linhas acrescentadas (`+`), zero removidas.

- [ ] **Step 3: Rodar o portão de pré-push**

Run: `pnpm preflight:static`
Expected: PASS (lint + typecheck + build).

**Se falhar aqui, com 9 commits em cima:** não reverter a entrega. O `preflight:static` roda `tsc -b --force` + lint, que o vitest não cobre — a falha típica é import não usado (TS6133) introduzido numa task e só consumido numa posterior. Diagnóstico e correção, nesta ordem:
1. `pnpm exec tsc -b --force` isolado: o erro traz arquivo e linha exatos.
2. Corrigir **no arquivo apontado**, com um commit novo de `fix:` — nunca `git commit --amend` nem rebase sobre os 9 commits (a `main` andou, e reescrever aqui custa conflito de merge sem ganho nenhum).
3. Nunca relaxar regra de lint nem acrescentar `// eslint-disable` para fechar o portão.

- [ ] **Step 4: Rodar a suíte inteira uma última vez**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 5: Confirmar que não sobrou stub, TODO nem skip**

Run: `grep -rn "TODO\|FIXME\|test\.skip\|it\.skip\|describe\.skip\|_onAplicarMassa\|_onReincluirCelula\|_removidas" src/components/estoque/ src/lib/cadastro-grade.ts`
Expected: nenhuma linha — os aliases `_` das tasks 4/6/8 têm de ter sido renomeados de volta.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add docs/decisions/0166-tipo-de-produto-por-organizacao.md
/usr/bin/git commit -m "docs(adr): amendment 0166 — grade em matriz Cor x Tamanho"
```

---

## Depois do plano (fora das tasks)

1. Revisão de código do branch (`superpowers:requesting-code-review`).
2. **Fable revisa o diff antes do merge** (regra do projeto, vale inclusive em background job).
3. Validação visual com Playwright **em sessão isolada** — nunca disputar o Chrome do Diego (skill `playwright-cli`, conta `VALIDATION_*`). Checar especificamente: matriz de calçado com 10+ colunas (sticky da primeira coluna + scroll horizontal), popover de massa aberto a partir de um cabeçalho de coluna, drawer de detalhes sobre a matriz, e uma screenshot real — snapshot de acessibilidade não pega bug de layout CSS.
4. Merge fast-forward na `main` com CI verde (`frontend`, `backend-lint`). **Este diff não toca `supabase/functions/**` nem `supabase/migrations/**`** — confirmar com `/usr/bin/git diff --name-only main...HEAD | grep supabase/` (esperado: nada) antes de dar por concluído. Se aparecer algo, deploy de Edge Function / migration é etapa obrigatória.
5. Deletar a branch, remover o worktree e **`git pull` na `main` local** — o ciclo só fecha aí.
