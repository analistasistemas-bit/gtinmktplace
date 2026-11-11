import type { ReactNode } from 'react'
import { Package } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { BuscaCategoriaML } from './busca-categoria-ml'
import type { MetaStatus, ProdutoCalculadoraML, TaxasManuaisML } from '@/hooks/useCalculadoraML'
import type { AnuncioCalculadora } from '@/lib/anuncio-calculadora'
import type { DimensoesProduto, EntradaCalculadoraML, ModalidadeML } from '@/lib/calculadora-ml'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatarNomeProduto } from '@/lib/texto'

const AVULSO = '__avulso__'

interface FormularioCalculadoraMLProps {
  entrada: EntradaCalculadoraML
  taxas: TaxasManuaisML
  produtos: ProdutoCalculadoraML[]
  produtoSelecionado: ProdutoCalculadoraML | null
  produtosCarregando: boolean
  /** Prefill do produto em andamento: campos desabilitados até carregar (nada do produto anterior é editável). */
  carregando?: boolean
  onEntrada: (parcial: Partial<EntradaCalculadoraML>) => void
  onTaxas: (parcial: Partial<TaxasManuaisML>) => void
  onProduto: (produto: ProdutoCalculadoraML | null) => void
  /** Preço e margem falam com o hook (solver preço ⇄ margem), não com `onEntrada`. */
  onPreco: (preco: number) => void
  onMargem: (meta: number) => void
  margemExibida: number | null
  metaStatus: MetaStatus | null
  metaSolicitada: number | null
  modalidade: ModalidadeML
  modalidadeDoAnuncio?: ModalidadeML | null
  onModalidade: (modalidade: ModalidadeML) => void
  avisosProduto?: string[]
  /** Nome da categoria já conferido pelo chamador contra `entrada.categoriaId`. */
  categoriaNome?: string
  variacaoUsada?: { codigo: string; cor: string | null } | null
  anuncio?: AnuncioCalculadora | null
}

/**
 * Número em formato brasileiro. Ponto é milhar só quando há vírgula no texto ou mais de um ponto;
 * um ponto isolado é decimal ("12.5", "0.130"). Texto vazio ou inválido → null.
 */
// eslint-disable-next-line react-refresh/only-export-components -- exportada por contrato da Task 6 (testável)
export function parseNumeroBR(texto: string): number | null {
  let t = texto.replace(/R\$|\s/g, '')
  if (t.includes(',')) {
    if (t.lastIndexOf('.') > t.lastIndexOf(',')) return null
    t = t.replace(/\./g, '').replace(',', '.')
  } else if ((t.match(/\./g) ?? []).length > 1) {
    t = t.replace(/\./g, '')
  }
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(t)) return null
  return Number(t)
}

function chaveDimensoes(dimensoes?: Partial<DimensoesProduto>): string {
  return (['alturaCm', 'larguraCm', 'comprimentoCm', 'pesoKg'] as const)
    .map((chave) => dimensoes?.[chave] ?? '')
    .join('|')
}

interface CampoNumeroProps {
  id: string
  label: string
  /** null = campo vazio (ex.: imposto desconhecido). */
  value: number | null
  onChange: (value: number) => void
  /** Texto apagado: 'zero' envia 0, 'null' chama `onVazio`, 'ignorar' não faz nada. */
  vazio?: 'null' | 'ignorar' | 'zero'
  onVazio?: () => void
  permiteNegativo?: boolean
  /** Limites que mostram erro (sem clamp silencioso) e não enviam nada ao pai. */
  max?: number
  maxExclusivo?: number
  casas?: [min: number, max: number]
  hint?: ReactNode
}

