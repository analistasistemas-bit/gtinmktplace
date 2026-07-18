import { useMemo, useState } from 'react';
import { MapPin, Building2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fmtBRL, fmtInt } from '@/lib/formato';
import { resolverJanela, type Periodo, type PeriodoDias } from '@/lib/metricas';
import { useVendas } from '@/hooks/useVendas';
import { agruparPorPedido } from '@/lib/pedidos-faturamento';
import { agruparPorGeografia } from '@/lib/geografia-vendas';
import { MapaBrasil } from '@/components/faturamento/mapa-brasil';
import { BotaoExportar } from '@/components/export/botao-exportar';
import { buildGeografiaReport } from '@/lib/export/adapters';
import { Button } from '@/components/ui/button';
import { KpiCard } from '@/components/ui/kpi-card';
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@/components/ui/table';

const PERIODOS: { dias: PeriodoDias; label: string }[] = [
  { dias: 7, label: '7 dias' },
  { dias: 30, label: '30 dias' },
  { dias: 90, label: '90 dias' },
];

/** Datas YYYY-MM-DD para o rascunho do período personalizado. */
function rascunhoDe(p: Periodo): { desde: string; ate: string } {
  if (p.tipo === 'range') return { desde: p.desde, ate: p.ate };
  const j = resolverJanela(p);
  return { desde: j.desde.slice(0, 10), ate: j.ate.slice(0, 10) };
}

