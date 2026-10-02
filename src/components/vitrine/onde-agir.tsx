import { useState } from 'react';
import { Link } from 'react-router-dom';
import { StatusPill, type StatusTone } from '@/components/ui/status-pill';
import { Button } from '@/components/ui/button';
import { fmtInt } from '@/lib/formato';
import { taxa, type ItemAcao, type Rotulo } from '@/lib/vitrine';

const ROTULO: Record<Rotulo, { label: string; tom: StatusTone; acao: string }> = {
  invisivel: { label: 'Invisível', tom: 'danger', acao: 'Checar moderação e indexação do anúncio.' },
  sem_venda: { label: 'Vitrine sem venda', tom: 'warning', acao: 'Rever preço, foto e título.' },
  converte: { label: 'Converte e ninguém vê', tom: 'info', acao: 'Anunciar com Ads para ganhar visitas.' },
  perdendo: { label: 'Perdendo visitas', tom: 'warning', acao: 'Checar concorrência e posição na busca.' },
};
const TOP = 10;
const pct = (x: number) => `${(x * 100).toFixed(1).replace('.', ',')}%`;

function Linha({ a }: { a: ItemAcao }) {
  const { item: i, rotulo } = a;
  const r = ROTULO[rotulo];
  const conv = taxa(i.pedidos, i.visitas);
  const emJogo = Math.round(a.emJogo);
  return (
    <li className="flex flex-col gap-1 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={r.tom}>{r.label}</StatusPill>
        {rotulo === 'converte' && <StatusPill>{i.em_ads ? 'em Ads' : 'sem Ads'}</StatusPill>}
        <span className="min-w-0 flex-1 truncate text-sm font-medium" title={i.titulo ?? i.ml_item_id}>{i.titulo ?? i.ml_item_id}</span>
      </div>
      <p className="text-xs tabular-nums text-muted-foreground">
        {fmtInt(i.visitas)} visitas{conv != null && ` · conversão ${pct(conv)}`}
        {' · '}
        {rotulo === 'invisivel' ? 'sem visita há 7+ dias' : `≈ ${fmtInt(emJogo)} ${emJogo === 1 ? 'pedido' : 'pedidos'} em jogo`}
      </p>
      <p className="text-xs">
        {r.acao}
        {i.codigo_pai && (
          <> <Link className="font-medium underline underline-offset-2" to={`/faturamento/sku/familia/${encodeURIComponent(i.codigo_pai)}`}>Ver no dossiê</Link></>
        )}
      </p>
    </li>
  );
}

export function OndeAgir({ acoes }: { acoes: ItemAcao[] }) {
  const [todos, setTodos] = useState(false);
  const lista = todos ? acoes : acoes.slice(0, TOP);
  return (
    <section aria-labelledby="vitrine-agir" className="flex flex-col gap-1 rounded-lg border bg-card p-4 shadow-sm">
      <h2 id="vitrine-agir" className="text-sm font-medium">Onde agir</h2>
      {acoes.length === 0 ? (
        <p className="py-3 text-sm text-muted-foreground">Nada pedindo ação agora.</p>
      ) : (
        <>
          <ul className="divide-y divide-border">{lista.map((a) => <Linha key={a.item.ml_item_id} a={a} />)}</ul>
          {acoes.length > TOP && (
            <Button variant="ghost" size="sm" className="self-start" onClick={() => setTodos(!todos)}>
              {todos ? 'Ver só os 10 primeiros' : `Ver todos (${acoes.length})`}
            </Button>
          )}
        </>
      )}
    </section>
  );
}
