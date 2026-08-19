import { AlertTriangle, Calculator, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { useCalculadoraML } from '@/hooks/useCalculadoraML'
import type { ModalidadeML } from '@/lib/calculadora-ml'
import { FormularioCalculadoraML } from './formulario-calculadora-ml'
import { ResultadoCalculadoraML } from './resultado-calculadora-ml'

export function CalculadoraML() {
  const calculadora = useCalculadoraML()
  const [modalidade, setModalidade] = useState<ModalidadeML>('classico')
  const produtos = calculadora.produtos.data?.produtos ?? []
  const categoriaAusente = !calculadora.entrada.categoriaId?.trim()

  return (
    <main className="min-h-full bg-muted/20 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="max-w-3xl">
          <div className="flex items-center gap-2 text-sm font-medium text-primary"><Calculator className="size-4" aria-hidden="true" /> Viabilidade</div>
          <h1 className="mt-2 font-heading text-3xl font-semibold tracking-tight sm:text-4xl">Calculadora Mercado Livre</h1>
          <p className="mt-2 text-base text-muted-foreground">Avalie a compra e descubra por quanto vender antes de investir em estoque.</p>
        </header>

        {categoriaAusente && <aside className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm" role="status"><AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden="true" /><div><p className="font-semibold">Categoria ainda não foi informada</p><p className="mt-1 text-muted-foreground">A simulação está em modo de estimativa; comissão, taxa fixa e frete podem variar por categoria.</p><button type="button" className="mt-2 font-medium text-foreground underline underline-offset-2" onClick={() => calculadora.atualizarEntrada({ categoriaId: undefined })}>Continuar sem categoria</button></div></aside>}

        {calculadora.produtos.isLoading && <p className="rounded-lg border border-border/70 bg-card p-3 text-sm text-muted-foreground" role="status">Carregando produtos cadastrados…</p>}
        {calculadora.produtos.isError && <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive" role="alert">Não foi possível carregar produtos cadastrados. Você ainda pode simular um produto avulso.</p>}

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.8fr)]">
          <section className="rounded-xl border border-border/70 bg-card p-5 sm:p-6" aria-label="Dados da simulação">
            <FormularioCalculadoraML
              entrada={calculadora.entrada}
              taxas={calculadora.taxasManuais}
              produtos={produtos}
              produtoSelecionado={calculadora.produtoSelecionado}
              produtosCarregando={calculadora.produtos.isLoading}
              onEntrada={calculadora.atualizarEntrada}
              onTaxas={calculadora.atualizarTaxasManuais}
              onProduto={calculadora.selecionarProduto}
            />
          </section>
          <aside className="lg:sticky lg:top-4">
            <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground"><ShieldCheck className="size-4 text-primary" aria-hidden="true" /> Resultado transparente e acionável</div>
            <ResultadoCalculadoraML
              resultado={calculadora.resultado}
              statusCotacao={calculadora.statusCotacao}
              aviso={calculadora.aviso}
              taxas={calculadora.taxasManuais}
              modalidadeSelecionada={modalidade}
              onModalidade={(proxima) => { setModalidade(proxima); calculadora.atualizarEntrada({ modalidadeParaDecisao: proxima }) }}
              onValidar={() => { void calculadora.validarNaApi() }}
              erroMeta={calculadora.erroMeta}
              cotacaoMeta={calculadora.cotacaoMeta}
            />
          </aside>
        </div>
      </div>
    </main>
  )
}

export { FormularioCalculadoraML } from './formulario-calculadora-ml'
export { ResultadoCalculadoraML } from './resultado-calculadora-ml'
export { BuscaCategoriaML } from './busca-categoria-ml'
