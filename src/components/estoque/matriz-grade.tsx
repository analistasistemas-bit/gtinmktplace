// Matriz Cor × Tamanho do cadastro em grade (spec 2026-09-19 "matriz"). É uma VIEW sobre o array
// `linhas` do dialog — nunca um segundo modelo de dados. A matriz não guarda linha, índice, cor
// nem tamanho em estado: deriva `Map<chaveGrade, índice>` a cada render. Um estado próprio de
// linhas aqui reintroduziria, por um caminho novo, o desalinho corrigido em f4a6df68.
//
// Estado interno é SÓ o modo de edição (uma string). Célula ativa NÃO é estado React: seria um
// rerender da matriz inteira a cada tecla, com até 60 células (ver Task 7, navegação por foco DOM).
import { useRef, useState } from 'react';
import { SlidersHorizontal, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { tabsListVariants, tabsTriggerClassName } from '@/components/ui/tabs';
import {
  Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { erroCampo } from '@/components/estoque/linha-variacao-form';
import { DetalhesSku, ROTULOS } from '@/components/estoque/detalhes-sku';
import { PreencherEmMassa } from '@/components/estoque/preencher-em-massa';
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

// `Extract`, não `CampoHerdavel` puro: só 2 dos 6 campos herdáveis são modos da matriz (peso e as
// 3 dimensões não têm aba), e um predicado cujo tipo não é subconjunto do parâmetro é erro de
// compilação (TS2677) — invisível ao vitest, que só transpila.
function ehHerdavel(modo: ModoGrade): modo is Extract<ModoGrade, CampoHerdavel> {
  return (CAMPOS_HERDAVEIS as readonly string[]).includes(modo);
}

export function MatrizGrade({
  linhas, resolvidas, cores, tamanhos, removidas, tentouSalvar, desabilitado,
  onMudarLinha, onMudarOverride, onDestravar, onVoltarAHerdar, onRemoverCelula, onReincluirCelula,
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
  onDestravar: (clientId: string, campo: CampoHerdavel) => void;
  onVoltarAHerdar: (clientId: string, campo: CampoHerdavel) => void;
  onRemoverCelula: (cor: string, tamanho: string) => void;
  onReincluirCelula: (cor: string, tamanho: string) => void;
  onAplicarMassa: (opts: OpcoesMassa) => void;
}) {
  const [modo, setModo] = useState<ModoGrade>('estoqueInicial');
  // SÓ o clientId, nunca a linha: a linha vem sempre de `linhas`, que é a fonte.
  const [detalhesDe, setDetalhesDe] = useState<string | null>(null);
  // A referência é do CONTAINER, não de célula nenhuma: o alvo é encontrado por seletor a cada
  // tecla. Guardar "célula ativa" em estado React rerenderizaria as até 60 células por tecla.
  const containerRef = useRef<HTMLDivElement>(null);
  const def = MODOS.find((m) => m.valor === modo)!;
  // Derivado A CADA RENDER, nunca memoizado num estado: `linhas` é a fonte, e um cache aqui
  // divergiria na primeira reconciliação.
  const indice = new Map(linhas.map((l, i) => [chaveGrade(l.cor, l.tamanho), i]));
  const totais = totaisDaGrade(resolvidas, cores, tamanhos);

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

    const input = alvo instanceof HTMLInputElement ? alvo : null;

    if (e.key === 'ArrowDown') { e.preventDefault(); focarCelula(r + 1, c); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); focarCelula(r - 1, c); return; }

    if (e.key === 'Enter') {
      // Achado do Fable: o "+" (Task 6) também carrega data-r/data-c, e Enter é a ATIVAÇÃO
      // NATIVA de um <button> focado. Interceptar Enter em qualquer alvo roubaria esse clique —
      // o operador de teclado nunca reincluiria uma célula por Enter, só por Espaço. Em cima de
      // um <input>, Enter continua navegação (célula de baixo); em cima de outra coisa (o
      // botão), não interceptamos — o clique nativo do botão segue seu curso.
      if (!input) return;
      // `preventDefault` no Enter também impede o submit implícito do formulário do dialog.
      e.preventDefault();
      focarCelula(r + 1, c);
      return;
    }

    // Setas laterais só saem da célula na BORDA do valor. No meio do texto elas são o cursor —
    // sem isso ninguém corrige um dígito no meio de um GTIN de 13 caracteres.
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

  function celula(cor: string, tamanho: string, c: number, r: number) {
    const chave = chaveGrade(cor, tamanho);
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
    const linha = linhas[i]!;
    const resolvida = resolvidas[i]!;
    const nome = `${cor} · ${tamanho}`;
    const herdavel = ehHerdavel(modo);
    const temOverride = herdavel && modo in linha.overrides;
    const valor = herdavel ? resolvida[modo] : linha[modo];
    const erro = erroCampo(modo, valor);

    return (
      <div className="flex flex-col gap-0.5">
        <div className="group/celula relative flex items-center gap-0.5">
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
                // `pr-16` pareado com o adorno "herdado" à direita, mesma regra do par
                // `sufixo`/`pr-7` em `linha-variacao-form.tsx:133`: sem ele, numa célula de ~100px
                // o texto "herdado" cai por cima do valor no hover.
                herdavel && !temOverride && 'pr-16 text-muted-foreground',
                // SEM `&& tentouSalvar`: era gate morto (achado da Task 4) — `tentouSalvar` só
                // liga dentro de `submeter()`, inalcançável enquanto existir erro em qualquer
                // CAMPOS_NUMERICOS (é exatamente a condição de `podeSalvar=false` que trava o
                // botão). O texto do erro abaixo segue a mesma regra, por consistência.
                //
                // `&& valor !== ''` (fix round pós-revisão): só `preco` reclama de vazio
                // (`erroCampo`, linha-variacao-form.tsx:39) — os outros campos numéricos aceitam
                // vazio como "ainda não preenchido". Sem este gate, abrir a aba Preço com o
                // cabeçalho vazio pinta TODAS as células de vermelho sem o operador ter feito
                // nada (o "muro vermelho" que a Task 9 sinalizou como preocupação). Célula com
                // valor real inválido (ex. "-1", "abc") continua acusando na hora.
                erro && valor !== '' && 'border-destructive',
              )}
              value={valor}
              disabled={desabilitado}
              // Achado do Fable: sem isto, focar uma célula herdada e digitar concatena no valor
              // resolvido ("99,90" + "5" → "99,905") — o operador queria SUBSTITUIR, não anexar.
              // Selecionar tudo no foco faz a primeira tecla trocar o conteúdo inteiro, como numa
              // planilha de verdade. Bônus: com a seleção cobrindo o valor todo, as setas laterais
              // já saem da célula na primeira tecla (regra da Task 7 é sobre a BORDA do valor).
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => (herdavel
                // Digitar numa célula herdada cria o override com o TEXTO DIGITADO. Não existe
                // estado "travado" prévio para semear com o valor resolvido (regra do spec).
                ? onMudarOverride(linha.clientId, modo, e.target.value)
                : onMudarLinha(linha.clientId, { [modo]: e.target.value }))}
            />
            {herdavel && !temOverride && (
              // Adorno INLINE à direita, dentro do wrapper relativo do input — mesmo padrão do
              // `sufixo` em `linha-variacao-form.tsx:138-142`. Nada de `-top-*` negativo: a célula
              // vive num scrollport (o container do `ui/table` rola nos dois eixos) e um badge
              // acima da linha sumiria atrás do `<thead sticky bg-background z-20>` na 1ª linha.
              //
              // Só em foco/hover: 60 células gritando "herdado" ao mesmo tempo é ruído, e a cor
              // `muted` sozinha não diz O QUE o cinza significa na primeira vez que se vê a tela.
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[10px] text-muted-foreground opacity-0 transition-opacity group-focus-within/celula:opacity-100 group-hover/celula:opacity-100"
              >
                herdado
              </span>
            )}
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
            aria-label={`Detalhes de ${nome}`}
            onClick={() => setDetalhesDe(linha.clientId)}
          >
            <SlidersHorizontal className="h-3 w-3" />
          </Button>
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
        {erro && valor !== '' && <span className="text-xs text-destructive">{erro}</span>}
      </div>
    );
  }

  return (
    // Só delega `onKeyDown` (navegação por foco DOM, Task 7); nenhuma interação de mouse/clique é
    // tratada aqui. Os elementos focáveis reais (inputs e botões) estão todos dentro dele.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div ref={containerRef} onKeyDown={teclado} className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <SeletorDeModo modo={modo} onMudar={setModo} />
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

      <Table
        // O scrollport é o DIV do próprio `ui/table` — um `overflow-x-auto` por fora criaria dois
        // scrollports aninhados e o de fora nunca rolaria. `role`/`tabIndex` ficam em QUEM ROLA
        // (WCAG 2.1.1): sem eles a grade de calçado é inalcançável por teclado.
        //
        // O `max-h` + `overflow-y-auto` é o PREÇO do cabeçalho sticky, não descuido. Por CSS
        // Overflow 3, um eixo `auto` faz o outro computar `auto`: este div já é o scrollport
        // mais próximo do `<thead sticky top-0>` nos dois eixos. Sem altura limitada,
        // `scrollHeight === clientHeight`, nunca há rolagem vertical interna, e o cabeçalho
        // nunca desgruda — o sticky vira decoração. O custo aceito é o aninhamento com o
        // `overflow-y-auto` do `DialogContent`: a roda do mouse rola a grade até o fim antes de
        // mover o dialog.
        containerClassName="max-h-[55vh] overflow-y-auto"
        containerProps={{ role: 'region', tabIndex: 0, 'aria-label': 'Grade de variações' }}
        className="min-w-max"
      >
        <TableHeader className="sticky top-0 z-20 bg-background">
          <TableRow>
            <TableHead scope="col">Cor</TableHead>
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
            <TableHead scope="col">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {cores.map((cor, r) => (
            <TableRow key={cor}>
              <TableHead scope="row" className="sticky left-0 z-10 bg-background">
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
              {tamanhos.map((tamanho, c) => (
                <TableCell key={tamanho}>{celula(cor, tamanho, c, r)}</TableCell>
              ))}
              <TableCell className="text-sm tabular-nums">{totais.porCor[cor] ?? 0}</TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter className="sticky bottom-0 z-20 bg-background">
          <TableRow>
            <TableHead scope="row" className="sticky left-0 z-10 bg-background">Total</TableHead>
            {tamanhos.map((t) => (
              <TableCell key={t} className="text-sm tabular-nums">{totais.porTamanho[t] ?? 0}</TableCell>
            ))}
            <TableCell className="text-sm font-medium tabular-nums">{totais.geral}</TableCell>
          </TableRow>
        </TableFooter>
      </Table>

      <span id="matriz-herdado" className="sr-only">Valor herdado do produto.</span>

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
    </div>
  );
}

/** Grupo de botões `aria-pressed`, NÃO `<Tabs>` do Radix: não existe painel por modo (a mesma
 *  tabela serve os 4), e um `TabsTrigger` sem `TabsContent` emite `aria-controls` apontando para
 *  um id inexistente. É exatamente a saída que `ui/tabs.tsx:58-60` documenta ao exportar
 *  `tabsTriggerClassName`.
 *
 *  Reproduzir a aparência exige os atributos que `Tabs`/`TabsList` renderizam além das classes —
 *  sem eles metade dos seletores de `tabsTriggerClassName` fica inerte:
 *  - `group/tabs` + `data-orientation` (o que `Tabs` é): habilita `group-data-horizontal/tabs:h-8`
 *    e o sublinhado `group-data-horizontal/tabs:after:…`;
 *  - `data-variant="default"` (o que `TabsList` renderiza): habilita
 *    `group-data-[variant=default]/tabs-list:data-active:shadow-sm`;
 *  - `data-state` E `data-active` no botão ativo: `data-active:` é o nome da classe, mas neste
 *    Tailwind ele casa com `data-state="active"` (medição do projeto; `radio-group.tsx:27` usa a
 *    mesma premissa com `data-checked:`). Emitir só um é apostar em qual — os dois custam nada. */
function SeletorDeModo({ modo, onMudar }: {
  modo: ModoGrade; onMudar: (m: ModoGrade) => void;
}) {
  return (
    <div className="group/tabs" data-orientation="horizontal">
      <div
        className={tabsListVariants()}
        data-variant="default"
        role="group"
        aria-label="Modo de edição da grade"
      >
        {MODOS.map((m) => {
          const ativo = modo === m.valor;
          return (
            <button
              key={m.valor}
              type="button"
              className={tabsTriggerClassName}
              data-state={ativo ? 'active' : 'inactive'}
              data-active={ativo ? '' : undefined}
              aria-pressed={ativo}
              onClick={() => onMudar(m.valor)}
            >
              {m.aba}
            </button>
          );
        })}
      </div>
    </div>
  );
}