export function AbaGeografia() {
  const [periodo, setPeriodo] = useState<Periodo>({ tipo: 'preset', dias: 30 });
  const [modoCustom, setModoCustom] = useState(false);
  const [rascunho, setRascunho] = useState(() => rascunhoDe(periodo));
  const [selecionada, setSelecionada] = useState<string | null>(null);
  const janela = useMemo(() => resolverJanela(periodo), [periodo]);

  const presetAtivo = !modoCustom && periodo.tipo === 'preset' ? periodo.dias : null;
  const ehHoje = !modoCustom && periodo.tipo === 'hoje';
  const rascunhoValido = !!rascunho.desde && !!rascunho.ate && rascunho.desde <= rascunho.ate;
  const escolherPreset = (d: PeriodoDias) => { setModoCustom(false); setSelecionada(null); setPeriodo({ tipo: 'preset', dias: d }); };
  const escolherHoje = () => { setModoCustom(false); setSelecionada(null); setPeriodo({ tipo: 'hoje' }); };
  const abrirCustom = () => { setRascunho(rascunhoDe(periodo)); setModoCustom(true); };
  const aplicarCustom = () => { if (rascunhoValido) { setSelecionada(null); setPeriodo({ tipo: 'range', desde: rascunho.desde, ate: rascunho.ate }); } };

  const { data: vendas, isFetching } = useVendas(janela, 'todos');

  const pedidos = useMemo(() => agruparPorPedido(vendas ?? []), [vendas]);
  const geo = useMemo(() => agruparPorGeografia(pedidos), [pedidos]);
  const valores = useMemo(
    () => Object.fromEntries(geo.porUf.map((u) => [u.uf, u.pedidos])),
    [geo],
  );

  const topUf = geo.porUf[0];
  const topUfSub = topUf ? `${topUf.pctPedidos}% dos pedidos` : undefined;

  const semDados = geo.totalPedidos === 0 && !isFetching;
  const carregando = isFetching && (vendas == null || vendas.length === 0);

  return (
    <div className="space-y-4">
      {/* Seletor de período + exportar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1">
        <Button
          size="sm"
          variant={ehHoje ? 'default' : 'outline'}
          className="h-7 px-2.5 text-xs"
          onClick={escolherHoje}
        >
          Hoje
        </Button>
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
        {modoCustom && (
          <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); aplicarCustom(); }}>
            <label className="text-xs text-muted-foreground" htmlFor="geo-de">De</label>
            <input id="geo-de" type="date" value={rascunho.desde} max={rascunho.ate}
              onChange={(e) => setRascunho((r) => ({ ...r, desde: e.target.value }))}
              className="h-7 rounded-md border bg-background px-2 text-xs dark:[color-scheme:dark]" />
            <label className="text-xs text-muted-foreground" htmlFor="geo-ate">Até</label>
            <input id="geo-ate" type="date" value={rascunho.ate} min={rascunho.desde}
              onChange={(e) => setRascunho((r) => ({ ...r, ate: e.target.value }))}
              className="h-7 rounded-md border bg-background px-2 text-xs dark:[color-scheme:dark]" />
            <Button type="submit" size="sm" className="h-7 px-2.5 text-xs" disabled={!rascunhoValido}>OK</Button>
          </form>
        )}
        </div>
        <BotaoExportar
          temKpis
          montarReport={(config) => buildGeografiaReport({ geo, periodo, config })}
        />
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <KpiCard
          size="compact"
          icon={MapPin}
          label="Estados atingidos"
          value={fmtInt(geo.estadosAtingidos)}
          tom="info"
        />
        <KpiCard
          size="compact"
          icon={Building2}
          label="Top estado"
          value={topUf?.uf ?? '—'}
          tom="success"
          hint={topUfSub}
        />
        <KpiCard
          size="compact"
          icon={Building2}
          label="Cidades"
          value={fmtInt(geo.porCidade.length)}
          tom="info"
        />
        {geo.semGeo > 0 && (
          <KpiCard
            size="compact"
            icon={AlertCircle}
            label="Sem localização"
            value={fmtInt(geo.semGeo)}
            tom="warning"
            hint="pedidos sem UF"
          />
        )}
      </div>

      {/* Estado de carregando / vazio */}
      {carregando && (
        <div className="py-10 text-center text-sm text-muted-foreground">Carregando…</div>
      )}
      {semDados && (
        <div className="py-10 text-center text-sm text-muted-foreground">
          Nenhuma venda com localização no período. Sincronize para importar do Mercado Livre.
        </div>
      )}

      {/* Bloco principal: mapa + rankings */}
      {!semDados && !carregando && (
        <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
          {/* Mapa */}
          <div className="rounded-lg border bg-card p-4 shadow-sm">
            <h3 className="mb-3 text-sm font-medium text-muted-foreground">Mapa de calor por estado</h3>
            <MapaBrasil
              valores={valores}
              unidade="pedidos"
              selecionada={selecionada}
              onSelecionar={(uf) => setSelecionada((s) => (s === uf ? null : uf))}
            />
          </div>

          {/* Rankings — altura igual ao mapa via flex h-full */}
          <div className="flex h-full flex-col gap-4">
            {/* Top estados */}
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card shadow-sm">
              <div className="shrink-0 border-b px-4 py-2.5">
                <h3 className="text-sm font-medium">Top estados</h3>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-color:hsl(var(--border))_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-track]:bg-transparent">
                <Table>
                  <TableHeader>
                    <TableRow className="text-xs text-muted-foreground hover:bg-transparent">
                      <TableHead className="py-2">UF</TableHead>
                      <TableHead className="py-2 text-right">Pedidos</TableHead>
                      <TableHead className="py-2 text-right">%</TableHead>
                      <TableHead className="py-2 text-right">Valor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {geo.porUf.slice(0, 8).map((u) => (
                      <TableRow
                        key={u.uf}
                        className={cn(
                          'cursor-pointer text-xs',
                          selecionada === u.uf && 'bg-primary/10',
                        )}
                        onClick={() => setSelecionada((s) => (s === u.uf ? null : u.uf))}
                      >
                        <TableCell className="py-1.5 font-medium">{u.uf}</TableCell>
                        <TableCell className="py-1.5 text-right tabular-nums">{fmtInt(u.pedidos)}</TableCell>
                        <TableCell className="py-1.5 text-right tabular-nums text-muted-foreground">
                          {u.pctPedidos}%
                        </TableCell>
                        <TableCell className="py-1.5 text-right tabular-nums">{fmtBRL(u.valor)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            {/* Top cidades */}
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card shadow-sm">
              <div className="shrink-0 border-b px-4 py-2.5">
                <h3 className="text-sm font-medium">Top cidades</h3>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-color:hsl(var(--border))_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-track]:bg-transparent">
                <Table>
                  <TableHeader>
                    <TableRow className="text-xs text-muted-foreground hover:bg-transparent">
                      <TableHead className="py-2">Cidade</TableHead>
                      <TableHead className="py-2">UF</TableHead>
                      <TableHead className="py-2 text-right">Pedidos</TableHead>
                      <TableHead className="py-2 text-right">Valor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {geo.porCidade.slice(0, 8).map((c) => (
                      <TableRow key={`${c.cidade}|${c.uf}`} className="text-xs">
                        <TableCell className="py-1.5 font-medium">{c.cidade}</TableCell>
                        <TableCell className="py-1.5 text-muted-foreground">{c.uf}</TableCell>
                        <TableCell className="py-1.5 text-right tabular-nums">{fmtInt(c.pedidos)}</TableCell>
                        <TableCell className="py-1.5 text-right tabular-nums">{fmtBRL(c.valor)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
