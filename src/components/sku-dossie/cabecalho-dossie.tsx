import type { ReactNode } from 'react';
import { Layers, PackageOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { StatusPill } from '@/components/ui/status-pill';
import { ThumbProduto } from '@/components/faturamento/pilha-thumbs';
import { ALERTA, TENDENCIA } from '@/components/faturamento/rotulos-sku';
import { dataBR, idadeComercial } from '@/components/sku-dossie/formato-dossie';
import { fmtInt } from '@/lib/formato';
import type { DossieSku } from '@/lib/sku-dossie';

function Fato({ rotulo, children, fraco = false }: { rotulo: string; children: ReactNode; fraco?: boolean }) {
  return (
    <div className="min-w-0 bg-card px-3 py-2.5">
      <dt className="text-xs text-muted-foreground">{rotulo}</dt>
      <dd className={cn('mt-0.5 truncate text-sm font-medium tabular-nums', fraco && 'font-normal text-muted-foreground')}>{children}</dd>
    </div>
  );
}

/** `aviso` fica entre o título e a faixa de fatos: a explicação vem antes do "desconhecido". */
export function CabecalhoDossie({ dados, familia, aviso }: { dados: DossieSku; familia: boolean; aviso?: ReactNode }) {
  const cat = dados.catalogo[0];
  const ehKit = dados.catalogo.some((c) => c.ehKit);
  // ponytail: o hook só expõe a cobertura do Kit Virtual como fonte parcial; o texto é o contrato.
  const kitVirtual = dados.qualidade.fontesParciais.some((f) => f.startsWith('Kit Virtual'));
  const foto = dados.linhaPeriodo?.imagemPath ?? dados.linhaAnterior?.imagemPath ?? null;
  const t = dados.tendencia ? TENDENCIA[dados.tendencia] : null;
  const parcial = dados.linhaPeriodo?.m.fonteCusto === 'parcial';
  const hoje = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

  const sub = familia
    ? [`Família ${cat?.codigoPai ?? ''}`.trim(), `${dados.codigos.length} ${dados.codigos.length === 1 ? 'variação' : 'variações'}`]
    : [`Código ${dados.codigos[0]}`, cat?.cor, cat?.tamanho];

  return (
    <div className="flex flex-col gap-4">
      <header className="flex min-w-0 items-start gap-4">
        <ThumbProduto path={foto} titulo={dados.titulo} size={56} />
        <div className="min-w-0 flex-1 space-y-1.5">
          <h1 className="text-xl font-semibold leading-tight tracking-[-0.01em] text-balance break-words sm:text-2xl">{dados.titulo}</h1>
          <p className="text-sm text-muted-foreground tabular-nums">{sub.filter(Boolean).join(' · ')}</p>
          {(t || dados.alertas.length > 0 || ehKit || kitVirtual) && (
            // Dois relógios, dois grupos: a tendência é a posição de hoje; os alertas seguem o período escolhido.
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-0.5">
              {t && (
                <span className="inline-flex items-center gap-1.5">
                  <StatusPill tone={t.tom} title={t.dica}>{t.label}</StatusPill>
                  <span className="text-xs text-muted-foreground" title="Tendência de hoje: últimos 30 dias contra os 30 anteriores, independente do período escolhido">
                    posição em {hoje}
                  </span>
                </span>
              )}
              {dados.alertas.length > 0 && (
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">No período:</span>
                  {dados.alertas.map((a) => (
                    <StatusPill key={a} tone={ALERTA[a].tom}>{a === 'sem_custo' && parcial ? 'Lucro parcial' : ALERTA[a].label}</StatusPill>
                  ))}
                </span>
              )}
              {(ehKit || kitVirtual) && (
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  {ehKit && (
                    <StatusPill tone="neutral" title="Kit vinculado: o estoque é o da base, dividido pelas unidades do kit">
                      <Layers className="h-3 w-3" aria-hidden />Kit: estoque da base
                    </StatusPill>
                  )}
                  {kitVirtual && (
                    <StatusPill tone="info" title="Vendas dentro de Kit Virtual só têm registro a partir de set/2026">
                      <PackageOpen className="h-3 w-3" aria-hidden />Vendido também em Kit Virtual
                    </StatusPill>
                  )}
                </span>
              )}
            </div>
          )}
        </div>
      </header>

      {aviso}

      {/* Hairline entre os fatos: grid com gap de 1px sobre bg-border, sem uma borda por célula. */}
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border shadow-sm sm:grid-cols-4">
        <Fato rotulo="1ª venda" fraco={!dados.historicoDesde}>{dados.historicoDesde ? dataBR(dados.historicoDesde) : 'nenhuma'}</Fato>
        <Fato rotulo="Última venda" fraco={!dados.ultimaVenda}>{dados.ultimaVenda ? dataBR(dados.ultimaVenda) : 'nenhuma'}</Fato>
        <Fato rotulo="Idade comercial" fraco={!dados.historicoDesde}>
          {dados.historicoDesde ? idadeComercial(dados.historicoDesde) : 'indisponível'}
        </Fato>
        <Fato rotulo={ehKit ? 'Estoque (kits)' : 'Estoque hoje'} fraco={dados.estoque == null}>
          {dados.estoque == null ? 'desconhecido' : `${fmtInt(dados.estoque)} ${ehKit ? (dados.estoque === 1 ? 'kit' : 'kits') : 'un.'}`}
        </Fato>
      </dl>
    </div>
  );
}
