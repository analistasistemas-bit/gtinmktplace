// Elemento-assinatura (spec §3.4): a prancheta do representante: cor por linha, tamanho por
// coluna, "estoque +N" escrito na célula (o +N, a compra, é o que manda). Navegável por setas (roving tabindex).
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Asterisk } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fmtInt } from '@/lib/formato';
import { chaveGrade, ordenarEixos } from '@/lib/cadastro-grade';
import { NUMERACOES_CALCADO, TAMANHOS_CALCA, TAMANHOS_INFANTIL, TAMANHOS_ROUPA } from '@/lib/tamanhos';
import type { FamiliaVisao, SkuVisao } from '@/hooks/useReposicao';
import { PopoverCelula, type CtxCalculo } from './popover-celula';
import { ROTULO_URGENCIA } from './por-que';

// ponytail: uma lista só com todas as grades; numa família os tamanhos são de uma grade, então a ordem sai certa.
export const TAMANHOS_CANONICOS = [...new Set<string>([...TAMANHOS_ROUPA, ...TAMANHOS_INFANTIL, ...TAMANHOS_CALCA, ...NUMERACOES_CALCADO])];

const rotuloCor = (c: string) => c || 'Sem cor';
const rotuloTam = (t: string) => t || 'Único';

// Ruptura ganha o filete à esquerda: a urgência não fica só na cor do fundo.
const FUNDO = {
  ruptura: 'bg-danger/15 dark:bg-danger/25 shadow-[inset_3px_0_0_var(--color-danger)]',
  vai_faltar: 'bg-danger/10 dark:bg-danger/15',
  pedir_agora: 'bg-warning/15 dark:bg-warning/20',
  em_dia: '',
} as const;

function eixosDaGrade(skus: SkuVisao[]) {
  const e = ordenarEixos(new Set(skus.map((s) => s.tela.cor ?? '')), new Set(skus.map((s) => s.tela.tamanho ?? '')), { cores: [], tamanhos: TAMANHOS_CANONICOS });
  const celulas = new Map(skus.map((s) => [chaveGrade(s.tela.cor ?? '', s.tela.tamanho ?? ''), s]));
  const hex = new Map(skus.map((s) => [s.tela.cor ?? '', s.tela.corHex]));
  return { ...e, celulas, hex };
}

function rotuloCelula(cor: string, tam: string, s: SkuVisao): string {
  const partes = [`${rotuloCor(cor)}, ${rotuloTam(tam)}: estoque ${fmtInt(s.sug.estoqueHoje)}`];
  if (s.tela.naoReporId) partes.push('Não repor');
  else if (s.sug.completarGrade > 0) partes.push(`completar ${fmtInt(s.sug.completarGrade)}`, 'nunca comprado');
  else {
    if (s.sug.pedir > 0) partes.push(`pedir ${fmtInt(s.sug.pedir)}`);
    partes.push(ROTULO_URGENCIA[s.urgencia]);
  }
  if (s.sug.poucoHistorico) partes.push('estimado pelas outras cores e tamanhos');
  return partes.join(', ');
}

