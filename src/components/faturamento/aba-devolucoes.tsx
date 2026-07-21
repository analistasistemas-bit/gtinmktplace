import { useState, useMemo } from 'react';
import { RotateCcw, ExternalLink, AlertTriangle } from 'lucide-react';
import { useDevolucoes } from '@/hooks/useDevolucoes';
import { labelTipoDevolucao, type Devolucao } from '@/lib/devolucoes';
import { fmtBRL } from '@/lib/formato';
import { fmtDataCurta } from '@/lib/ml-status';
import { StatusPill } from '@/components/ui/status-pill';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { BotaoExportar } from '@/components/export/botao-exportar';
import { buildDevolucoesReport } from '@/lib/export/adapters';
import { Button } from '@/components/ui/button';
import { type PeriodoDias, type Periodo, resolverJanela } from '@/lib/metricas';

const ACAO_LABEL: Record<string, string> = {
  send_money_back: 'Devolver dinheiro',
  review_return: 'Revisar devolução',
  open_dispute: 'Abrir disputa',
  allow_return: 'Autorizar devolução',
  ship_product: 'Enviar produto',
};
const labelAcao = (a: string) => ACAO_LABEL[a] ?? a.replace(/_/g, ' ');

const PERIODOS: { dias: PeriodoDias; label: string }[] = [
  { dias: 7, label: '7 dias' }, { dias: 30, label: '30 dias' }, { dias: 90, label: '90 dias' },
];

const TIPOS: { v: string; label: string }[] = [
  { v: 'returns', label: 'Devoluções' },
  { v: 'cancel_purchase', label: 'Cancelamentos' },
  { v: 'mediations', label: 'Mediações' },
  { v: 'todos', label: 'Todos' },
];

function rascunhoDe(p: Periodo): { desde: string; ate: string } {
  if (p.tipo === 'range') return { desde: p.desde, ate: p.ate };
  const j = resolverJanela(p);
  return { desde: j.desde.slice(0, 10), ate: j.ate.slice(0, 10) };
}

function Acoes({ d }: { d: Devolucao }) {
  const acoes = d.acoes_pendentes ?? [];
  if (acoes.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-col gap-1">
      {acoes.map((a, i) => (
        <span key={i} className="inline-flex items-center gap-1 text-xs">
          {a.mandatory && <AlertTriangle className="h-3 w-3 text-warning" />}
          {labelAcao(a.action)}
          {a.due_date && <span className="text-muted-foreground">· até {fmtDataCurta(a.due_date)}</span>}
        </span>
      ))}
    </div>
  );
}

