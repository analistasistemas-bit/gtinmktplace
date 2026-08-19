import type { ChangeEvent } from 'react'
import { ChevronDown, Package } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { BuscaCategoriaML } from './busca-categoria-ml'
import type { ProdutoCalculadoraML, TaxasManuaisML } from '@/hooks/useCalculadoraML'
import type { DimensoesProduto, EntradaCalculadoraML } from '@/lib/calculadora-ml'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface FormularioCalculadoraMLProps {
  entrada: EntradaCalculadoraML
  taxas: TaxasManuaisML
  produtos: ProdutoCalculadoraML[]
  produtoSelecionado: ProdutoCalculadoraML | null
  produtosCarregando: boolean
  onEntrada: (parcial: Partial<EntradaCalculadoraML>) => void
  onTaxas: (parcial: Partial<TaxasManuaisML>) => void
  onProduto: (produto: ProdutoCalculadoraML | null) => void
}

function numero(event: ChangeEvent<HTMLInputElement>, min: number, max?: number, onError?: (mensagem: string | null) => void) {
  const valor = Number(event.target.value)
  if (!Number.isFinite(valor)) return min
  if (valor < min) {
    onError?.(min === 0 ? 'Este valor não pode ser negativo.' : `Este valor deve ser no mínimo ${min}.`)
    return min
  }
  if (max !== undefined && valor > max) {
    onError?.(`Este valor deve ficar entre ${min} e ${max}.`)
    return max
  }
  onError?.(null)
  return valor
}

function chaveDimensoes(dimensoes?: Partial<DimensoesProduto>): string {
  return (['alturaCm', 'larguraCm', 'comprimentoCm', 'pesoKg'] as const)
    .map((chave) => dimensoes?.[chave] ?? '')
    .join('|')
}

