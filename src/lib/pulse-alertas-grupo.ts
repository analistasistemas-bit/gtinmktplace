// Pulse (ADR-0133 Errata 4): a fila de trabalho do operador é de PRODUTOS, não de eventos — na org
// de validação, 9 alertas de Ação eram 4 produtos. Pura, sem I/O: o agrupamento é de exibição e não
// apaga nenhuma linha de `pulse_alertas`.
import type { PulseAlerta } from './pulse';

export interface GrupoAlertas {
  /** Chave de render. Produto quando há um; o id do alerta quando não há (grupo de um). */
  chave: string;
  produtoId: string | null;
  /** O que a linha exibe. */
  maisRecente: PulseAlerta;
  /** Todos os ids do grupo, do mais novo para o mais antigo — é o escopo do ✓ do grupo (D-3). */
  ids: string[];
  total: number;
  /** Os demais, para o expandir. Já sem o `maisRecente`. */
  demais: PulseAlerta[];
}

export function agruparAlertasPorProduto(alertas: PulseAlerta[]): GrupoAlertas[] {
  const porChave = new Map<string, PulseAlerta[]>();
  for (const a of alertas) {
    // Ficha removida: grupo de um. Juntar "sem produto" num balde só misturaria produtos
    // diferentes numa linha, que é exatamente o defeito que esta função existe para corrigir.
    const chave = a.produto_id ?? `alerta:${a.id}`;
    const lista = porChave.get(chave) ?? [];
    lista.push(a);
    porChave.set(chave, lista);
  }
  // A ordem dos grupos é a de chegada (a lista já vem por `criado_em desc`): reordenar aqui faria
  // a fila saltar sob o cursor a cada refetch.
  return [...porChave.entries()].map(([chave, lista]) => {
    const ordenados = [...lista].sort((a, b) => b.criado_em.localeCompare(a.criado_em));
    const [maisRecente, ...demais] = ordenados;
    return {
      chave,
      produtoId: maisRecente.produto_id,
      maisRecente,
      ids: ordenados.map((a) => a.id),
      total: ordenados.length,
      demais,
    };
  });
}
