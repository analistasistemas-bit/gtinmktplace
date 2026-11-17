import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/ui/status-pill';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { fmtInt } from '@/lib/formato';
import type { FamiliaVisao, SkuVisao } from '@/hooks/useReposicao';
import { projetarSku } from '../../../supabase/functions/_shared/reposicao/calculo';
import { fmtDia, fraseVelocidade, ROTULO_URGENCIA, TOM_URGENCIA } from './por-que';

export interface CtxCalculo {
  prazo: number; cobertura: number; hoje: string; onRemoverNaoRepor: (id: string) => void; pendente?: boolean;
  /** "Incluir no pedido" do SKU nunca comprado: põe o `completarGrade` no rascunho do fornecedor. */
  onIncluirCompletar?: (familia: FamiliaVisao, s: SkuVisao) => void;
}

const ESCOPO_NAO_REPOR = { sku: 'este SKU', cor: 'esta cor', familia: 'este produto' } as const;

/** O cálculo do SKU em linguagem leiga (spec §3.4). Popover da célula e detalhe do produto sem variação. */
export function CalculoSku({ s, familia, ctx }: { s: SkuVisao; familia: FamiliaVisao; ctx: CtxCalculo }) {
  const { sug } = s;
  // Mesma projeção da edge (pedidos abertos montados como em dados.ts) para a sobra bater com o `pedir`.
  const proj = projetarSku({ v: sug.v, estoqueHoje: sug.estoqueHoje, pedidos: s.pedidos, hoje: ctx.hoje, prazo: ctx.prazo, cobertura: ctx.cobertura });
  const sobra = Math.floor(proj.E[ctx.prazo] + 1e-9);
  // O número é o mesmo da célula (`pedir`); a diferença para a falta pela média é a folga (e a caixa, se houver).
  const falta = Math.max(0, Math.ceil(proj.falta - 1e-9));
  const folga = sug.pedir - falta;
  const caixa = familia.multiplo > 1 && familia.pedir !== familia.pedirAntesMultiplo;
  // Nunca comprado: as linhas da conta seriam todas zero; fica só a explicação.
  const completar = !s.tela.naoReporId && sug.completarGrade > 0;
  const linhas: [string, string][] = [
    ['Estoque', fmtInt(sug.estoqueHoje)],
    ['Vendidos (60 dias)', fmtInt(Math.round(sug.unidades))],
    ['Dias disponíveis', fmtInt(sug.diasDisponiveis)],
    ['Velocidade', `${sug.v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}/dia`],
    ['A caminho', sug.aCaminho ? `${fmtInt(sug.aCaminho)}${sug.chegaEm ? `, chega ${fmtDia(sug.chegaEm)}` : ''}` : '0 un.'],
  ];
  return (
    <div className="flex flex-col gap-3 text-sm">
      {!completar && <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
        {linhas.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="text-right font-medium tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>}
      {s.tela.naoReporId ? (
        <div className="flex items-center justify-between gap-2 rounded-md bg-muted px-2 py-1.5">
          <span>Não repor{s.naoReporEscopo ? ` (${ESCOPO_NAO_REPOR[s.naoReporEscopo]})` : ''}.</span>
          <Button size="sm" variant="outline" className="h-11 md:h-7" disabled={ctx.pendente} onClick={() => ctx.onRemoverNaoRepor(s.tela.naoReporId!)}>Remover</Button>
        </div>
      ) : completar ? (
        <div className="flex flex-col gap-2">
          <p className="leading-relaxed">
            Este tamanho/cor nunca foi comprado. Sugestão para completar a grade: {fmtInt(sug.completarGrade)}. Não entra no pedido sozinho.
          </p>
          {ctx.onIncluirCompletar && (
            <Button size="sm" variant="outline" className="h-11 self-start md:h-8" disabled={ctx.pendente || !familia.fornecedor.nome.trim()}
              onClick={() => ctx.onIncluirCompletar!(familia, s)}>
              Incluir no pedido
            </Button>
          )}
        </div>
      ) : (
        <p className="leading-relaxed">
          {fraseVelocidade(sug.v)}
          {sug.v > 0 && <> Quando a compra chegar, sobra {fmtInt(sobra)}.</>}
          {sug.pedir <= 0
            ? <> Para durar {ctx.cobertura} dias, não precisa comprar.</>
            : folga <= 0
              ? <> Para durar {ctx.cobertura} dias, peça {fmtInt(sug.pedir)}.</>
              : <>
                  {' '}{falta > 0 ? `Pela média, faltam ${fmtInt(falta)} para durar ${ctx.cobertura} dias` : `Pela média, o estoque dura ${ctx.cobertura} dias`};
                  {' '}peça {fmtInt(sug.pedir)}: {fmtInt(folga)} a mais {caixa ? 'de folga e para fechar a caixa' : 'de folga'}, para não faltar se vender um pouco acima da média.
                </>}
        </p>
      )}
      {caixa && !s.tela.naoReporId && (
        <p className="leading-relaxed">
          A família pediu {fmtInt(familia.pedirAntesMultiplo)}; a caixa é de {fmtInt(familia.multiplo)}, então sobe para {fmtInt(familia.pedir)}, repartidos pelos tamanhos que mais vendem.
        </p>
      )}
      {sug.poucoHistorico && <p className="text-muted-foreground">Estimado pelas outras cores e tamanhos deste produto.</p>}
      <p className="text-caption">Pausas do anúncio ainda não entram na conta.</p>
    </div>
  );
}

export function PopoverCelula({ s, familia, ctx, titulo, children, onAbrir }: {
  s: SkuVisao; familia: FamiliaVisao; ctx: CtxCalculo; titulo: string; children: ReactNode; onAbrir?: () => void;
}) {
  return (
    <Popover onOpenChange={(o) => { if (o) onAbrir?.(); }}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-80" align="center" onOpenAutoFocus={(e) => e.preventDefault()}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="font-medium">{titulo}</p>
          {s.tela.naoReporId ? null : s.sug.completarGrade > 0
            ? <StatusPill tone="neutral">Nunca comprado</StatusPill>
            : <StatusPill tone={TOM_URGENCIA[s.urgencia]}>{ROTULO_URGENCIA[s.urgencia]}</StatusPill>}
        </div>
        <CalculoSku s={s} familia={familia} ctx={ctx} />
      </PopoverContent>
    </Popover>
  );
}
