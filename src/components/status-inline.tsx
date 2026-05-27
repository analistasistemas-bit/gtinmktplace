import { Check } from 'lucide-react';

export type SaveStatus = 'salvando' | 'salvo' | 'erro' | undefined;

export function StatusInline({ status }: { status: SaveStatus }) {
  if (status === 'salvando') {
    return <span className="text-xs text-muted-foreground">Salvando…</span>;
  }
  if (status === 'salvo') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-green-600">
        <Check className="h-3 w-3" /> Salvo
      </span>
    );
  }
  if (status === 'erro') {
    return <span className="text-xs text-destructive">Erro ao salvar</span>;
  }
  return null;
}