export function AbaDevolucoes() {
  const [periodo, setPeriodo] = useState<Periodo>({ tipo: 'preset', dias: 30 });
  const [tipoFiltro, setTipoFiltro] = useState<string>('returns');
  const [modoCustom, setModoCustom] = useState(false);
  const [rascunho, setRascunho] = useState(() => rascunhoDe(periodo));
  
  const janela = useMemo(() => resolverJanela(periodo), [periodo]);
  const presetAtivo = !modoCustom && periodo.tipo === 'preset' ? periodo.dias : null;
  const ehHoje = !modoCustom && periodo.tipo === 'hoje';
  const rascunhoValido = !!rascunho.desde && !!rascunho.ate && rascunho.desde <= rascunho.ate;
  const escolherPreset = (dias: PeriodoDias) => { setModoCustom(false); setPeriodo({ tipo: 'preset', dias }); };
  const escolherHoje = () => { setModoCustom(false); setPeriodo({ tipo: 'hoje' }); };
  const abrirCustom = () => { setRascunho(rascunhoDe(periodo)); setModoCustom(true); };
  const aplicarCustom = () => { if (rascunhoValido) setPeriodo({ tipo: 'range', desde: rascunho.desde, ate: rascunho.ate }); };

  const { data: devolucoes, isFetching, isError } = useDevolucoes();
  
  const lista = useMemo(() => {
    if (!devolucoes) return [];
    const de = janela.desde;
    const ate = janela.ate;
    return devolucoes.filter((d) => {
      if (d.aberto_em && (d.aberto_em < de || d.aberto_em > ate)) return false;
      if (tipoFiltro !== 'todos' && d.type !== tipoFiltro) return false;
      return true;
    });
  }, [devolucoes, janela, tipoFiltro]);

  if (!isFetching && devolucoes?.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-lg border bg-card px-4 py-16 text-center text-sm text-muted-foreground">
        <RotateCcw className="h-6 w-6" />
        Nenhuma devolução ou reclamação. Use "Sincronizar" na aba Vendas para importar do Mercado Livre.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-md border p-1 shadow-sm">
            <Button size="sm"
              variant={ehHoje ? 'default' : 'ghost'}
              className="h-7 px-2.5 text-xs"
              onClick={escolherHoje}>
              Hoje
            </Button>
            {PERIODOS.map((p) => (
              <Button key={p.dias} size="sm"
                variant={presetAtivo === p.dias ? 'default' : 'ghost'}
                className="h-7 px-2.5 text-xs"
                onClick={() => escolherPreset(p.dias)}>
                {p.label}
              </Button>
            ))}
            <Button size="sm"
              variant={modoCustom ? 'default' : 'ghost'}
              className="h-7 px-2.5 text-xs"
              onClick={abrirCustom}>
              Personalizado
            </Button>
            {modoCustom && (
              <form className="flex items-center gap-1.5 pl-2" onSubmit={(e) => { e.preventDefault(); aplicarCustom(); }}>
                <label className="text-xs text-muted-foreground" htmlFor="dev-de">De</label>
                <input id="dev-de" type="date" value={rascunho.desde} max={rascunho.ate}
                  onChange={(e) => setRascunho((r) => ({ ...r, desde: e.target.value }))}
                  className="h-7 rounded-md border bg-background px-2 text-xs dark:[color-scheme:dark]" />
                <label className="text-xs text-muted-foreground" htmlFor="dev-ate">Até</label>
                <input id="dev-ate" type="date" value={rascunho.ate} min={rascunho.desde}
                  onChange={(e) => setRascunho((r) => ({ ...r, ate: e.target.value }))}
                  className="h-7 rounded-md border bg-background px-2 text-xs dark:[color-scheme:dark]" />
                <Button type="submit" size="sm" className="h-7 px-2.5 text-xs" disabled={!rascunhoValido}>OK</Button>
              </form>
            )}
          </div>
          
          <div className="flex items-center gap-1 rounded-md border p-1 shadow-sm">
            {TIPOS.map((t) => (
              <Button key={t.v} size="sm"
                variant={tipoFiltro === t.v ? 'secondary' : 'ghost'}
                className="h-7 px-2.5 text-xs"
                onClick={() => setTipoFiltro(t.v)}>
                {t.label}
              </Button>
            ))}
          </div>
        </div>
        
        <BotaoExportar montarReport={() => buildDevolucoesReport(lista)} />
      </div>
      
      <div className="rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50 text-xs text-muted-foreground hover:bg-muted/50">
            <TableHead>Aberta</TableHead>
            <TableHead>Pedido</TableHead>
            <TableHead>Motivo</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Estornado</TableHead>
            <TableHead>Ações pendentes</TableHead>
            <TableHead className="w-8" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {lista.map((d) => {
            const aberto = d.status === 'opened';
            const urlClaim = d.type === 'returns'
              ? 'https://www.mercadolivre.com.br/post-purchase/post-sales?main.filter=returns&temporal.filter=in-process'
              : `https://www.mercadolivre.com.br/vendas/reclamacoes/vendedor/${d.claim_id}`;
            return (
              <TableRow key={d.id}>
                <TableCell className="whitespace-nowrap tabular-nums">{fmtDataCurta(d.aberto_em)}</TableCell>
                <TableCell className="tabular-nums">
                  <div className="flex flex-col">
                    <span>{d.pack_id ? `#${d.pack_id}` : (d.order_id ? `#${d.order_id}` : '—')}</span>
                    {d.pack_id != null && d.order_id != null && (
                      <span className="text-[10px] text-muted-foreground">Pedido: #{d.order_id}</span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="max-w-[220px] truncate" title={d.reason_texto ?? ''}>{d.reason_texto ?? '—'}</TableCell>
                <TableCell>{labelTipoDevolucao(d.type)}</TableCell>
                <TableCell><StatusPill tone={aberto ? 'warning' : 'neutral'}>{aberto ? 'Aberta' : 'Fechada'}</StatusPill></TableCell>
                <TableCell className="text-right tabular-nums">{d.valor_estornado != null ? fmtBRL(d.valor_estornado) : '—'}</TableCell>
                <TableCell><Acoes d={d} /></TableCell>
                <TableCell>
                  <a href={urlClaim} target="_blank" rel="noreferrer" className="text-info hover:underline"><ExternalLink className="h-3.5 w-3.5" /></a>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {isError && (
        <div className="px-4 py-10 text-center text-sm text-muted-foreground">Não foi possível carregar as devoluções. Tente novamente.</div>
      )}
      {!isError && !isFetching && lista.length === 0 && devolucoes?.length !== 0 && (
        <div className="px-4 py-10 text-center text-sm text-muted-foreground">Nenhum registro encontrado para os filtros selecionados.</div>
      )}
      {!isError && isFetching && lista.length === 0 && <div className="px-4 py-10 text-center text-sm text-muted-foreground">Carregando…</div>}
      </div>
    </div>
  );
}
