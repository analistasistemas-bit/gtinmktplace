import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { StatusPill, type StatusTone } from '@/components/ui/status-pill';
import { Input } from '@/components/ui/input';
import { fmtBRL } from '@/lib/formato';
import { calcularMarkup } from '@/lib/markup';
import { useAliquotas } from '@/hooks/useConfiguracoes';
import {
  liquidoNoMercado, etiquetaParaMinimo, semaforoTipo, analisarComDimensoes,
  type ItemAnalisado, type ComissaoTipo, type DimensoesPacote,
} from '@/lib/viabilidade';
import type { Semaforo } from '@/lib/semaforo';

const TOM: Record<Semaforo, StatusTone> = {
  verde: 'success', amarelo: 'warning', vermelho: 'danger', indisponivel: 'neutral',
};
const ROTULO: Record<Semaforo, string> = {
  verde: 'Viável', amarelo: 'Apertado', vermelho: 'Inviável', indisponivel: '—',
};

function round2(n: number): number { return Math.round(n * 100) / 100; }

function BlocoTipo({ titulo, c, menor, minimo, custo, aliquotaPct, frete }: {
  titulo: string; c: ComissaoTipo; menor: number | null;
  minimo: number | null; custo: number | null; aliquotaPct: number; frete: number;
}) {
  const imposto = round2((menor ?? 0) * aliquotaPct / 100);
  const liquido = liquidoNoMercado(menor, c.saleFeeAmount, imposto, frete);
  const etiqueta = etiquetaParaMinimo(minimo, c.percentual, aliquotaPct, frete);
  const sem = semaforoTipo(menor, c.saleFeeAmount, minimo, custo, imposto, frete);
  const temCusto = custo != null && custo > 0;
  const mk = temCusto && liquido != null ? calcularMarkup(liquido, custo) : null;
  const prejuizo = mk != null && mk.lucro < 0;
  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex items-center justify-between">
        <span className="font-medium">{titulo}</span>
        <StatusPill tone={TOM[sem]}>{ROTULO[sem]}</StatusPill>
      </div>
      <dl className="mt-2 space-y-1 text-sm text-muted-foreground">
        <div className="flex justify-between"><dt>Comissão</dt><dd>−{fmtBRL(c.saleFeeAmount)} ({c.percentual}%)</dd></div>
        {imposto > 0 && (
          <div className="flex justify-between"><dt>Imposto</dt><dd>−{fmtBRL(imposto)} ({aliquotaPct}%)</dd></div>
        )}
        {frete > 0 && (
          <div className="flex justify-between"><dt>Frete (vendedor)</dt><dd>−{fmtBRL(frete)}</dd></div>
        )}
        <div className="flex justify-between"><dt>Líquido se igualar o mercado</dt><dd>{liquido != null ? fmtBRL(liquido) : '—'}</dd></div>
        {mk != null && (
          <div className="flex justify-between">
            <dt>{prejuizo ? 'Prejuízo' : 'Lucro'}</dt>
            <dd className={prejuizo ? 'text-destructive' : 'text-success'}>
              {fmtBRL(mk.lucro)} · markup {Math.round(mk.markup * 100)}%
            </dd>
          </div>
        )}
        <div className="flex justify-between"><dt>Pra receber seu mínimo, anuncie a</dt><dd>{etiqueta != null ? fmtBRL(etiqueta) : '—'}</dd></div>
      </dl>
    </div>
  );
}