function CampoNumero({ id, label, value, onChange, min = 0, max, step = '0.01', hint }: { id: string; label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; step?: string; hint?: string }) {
  const [erro, setErro] = useState<string | null>(null)
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      <Input id={id} type="number" min={min} max={max} step={step} value={value} onChange={(event) => onChange(numero(event, min, max, setErro))} inputMode="decimal" aria-invalid={Boolean(erro)} aria-describedby={erro ? `${id}-erro` : hint ? `${id}-hint` : undefined} />
      {erro && <p id={`${id}-erro`} className="text-xs text-destructive" role="alert">{erro}</p>}
      {hint && <p id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

export function FormularioCalculadoraML({ entrada, taxas, produtos, produtoSelecionado, produtosCarregando, onEntrada, onTaxas, onProduto }: FormularioCalculadoraMLProps) {
  const [dimensoesRascunho, setDimensoesRascunho] = useState<Partial<DimensoesProduto>>(entrada.dimensoes ?? {})
  const dimensoesExternasKey = chaveDimensoes(entrada.dimensoes)
  const atualizacaoEsperadaRef = useRef(dimensoesExternasKey)
  const dimensoesCompletas = (dimensoes: Partial<DimensoesProduto>): dimensoes is DimensoesProduto =>
    (['alturaCm', 'larguraCm', 'comprimentoCm', 'pesoKg'] as const).every((chave) => Number.isFinite(dimensoes[chave]) && (dimensoes[chave] as number) > 0)
  useEffect(() => {
    if (dimensoesExternasKey === atualizacaoEsperadaRef.current) return
    atualizacaoEsperadaRef.current = dimensoesExternasKey
    setDimensoesRascunho(entrada.dimensoes ?? {})
  }, [dimensoesExternasKey, entrada.dimensoes])
  const setDimensao = (chave: keyof DimensoesProduto, valor: number) => {
    const proximo = { ...dimensoesRascunho, [chave]: valor }
    setDimensoesRascunho(proximo)
    if (dimensoesCompletas(proximo)) {
      atualizacaoEsperadaRef.current = chaveDimensoes(proximo)
      onEntrada({ dimensoes: proximo })
    } else if (dimensoesCompletas(entrada.dimensoes ?? {})) {
      atualizacaoEsperadaRef.current = chaveDimensoes(undefined)
      onEntrada({ dimensoes: undefined })
    }
  }
  return (
    <div className="space-y-6">
      <section className="space-y-4" aria-labelledby="contexto-heading">
        <div>
          <h2 id="contexto-heading" className="font-heading text-lg font-semibold">Contexto da simulação</h2>
          <p className="mt-1 text-sm text-muted-foreground">Comece por um produto cadastrado ou informe os dados de uma oportunidade.</p>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="produto-cadastrado" className="flex items-center gap-1.5 text-sm font-medium"><Package className="size-4 text-muted-foreground" aria-hidden="true" /> Produto cadastrado <span className="font-normal text-muted-foreground">(opcional)</span></label>
          <div className="relative">
            <select id="produto-cadastrado" className="h-8 w-full appearance-none rounded-lg border border-input bg-transparent px-2.5 pr-8 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" value={produtoSelecionado?.codigoPai ?? ''} onChange={(event) => onProduto(produtos.find((produto) => produto.codigoPai === event.target.value) ?? null)} disabled={produtosCarregando}>
              <option value="">Produto avulso</option>
              {produtos.map((produto) => <option key={produto.codigoPai} value={produto.codigoPai}>{produto.nomePai}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-2 size-4 text-muted-foreground" aria-hidden="true" />
          </div>
        </div>
        <BuscaCategoriaML value={entrada.categoriaId} onSelect={(categoria) => onEntrada({ categoriaId: categoria.id })} />
      </section>

      <section className="space-y-4" aria-labelledby="comercial-heading">
        <h2 id="comercial-heading" className="font-heading text-lg font-semibold">Compra e venda</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <CampoNumero id="custo-produto" label="Custo de compra (R$)" value={entrada.custoProduto} onChange={(value) => onEntrada({ custoProduto: value })} />
          <CampoNumero id="preco-venda" label="Preço de venda (R$)" value={entrada.precoVenda} onChange={(value) => onEntrada({ precoVenda: value })} />
          <CampoNumero id="margem-alvo" label="Margem-alvo (%)" value={entrada.margemAlvoPct} onChange={(value) => onEntrada({ margemAlvoPct: value })} step="0.1" max={100} />
          <CampoNumero id="imposto" label="Impostos (%)" value={entrada.aliquotaImpostoPct} onChange={(value) => onEntrada({ aliquotaImpostoPct: value })} step="0.1" max={100} />
        </div>
      </section>

      <section className="space-y-4" aria-labelledby="custos-heading">
        <h2 id="custos-heading" className="font-heading text-lg font-semibold">Custos operacionais</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <CampoNumero id="custos-fixos" label="Custos fixos por unidade (R$)" value={entrada.custosFixos} onChange={(value) => onEntrada({ custosFixos: value })} />
          <CampoNumero id="custos-variaveis" label="Custos variáveis (R$)" value={entrada.custosVariaveis} onChange={(value) => onEntrada({ custosVariaveis: value })} />
          <CampoNumero id="rebate" label="Rebate/desconto (R$)" value={entrada.rebate} onChange={(value) => onEntrada({ rebate: value })} />
        </div>
      </section>

      <section className="space-y-4" aria-labelledby="logistica-heading">
        <div><h2 id="logistica-heading" className="font-heading text-lg font-semibold">Logística e taxas manuais</h2><p className="mt-1 text-sm text-muted-foreground">Use o frete manual somente quando a cotação oficial não estiver disponível.</p></div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <CampoNumero id="altura" label="Altura (cm)" value={dimensoesRascunho.alturaCm ?? 0} onChange={(value) => setDimensao('alturaCm', value)} />
          <CampoNumero id="largura" label="Largura (cm)" value={dimensoesRascunho.larguraCm ?? 0} onChange={(value) => setDimensao('larguraCm', value)} />
          <CampoNumero id="comprimento" label="Comprimento (cm)" value={dimensoesRascunho.comprimentoCm ?? 0} onChange={(value) => setDimensao('comprimentoCm', value)} />
          <CampoNumero id="peso" label="Peso real (kg)" value={dimensoesRascunho.pesoKg ?? 0} onChange={(value) => setDimensao('pesoKg', value)} />
        </div>
        <div className="rounded-lg border border-border/70 bg-muted/30 p-3">
          <p className="mb-3 text-sm font-medium">Fallback manual (estimativa)</p>
          <div className="grid gap-4 sm:grid-cols-3">
            <CampoNumero id="comissao-manual" label="Comissão (%)" value={taxas.percentualComissaoPct} onChange={(value) => onTaxas({ percentualComissaoPct: value })} step="0.1" max={95} />
            <CampoNumero id="taxa-fixa-manual" label="Taxa fixa (R$)" value={taxas.taxaFixa} onChange={(value) => onTaxas({ taxaFixa: value })} />
            <CampoNumero id="frete-manual" label="Frete (R$)" value={taxas.frete ?? 0} onChange={(value) => onTaxas({ frete: value, freteRealmenteZero: value === 0 ? taxas.freteRealmenteZero : false })} hint="Informe 0 apenas se o frete for realmente zero." />
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={taxas.freteRealmenteZero}
              onChange={(event) => onTaxas({ freteRealmenteZero: event.target.checked })}
            />
            Frete realmente zero
          </label>
        </div>
      </section>
      <Button type="button" variant="ghost" size="sm" onClick={() => onProduto(null)} disabled={!produtoSelecionado}>Limpar produto cadastrado</Button>
    </div>
  )
}
