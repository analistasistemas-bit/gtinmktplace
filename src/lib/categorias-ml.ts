import { erroDaEdge } from '@/lib/edge-erro'
import { supabase } from '@/lib/supabase'

export interface CategoriaML {
  id: string
  nome: string
  caminho?: string
}

function normalizarCategorias(raw: unknown): CategoriaML[] {
  if (!Array.isArray(raw)) return []

  return raw.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const { id, nome, caminho } = item as Record<string, unknown>
    if (typeof id !== 'string' || !id.trim() || typeof nome !== 'string' || !nome.trim()) {
      return []
    }
    return [{
      id: id.trim(),
      nome: nome.trim(),
      ...(typeof caminho === 'string' && caminho.trim() ? { caminho: caminho.trim() } : {}),
    }]
  })
}

export async function buscarCategoriasML(query: string): Promise<CategoriaML[]> {
  const termo = query.trim()
  if (termo.length < 3) return []

  const { data, error } = await supabase.functions.invoke('buscar-categorias-ml', {
    body: { query: termo },
  })
  if (error) throw await erroDaEdge(error)

  const resposta = data as { categorias?: unknown; error?: unknown } | null
  if (typeof resposta?.error === 'string') throw new Error(resposta.error)
  return normalizarCategorias(resposta?.categorias)
}
