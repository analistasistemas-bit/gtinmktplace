import { useState } from 'react'
import { Boxes } from 'lucide-react'
import { useKitsCalculadora, type ColunaKit, type UseKitsCalculadoraArgs } from '@/hooks/useKitsCalculadora'
import { StatusPill, type StatusTone } from '@/components/ui/status-pill'
import { CampoNumero } from './formulario-calculadora-ml'

type QuadroKitsProps = Omit<UseKitsCalculadoraArgs, 'quantidadeN'>

const moeda = (valor: number) => valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const pct2 = (valor: number) => `${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`

const STATUS: Record<ColunaKit['status'], { label: string; tone: StatusTone }> = {
  ok: { label: 'Confirmado', tone: 'success' },
  calculando: { label: 'Calculando…', tone: 'neutral' },
  nao_confirmado: { label: 'Não confirmado', tone: 'warning' },
  sem_dados: { label: 'Sem dados', tone: 'neutral' },
}

const LINHAS: { label: string; valor: (c: ColunaKit) => string }[] = [
  { label: 'Custo do produto', valor: (c) => moeda(c.custo) },
  { label: 'Preço do kit', valor: (c) => (c.preco === null ? '—' : moeda(c.preco)) },
  { label: 'Preço por unidade', valor: (c) => (c.precoUnitario === null ? '—' : moeda(c.precoUnitario)) },
  { label: 'Frete', valor: (c) => (c.frete === null ? 'Desconhecido' : moeda(c.frete)) },
  { label: 'Comissão', valor: (c) => (c.comissao === null ? '—' : moeda(c.comissao)) },
  { label: 'Lucro do kit', valor: (c) => (c.lucro === null ? '—' : moeda(c.lucro)) },
  { label: 'Margem', valor: (c) => (c.margemPct === null ? '—' : pct2(c.margemPct)) },
]

export function QuadroKits(props: QuadroKitsProps) {
  const [quantidadeN, setQuantidadeN] = useState(1)
  const colunas = useKitsCalculadora({ ...props, quantidadeN })

  return (
    <section className="rounded-xl border border-border/70 bg-card p-5 sm:p-6" aria-labelledby="quadro-kits-heading">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 id="quadro-kits-heading" className="flex items-center gap-2 font-heading text-lg font-semibold"><Boxes className="size-5 text-primary" aria-hidden="true" /> Kits com a mesma margem</h2>
          <p className="mt-1 text-sm text-muted-foreground">Preço de cada kit para manter a margem atual, com frete e comissão cotados nas medidas do kit.</p>
        </div>
        <div className="w-40">
          <CampoNumero id="quantidade-kit" label="Quantidade no kit (N)" value={quantidadeN} casas={[0, 0]} onChange={(v) => setQuantidadeN(Math.max(1, Math.trunc(v)))} />
        </div>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[480px] text-sm">
          <thead>
            <tr className="border-b border-border/60">
              <th scope="col" className="py-2 pr-3 text-left font-medium text-muted-foreground"><span className="sr-only">Item</span></th>
              {colunas.map((c) => <th key={c.quantidade} scope="col" className="px-3 py-2 text-right font-heading font-semibold">{c.quantidade === 1 ? '1 unidade' : `Kit de ${c.quantidade}`}</th>)}
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-border/40">
              <th scope="row" className="py-2 pr-3 text-left font-normal text-muted-foreground">Situação</th>
              {colunas.map((c) => <td key={c.quantidade} className="px-3 py-2 text-right"><StatusPill tone={STATUS[c.status].tone}>{STATUS[c.status].label}</StatusPill></td>)}
            </tr>
            {LINHAS.map((linha) => (
              <tr key={linha.label} className="border-b border-border/40 last:border-0">
                <th scope="row" className="py-2 pr-3 text-left font-normal text-muted-foreground">{linha.label}</th>
                {colunas.map((c) => <td key={c.quantidade} className="px-3 py-2 text-right tabular-nums">{c.status === 'calculando' && linha.label !== 'Custo do produto' ? '…' : linha.valor(c)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">Custos fixos, variáveis e rebate considerados por kit.</p>
    </section>
  )
}
