import { useEffect, useState } from 'react'
import { CheckCircle2, CircleAlert, Info, TrendingUp } from 'lucide-react'
import type { ModalidadeML, ResultadoCalculadoraML, ResultadoModalidadeML, TipoVereditoML } from '@/lib/calculadora-ml'
import type { TaxasManuaisML } from '@/hooks/useCalculadoraML'
import { StatusPill, type StatusTone } from '@/components/ui/status-pill'

interface ResultadoCalculadoraMLProps {
  resultado: ResultadoCalculadoraML
  statusCotacao: 'idle' | 'loading' | 'official' | 'partial' | 'estimated'
  aviso: string | null
  taxas: TaxasManuaisML
  /** Modalidade da decisão (toggle do formulário). A visão mobile abaixo é só de exibição. */
  modalidadeSelecionada: ModalidadeML
  /** Sem meta do operador, custo máximo e preço para margem-alvo não fazem sentido (meta 0). */
  temMeta: boolean
  /** Cotação sem frete (nem oficial nem manual confirmado): selo/título não podem dizer "frete manual". */
  freteDesconhecido?: boolean
}

const TOM_VEREDITO: Record<TipoVereditoML, StatusTone> = {
  Comprar: 'success', 'Negociar custo': 'warning', 'Ajustar preço': 'warning', Evitar: 'warning', 'Dados insuficientes': 'neutral', 'Margem atual': 'neutral',
}
const COR_ICONE: Partial<Record<StatusTone, string>> = { success: 'text-success', warning: 'text-warning' }

const moeda = (valor: number | null | undefined) => valor == null ? 'Não calculado' : valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const pct = (valor: number) => `${valor.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`

function SeloProveniencia({ proveniencia, freteDesconhecido = false }: { proveniencia: ResultadoCalculadoraML['proveniencia']; freteDesconhecido?: boolean }) {
  const config = {
    official: { label: 'Oficial · API ML', tone: 'success' as const },
    partial: { label: freteDesconhecido ? 'Parcial · frete desconhecido' : 'Parcial · frete manual', tone: 'warning' as const },
    estimated: { label: 'Estimativa · dados manuais', tone: 'neutral' as const },
  }[proveniencia]
  return <StatusPill tone={config.tone}>{config.label}</StatusPill>
}

function Modalidade({ nome, resultado, ativa, mobile, temMeta }: { nome: string; resultado: ResultadoModalidadeML | null; ativa: boolean; mobile: boolean; temMeta: boolean }) {
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
      <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-3 text-sm">
        <div><dt className="text-muted-foreground">Lucro</dt><dd className={`mt-0.5 text-2xl font-semibold tabular-nums tracking-tight ${resultado.lucro >= 0 ? 'text-success' : 'text-destructive'}`}>{moeda(resultado.lucro)}</dd></div>
        <div><dt className="text-muted-foreground">Margem</dt><dd className="mt-0.5 text-2xl font-semibold tabular-nums tracking-tight">{pct(resultado.margemPct)}</dd></div>
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
    </section>
  )
}

function variacaoMoeda(valor: number): string {
  return `${valor < 0 ? '−' : '+'}${moeda(Math.abs(valor))}`
}