export function MapaGrade({ familia, ctx, selecionado, onSelecionar }: {
  familia: FamiliaVisao; ctx: CtxCalculo; selecionado: string | null; onSelecionar: (codigo: string) => void;
}) {
  const { cores, tamanhos, celulas, hex } = eixosDaGrade(familia.skus);
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const primeira = cores.flatMap((c) => tamanhos.map((t) => [c, t] as const)).find(([c, t]) => celulas.has(chaveGrade(c, t)));
  const [escolhida, setAtiva] = useState<string | null>(null);
  // Célula ativa que sumiu num refetch (ou nenhuma ainda): volta para a primeira existente.
  const ativa = escolhida && celulas.has(escolhida) ? escolhida : primeira ? chaveGrade(...primeira) : null;
  // Família toda estimada (o aviso já diz): asterisco em toda célula vira ruído; a legenda avisa uma vez.
  const todasEstimadas = familia.skus.every((s) => s.sug.poucoHistorico);

  // Celular: a grade rola na horizontal; o esmaecido à direita avisa que há mais tamanhos até chegar ao fim.
  const rolagem = useRef<HTMLDivElement>(null);
  const [temMais, setTemMais] = useState(false);
  const checarRolagem = () => {
    const el = rolagem.current;
    setTemMais(!!el && el.scrollWidth - el.clientWidth - el.scrollLeft > 1);
  };
  useEffect(() => {
    checarRolagem();
    window.addEventListener('resize', checarRolagem);
    return () => window.removeEventListener('resize', checarRolagem);
  }, []);

  const focar = (k: string) => { setAtiva(k); refs.current.get(k)?.focus(); };
  const mover = (e: KeyboardEvent, r: number, c: number) => {
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      const linha = tamanhos.map((t) => chaveGrade(cores[r], t)).filter((k) => celulas.has(k));
      focar(e.key === 'Home' ? linha[0] : linha[linha.length - 1]);
      return;
    }
    const passo = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0] }[e.key];
    if (!passo) return;
    e.preventDefault();
    // Pula as combinações que não existem até achar uma célula ou bater na borda.
    for (let i = r + passo[0], j = c + passo[1]; i >= 0 && i < cores.length && j >= 0 && j < tamanhos.length; i += passo[0], j += passo[1]) {
      const k = chaveGrade(cores[i], tamanhos[j]);
      if (celulas.has(k)) { focar(k); return; }
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="relative w-fit max-w-full">
      <div ref={rolagem} onScroll={checarRolagem} className="max-w-full overflow-x-auto rounded-lg border border-border">
        <table role="grid" aria-label={`Mapa da grade de ${familia.nome}`} className="border-separate border-spacing-0 text-sm">
          <thead>
            <tr role="row">
              <th role="columnheader" scope="col" className="sticky left-0 z-10 border-b border-r border-border bg-muted px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                <span className="sr-only">Cor</span>
              </th>
              {tamanhos.map((t) => (
                <th key={t} role="columnheader" scope="col" className="border-b border-r border-border bg-muted px-3 py-2 text-center text-xs font-semibold tracking-wide text-muted-foreground last:border-r-0">
                  {rotuloTam(t)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cores.map((cor, r) => (
              <tr key={cor} role="row" className="[&:last-child>*]:border-b-0">
                <th role="rowheader" scope="row" className="sticky left-0 z-10 whitespace-nowrap border-b border-r border-border bg-card px-3 text-left font-medium">
                  <span className="flex items-center gap-2">
                    {hex.get(cor) && <span aria-hidden className="h-3 w-3 shrink-0 rounded-full ring-1 ring-foreground/20" style={{ backgroundColor: hex.get(cor)! }} />}
                    {rotuloCor(cor)}
                  </span>
                </th>
                {tamanhos.map((tam, c) => {
                  const k = chaveGrade(cor, tam);
                  const s = celulas.get(k);
                  if (!s) {
                    return <td key={tam} role="gridcell" aria-disabled="true" className="border-b border-r border-border bg-muted/30 last:border-r-0" />;
                  }
                  const nao = !!s.tela.naoReporId;
                  const comprar = !nao && s.sug.pedir > 0;
                  // Nunca comprado (emenda 17/11): estimativa à parte, sem cor de urgência e fora do pedido.
                  const completar = !nao && s.sug.completarGrade > 0;
                  return (
                    <td key={tam} role="gridcell" aria-selected={selecionado === s.tela.codigo} className="border-b border-r border-border p-0 last:border-r-0">
                      <PopoverCelula s={s} familia={familia} ctx={ctx} titulo={`${rotuloCor(cor)} · ${rotuloTam(tam)}`} onAbrir={() => onSelecionar(s.tela.codigo)}>
                        <button
                          type="button"
                          ref={(el) => { if (el) refs.current.set(k, el); else refs.current.delete(k); }}
                          tabIndex={ativa === k ? 0 : -1}
                          onFocus={() => setAtiva(k)}
                          onKeyDown={(e) => mover(e, r, c)}
                          aria-label={rotuloCelula(cor, tam, s)}
                          data-nao-repor={nao ? 'true' : undefined}
                          className={cn(
                            'relative flex h-11 w-full min-w-[4.5rem] flex-col items-center justify-center whitespace-nowrap px-2 leading-tight tabular-nums outline-none transition-colors md:min-w-[6.5rem] md:flex-row md:px-3',
                            'hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                            nao ? 'bg-muted/50 text-muted-foreground line-through' : FUNDO[s.urgencia],
                            // Seleção = traço embaixo (sem bg: o fundo de urgência fica nos dois temas); anel só no foco.
                            selecionado === s.tela.codigo && 'after:absolute after:inset-x-2 after:bottom-1 after:h-0.5 after:rounded-full after:bg-primary',
                          )}
                        >
                          {comprar ? (
                            <>
                              <span className="text-caption font-normal md:text-sm md:text-muted-foreground dark:text-foreground/70 md:dark:text-foreground/70">{fmtInt(s.sug.estoqueHoje)}</span>
                              <span className="font-semibold text-foreground md:ml-1.5">+{fmtInt(s.sug.pedir)}</span>
                            </>
                          ) : completar ? (
                            <>
                              <span className="text-caption md:text-sm md:text-muted-foreground dark:text-foreground/70 md:dark:text-foreground/70">{fmtInt(s.sug.estoqueHoje)}</span>
                              <span className="rounded bg-muted px-1 text-caption text-muted-foreground ring-1 ring-inset ring-border md:ml-1.5">completar +{fmtInt(s.sug.completarGrade)}</span>
                            </>
                          ) : fmtInt(s.sug.estoqueHoje)}
                          {s.sug.poucoHistorico && !todasEstimadas && <Asterisk aria-hidden className="absolute right-1 top-1 h-3 w-3 text-muted-foreground" />}
                        </button>
                      </PopoverCelula>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {temMais && <div data-indicador-rolagem aria-hidden className="pointer-events-none absolute inset-y-px right-px w-8 rounded-r-lg bg-gradient-to-l from-card to-transparent" />}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-caption" aria-label="Legenda do mapa">
        <li className="flex items-center gap-1.5"><span aria-hidden className="h-3 w-3 rounded-sm border border-border bg-danger/15 shadow-[inset_3px_0_0_var(--color-danger)] dark:bg-danger/25" />Ruptura ou Vai faltar</li>
        <li className="flex items-center gap-1.5"><span aria-hidden className="h-3 w-3 rounded-sm border border-border bg-warning/15 dark:bg-warning/20" />Pedir agora</li>
        <li className="flex items-center gap-1.5"><span aria-hidden className="h-3 w-3 rounded-sm border border-border" />Em dia</li>
        <li><span className="font-semibold text-foreground">+N</span> = comprar N</li>
        {familia.skus.some((s) => !s.tela.naoReporId && s.sug.completarGrade > 0) && (
          <li><span className="rounded bg-muted px-1 text-muted-foreground ring-1 ring-inset ring-border">completar +N</span> = nunca comprado</li>
        )}
        {todasEstimadas
          ? <li>Todas estimadas pela família</li>
          : <li className="flex items-center gap-1.5"><Asterisk aria-hidden className="h-3 w-3" />Estimado pela família</li>}
      </ul>
    </div>
  );
}
