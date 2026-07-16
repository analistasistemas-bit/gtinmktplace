import { useState } from 'react';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { resolverJanela, type Periodo, type PeriodoDias } from '@/lib/metricas';

interface Props {
  periodo: Periodo;
  onPeriodo: (p: Periodo) => void;
  mostrarMesAtual?: boolean;
  /** Mostra "atualizando…" ao lado do seletor enquanto a query refaz. */
  carregando?: boolean;
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

/**
 * Seletor de período reutilizável (presets 7/30/90 + "Personalizado" com intervalo livre).
 * Controlado: o consumidor mantém `periodo` e decide onde persistir (estado, URL, ambos). O
 * rascunho do modo custom é local — digitar datas NÃO refaz a busca; só ao clicar OK aplicamos
 * via `onPeriodo`. Usado na lista Publicados e no Detalhe de vendas (o Faturamento tem o seu).
 */
export function SeletorPeriodo({ periodo, onPeriodo, mostrarMesAtual = false, carregando }: Props) {
  const [modoCustom, setModoCustom] = useState(periodo.tipo === 'range');
  const [rascunho, setRascunho] = useState(() => rascunhoDe(periodo));

  const presetAtivo = !modoCustom && periodo.tipo === 'preset' ? periodo.dias : null;
  const ehHoje = !modoCustom && periodo.tipo === 'hoje';
  const ehMesAtual = !modoCustom && periodo.tipo === 'mes_atual';

  const escolherPreset = (dias: PeriodoDias) => {
    setModoCustom(false);
    onPeriodo({ tipo: 'preset', dias });
  };

  const escolherHoje = () => {
    setModoCustom(false);
    onPeriodo({ tipo: 'hoje' });
  };

  const escolherMesAtual = () => {
    setModoCustom(false);
    onPeriodo({ tipo: 'mes_atual' });
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

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">Vendas nos últimos</span>
      <div className="flex gap-1">
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
        {mostrarMesAtual && (
          <Button
            size="sm"
            variant={ehMesAtual ? 'default' : 'outline'}
            className="h-7 px-2.5 text-xs"
            onClick={escolherMesAtual}
          >
            Mês atual
          </Button>
        )}
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
  );
}
