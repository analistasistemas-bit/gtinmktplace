import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { DollarSign, Package, Receipt, Target, CheckCircle2, AlertTriangle, PackageX, Trophy, Check, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fmtBRL } from '@/lib/formato';
import { Button } from '@/components/ui/button';
import type { PublicadoItem } from '@/lib/publicados';
import { resolverJanela, periodoToParams, type Periodo, type PeriodoDias } from '@/lib/metricas';

interface Props {
  itens: PublicadoItem[];
  totais: { faturamento: number; unidades: number; pedidos: number };
  periodo: Periodo;
  onPeriodo: (p: Periodo) => void;
  carregando?: boolean;
  /** Mensagem quando as vendas não puderam ser lidas (ex.: app sem permissão de Pedidos). */
  aviso?: string | null;
  /** Markup agregado do período (null = sem dados de custo). */
  markupPct?: number | null;
}

const PERIODOS: { dias: PeriodoDias; label: string }[] = [
  { dias: 7, label: '7 dias' },
  { dias: 30, label: '30 dias' },
  { dias: 90, label: '90 dias' },
];

/** Datas YYYY-MM-DD para o rascunho. No range usa as do período (sem round-trip UTC). */
function rascunhoDe(p: Periodo): { desde: string; ate: string } {
  if (p.tipo === 'range') return { desde: p.desde, ate: p.ate };
  const j = resolverJanela(p);
  return { desde: j.desde.slice(0, 10), ate: j.ate.slice(0, 10) };
}

function Kpi({ icon: Icon, label, valor, tom, valorCor }: {
  icon: typeof DollarSign; label: string; valor: string; tom?: 'info' | 'success' | 'warning'; valorCor?: string;
}) {
  const cor = tom === 'success' ? 'text-success' : tom === 'warning' ? 'text-warning' : 'text-info';
  return (
    <div className="rounded-lg border bg-card px-3 py-2.5">
      <div className={cn('mb-1 flex items-center gap-1.5 text-xs text-muted-foreground', cor)}>
        <Icon className="h-3.5 w-3.5 shrink-0" />
        {label}
      </div>
      <div className={cn('text-lg font-semibold tabular-nums', valorCor)}>{valor}</div>
    </div>
  );
}

