import { useEffect, useState } from 'react'
import { CheckCircle2, CircleAlert, Info, RefreshCw, Target, TrendingDown, TrendingUp } from 'lucide-react'
import type { ModalidadeML, ResultadoCalculadoraML, ResultadoModalidadeML } from '@/lib/calculadora-ml'
import type { TaxasManuaisML } from '@/hooks/useCalculadoraML'
import { Button } from '@/components/ui/button'
import { StatusPill } from '@/components/ui/status-pill'

interface ResultadoCalculadoraMLProps {
  resultado: ResultadoCalculadoraML
  statusCotacao: 'idle' | 'loading' | 'official' | 'partial' | 'estimated'
  aviso: string | null
  taxas: TaxasManuaisML
  /** Modalidade da decisão (toggle do formulário). A visão mobile abaixo é só de exibição. */
  modalidadeSelecionada: ModalidadeML
  /** Sem meta do operador, custo máximo e preço para margem-alvo não fazem sentido (meta 0). */
  temMeta: boolean
}

const moeda = (valor: number | null | undefined) => valor == null ? 'Não calculado' : valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const pct = (valor: number) => `${valor.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`

function SeloProveniencia({ proveniencia }: { proveniencia: ResultadoCalculadoraML['proveniencia'] }) {
  const config = {
    official: { label: 'Oficial · API ML', tone: 'success' as const },
    partial: { label: 'Parcial · frete manual', tone: 'warning' as const },
    estimated: { label: 'Estimativa · dados manuais', tone: 'neutral' as const },
  }[proveniencia]
  return <StatusPill tone={config.tone}>{config.label}</StatusPill>
}

function Modalidade({ nome, resultado, ativa, mobile, temMeta, onSelecionar }: { nome: string; resultado: ResultadoModalidadeML | null; ativa: boolean; mobile: boolean; temMeta: boolean; onSelecionar: () => void }) {
  if (!resultado) return <section className={mobile ? 'hidden sm:block' : undefined} aria-labelledby={`${nome}-heading`}><h3 id={`${nome}-heading`} className="font-heading text-base font-semibold">{nome}</h3><p className="mt-3 text-sm text-muted-foreground">Frete não calculado. Complete dimensões ou informe um valor manual.</p></section>
  const custos = [
    ['Produto', resultado.custos.custoProduto], ['Comissão', resultado.custos.comissao], ['Frete', resultado.custos.frete], ['Impostos', resultado.custos.imposto], ['Custos fixos', resultado.custos.custosFixos], ['Custos variáveis', resultado.custos.custosVariaveis], ['Rebate', -resultado.custos.rebate],
  ] as const
  return (
    <section className={`${mobile && !ativa ? 'hidden sm:block' : ''} rounded-xl border border-border/70 bg-card p-4`} aria-labelledby={`${nome}-heading`}>
      <div className="flex items-center justify-between gap-3">
        <h3 id={`${nome}-heading`} className="font-heading text-base font-semibold">{nome}</h3>
        <SeloProveniencia proveniencia={resultado.proveniencia} />
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div><dt className="text-muted-foreground">Lucro</dt><dd className={`mt-0.5 text-lg font-semibold ${resultado.lucro >= 0 ? 'text-success' : 'text-destructive'}`}>{moeda(resultado.lucro)}</dd></div>
        <div><dt className="text-muted-foreground">Margem</dt><dd className="mt-0.5 text-lg font-semibold">{pct(resultado.margemPct)}</dd></div>
      </dl>
      <div className="mt-4 border-t border-border/60 pt-3">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Composição do custo</p>
        <dl className="space-y-1.5 text-sm">
          {custos.map(([label, valor]) => <div key={label} className="flex justify-between gap-3"><dt className="text-muted-foreground">{label}</dt><dd>{moeda(valor)}</dd></div>)}
          <div className="flex justify-between gap-3 border-t border-border/60 pt-1.5 font-semibold"><dt>Total</dt><dd>{moeda(resultado.custos.total)}</dd></div>
        </dl>
      </div>
      {temMeta && <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
        <div className="rounded-lg bg-muted/50 p-2.5"><p className="text-xs text-muted-foreground">Custo máximo de compra</p><p className="font-semibold">{moeda(resultado.custoMaximoCompra)}</p></div>
        <div className="rounded-lg bg-muted/50 p-2.5"><p className="text-xs text-muted-foreground">Preço para margem-alvo</p><p className="font-semibold">{moeda(resultado.precoAlvo.valor)} <span className="text-xs font-normal text-muted-foreground">(projeção)</span></p></div>
      </div>}
      {mobile && <Button type="button" variant="outline" size="sm" className="mt-3 sm:hidden" onClick={onSelecionar}>Ver {nome}</Button>}
    </section>
  )
}

function variacaoMoeda(valor: number): string {
  return `${valor < 0 ? '−' : '+'}${moeda(Math.abs(valor))}`
}

