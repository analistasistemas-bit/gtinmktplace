import type { ChangeEvent } from 'react'
import { ChevronDown, Package } from 'lucide-react'
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

function numero(event: ChangeEvent<HTMLInputElement>) {
  const valor = Number(event.target.value)
  return Number.isFinite(valor) ? valor : 0
}

function CampoNumero({ id, label, value, onChange, min = 0, step = '0.01', hint }: { id: string; label: string; value: number; onChange: (value: number) => void; min?: number; step?: string; hint?: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      <Input id={id} type="number" min={min} step={step} value={value} onChange={(event) => onChange(numero(event))} inputMode="decimal" />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

export function FormularioCalculadoraML({ entrada, taxas, produtos, produtoSelecionado, produtosCarregando, onEntrada, onTaxas, onProduto }: FormularioCalculadoraMLProps) {
  const setDimensao = (chave: keyof DimensoesProduto, valor: number) => onEntrada({ dimensoes: { ...(entrada.dimensoes ?? { alturaCm: 0, larguraCm: 0, comprimentoCm: 0, pesoKg: 0 }), [chave]: valor } })
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
          <CampoNumero id="margem-alvo" label="Margem-alvo (%)" value={entrada.margemAlvoPct} onChange={(value) => onEntrada({ margemAlvoPct: value })} step="0.1" />
          <CampoNumero id="imposto" label="Impostos (%)" value={entrada.aliquotaImpostoPct} onChange={(value) => onEntrada({ aliquotaImpostoPct: value })} step="0.1" />
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
          <CampoNumero id="altura" label="Altura (cm)" value={entrada.dimensoes?.alturaCm ?? 0} onChange={(value) => setDimensao('alturaCm', value)} />
          <CampoNumero id="largura" label="Largura (cm)" value={entrada.dimensoes?.larguraCm ?? 0} onChange={(value) => setDimensao('larguraCm', value)} />
          <CampoNumero id="comprimento" label="Comprimento (cm)" value={entrada.dimensoes?.comprimentoCm ?? 0} onChange={(value) => setDimensao('comprimentoCm', value)} />
          <CampoNumero id="peso" label="Peso real (kg)" value={entrada.dimensoes?.pesoKg ?? 0} onChange={(value) => setDimensao('pesoKg', value)} />
        </div>
        <div className="rounded-lg border border-border/70 bg-muted/30 p-3">
          <p className="mb-3 text-sm font-medium">Fallback manual (estimativa)</p>
          <div className="grid gap-4 sm:grid-cols-3">
            <CampoNumero id="comissao-manual" label="Comissão (%)" value={taxas.percentualComissaoPct} onChange={(value) => onTaxas({ percentualComissaoPct: value })} step="0.1" />
            <CampoNumero id="taxa-fixa-manual" label="Taxa fixa (R$)" value={taxas.taxaFixa} onChange={(value) => onTaxas({ taxaFixa: value })} />
            <CampoNumero id="frete-manual" label="Frete (R$)" value={taxas.frete ?? 0} onChange={(value) => onTaxas({ frete: value })} hint="Informe 0 apenas se o frete for realmente zero." />
          </div>
        </div>
      </section>
      <Button type="button" variant="ghost" size="sm" onClick={() => onProduto(null)} disabled={!produtoSelecionado}>Limpar produto cadastrado</Button>
    </div>
  )
}