export function DashboardPublicados({ itens, totais, periodo, onPeriodo, carregando, aviso, markupPct }: Props) {
  // Rascunho local: abrir "Personalizado" e digitar datas NÃO refaz a busca.
  // Só ao clicar OK aplicamos via onPeriodo (e o período aplicado dispara o fetch).
  const [modoCustom, setModoCustom] = useState(periodo.tipo === 'range');
  const [rascunho, setRascunho] = useState(() => rascunhoDe(periodo));

  const presetAtivo = !modoCustom && periodo.tipo === 'preset' ? periodo.dias : null;

  const escolherPreset = (dias: PeriodoDias) => {
    setModoCustom(false);
    onPeriodo({ tipo: 'preset', dias });
  };

  const abrirCustom = () => {
    setRascunho(rascunhoDe(periodo));
    setModoCustom(true);
  };

  const rascunhoValido = !!rascunho.desde && !!rascunho.ate && rascunho.desde <= rascunho.ate;
  const aplicarCustom = () => {
    if (!rascunhoValido) return;
    onPeriodo({ tipo: 'range', desde: rascunho.desde, ate: rascunho.ate });
  };

  const queryDetalhe = new URLSearchParams(periodoToParams(periodo)).toString();

  const resumo = useMemo(() => {
    const total = itens.length;
    const ativos = itens.filter((i) => i.status === 'ativo').length;
    const comProblema = itens.filter(
      (i) => i.status === 'moderado' || i.status === 'inativo' || i.status === 'pausado',
    ).length;
    const encalhados = itens.filter(
      (i) => i.status === 'ativo' && (i.unidadesVendidas ?? 0) === 0,
    ).length;
    const topFat = [...itens]
      .filter((i) => (i.valorVendido ?? 0) > 0)
      .sort((a, b) => (b.valorVendido ?? 0) - (a.valorVendido ?? 0))
      .slice(0, 5);
    const topUnid = [...itens]
      .filter((i) => (i.unidadesVendidas ?? 0) > 0)
      .sort((a, b) => (b.unidadesVendidas ?? 0) - (a.unidadesVendidas ?? 0))
      .slice(0, 5);
    return { total, ativos, comProblema, encalhados, topFat, topUnid };
  }, [itens]);

  const ticket = totais.pedidos > 0 ? totais.faturamento / totais.pedidos : 0;

  return (
    <div className="mb-5 space-y-3">
      {/* Seletor de período */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Vendas nos últimos</span>
        <div className="flex gap-1">
          {PERIODOS.map((p) => (
            <Button
              key={p.dias}
              size="sm"
              variant={presetAtivo === p.dias ? 'default' : 'outline'}
              className="h-7 px-2.5 text-xs"
              onClick={() => escolherPreset(p.dias)}
            >
              {p.label}
            </Button>
          ))}
          <Button
            size="sm"
            variant={modoCustom ? 'default' : 'outline'}
            className="h-7 px-2.5 text-xs"
            onClick={abrirCustom}
          >
            Personalizado
          </Button>
        </div>
        {modoCustom && (
          <form
            className="flex items-center gap-1.5"
            onSubmit={(e) => { e.preventDefault(); aplicarCustom(); }}
          >
            <label className="text-xs text-muted-foreground" htmlFor="venda-de">De</label>
            <input
              id="venda-de"
              type="date"
              value={rascunho.desde}
              max={rascunho.ate}
              onChange={(e) => setRascunho((r) => ({ ...r, desde: e.target.value }))}
              className="h-7 rounded-md border bg-background px-2 text-xs dark:[color-scheme:dark]"
            />
            <label className="text-xs text-muted-foreground" htmlFor="venda-ate">Até</label>
            <input
              id="venda-ate"
              type="date"
              value={rascunho.ate}
              min={rascunho.desde}
              onChange={(e) => setRascunho((r) => ({ ...r, ate: e.target.value }))}
              className="h-7 rounded-md border bg-background px-2 text-xs dark:[color-scheme:dark]"
            />
            <Button
              type="submit"
              size="sm"
              className="h-7 px-2.5 text-xs"
              disabled={!rascunhoValido}
            >
              <Check className="mr-1 h-3.5 w-3.5" /> OK
            </Button>
          </form>
        )}
        {carregando && <span className="text-xs text-muted-foreground">atualizando…</span>}
      </div>

      {aviso && (
        <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          {aviso}
        </div>
      )}

      {/* Vendas */}
      <div className={cn('grid grid-cols-2 gap-3', markupPct != null ? 'md:grid-cols-5' : 'md:grid-cols-4')}>
        <Link
          to={{ pathname: '/publicados/vendas', search: queryDetalhe }}
          className="rounded-lg outline-none ring-offset-background transition focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90"
          aria-label="Faturamento — ver composição"
        >
          <Kpi icon={DollarSign} label="Faturamento" valor={fmtBRL(totais.faturamento)} tom="success" />
        </Link>
        <Kpi icon={Package} label="Unidades vendidas" valor={String(totais.unidades)} />
        <Kpi icon={Receipt} label="Pedidos" valor={String(totais.pedidos)} />
        <Kpi icon={Target} label="Ticket médio" valor={fmtBRL(ticket)} />
        {markupPct != null && (
          <Kpi
            icon={TrendingUp}
            label="Markup no período"
            valor={(markupPct >= 0 ? '+' : '') + Math.round(markupPct * 100) + '%'}
            valorCor={markupPct >= 0 ? 'text-success' : 'text-destructive'}
          />
        )}
      </div>

      {/* Saúde + Encalhados + Rankings */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="rounded-lg border bg-card px-3 py-2.5 text-sm">
          <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <CheckCircle2 className="h-3.5 w-3.5 text-success" /> Saúde dos anúncios
          </div>
          <div className="flex items-center justify-between">
            <span>Ativos</span>
            <span className="font-semibold tabular-nums text-success">{resumo.ativos}/{resumo.total}</span>
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span className="flex items-center gap-1 text-warning"><AlertTriangle className="h-3.5 w-3.5" /> Com problema</span>
            <span className="font-semibold tabular-nums text-warning">{resumo.comProblema}</span>
          </div>
        </div>

        <div className="rounded-lg border bg-card px-3 py-2.5 text-sm">
          <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <PackageX className="h-3.5 w-3.5 text-warning" /> Encalhados (sem venda no período)
          </div>
          <div className="text-2xl font-semibold tabular-nums">{resumo.encalhados}</div>
          <div className="text-xs text-muted-foreground">
            de {resumo.ativos} ativo(s) — candidatos a revisão de preço/título/foto
          </div>
        </div>

        <div className="rounded-lg border bg-card px-3 py-2.5 text-sm">
          <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Trophy className="h-3.5 w-3.5 text-info" /> Top produtos (faturamento)
          </div>
          {resumo.topFat.length === 0 ? (
            <div className="text-xs text-muted-foreground">Sem vendas no período.</div>
          ) : (
            <ul className="space-y-1">
              {resumo.topFat.map((i) => (
                <li key={i.familiaId} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate" title={i.titulo}>{i.titulo}</span>
                  <span className="shrink-0 font-medium tabular-nums">{fmtBRL(i.valorVendido ?? 0)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
