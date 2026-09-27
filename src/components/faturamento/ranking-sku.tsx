import { Fragment, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowDown, ChevronDown, ChevronRight, ChevronsUpDown, Layers } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { StatusPill } from '@/components/ui/status-pill';
import { ALERTA, TENDENCIA } from '@/components/faturamento/rotulos-sku';
import { ThumbProduto } from '@/components/faturamento/pilha-thumbs';
import { fmtBRL, fmtBRLSinal, fmtInt, fmtMarkup } from '@/lib/formato';
import {
  SEM_CODIGO, type LinhaSku, type LinhaFamilia, type Tendencia, type Alerta, type Cobertura, type ClasseAbc,
} from '@/lib/vendas-sku';

export type ChaveOrdem = 'lucro' | 'bruto' | 'unidades' | 'lucroPorUnidade';

const ABC_CLS: Record<ClasseAbc, string> = {
  A: 'bg-success/10 text-success ring-success/20',
  B: 'bg-info/10 text-info ring-info/20',
  C: 'bg-muted text-muted-foreground ring-border',
  D: 'bg-danger/10 text-danger ring-danger/20',
};
// Idioma do app para "sem valor" (o mesmo de fmtMarkup e da aba Vendas).
const NADA = '—';
const pct = (v: number | null) => (v == null ? NADA : `${(v * 100).toFixed(1).replace('.', ',')}%`);
const TOTAL_COLUNAS = 11;
/** Título em até 2 linhas, largura contida: linhas irmãs ("Camiseta Dry Fit Masculina Azul/Preta")
 *  continuam distinguíveis e a tabela cabe em 1440px sem rolar. */
const TITULO = 'line-clamp-2 max-w-40 whitespace-normal font-medium leading-snug lg:max-w-56';
/** Nome que abre o dossiê. Para o clique aqui: a linha continua alternando a conta pelo resto dela. */
const LINK_DOSSIE = 'rounded-sm underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function LinkDossie({ to, className, children, ...rest }: { to: string; className?: string; children: ReactNode; 'aria-label'?: string }) {
  const location = useLocation();
  return (
    <Link to={to} state={{ de: location.pathname + location.search }} onClick={(e) => e.stopPropagation()}
      className={cn(LINK_DOSSIE, className)} {...rest}>
      {children}
    </Link>
  );
}

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
    <TableHead className="text-right text-muted-foreground" aria-sort={ativo ? 'descending' : undefined}>
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

function Celulas({ l, abc, t }: { l: LinhaSku; abc?: ClasseAbc; t?: Tendencia }) {
  const { lucro } = l.m;
  const parcial = l.m.fonteCusto === 'parcial';
  const num = 'text-right tabular-nums';
  return (
    <>
      <TableCell
        className={cn(num, 'font-semibold', lucro == null ? 'text-muted-foreground' : lucro < 0 ? 'text-destructive' : 'text-foreground')}
        title={lucro == null ? 'Sem custo: lucro não calculado' : parcial ? 'Parcial: só os itens com custo entram' : undefined}
      >
        {lucro == null ? NADA : fmtBRLSinal(lucro)}
        {parcial && <><span className="ml-0.5 text-warning" aria-hidden>*</span><span className="sr-only"> (parcial)</span></>}
      </TableCell>
      <TableCell className={cn(num, l.m.lucroPorUnidade != null && l.m.lucroPorUnidade < 0 && 'text-destructive')}>
        {l.m.lucroPorUnidade == null ? NADA : fmtBRLSinal(l.m.lucroPorUnidade)}
      </TableCell>
      <TableCell className={cn(num, l.m.markup != null && l.m.markup < 0 && 'text-destructive')}>{fmtMarkup(l.m.markup)}</TableCell>
      <TableCell className={cn(num, l.m.margemSVenda != null && l.m.margemSVenda < 0 && 'text-destructive')}>{pct(l.m.margemSVenda)}</TableCell>
      {/* Preço médio vira sub-linha do faturamento: uma coluna a menos para a tabela caber em 1440px. */}
      <TableCell className={cn(num, 'text-muted-foreground')}>
        <div>{fmtBRL(l.acc.bruto)}</div>
        <div className="text-[11px]" title="Preço médio por unidade">{fmtBRL(l.m.ticket)}/un.</div>
      </TableCell>
      <TableCell className={cn(num, 'text-muted-foreground')}>{fmtInt(l.acc.unidades)}</TableCell>
      <TableCell className={cn(num, 'text-muted-foreground')}>{pct(l.m.taxaDevolucao)}</TableCell>
      <TableCell className="text-center"><Abc c={abc} /></TableCell>
      <TableCell>{t && <StatusPill tone={TENDENCIA[t].tom} title={TENDENCIA[t].dica}>{TENDENCIA[t].label}</StatusPill>}</TableCell>
    </>
  );
}