/** Texto local até o blur: digita "12," sem o pai reformatar; fora do foco mostra pt-BR. */
export function CampoNumero({ id, label, value, onChange, vazio = 'zero', onVazio, permiteNegativo = false, max, maxExclusivo, casas = [2, 2], hint }: CampoNumeroProps) {
  const [rascunho, setRascunho] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const formatado = value === null || !Number.isFinite(value)
    ? ''
    : value.toLocaleString('pt-BR', { minimumFractionDigits: casas[0], maximumFractionDigits: casas[1], useGrouping: false })

  const aoDigitar = (texto: string) => {
    setRascunho(texto)
    if (texto.trim() === '') {
      setErro(null)
      if (vazio === 'zero') onChange(0)
      else if (vazio === 'null') onVazio?.()
      return
    }
    if (texto.trim() === '-' && permiteNegativo) return setErro(null)
    const valor = parseNumeroBR(texto)
    if (valor === null) return setErro('Digite um número válido.')
    if (valor < 0 && !permiteNegativo) return setErro('Este valor não pode ser negativo.')
    if (max !== undefined && valor > max) return setErro(`Este valor deve ser no máximo ${max.toLocaleString('pt-BR')}.`)
    if (maxExclusivo !== undefined && valor >= maxExclusivo) return setErro(`Este valor deve ser menor que ${maxExclusivo.toLocaleString('pt-BR')}.`)
    setErro(null)
    onChange(valor)
  }

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      <Input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={rascunho ?? formatado}
        onFocus={(event) => { setRascunho(formatado); event.currentTarget.select() }}
        onBlur={() => { setRascunho(null); setErro(null) }}
        onChange={(event) => aoDigitar(event.target.value)}
        aria-invalid={Boolean(erro)}
        aria-describedby={erro ? `${id}-erro` : hint ? `${id}-hint` : undefined}
      />
      {erro && <p id={`${id}-erro`} className="text-xs text-destructive" role="alert">{erro}</p>}
      {hint && <div id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  )
}

const ROTULO_MODALIDADE: Record<ModalidadeML, string> = { classico: 'Clássico', premium: 'Premium' }
const moeda = (valor: number) => valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const pct2 = (valor: number) => `${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`

