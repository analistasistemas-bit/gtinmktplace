import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { StatusPill, type StatusTone } from '@/components/ui/status-pill';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { InfoDica } from '@/components/vitrine/info-dica';
import { LEGENDA } from '@/components/vitrine/dicas';
import { fmtInt } from '@/lib/formato';
import { formatarNomeProduto } from '@/lib/texto';
import { esperado7, linkML, taxa, type ItemAcao, type Preset, type Rotulo } from '@/lib/vitrine';

const ROTULO: Record<Rotulo, { label: string; tom: StatusTone; ponto: string; acao: string }> = {
  invisivel: { label: 'Invisível', tom: 'danger', ponto: 'bg-danger', acao: 'Checar moderação e indexação do anúncio.' },
  sem_venda: { label: 'Vitrine sem venda', tom: 'warning', ponto: 'bg-warning', acao: 'Rever preço, foto e título.' },
  converte: { label: 'Converte e ninguém vê', tom: 'info', ponto: 'bg-info', acao: 'Anunciar com Ads para ganhar visitas.' },
  perdendo: { label: 'Perdendo visitas', tom: 'warning', ponto: 'bg-warning', acao: 'Checar concorrência e posição na busca.' },
};
const PERIODO: Record<Preset, string> = { '4s': '4 sem', '12s': '12 sem', '6m': '6 meses' };
const significa = (r: Rotulo) => LEGENDA.find((l) => l.rotulo === r)?.significa ?? '';
const TOP = 10;
const pct = (x: number) => `${(x * 100).toFixed(1).replace('.', ',')}%`;
// título | visitas | conversão | em jogo (desktop); mobile empilha
const COLUNAS = 'sm:grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_5rem]';

function Linha({ a, preset }: { a: ItemAcao; preset: Preset }) {
  const { item: i, rotulo } = a;
  const r = ROTULO[rotulo];
  const conv = taxa(i.pedidos, i.visitas);
  const emJogo = Math.round(a.emJogo);
  const jogo = rotulo === 'invisivel' ? null : `≈ ${fmtInt(emJogo)}`;
  const motivo = rotulo === 'invisivel' ? `Sem visita há 7+ dias (o normal seria ~${Math.round(esperado7(i))})` : significa(rotulo);
  return (
    <li className={`relative grid gap-x-4 gap-y-1 py-3 ${COLUNAS}`}>
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs">
            <span aria-hidden className={`size-2 rounded-full ${r.ponto}`} />
            {r.label}
          </span>
          {rotulo === 'converte' && <StatusPill>{i.em_ads ? 'em Ads' : 'sem Ads'}</StatusPill>}
        </div>
        <div className="flex min-w-0 items-center gap-2 pr-8 sm:pr-0">
          <span className="min-w-0 truncate text-sm font-medium" title={formatarNomeProduto(i.titulo) || i.ml_item_id}>
            {i.titulo ? formatarNomeProduto(i.titulo) : i.ml_item_id}
          </span>
          {!i.titulo && <StatusPill>título ainda não coletado</StatusPill>}
          {i.variacao && <span className="shrink-0 rounded-full border px-2 py-0.5 text-xs text-muted-foreground">{i.variacao}</span>}
          <a
            href={linkML(i)} target="_blank" rel="noopener noreferrer" aria-label="Abrir anúncio no Mercado Livre"
            className="-m-4 inline-flex shrink-0 items-center justify-center rounded-full p-4 sm:-m-2.5 sm:p-2.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:absolute max-sm:right-0 max-sm:top-2.5"
          >
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
        </div>
      </div>
      <p className="hidden text-right text-sm tabular-nums sm:block">{fmtInt(i.visitas)}</p>
      <p className="hidden text-right text-sm tabular-nums sm:block">{conv != null ? pct(conv) : '—'}</p>
      <p className="hidden text-right text-sm tabular-nums sm:block">{jogo ?? '—'}</p>
      <p className="text-xs tabular-nums text-muted-foreground sm:hidden">
        {`${fmtInt(i.visitas)} visitas em ${PERIODO[preset]}${conv != null ? ` · conversão ${pct(conv)}` : ''}${jogo ? ` · ${jogo} ${emJogo === 1 ? 'pedido' : 'pedidos'} em jogo` : ''}`}
      </p>
      <p className="text-xs text-muted-foreground sm:col-span-4">{motivo}</p>
      <p className="text-xs sm:col-span-4">
        {r.acao}
        {i.codigo_pai && (
          <> <Link className="whitespace-nowrap font-medium underline underline-offset-2" to={`/faturamento/sku/familia/${encodeURIComponent(i.codigo_pai)}`}>Ver no dossiê ›</Link></>
        )}
      </p>
    </li>
  );
}

