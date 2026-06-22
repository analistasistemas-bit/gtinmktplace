import { AlertCircle } from 'lucide-react';

// Preenchida na Fase 3 (ADR-0037).
export function AbaDevolucoes() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border bg-card px-4 py-16 text-center text-sm text-muted-foreground">
      <AlertCircle className="h-6 w-6" />
      Módulo de devoluções em ativação.
    </div>
  );
}