export function FormularioCalculadoraML({
  entrada, taxas, produtos, produtoSelecionado, produtosCarregando, carregando = false, onEntrada, onTaxas, onProduto,
  onPreco, onMargem, margemExibida, metaStatus, metaSolicitada, modalidade, modalidadeDoAnuncio = null, onModalidade,
  avisosProduto = [], categoriaNome, variacaoUsada = null, anuncio = null,
}: FormularioCalculadoraMLProps) {
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
  // "De" riscado só em promoção de verdade: a edge pode devolver precoOriginal igual ao preço.
  const emPromocao = Boolean(anuncio?.publicado && anuncio.preco != null && anuncio.precoOriginal != null && anuncio.precoOriginal > anuncio.preco)
  const dicaMargem = metaStatus === 'calculando'
    ? <span role="status">Calculando o preço para a meta…</span>
    : metaStatus === 'nao_confirmada' && metaSolicitada !== null
      ? <span role="status">Preço calculado, mas meta de {pct2(metaSolicitada)} não confirmada.</span>
      : undefined
  return (
    <div className="space-y-6">
      <section className="space-y-4" aria-labelledby="contexto-heading">
        <div>
          <h2 id="contexto-heading" className="font-heading text-lg font-semibold">Contexto da simulação</h2>
          <p className="mt-1 text-sm text-muted-foreground">Comece por um produto cadastrado ou informe os dados de uma oportunidade.</p>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="produto-cadastrado" className="flex items-center gap-1.5 text-sm font-medium"><Package className="size-4 text-muted-foreground" aria-hidden="true" /> Produto cadastrado <span className="font-normal text-muted-foreground">(opcional)</span></label>
          {/* Radix não aceita item com value vazio: "Produto avulso" usa o sentinela AVULSO. */}
          <Select
            value={produtoSelecionado?.codigoPai ?? AVULSO}
            onValueChange={(v) => onProduto(produtos.find((produto) => produto.codigoPai === v) ?? null)}
            disabled={produtosCarregando}
          >
            <SelectTrigger id="produto-cadastrado" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={AVULSO}>Produto avulso</SelectItem>
              {produtos.map((produto) => <SelectItem key={produto.codigoPai} value={produto.codigoPai}>{formatarNomeProduto(produto.nomePai)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {carregando && <p className="text-sm text-muted-foreground" role="status">Carregando produto…</p>}
        {variacaoUsada && <p className="text-xs text-muted-foreground">Preço/medidas da variação {variacaoUsada.codigo}{variacaoUsada.cor ? ` (${variacaoUsada.cor})` : ''}</p>}
        {avisosProduto.length > 0 && (
          <ul className="space-y-1 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs" role="status" aria-label="Avisos do produto">
            {avisosProduto.map((aviso) => <li key={aviso}>{aviso}</li>)}
          </ul>
        )}
        <fieldset disabled={carregando} className="min-w-0 disabled:opacity-60">
          <BuscaCategoriaML value={entrada.categoriaId} nome={categoriaNome} onSelect={(categoria) => onEntrada({ categoriaId: categoria.id })} />
        </fieldset>
      </section>

      <fieldset disabled={carregando} className="min-w-0 space-y-6 disabled:opacity-60">

        <section className="space-y-4" aria-labelledby="comercial-heading">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="comercial-heading" className="font-heading text-lg font-semibold">Compra e venda</h2>
            <div className="flex gap-1 rounded-lg border border-border/70 bg-muted/40 p-1" role="group" aria-label="Modalidade do anúncio">
              {(['classico', 'premium'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={modalidade === m}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${modalidade === m ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}
                  onClick={() => onModalidade(m)}
                >
                  {ROTULO_MODALIDADE[m]}{modalidadeDoAnuncio === m ? ' · do anúncio' : ''}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <CampoNumero id="custo-produto" label="Custo de compra (R$)" value={entrada.custoProduto} onChange={(value) => onEntrada({ custoProduto: value })} />
            <CampoNumero
              id="preco-venda"
              label="Preço de venda (R$)"
              value={entrada.precoVenda}
              onChange={onPreco}
              hint={emPromocao ? <>Em promoção no ML: <s>{moeda(anuncio!.precoOriginal!)}</s> por {moeda(anuncio!.preco!)}</> : undefined}
            />
            <CampoNumero id="margem" label="Margem (%)" value={margemExibida} onChange={onMargem} vazio="ignorar" permiteNegativo maxExclusivo={100} hint={dicaMargem} />
            <CampoNumero id="imposto" label="Impostos (%)" value={entrada.aliquotaImpostoPct} onChange={(value) => onEntrada({ aliquotaImpostoPct: value })} vazio="null" onVazio={() => onEntrada({ aliquotaImpostoPct: null })} max={100} casas={[0, 2]} />
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
            <CampoNumero id="altura" label="Altura (cm)" value={dimensoesRascunho.alturaCm ?? 0} onChange={(value) => setDimensao('alturaCm', value)} casas={[0, 3]} />
            <CampoNumero id="largura" label="Largura (cm)" value={dimensoesRascunho.larguraCm ?? 0} onChange={(value) => setDimensao('larguraCm', value)} casas={[0, 3]} />
            <CampoNumero id="comprimento" label="Comprimento (cm)" value={dimensoesRascunho.comprimentoCm ?? 0} onChange={(value) => setDimensao('comprimentoCm', value)} casas={[0, 3]} />
            <CampoNumero id="peso" label="Peso real (kg)" value={dimensoesRascunho.pesoKg ?? 0} onChange={(value) => setDimensao('pesoKg', value)} casas={[0, 3]} />
          </div>
          <div className="rounded-lg border border-border/70 bg-muted/30 p-3">
            <p className="mb-3 text-sm font-medium">Fallback manual (estimativa)</p>
            <div className="grid gap-4 sm:grid-cols-3">
              <CampoNumero id="comissao-manual" label="Comissão (%)" value={taxas.percentualComissaoPct} onChange={(value) => onTaxas({ percentualComissaoPct: value })} max={95} casas={[0, 2]} />
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
      </fieldset>
      <Button type="button" variant="ghost" size="sm" onClick={() => onProduto(null)} disabled={!produtoSelecionado}>Limpar produto cadastrado</Button>
    </div>
  )
}
