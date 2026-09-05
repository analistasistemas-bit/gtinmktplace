import { useEffect, useState } from 'react';
import { onlineManager } from '@tanstack/react-query';

function horaAtual(): string {
  return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// Faixa de aviso offline (ADR-0153, D6). Sem rede, o app continua mostrando preço, estoque e
// saldo da última busca — dado de dinheiro que pode não ser de agora. A decisão é avisar, não
// esconder o valor: o risco a controlar é o operador achar que o número é de agora.
export function BannerOffline() {
  const [desde, setDesde] = useState<string | null>(() => (onlineManager.isOnline() ? null : horaAtual()));

  useEffect(() => {
    return onlineManager.subscribe((online) => {
      setDesde(online ? null : horaAtual());
    });
  }, []);

  if (!desde) return null;

  return (
    <aside
      className="flex items-center justify-center gap-2 border-b border-red-400/50 bg-red-50 px-4 py-2 text-center text-sm text-red-950 dark:bg-red-950/40 dark:text-red-100"
      aria-label="Sem conexão"
    >
      Sem conexão desde {desde} — valores podem estar desatualizados.
    </aside>
  );
}
