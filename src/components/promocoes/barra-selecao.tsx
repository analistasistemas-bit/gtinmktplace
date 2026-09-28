// ADR-0174 — barra de ação fixa no rodapé quando há seleção no detalhe da campanha.
import { Button } from '@/components/ui/button';

export function BarraSelecao({ convidados, participando, onAderir, onSair, onLimpar }: {
  convidados: number; participando: number; onAderir: () => void; onSair: () => void; onLimpar: () => void;
}) {
  const total = convidados + participando;
  if (total === 0) return null;
  return (
    <div className="sticky bottom-0 z-30 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-3 shadow-lg">
      <p className="text-sm font-medium">
        {total} selecionado{total > 1 ? 's' : ''}
        {convidados > 0 && <span className="text-muted-foreground"> · Aderir {convidados}</span>}
        {participando > 0 && <span className="text-muted-foreground"> · Sair {participando}</span>}
      </p>
      <div className="flex items-center gap-2">
        {convidados > 0 && <Button size="sm" onClick={onAderir}>Aderir {convidados}</Button>}
        {participando > 0 && <Button size="sm" variant="outline" onClick={onSair}>Sair {participando}</Button>}
        <Button size="sm" variant="ghost" onClick={onLimpar}>Limpar</Button>
      </div>
    </div>
  );
}
