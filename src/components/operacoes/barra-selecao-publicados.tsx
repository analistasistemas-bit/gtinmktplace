// ADR-0174 emenda 2026-10-04 — barra fixa da seleção na tela Publicados (+ I5: reajuste de preço).
import { Button } from '@/components/ui/button';

export function BarraSelecaoPublicados({ ativos, pausados, onPausar, onReativar, onReajustar, onLimpar }: {
  ativos: number; pausados: number; onPausar: () => void; onReativar: () => void; onReajustar: () => void; onLimpar: () => void;
}) {
  const total = ativos + pausados;
  if (total === 0) return null;
  return (
    <div className="sticky bottom-0 z-30 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-3 shadow-lg">
      <p className="text-sm font-medium">{total} selecionado{total > 1 ? 's' : ''}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={onPausar} disabled={ativos === 0}>Pausar {ativos}</Button>
        <Button size="sm" variant="outline" onClick={onReativar} disabled={pausados === 0}>Reativar {pausados}</Button>
        <Button size="sm" variant="outline" onClick={onReajustar}>Reajustar preço ({total})</Button>
        <Button size="sm" variant="ghost" onClick={onLimpar}>Limpar</Button>
      </div>
    </div>
  );
}
