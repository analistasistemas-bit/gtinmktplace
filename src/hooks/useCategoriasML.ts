import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { buscarCategoriasML } from '@/lib/categorias-ml'

const DEBOUNCE_MS = 300

export function useCategoriasML(query: string) {
  const [termo, setTermo] = useState(query.trim())

  useEffect(() => {
    const timer = window.setTimeout(() => setTermo(query.trim()), DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [query])

  return useQuery({
    queryKey: ['categorias-ml', termo],
    queryFn: () => buscarCategoriasML(termo),
    enabled: termo.length >= 3,
    staleTime: 5 * 60_000,
  })
}
