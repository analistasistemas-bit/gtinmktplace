import { Loader2, Search, Tag } from 'lucide-react'
import { useState } from 'react'
import { useCategoriasML } from '@/hooks/useCategoriasML'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { StatusPill } from '@/components/ui/status-pill'

interface BuscaCategoriaMLProps {
  value?: string
  onSelect: (categoria: { id: string; nome: string }) => void
  disabled?: boolean
}

export function BuscaCategoriaML({ value, onSelect, disabled = false }: BuscaCategoriaMLProps) {
  const [query, setQuery] = useState('')
  const { data: categorias = [], isLoading, isError, refetch } = useCategoriasML(query)

  return (
    <div className="space-y-2" aria-describedby="categoria-ajuda">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor="categoria-ml" className="flex items-center gap-1.5 text-sm font-medium">
          <Tag className="size-4 text-muted-foreground" aria-hidden="true" />
          Categoria Mercado Livre <span className="font-normal text-muted-foreground">(opcional)</span>
        </label>
        {value && <StatusPill tone="info">{value}</StatusPill>}
      </div>
      <p id="categoria-ajuda" className="text-xs text-muted-foreground">
        Escolha uma categoria para consultar taxas oficiais. Sem ela, a conta permanece estimada.
      </p>
      <div className="flex gap-2">
        <Input
          id="categoria-ml"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar por nome ou ID MLB..."
          disabled={disabled}
          aria-label="Buscar categoria Mercado Livre"
        />
        <Button type="button" variant="outline" size="icon" disabled={disabled || query.trim().length < 3 || isLoading} aria-label="Buscar categoria" onClick={() => { void refetch() }}>
          <Search aria-hidden="true" />
        </Button>
      </div>
      {isLoading && <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status"><Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> Buscando categorias…</p>}
      {isError && <p className="text-xs text-destructive" role="alert">Não foi possível buscar categorias. Tente novamente.</p>}
      {categorias.length > 0 && (
        <ul className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-border/70 p-1" aria-label="Sugestões de categoria">
          {categorias.map((categoria) => (
            <li key={categoria.id}>
              <button
                type="button"
                className="w-full rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => { onSelect(categoria); setQuery(categoria.nome) }}
                disabled={disabled}
              >
                <span className="font-medium">{categoria.nome}</span>
                <span className="ml-2 text-xs text-muted-foreground">{categoria.id}</span>
                {categoria.caminho && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{categoria.caminho}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