export function ResultadoCalculadoraML({ resultado, statusCotacao, aviso, modalidadeSelecionada, temMeta, freteDesconhecido = false }: ResultadoCalculadoraMLProps) {
  // Qual card o mobile mostra: nunca altera a modalidade da decisão; acompanha-a quando ela troca.
  const [visao, setVisao] = useState<ModalidadeML>(modalidadeSelecionada)
  useEffect(() => setVisao(modalidadeSelecionada), [modalidadeSelecionada])
  const tipo = resultado.veredito.tipo
  const icon = tipo === 'Comprar' ? CheckCircle2 : tipo === 'Dados insuficientes' || tipo === 'Margem atual' ? Info : CircleAlert
  const Icon = icon
  const tomVeredito = TOM_VEREDITO[tipo]
  const ativo = resultado.modalidades[modalidadeSelecionada]
  const sensibilidade = resultado.modalidades[visao]?.sensibilidade
  const lucroAtual = resultado.modalidades[visao]?.lucro ?? 0
  const cenariosSensibilidade = sensibilidade ? [
    { rotulo: 'Se o custo de compra subir 10%', cenario: sensibilidade.custoCompraMais10Pct },
    { rotulo: 'Se o preço de venda cair 5%', cenario: sensibilidade.precoVendaMenos5Pct },
    { rotulo: 'Se o frete subir R$ 5', cenario: sensibilidade.freteMais5 },
  ] : []
  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-border/70 bg-card p-5 shadow-sm" aria-live="polite" aria-atomic="true">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="text-sm text-muted-foreground">Central de decisão · {modalidadeSelecionada === 'classico' ? 'Clássico' : 'Premium'}</p><h2 className="mt-1 flex items-center gap-2 font-heading text-2xl font-semibold"><Icon className={`size-6 ${COR_ICONE[tomVeredito] ?? 'text-primary'}`} aria-hidden="true" />{tipo}</h2></div>
          <SeloProveniencia proveniencia={resultado.proveniencia} freteDesconhecido={freteDesconhecido} />
        </div>
        <ul className="mt-4 space-y-2 text-sm text-muted-foreground">{resultado.veredito.fatores.map((fator) => <li key={fator} className="flex gap-2"><span aria-hidden="true">•</span><span>{fator}</span></li>)}</ul>
        {tipo === 'Margem atual' && <p className="mt-3 text-sm text-muted-foreground">Defina a <span className="font-medium text-foreground">margem desejada</span> no formulário para ver a recomendação (comprar, negociar custo ou ajustar preço).</p>}
      </section>

      {statusCotacao !== 'official' && <section className="rounded-xl border border-border/70 bg-muted/30 p-4" aria-label="Status da cotação" aria-live="polite" aria-atomic="true">
        <div className="flex items-start gap-2"><Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" /><div className="text-sm"><p className="font-medium">{statusCotacao === 'loading' ? 'Consultando taxas oficiais…' : statusCotacao === 'partial' ? (freteDesconhecido ? 'Comissão oficial · frete não calculado' : 'Comissão oficial e frete manual') : 'Taxas manuais estimadas'}</p><p className="mt-1 text-muted-foreground">{aviso ?? (statusCotacao === 'partial' ? 'A comissão veio da API; o frete manual precisa ser confirmado.' : 'Categoria, comissão e frete podem variar; informe a categoria para usar as taxas oficiais.')}</p></div></div>
      </section>}

      <div className="flex gap-1 rounded-lg border border-border/70 bg-muted/40 p-1 sm:hidden" role="tablist" aria-label="Modalidade de anúncio">
        {(['classico', 'premium'] as const).map((modalidade) => <button key={modalidade} type="button" role="tab" aria-selected={visao === modalidade} className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${visao === modalidade ? 'bg-background shadow-sm' : 'text-muted-foreground'}`} onClick={() => setVisao(modalidade)}>{modalidade === 'classico' ? 'Clássico' : 'Premium'}</button>)}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Modalidade nome="Clássico" resultado={resultado.modalidades.classico} ativa={visao === 'classico'} mobile temMeta={temMeta} />
        <Modalidade nome="Premium" resultado={resultado.modalidades.premium} ativa={visao === 'premium'} mobile temMeta={temMeta} />
      </div>
      {sensibilidade && <section className="rounded-xl border border-border/70 bg-card p-4" aria-labelledby="sensibilidade-heading">
        <h3 id="sensibilidade-heading" className="font-heading text-base font-semibold">E se piorar? · {visao === 'classico' ? 'Clássico' : 'Premium'}</h3>
        <p className="mt-1 text-sm text-muted-foreground">Lucro atual por unidade: <span className="font-medium text-foreground">{moeda(lucroAtual)}</span>. Veja quanto sobra se um item mudar:</p>
        <dl className="mt-3 divide-y divide-border/60 text-sm">
          {cenariosSensibilidade.map(({ rotulo, cenario }) => <div key={rotulo} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"><dt>{rotulo}</dt><dd className="text-right"><span className={`font-semibold ${cenario.lucro < 0 ? 'text-destructive' : ''}`}>{cenario.lucro < 0 ? `Prejuízo de ${moeda(Math.abs(cenario.lucro))}` : `Sobra ${moeda(cenario.lucro)}`}</span> <span className={`text-xs ${cenario.variacaoLucro < 0 ? 'text-destructive' : 'text-success'}`}>({variacaoMoeda(cenario.variacaoLucro)})</span></dd></div>)}
        </dl>
      </section>}
      {resultado.peso && <p className="flex items-center gap-2 text-xs text-muted-foreground"><TrendingUp className="size-3.5" aria-hidden="true" /> Peso utilizado: {resultado.peso.pesoUtilizadoKg.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} kg (cubado: {resultado.peso.pesoCubadoKg.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} kg).</p>}
      <div aria-hidden="true" data-testid="barra-resumo-ml" className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-3 border-t border-border bg-background/95 px-4 py-2.5 shadow-lg backdrop-blur lg:hidden">
        <StatusPill tone={tomVeredito}>{tipo}</StatusPill>
        <dl className="flex items-baseline gap-4 text-sm">
          <div className="flex items-baseline gap-1.5"><dt className="text-muted-foreground">Lucro</dt><dd className={`text-lg font-semibold tabular-nums ${ativo && ativo.lucro < 0 ? 'text-destructive' : 'text-success'}`}>{moeda(ativo?.lucro)}</dd></div>
          <div className="flex items-baseline gap-1.5"><dt className="text-muted-foreground">Margem</dt><dd className="text-lg font-semibold tabular-nums">{ativo ? pct(ativo.margemPct) : '—'}</dd></div>
        </dl>
      </div>
    </div>
  )
}