function Legenda() {
  return (
    <div className="flex flex-col gap-3 text-xs sm:gap-2">
      <div className={`hidden gap-3 font-medium text-foreground sm:grid sm:grid-cols-[7rem_1fr_1fr_1fr]`}>
        <span>Rótulo</span><span>Significa</span><span>O que fazer</span><span>Por que entrou</span>
      </div>
      {LEGENDA.map((l) => (
        <div key={l.rotulo} className="grid gap-1 border-t pt-2 sm:grid-cols-[7rem_1fr_1fr_1fr] sm:gap-3">
          <p className="font-medium text-foreground">{ROTULO[l.rotulo].label}</p>
          <p className="text-muted-foreground">{l.significa}</p>
          <p className="text-muted-foreground">{l.fazer}</p>
          <p className="text-muted-foreground">{l.porQue}</p>
        </div>
      ))}
    </div>
  );
}

export function OndeAgir({ acoes, preset }: { acoes: ItemAcao[]; preset: Preset }) {
  const [todos, setTodos] = useState(false);
  const [filtro, setFiltro] = useState<Rotulo | null>(null);
  const chips = (Object.keys(ROTULO) as Rotulo[])
    .map((r) => ({ r, n: acoes.filter((a) => a.rotulo === r).length }))
    .filter((c) => c.n > 0);
  const filtrada = filtro ? acoes.filter((a) => a.rotulo === filtro) : acoes;
  const lista = todos ? filtrada : filtrada.slice(0, TOP);
  const escolher = (r: Rotulo | null) => { setFiltro(r); setTodos(false); };
  return (
    <section aria-labelledby="vitrine-agir" className="flex flex-col gap-1 rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-1.5">
        <h2 id="vitrine-agir" className="text-sm font-medium">Onde agir</h2>
        <InfoDica titulo="Onde agir" className="w-[min(calc(100vw-2rem),40rem)]"><Legenda /></InfoDica>
      </div>
      {acoes.length === 0 ? (
        <p className="py-3 text-sm text-muted-foreground">Nada pedindo ação agora.</p>
      ) : (
        <>
          <TooltipProvider>
            <div role="group" aria-label="Filtrar por rótulo" className="flex flex-wrap gap-1.5 py-2">
              <Button size="sm" variant={filtro == null ? 'default' : 'outline'} aria-pressed={filtro == null} onClick={() => escolher(null)}>
                Todos {acoes.length}
              </Button>
              {chips.map(({ r, n }) => (
                <Tooltip key={r}>
                  <TooltipTrigger asChild>
                    <Button size="sm" variant={filtro === r ? 'default' : 'outline'} aria-pressed={filtro === r} onClick={() => escolher(r)}>
                      {ROTULO[r].label} {n}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{significa(r)}</TooltipContent>
                </Tooltip>
              ))}
            </div>
          </TooltipProvider>
          <div aria-hidden className={`hidden gap-x-4 border-b pb-1 text-xs text-muted-foreground sm:grid ${COLUNAS}`}>
            <span />
            <span className="text-right">Visitas</span>
            <span className="text-right">Conversão</span>
            <span className="text-right">Em jogo</span>
          </div>
          <ul className="divide-y divide-border">{lista.map((a) => <Linha key={a.item.ml_item_id} a={a} preset={preset} />)}</ul>
          {filtrada.length > TOP && (
            <Button variant="outline" size="sm" className="mt-2 self-start" onClick={() => setTodos(!todos)}>
              {todos ? 'Ver só os 10 primeiros' : `Ver todos (${filtrada.length})`}
            </Button>
          )}
        </>
      )}
    </section>
  );
}
