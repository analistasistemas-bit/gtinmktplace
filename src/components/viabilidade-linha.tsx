import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { StatusPill, type StatusTone } from '@/components/ui/status-pill';
import { Input } from '@/components/ui/input';
import { fmtBRL } from '@/lib/formato';
import {
  liquidoNoMercado, etiquetaParaMinimo, semaforoTipo,
  type ItemAnalisado, type ComissaoTipo,
} from '@/lib/viabilidade';
import type { Semaforo } from '@/lib/semaforo';

const TOM: Record<Semaforo, StatusTone> = {
  verde: 'success', amarelo: 'warning', vermelho: 'danger', indisponivel: 'neutral',
};
const ROTULO: Record<Semaforo, string> = {
  verde: 'Viável', amarelo: 'Apertado', vermelho: 'Inviável', indisponivel: '—',
};

function BlocoTipo({ titulo, c, menor, minimo, custo }: {
  titulo: string; c: ComissaoTipo; menor: number | null;
  minimo: number | null; custo: number | null;
}) {
  const liquido = liquidoNoMercado(menor, c.saleFeeAmount);
  const etiqueta = etiquetaParaMinimo(minimo, c.percentual);
  const sem = semaforoTipo(menor, c.saleFeeAmount, minimo, custo);
  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex items-center justify-between">
        <span className="font-medium">{titulo}</span>
        <StatusPill tone={TOM[sem]}>{ROTULO[sem]}</StatusPill>
      </div>
      <dl className="mt-2 space-y-1 text-sm text-muted-foreground">
        <div className="flex justify-between"><dt>Comissão</dt><dd>{c.percentual}% + {fmtBRL(c.fixa)}</dd></div>
        <div className="flex justify-between"><dt>Líquido se igualar o mercado</dt><dd>{liquido != null ? fmtBRL(liquido) : '—'}</dd></div>
        <div className="flex justify-between"><dt>Pra receber seu mínimo, anuncie a</dt><dd>{etiqueta != null ? fmtBRL(etiqueta) : '—'}</dd></div>
      </dl>
    </div>
  );
}

export function ViabilidadeLinha({ item, editavel }: { item: ItemAnalisado; editavel: boolean }) {
  const [aberto, setAberto] = useState(false);
  const [minimo, setMinimo] = useState<number | null>(item.minimo);
  const [custo, setCusto] = useState<number | null>(item.custo);

  if (!item.existeNoML) {
    return (
      <tr className="border-t border-border text-muted-foreground">
        <td className="px-3 py-2">{item.nome || item.gtin}</td>
        <td colSpan={5} className="px-3 py-2">{item.erro ? 'ML indisponível' : 'não vende no ML'}</td>
      </tr>
    );
  }

  const c = item.classico!;
  const semaforo = semaforoTipo(item.mercado!.menor, c.saleFeeAmount, minimo, custo);
  const liquido = liquidoNoMercado(item.mercado!.menor, c.saleFeeAmount);

  return (
    <>
      <tr className="cursor-pointer border-t border-border hover:bg-accent/40" onClick={() => setAberto((v) => !v)}>
        <td className="px-3 py-2">
          <span className="inline-flex items-center gap-1">
            {aberto ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            {item.nome || item.gtin}
          </span>
        </td>
        <td className="px-3 py-2">{fmtBRL(item.mercado!.menor ?? 0)}</td>
        <td className="px-3 py-2">{item.mercado!.vendedores}</td>
        <td className="px-3 py-2">{minimo != null ? fmtBRL(minimo) : '—'}</td>
        <td className="px-3 py-2">{liquido != null ? fmtBRL(liquido) : '—'}</td>
        <td className="px-3 py-2"><StatusPill tone={TOM[semaforo]}>{ROTULO[semaforo]}</StatusPill></td>
      </tr>
      {aberto && (
        <tr className="border-t border-border bg-muted/30">
          <td colSpan={6} className="px-3 py-3">
            <div className="mb-3 flex flex-wrap items-center gap-4 text-sm">
              <label htmlFor={`minimo-${item.gtin}`} className="flex items-center gap-2">Seu mínimo
                <Input id={`minimo-${item.gtin}`} type="number" step="0.01" disabled={!editavel} className="w-28"
                  value={minimo ?? ''} onChange={(e) => setMinimo(e.target.value === '' ? null : Number(e.target.value))} />
              </label>
              <label htmlFor={`custo-${item.gtin}`} className="flex items-center gap-2">Custo
                <Input id={`custo-${item.gtin}`} type="number" step="0.01" disabled={!editavel} className="w-28"
                  value={custo ?? ''} onChange={(e) => setCusto(e.target.value === '' ? null : Number(e.target.value))} />
              </label>
              <span className="text-muted-foreground">
                Mercado: {fmtBRL(item.mercado!.menor ?? 0)}–{fmtBRL(item.mercado!.maior ?? item.mercado!.menor ?? 0)} ·
                {' '}{item.mercado!.freteGratis} c/ frete grátis · {item.mercado!.full} FULL
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <BlocoTipo titulo="Clássico" c={item.classico!} menor={item.mercado!.menor} minimo={minimo} custo={custo} />
              <BlocoTipo titulo="Premium" c={item.premium!} menor={item.mercado!.menor} minimo={minimo} custo={custo} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