/** Alertas vão na célula do SKU (2ª linha), não numa coluna no fim: a tabela é larga e a coluna
 *  final ficava fora da tela até em 1440px. */
function Selos({ alertas, cob, parcial }: { alertas: Alerta[]; cob?: Cobertura; parcial: boolean }) {
  if (alertas.length === 0 && cob !== 'compartilhado') return null;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {alertas.map((a) => (
        <StatusPill key={a} tone={ALERTA[a].tom} className="px-1.5 py-0 text-[11px]">
          {a === 'sem_custo' && parcial ? 'Lucro parcial' : ALERTA[a].label}
        </StatusPill>
      ))}
      {cob === 'compartilhado' && (
        <StatusPill tone="neutral" className="px-1.5 py-0 text-[11px]" title="Kit: o estoque é o da base, sem cobertura própria">
          <Layers className="h-3 w-3" aria-hidden />Estoque da base
        </StatusPill>
      )}
    </span>
  );
}

function Nome({ l, recuo = false, selos }: { l: LinhaSku; recuo?: boolean; selos?: ReactNode }) {
  return (
    <div className={cn('flex min-w-0 items-center gap-2.5', recuo && 'pl-6')}>
      <ThumbProduto path={l.imagemPath} titulo={l.titulo} size={32} />
      <div className="min-w-0">
        {l.codigo === SEM_CODIGO
          ? <div className={TITULO} data-testid="sku-titulo" title={l.titulo ?? undefined}>{l.titulo ?? NADA}</div>
          : (
            <LinkDossie to={`/faturamento/sku/${encodeURIComponent(l.codigo)}`} className="block w-fit">
              <div className={TITULO} data-testid="sku-titulo" title={l.titulo ?? undefined}>{l.titulo ?? NADA}</div>
            </LinkDossie>
          )}
        <div className="text-xs text-muted-foreground tabular-nums">
          {l.codigo === SEM_CODIGO ? 'sem código' : l.codigo}
          {l.m.fonteCusto === 'estimado' && <> · <span title="Sem custo congelado na venda: usa o custo atual do cadastro">custo estimado</span></>}
        </div>
        {selos && <div className="mt-1">{selos}</div>}
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
  const dir = (v: number | null) => (v == null ? NADA : fmtBRLSinal(v));
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 px-2 py-2.5 text-xs">
      {passos.map(([rot, v]) => (
        <span key={rot} className="flex flex-col">
          <span className="text-muted-foreground">{rot}</span>
          <span className="tabular-nums">{dir(v)}</span>
        </span>
      ))}
      <span className="flex flex-col border-l pl-5">
        <span className="text-muted-foreground">Lucro</span>
        <span className={cn('font-semibold tabular-nums', l.m.lucro != null && l.m.lucro < 0 && 'text-destructive')}>
          {dir(l.m.lucro)}
        </span>
      </span>
      <span className="flex flex-col">
        <span className="text-muted-foreground">Canceladas (un.)</span>
        <span className="tabular-nums">{fmtInt(a.canceladas)}</span>
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
  // Dois estados: abrir a conta de um filho não pode fechar a família dele.
  const [familiasAbertas, setFamiliasAbertas] = useState<Set<string>>(() => new Set());
  const [contaAberta, setContaAberta] = useState<string | null>(null);
  const alternarConta = (k: string) => setContaAberta((a) => (a === k ? null : k));
  const alternarFamilia = (k: string) => setFamiliasAbertas((s) => {
    const n = new Set(s);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });

  const linhaVariacao = (l: LinhaSku, recuo = false) => {
    const chave = l.codigo;
    const exp = contaAberta === chave;
    return (
      <Fragment key={`v:${l.codigo || 'sem-codigo'}`}>
        <TableRow className={cn('cursor-pointer', recuo && 'bg-muted/10')} onClick={() => alternarConta(chave)}>
          <TableCell className="w-8"><Alternar aberto={exp} rotulo={`Ver a conta de ${l.titulo ?? l.codigo}`} onClick={() => alternarConta(chave)} /></TableCell>
          <TableCell><Nome l={l} recuo={recuo} selos={(
            <Selos alertas={alertas.get(l.codigo) ?? []} cob={coberturas.get(l.codigo)} parcial={l.m.fonteCusto === 'parcial'} />
          )} /></TableCell>
          <Celulas l={l} abc={recuo ? undefined : abc.get(l.codigo)} t={tendencias.get(l.codigo)} />
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
    <Table containerClassName="rounded-lg border bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      containerProps={{ role: 'region', tabIndex: 0, 'aria-label': 'Ranking de SKUs' }}>
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
          <TableHead className="text-right text-muted-foreground">Devolução</TableHead>
          <TableHead className="text-center text-muted-foreground">ABC</TableHead>
          <TableHead className="text-muted-foreground">Tendência</TableHead>
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
            const chave = f.codigoPai;
            const exp = familiasAbertas.has(chave);
            const semFamilia = f.codigoPai.startsWith('sem-familia:');
            const base = f.nomeFamilia ?? (semFamilia ? f.filhos[0].titulo ?? 'Sem família' : f.codigoPai);
            const nome = `${base} (${f.filhos.length} ${f.filhos.length === 1 ? 'variação' : 'variações'})`;
            const soma: LinhaSku = {
              ...f.filhos[0], codigo: f.codigoPai, titulo: nome,
              acc: f.acc, m: f.m, pedidoChaves: [...new Set(f.filhos.flatMap((x) => x.pedidoChaves))],
            };
            const piores = [...new Set(f.filhos.flatMap((x) => alertas.get(x.codigo) ?? []))];
            return (
              <Fragment key={chave}>
                <TableRow className="cursor-pointer" onClick={() => alternarFamilia(chave)}>
                  <TableCell className="w-8"><Alternar aberto={exp} rotulo={`Mostrar variações de ${nome}`} onClick={() => alternarFamilia(chave)} /></TableCell>
                  <TableCell>
                    <div className="flex min-w-0 items-center gap-2.5">
                      <ThumbProduto path={f.filhos[0].imagemPath} titulo={nome} size={32} />
                      <div className="min-w-0">
                        {/* Visual: nome em até 2 linhas e a contagem na sub-linha, onde nunca é cortada. O leitor
                            de tela recebe o nome inteiro uma vez só (sr-only), sem a versão partida. */}
                        {semFamilia ? (
                          <>
                            <div className={TITULO} title={nome} aria-hidden>{base}</div>
                            <span className="sr-only">{nome}</span>
                          </>
                        ) : (
                          <LinkDossie to={`/faturamento/sku/familia/${encodeURIComponent(f.codigoPai)}`} className="block w-fit">
                            <div className={TITULO} title={nome} aria-hidden>{base}</div>
                            <span className="sr-only">{nome}</span>
                          </LinkDossie>
                        )}
                        <div className="text-xs text-muted-foreground tabular-nums" aria-hidden>
                          {semFamilia ? 'sem família' : f.codigoPai} · {f.filhos.length} {f.filhos.length === 1 ? 'variação' : 'variações'}
                        </div>
                        {!exp && piores.length > 0 && <div className="mt-1"><Selos alertas={piores} parcial={f.m.fonteCusto === 'parcial'} /></div>}
                      </div>
                    </div>
                  </TableCell>
                  <Celulas l={soma} abc={abc.get(f.codigoPai)} />
                </TableRow>
                {exp && f.filhos.map((x) => linhaVariacao(x, true))}
              </Fragment>
            );
          })}
      </TableBody>
    </Table>
  );
}
