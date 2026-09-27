import { Fragment, useState, type ReactNode } from 'react';
import { ArrowDown, ChevronDown, ChevronRight, ChevronsUpDown, Layers } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { StatusPill, type StatusTone } from '@/components/ui/status-pill';
import { ThumbProduto } from '@/components/faturamento/pilha-thumbs';
import { fmtBRL, fmtInt, fmtMarkup } from '@/lib/formato';
import {
  SEM_CODIGO, type LinhaSku, type LinhaFamilia, type Tendencia, type Alerta, type Cobertura, type ClasseAbc,
} from '@/lib/vendas-sku';

export type ChaveOrdem = 'lucro' | 'bruto' | 'unidades' | 'lucroPorUnidade';

const TENDENCIA: Record<Tendencia, { label: string; tom: StatusTone; dica: string }> = {
  novo: { label: 'Novo', tom: 'info', dica: '1ª venda há menos de 30 dias' },
  em_alta: { label: 'Em alta', tom: 'success', dica: '+20% ou mais em unidades: últimos 30 dias contra os 30 anteriores' },
  em_queda: { label: 'Em queda', tom: 'danger', dica: '−20% ou menos em unidades: últimos 30 dias contra os 30 anteriores' },
  estavel: { label: 'Estável', tom: 'neutral', dica: 'Entre −20% e +20%' },
  parado: { label: 'Parado', tom: 'warning', dica: 'Já vendeu; nenhuma venda nos últimos 30 dias' },
  baixo_giro: { label: 'Baixo giro', tom: 'neutral', dica: 'Menos de 5 unidades nas duas janelas de 30 dias' },
};
const ALERTA: Record<Alerta, { label: string; tom: StatusTone }> = {
  lucro_negativo: { label: 'Lucro negativo', tom: 'danger' },
  cobertura_baixa: { label: 'Estoque < 15 dias', tom: 'warning' },
  devolucao_alta: { label: 'Devolução > 5%', tom: 'warning' },
  sem_custo: { label: 'Sem custo', tom: 'warning' },
};
const ABC_CLS: Record<ClasseAbc, string> = {
  A: 'bg-success/10 text-success ring-success/20',
  B: 'bg-info/10 text-info ring-info/20',
  C: 'bg-muted text-muted-foreground ring-border',
  D: 'bg-danger/10 text-danger ring-danger/20',
};
// Idioma do app para "sem valor" (o mesmo de fmtMarkup e da aba Vendas).
const NADA = '—';
const pct = (v: number | null) => (v == null ? NADA : `${(v * 100).toFixed(1).replace('.', ',')}%`);
const TOTAL_COLUNAS = 14;

export interface RankingSkuProps {
  /** Variações soltas (usadas quando `familias` é null). */
  linhas: LinhaSku[];
  /** Famílias quando agrupado; null = lista de variações. */
  familias: LinhaFamilia[] | null;
  tendencias: Map<string, Tendencia>;
  coberturas: Map<string, Cobertura>;
  alertas: Map<string, Alerta[]>;
  abc: Map<string, ClasseAbc>;
  ordem: ChaveOrdem;
  onOrdem: (k: ChaveOrdem) => void;
  /** Conteúdo exibido no corpo quando não há linhas (filtro sem resultado). */
  vazio?: ReactNode;
}

