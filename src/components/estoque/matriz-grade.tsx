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

// `Extract`, não `CampoHerdavel` puro: só 2 dos 6 campos herdáveis são modos da matriz (peso e as
// 3 dimensões não têm aba), e um predicado cujo tipo não é subconjunto do parâmetro é erro de
// compilação (TS2677) — invisível ao vitest, que só transpila.
function ehHerdavel(modo: ModoGrade): modo is Extract<ModoGrade, CampoHerdavel> {
  return (CAMPOS_HERDAVEIS as readonly string[]).includes(modo);
}

export function MatrizGrade({
  linhas, resolvidas, cores, tamanhos, tentouSalvar, desabilitado,
  onMudarLinha, onMudarOverride, onVoltarAHerdar, onRemoverCelula,
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
              erro && tentouSalvar && 'border-destructive',
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
      <SeletorDeModo modo={modo} onMudar={setModo} />

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