function FormDimensoes({ gtin, onAtualizado }: { gtin: string; onAtualizado: (item: ItemAnalisado) => void }) {
  const [dim, setDim] = useState({ altura_cm: '', largura_cm: '', comprimento_cm: '', peso_gramas: '' });
  const [recalculando, setRecalculando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const faltaCampo = Object.values(dim).some((v) => v === '');

  const recalcular = async () => {
    const dimensoes: DimensoesPacote = {
      altura_cm: Number(dim.altura_cm), largura_cm: Number(dim.largura_cm),
      comprimento_cm: Number(dim.comprimento_cm), peso_gramas: Number(dim.peso_gramas),
    };
    setRecalculando(true);
    setErro(null);
    try {
      onAtualizado(await analisarComDimensoes(gtin, dimensoes));
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setRecalculando(false);
    }
  };

  return (
    <div className="mb-3 rounded-md border border-border bg-muted/40 p-3 text-sm">
      <p className="mb-2 text-muted-foreground">
        Frete estimado com pacote genérico (16×11×6cm, 300g) — sem dimensões cadastradas pra esse GTIN.
        Informe as reais para um cálculo mais preciso.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label htmlFor={`alt-${gtin}`} className="flex flex-col gap-1 text-xs">Altura (cm)
          <Input id={`alt-${gtin}`} type="number" step="0.1" min="0" className="w-20" value={dim.altura_cm}
            onChange={(e) => setDim((d) => ({ ...d, altura_cm: e.target.value }))} />
        </label>
        <label htmlFor={`larg-${gtin}`} className="flex flex-col gap-1 text-xs">Largura (cm)
          <Input id={`larg-${gtin}`} type="number" step="0.1" min="0" className="w-20" value={dim.largura_cm}
            onChange={(e) => setDim((d) => ({ ...d, largura_cm: e.target.value }))} />
        </label>
        <label htmlFor={`comp-${gtin}`} className="flex flex-col gap-1 text-xs">Compr. (cm)
          <Input id={`comp-${gtin}`} type="number" step="0.1" min="0" className="w-20" value={dim.comprimento_cm}
            onChange={(e) => setDim((d) => ({ ...d, comprimento_cm: e.target.value }))} />
        </label>
        <label htmlFor={`peso-${gtin}`} className="flex flex-col gap-1 text-xs">Peso (g)
          <Input id={`peso-${gtin}`} type="number" step="1" min="0" className="w-20" value={dim.peso_gramas}
            onChange={(e) => setDim((d) => ({ ...d, peso_gramas: e.target.value }))} />
        </label>
        <button onClick={recalcular} disabled={recalculando || faltaCampo}
          className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50">
          {recalculando ? 'Recalculando…' : 'Recalcular frete'}
        </button>
      </div>
      {erro && <p className="mt-1 text-xs text-destructive">{erro}</p>}
    </div>
  );
}

export function ViabilidadeLinha({ item: itemInicial, editavel }: { item: ItemAnalisado; editavel: boolean }) {
  const [aberto, setAberto] = useState(false);
  const [override, setOverride] = useState<ItemAnalisado | null>(null);
  const item = override ?? itemInicial;
  const [minimo, setMinimo] = useState<number | null>(item.minimo);
  const [custo, setCusto] = useState<number | null>(item.custo);
  const { data: aliquotas } = useAliquotas();
  const aliquotaPct = item.origem === 'importado' ? (aliquotas?.importado ?? 16) : (aliquotas?.nacional ?? 8);

  if (!item.existeNoML) {
    return (
      <tr className="border-t border-border text-muted-foreground">
        <td className="px-3 py-2">
          <span className="flex flex-col">
            <span>{item.nome || item.gtin}</span>
            {item.nome && item.nome !== item.gtin && (
              <span className="text-xs">GTIN {item.gtin}</span>
            )}
          </span>
        </td>
        <td colSpan={5} className="px-3 py-2">{item.erro ? 'ML indisponível' : 'não vende no ML'}</td>
      </tr>
    );
  }

  const c = item.classico!;
  const frete = item.frete ?? 0;
  const impostoResumo = round2((item.mercado!.menor ?? 0) * aliquotaPct / 100);
  const semaforo = semaforoTipo(item.mercado!.menor, c.saleFeeAmount, minimo, custo, impostoResumo, frete);
  const liquido = liquidoNoMercado(item.mercado!.menor, c.saleFeeAmount, impostoResumo, frete);

  return (
    <>
      <tr className="cursor-pointer border-t border-border hover:bg-accent/40" onClick={() => setAberto((v) => !v)}>
        <td className="px-3 py-2">
          <span className="inline-flex items-center gap-1">
            {aberto ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
            <span className="flex flex-col">
              <span>{item.nome || item.gtin}</span>
              {item.nome && item.nome !== item.gtin && (
                <span className="text-xs text-muted-foreground">GTIN {item.gtin}</span>
              )}
            </span>
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
          <td colSpan={6} className="px-3 py-3 motion-safe:animate-in fade-in-0 duration-(--motion-duration-state) ease-reversible">
            {editavel && item.dimensoesEncontradas === false && (
              <FormDimensoes gtin={item.gtin} onAtualizado={setOverride} />
            )}
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
              <BlocoTipo titulo="Clássico" c={item.classico!} menor={item.mercado!.menor} minimo={minimo} custo={custo} aliquotaPct={aliquotaPct} frete={frete} />
              <BlocoTipo titulo="Premium" c={item.premium!} menor={item.mercado!.menor} minimo={minimo} custo={custo} aliquotaPct={aliquotaPct} frete={frete} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
