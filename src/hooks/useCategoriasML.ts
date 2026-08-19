import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { buscarCategoriasML } from '@/lib/categorias-ml'

const DEBOUNCE_MS = 300

export function useCategoriasML(query: string) {
  const queryNormalizada = query.trim()
  const [termo, setTermo] = useState(queryNormalizada)

  useEffect(() => {
    const timer = window.setTimeout(() => setTermo(queryNormalizada), DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [queryNormalizada])

  const consulta = useQuery({
    queryKey: ['categorias-ml', termo],
    queryFn: () => buscarCategoriasML(termo),
    enabled: termo.length >= 3,
    staleTime: 5 * 60_000,
  })

  return {
    ...consulta,
    data: termo === queryNormalizada && termo.length >= 3 ? consulta.data ?? [] : [],
  }
}
