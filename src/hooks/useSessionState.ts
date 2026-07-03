import { useCallback, useState } from 'react';

/**
 * useState persistido em sessionStorage. Sobrevive a remount (troca de aba do
 * Faturamento, navegação Voltar→entrar de novo) e ao refetch das telas "Ao vivo",
 * preservando a ordenação escolhida pelo usuário. Limpa ao fechar a aba do browser.
 */
export function useSessionState<T>(chave: string, inicial: T) {
  const [estado, setEstado] = useState<T>(() => {
    try {
      const bruto = sessionStorage.getItem(chave);
      return bruto ? (JSON.parse(bruto) as T) : inicial;
    } catch {
      return inicial;
    }
  });

  const set = useCallback(
    (valor: T | ((anterior: T) => T)) => {
      setEstado((anterior) => {
        const proximo = typeof valor === 'function' ? (valor as (a: T) => T)(anterior) : valor;
        try {
          sessionStorage.setItem(chave, JSON.stringify(proximo));
        } catch {
          // ponytail: sessionStorage indisponível (modo privado/quota) → só memória, sem persistir
        }
        return proximo;
      });
    },
    [chave],
  );

  return [estado, set] as const;
}
