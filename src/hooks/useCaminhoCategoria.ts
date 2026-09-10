import { useEffect, useState } from 'react';
import { caminhoCategoriaML } from '@/lib/caminho-categoria-ml';

/**
 * Caminho completo da categoria no ML (`path_from_root`), separado em ancestrais + folha para
 * quem renderiza decidir o layout (inline no diálogo de kit, empilhado no card estreito da
 * Revisão). O caminho chega por rede e é decoração: enquanto não chega — ou se a busca falhar —
 * `ancestrais` fica vazio e `folha` cai no nome que já veio do banco/da busca.
 */
export function useCaminhoCategoria(categoriaId: string | null, nome: string | null) {
  const [caminho, setCaminho] = useState<string[]>([]);

  useEffect(() => {
    setCaminho([]);
    if (!categoriaId) return;
    let vivo = true;
    void caminhoCategoriaML(categoriaId).then((c) => { if (vivo) setCaminho(c); });
    return () => { vivo = false; };
  }, [categoriaId]);

  return { ancestrais: caminho.slice(0, -1), folha: caminho.at(-1) ?? nome ?? '' };
}