export function ResultadoCalculadoraML({ resultado, statusCotacao, aviso, modalidadeSelecionada, temMeta }: ResultadoCalculadoraMLProps) {
  // Qual card o mobile mostra: nunca altera a modalidade da decisão; acompanha-a quando ela troca.
  const [visao, setVisao] = useState<ModalidadeML>(modalidadeSelecionada)
  useEffect(() => setVisao(modalidadeSelecionada), [modalidadeSelecionada])
  const tipo = resultado.veredito.tipo
  const icon = tipo === 'Comprar' ? CheckCircle2 : tipo === 'Dados insuficientes' || tipo === 'Margem atual' ? Info : CircleAlert
  const Icon = icon
  const sensibilidade = resultado.modalidades[visao]?.sensibilidade
  const cenariosSensibilidade = sensibilidade ? [
    { rotulo: 'Custo de compra +10%', cenario: sensibilidade.custoCompraMais10Pct },
    { rotulo: 'Preço de venda -5%', cenario: sensibilidade.precoVendaMenos5Pct },
    { rotulo: 'Frete +R$ 5', cenario: sensibilidade.freteMais5 },
  ] : []
  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-border/70 bg-card p-5 shadow-sm" aria-live="polite" aria-atomic="true">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="text-sm text-muted-foreground">Central de decisão · {modalidadeSelecionada === 'classico' ? 'Clássico' : 'Premium'}</p><h2 className="mt-1 flex items-center gap-2 font-heading text-2xl font-semibold"><Icon className="size-6 text-primary" aria-hidden="true" />{tipo}</h2></div>
          <SeloProveniencia proveniencia={resultado.proveniencia} />
        </div>
        <ul className="mt-4 space-y-2 text-sm text-muted-foreground">{resultado.veredito.fatores.map((fator) => <li key={fator} className="flex gap-2"><span aria-hidden="true">•</span><span>{fator}</span></li>)}</ul>
      </section>

      <section className="rounded-xl border border-border/70 bg-muted/30 p-4" aria-label="Status da cotação" aria-live="polite" aria-atomic="true">
        <div className="flex items-start gap-2"><Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" /><div className="text-sm"><p className="font-medium">{statusCotacao === 'loading' ? 'Consultando taxas oficiais…' : statusCotacao === 'official' ? 'Taxas oficiais aplicadas' : statusCotacao === 'partial' ? 'Comissão oficial e frete manual' : 'Taxas manuais estimadas'}</p><p className="mt-1 text-muted-foreground">{aviso ?? (statusCotacao === 'official' ? 'Comissão e frete vieram da API para esta categoria e preço.' : statusCotacao === 'partial' ? 'A comissão veio da API; o frete manual precisa ser confirmado.' : 'Categoria, comissão e frete podem variar; informe a categoria para usar as taxas oficiais.')}</p></div></div>
      </section>

      <div className="flex gap-1 rounded-lg border border-border/70 bg-muted/40 p-1 sm:hidden" role="tablist" aria-label="Modalidade de anúncio">
        {(['classico', 'premium'] as const).map((modalidade) => <button key={modalidade} type="button" role="tab" aria-selected={visao === modalidade} className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${visao === modalidade ? 'bg-background shadow-sm' : 'text-muted-foreground'}`} onClick={() => setVisao(modalidade)}>{modalidade === 'classico' ? 'Clássico' : 'Premium'}</button>)}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Modalidade nome="Clássico" resultado={resultado.modalidades.classico} ativa={visao === 'classico'} mobile temMeta={temMeta} onSelecionar={() => setVisao('classico')} />
        <Modalidade nome="Premium" resultado={resultado.modalidades.premium} ativa={visao === 'premium'} mobile temMeta={temMeta} onSelecionar={() => setVisao('premium')} />
      </div>
      {sensibilidade && <section className="rounded-xl border border-border/70 bg-card p-4" aria-labelledby="sensibilidade-heading">
        <h3 id="sensibilidade-heading" className="font-heading text-base font-semibold">Sensibilidade · {visao === 'classico' ? 'Clássico' : 'Premium'}</h3>
        <p className="mt-1 text-sm text-muted-foreground">Variação do lucro por cenário.</p>
        <dl className="mt-3 space-y-2 text-sm">
          {cenariosSensibilidade.map(({ rotulo, cenario }) => <div key={rotulo} className="flex justify-between gap-3"><dt>{rotulo}</dt><dd className={cenario.variacaoLucro < 0 ? 'text-destructive' : 'text-success'}>{variacaoMoeda(cenario.variacaoLucro)}</dd></div>)}
        </dl>
      </section>}
      {resultado.peso && <p className="flex items-center gap-2 text-xs text-muted-foreground"><TrendingUp className="size-3.5" aria-hidden="true" /> Peso utilizado: {resultado.peso.pesoUtilizadoKg.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} kg (cubado: {resultado.peso.pesoCubadoKg.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} kg).</p>}
      <div className="grid gap-3 sm:grid-cols-3"><div className="rounded-lg border border-border/70 p-3"><TrendingDown className="size-4 text-primary" aria-hidden="true" /><p className="mt-2 text-xs text-muted-foreground">Menor custo</p><p className="text-sm">Teste reduzir o custo de compra para elevar a margem.</p></div><div className="rounded-lg border border-border/70 p-3"><Target className="size-4 text-primary" aria-hidden="true" /><p className="mt-2 text-xs text-muted-foreground">Custo máximo</p><p className="text-sm">Com uma margem definida, o teto de compra considera essa meta.</p></div><div className="rounded-lg border border-border/70 p-3"><RefreshCw className="size-4 text-primary" aria-hidden="true" /><p className="mt-2 text-xs text-muted-foreground">Sensibilidade</p><p className="text-sm">Revalide sempre que preço, frete ou categoria mudar.</p></div></div>
    </div>
  )
}
