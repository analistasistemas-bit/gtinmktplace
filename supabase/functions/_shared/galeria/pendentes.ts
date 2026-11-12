// Imagens prontas e ainda não aplicadas (aba "Imagens IA" de Publicados). Puro: a edge `galeria-pendentes` lê o banco e
// entrega as linhas. Só conta o que ainda importa: imagem do roteiro aprovado do anúncio (mesma regra do `listar`).
export interface ImagemLinha {
  id: string; anuncio_externo_id: string; cor: string; status: string; roteiro_id: string; missao: number;
}
export interface AplicacaoLinha {
  anuncio_externo_id: string; cor: string; status: string; manifesto: unknown;
}
export interface PendenteGaleria {
  anuncio_externo_id: string; cor: string;
  /** Aprovadas que nenhuma aplicação ativa cobre: é o que falta aplicar. */
  prontas: number;
  /** Geradas que ainda esperam aprovação do operador. */
  aguardando_aprovacao: number;
  /** Há aplicação em andamento nesta cor. */
  aplicando: boolean;
}

const PAGINA = 1000;

/** PostgREST corta em 1000 linhas: lê por páginas até esgotar. A consulta TEM de ordenar por coluna única. */
export async function paginar<T>(
  consulta: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const saida: T[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await consulta(de, de + PAGINA - 1);
    if (error) throw new Error(error.message);
    saida.push(...(data ?? []));
    if ((data ?? []).length < PAGINA) return saida;
  }
}
/** `in()` vai na URL: listas grandes saem em blocos. */
export const blocos = <T>(xs: T[], n = 100) => Array.from({ length: Math.ceil(xs.length / n) }, (_, k) => xs.slice(k * n, (k + 1) * n));

// Cobre a imagem: aplicada, ou a caminho (em_andamento). Revertida, falha, preparada e reversão não cobrem.
const COBRE = new Set(['aplicada', 'em_andamento']);

/** `roteiroAprovado`: anúncio → id do roteiro aprovado. */
export function agruparPendentes(
  imagens: ImagemLinha[], aplicacoes: AplicacaoLinha[], roteiroAprovado: Map<string, string>,
): PendenteGaleria[] {
  const cobertas = new Set<string>();
  const andamento = new Set<string>();
  for (const a of aplicacoes) {
    if (!COBRE.has(a.status)) continue;
    if (a.status === 'em_andamento') andamento.add(`${a.anuncio_externo_id}\u0000${a.cor}`);
    for (const m of Array.isArray(a.manifesto) ? a.manifesto : []) {
      const id = (m as { imagem_id?: unknown })?.imagem_id;
      if (typeof id === 'string') cobertas.add(id);
    }
  }
  const grupos = new Map<string, PendenteGaleria>();
  for (const i of imagens) {
    if (i.status !== 'aprovada' && i.status !== 'gerada') continue;
    if (roteiroAprovado.get(i.anuncio_externo_id) !== i.roteiro_id) continue;
    const chave = `${i.anuncio_externo_id}\u0000${i.cor}`;
    const g = grupos.get(chave) ?? { anuncio_externo_id: i.anuncio_externo_id, cor: i.cor, prontas: 0, aguardando_aprovacao: 0, aplicando: andamento.has(chave) };
    if (i.status === 'gerada') g.aguardando_aprovacao++;
    else if (!cobertas.has(i.id)) g.prontas++;
    grupos.set(chave, g);
  }
  return [...grupos.values()]
    .filter((g) => g.prontas > 0 || g.aguardando_aprovacao > 0)
    .sort((a, b) => b.prontas - a.prontas || a.cor.localeCompare(b.cor, 'pt-BR'));
}