function Cabecalho({ rot, k, ordem, onOrdem }: { rot: string; k: ChaveOrdem; ordem: ChaveOrdem; onOrdem: (k: ChaveOrdem) => void }) {
  const ativo = ordem === k;
  return (
    <TableHead className="text-right" aria-sort={ativo ? 'descending' : undefined}>
      <button
        type="button"
        onClick={() => onOrdem(k)}
        aria-label={`Ordenar por ${rot}`}
        className={cn('inline-flex w-full items-center justify-end gap-1 rounded-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          ativo && 'text-foreground')}
      >
        {rot}
        {ativo ? <ArrowDown className="h-3 w-3" aria-hidden /> : <ChevronsUpDown className="h-3 w-3 opacity-40" aria-hidden />}
      </button>
    </TableHead>
  );
}

function Abc({ c }: { c?: ClasseAbc }) {
  if (!c) return <span className="text-muted-foreground">{NADA}</span>;
  return (
    <span className={cn('inline-flex size-5 items-center justify-center rounded text-[11px] font-semibold ring-1 ring-inset', ABC_CLS[c])}
      title={c === 'D' ? 'Prejuízo no período' : `Classe ${c} da curva ABC`}>
      {c}
    </span>
  );
}

function Celulas({ l, abc, t, alertas, cob }: {
  l: LinhaSku; abc?: ClasseAbc; t?: Tendencia; alertas: Alerta[]; cob?: Cobertura;
}) {
  const { lucro } = l.m;
  const parcial = l.m.fonteCusto === 'parcial';
  const num = 'text-right tabular-nums';
  return (
    <>
      <TableCell
        className={cn(num, 'font-semibold', lucro == null ? 'text-muted-foreground' : lucro < 0 ? 'text-destructive' : 'text-foreground')}
        title={lucro == null ? 'Sem custo: lucro não calculado' : parcial ? 'Parcial: só os itens com custo entram' : undefined}
      >
        {lucro == null ? NADA : fmtBRL(lucro)}
        {parcial && <><span className="ml-0.5 text-warning" aria-hidden>*</span><span className="sr-only"> (parcial)</span></>}
      </TableCell>
      <TableCell className={cn(num, l.m.lucroPorUnidade != null && l.m.lucroPorUnidade < 0 && 'text-destructive')}>
        {l.m.lucroPorUnidade == null ? NADA : fmtBRL(l.m.lucroPorUnidade)}
      </TableCell>
      <TableCell className={num}>{fmtMarkup(l.m.markup)}</TableCell>
      <TableCell className={num}>{pct(l.m.margemSVenda)}</TableCell>
      <TableCell className={cn(num, 'text-muted-foreground')}>{fmtBRL(l.acc.bruto)}</TableCell>
      <TableCell className={cn(num, 'text-muted-foreground')}>{fmtInt(l.acc.unidades)}</TableCell>
      <TableCell className={cn(num, 'text-muted-foreground')}>{fmtBRL(l.m.ticket)}</TableCell>
      <TableCell className={cn(num, 'text-muted-foreground')}>{l.acc.canceladas > 0 ? fmtInt(l.acc.canceladas) : NADA}</TableCell>
      <TableCell className={cn(num, 'text-muted-foreground')}>{pct(l.m.taxaDevolucao)}</TableCell>
      <TableCell className="text-center"><Abc c={abc} /></TableCell>
      <TableCell>{t && <StatusPill tone={TENDENCIA[t].tom} title={TENDENCIA[t].dica}>{TENDENCIA[t].label}</StatusPill>}</TableCell>
      <TableCell>
        <span className="flex items-center gap-1">
          {alertas.map((a) => {
            const rot = a === 'sem_custo' && parcial ? 'Lucro parcial' : ALERTA[a].label;
            return <StatusPill key={a} tone={ALERTA[a].tom}>{rot}</StatusPill>;
          })}
          {cob === 'compartilhado' && (
            <StatusPill tone="neutral" title="Kit: o estoque é o da base, sem cobertura própria"><Layers className="h-3 w-3" aria-hidden />Estoque da base</StatusPill>
          )}
        </span>
      </TableCell>
    </>
  );
}

function Nome({ l, recuo = false }: { l: LinhaSku; recuo?: boolean }) {
  return (
    <div className={cn('flex min-w-0 items-center gap-2.5', recuo && 'pl-6')}>
      <ThumbProduto path={l.imagemPath} titulo={l.titulo} size={32} />
      <div className="min-w-0">
        <div className="max-w-72 truncate font-medium" data-testid="sku-titulo" title={l.titulo ?? undefined}>{l.titulo ?? NADA}</div>
        <div className="text-xs text-muted-foreground tabular-nums">
          {l.codigo === SEM_CODIGO ? 'sem código' : l.codigo}
          {l.m.fonteCusto === 'estimado' && <> · <span title="Sem custo congelado na venda: usa o custo atual do cadastro">custo estimado</span></>}
        </div>
      </div>
    </div>
  );
}

/** Bruto → comissão + frete → imposto → líquido → custo → lucro. Comissão e frete vêm juntos: o item
 *  só carrega o líquido rateado (agruparPorPedido). */
function ContaDaLinha({ l }: { l: LinhaSku }) {
  const a = l.acc;
  const passos: [string, number | null][] = [
    ['Faturamento', a.bruto], ['Comissão + frete', -(a.bruto - a.liquido - a.imposto)], ['Imposto', -a.imposto],
    ['Líquido', a.liquido], ['Custo (itens com custo)', a.itensComCusto > 0 ? -a.custo : null],
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 px-2 py-2.5 text-xs">
      {passos.map(([rot, v]) => (
        <span key={rot} className="flex flex-col">
          <span className="text-muted-foreground">{rot}</span>
          <span className="tabular-nums">{v == null ? NADA : fmtBRL(v)}</span>
        </span>
      ))}
      <span className="flex flex-col border-l pl-5">
        <span className="text-muted-foreground">Lucro</span>
        <span className={cn('font-semibold tabular-nums', l.m.lucro != null && l.m.lucro < 0 && 'text-destructive')}>
          {l.m.lucro == null ? NADA : fmtBRL(l.m.lucro)}
        </span>
      </span>
      <span className="self-end text-muted-foreground">
        {fmtInt(l.pedidoChaves.length)} {l.pedidoChaves.length === 1 ? 'pedido' : 'pedidos'}
      </span>
    </div>
  );
}

/** Botão da 1ª coluna: é ele que carrega o aria-expanded (teclado: Enter/Espaço nativos).
 *  O clique na linha inteira é atalho de mouse; o botão para a propagação para não alternar duas vezes. */
function Alternar({ aberto, rotulo, onClick }: { aberto: boolean; rotulo: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-expanded={aberto}
      aria-label={rotulo}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="inline-flex size-6 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {aberto ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
    </button>
  );
}

export function RankingSku({ linhas, familias, tendencias, coberturas, alertas, abc, ordem, onOrdem, vazio }: RankingSkuProps) {
  const [aberto, setAberto] = useState<string | null>(null);
  const alternar = (k: string) => setAberto((a) => (a === k ? null : k));

  const linhaVariacao = (l: LinhaSku, recuo = false) => {
    const chave = `v:${l.codigo}`;
    const exp = aberto === chave;
    return (
      <Fragment key={`v:${l.codigo || 'sem-codigo'}`}>
        <TableRow className={cn('cursor-pointer', recuo && 'bg-muted/10')} onClick={() => alternar(chave)}>
          <TableCell className="w-8"><Alternar aberto={exp} rotulo={`Ver a conta de ${l.titulo ?? l.codigo}`} onClick={() => alternar(chave)} /></TableCell>
          <TableCell className="min-w-56"><Nome l={l} recuo={recuo} /></TableCell>
          <Celulas l={l} abc={recuo ? undefined : abc.get(l.codigo)} t={tendencias.get(l.codigo)}
            alertas={alertas.get(l.codigo) ?? []} cob={coberturas.get(l.codigo)} />
        </TableRow>
        {exp && (
          <TableRow className="bg-muted/30 hover:bg-muted/30">
            <TableCell />
            <TableCell colSpan={TOTAL_COLUNAS - 1} className="p-0"><ContaDaLinha l={l} /></TableCell>
          </TableRow>
        )}
      </Fragment>
    );
  };

  const vazioAgora = familias == null ? linhas.length === 0 : familias.length === 0;

  return (
    <Table containerClassName="rounded-lg border bg-card">
      <TableHeader>
        <TableRow className="bg-muted/50 text-xs text-muted-foreground hover:bg-muted/50">
          <TableHead className="w-8"><span className="sr-only">Expandir</span></TableHead>
          <TableHead className="text-muted-foreground">SKU</TableHead>
          <Cabecalho rot="Lucro" k="lucro" ordem={ordem} onOrdem={onOrdem} />
          <Cabecalho rot="Lucro/un." k="lucroPorUnidade" ordem={ordem} onOrdem={onOrdem} />
          <TableHead className="text-right text-muted-foreground">Markup</TableHead>
          <TableHead className="text-right text-muted-foreground">Margem s/ venda</TableHead>
          <Cabecalho rot="Faturamento" k="bruto" ordem={ordem} onOrdem={onOrdem} />
          <Cabecalho rot="Unidades" k="unidades" ordem={ordem} onOrdem={onOrdem} />
          <TableHead className="text-right text-muted-foreground">Preço médio</TableHead>
          <TableHead className="text-right text-muted-foreground">Canceladas (un.)</TableHead>
          <TableHead className="text-right text-muted-foreground">Devolução</TableHead>
          <TableHead className="text-center text-muted-foreground">ABC</TableHead>
          <TableHead className="text-muted-foreground">Tendência</TableHead>
          <TableHead className="text-muted-foreground">Alertas</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {vazioAgora && vazio && (
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={TOTAL_COLUNAS} className="p-0">{vazio}</TableCell>
          </TableRow>
        )}
        {familias == null
          ? linhas.map((l) => linhaVariacao(l))
          : familias.map((f) => {
            const chave = `f:${f.codigoPai}`;
            const exp = aberto === chave;
            const semFamilia = f.codigoPai.startsWith('sem-familia:');
            const nome = `${f.nomeFamilia ?? (semFamilia ? f.filhos[0].titulo ?? 'Sem família' : f.codigoPai)} (${f.filhos.length} ${f.filhos.length === 1 ? 'variação' : 'variações'})`;
            const soma: LinhaSku = {
              ...f.filhos[0], codigo: f.codigoPai, titulo: nome,
              acc: f.acc, m: f.m, pedidoChaves: [...new Set(f.filhos.flatMap((x) => x.pedidoChaves))],
            };
            const piores = [...new Set(f.filhos.flatMap((x) => alertas.get(x.codigo) ?? []))];
            return (
              <Fragment key={chave}>
                <TableRow className="cursor-pointer" onClick={() => alternar(chave)}>
                  <TableCell className="w-8"><Alternar aberto={exp} rotulo={`Mostrar variações de ${nome}`} onClick={() => alternar(chave)} /></TableCell>
                  <TableCell className="min-w-56">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <ThumbProduto path={f.filhos[0].imagemPath} titulo={nome} size={32} />
                      <div className="min-w-0">
                        <div className="max-w-72 truncate font-medium" title={nome}>{nome}</div>
                        <div className="text-xs text-muted-foreground tabular-nums">{semFamilia ? 'sem família' : f.codigoPai}</div>
                      </div>
                    </div>
                  </TableCell>
                  <Celulas l={soma} abc={abc.get(f.codigoPai)} alertas={piores} />
                </TableRow>
                {exp && f.filhos.map((x) => linhaVariacao(x, true))}
              </Fragment>
            );
          })}
      </TableBody>
    </Table>
  );
}
