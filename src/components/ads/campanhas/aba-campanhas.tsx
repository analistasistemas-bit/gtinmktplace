import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Info, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CarregandoMarca } from '@/components/ui/carregando-marca';
import type { useAdsCampanhas } from '@/hooks/useAdsCampanhas';
import type { useAdsMetricas } from '@/hooks/useAdsMetricas';
import { AvisoAcesso } from '@/components/ads/aviso';
import { TabelaCampanhas } from './tabela-campanhas';
import { DetalheCampanha, type PedidoBaseDetalhe } from './detalhe-campanha';
import { Competitividade } from './competitividade';
import type { AcoesFamilia } from './familia-campanha';

const BOTAO = 'h-8 max-sm:h-11 pointer-coarse:h-11';

export type DadosCampanhas = ReturnType<typeof useAdsCampanhas>;
export type MetricasCampanhas = Pick<ReturnType<typeof useAdsMetricas>, 'data' | 'isError' | 'refetch' | 'atualizar'>;

const lidoAs = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Sao_Paulo' })
    .format(new Date(iso));

/**
 * Aba Campanhas por período (plano ads-redesign §3.2/3.4/4.4). A página entrega o bloco da conta inteira (KPIs,
 * gráfico e resultado da conta: nunca apresentado como resultado das campanhas), a integridade e as métricas do
 * período (ads-metricas, escopo 'campanhas', lidas lá para o Atualizar do cabeçalho alcançá-las); aqui ficam a
 * tabela e o detalhe. A configuração atual (ads-campanhas) só alimenta o detalhe e o aviso de alertas: carregar ou
 * falhar nela não esconde a tabela.
 */
export function AbaCampanhas({ dados, metricas, pedido, conta, integridade, acoes }: {
  dados: DadosCampanhas;
  metricas: MetricasCampanhas;
  /** Período e comparação compartilhados pela página; null = sem janela pronta. */
  pedido: PedidoBaseDetalhe | null;
  conta?: ReactNode;
  integridade?: ReactNode;
  acoes?: AcoesFamilia;
}) {
  const [aberta, setAberta] = useState<{ id: number; nome: string } | null>(null);
  // O detalhe monta só quando há campanha aberta, então o Radix não tem gatilho para devolver o foco (cairia no
  // body). Guardamos o botão que abriu e o refocamos depois que o Radix terminar de fechar (QA P3).
  const gatilho = useRef<HTMLElement | null>(null);
  const abrir = (c: { id: number; nome: string }) => {
    gatilho.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setAberta(c);
  };
  useEffect(() => {
    if (aberta !== null) return;
    const t = setTimeout(() => {
      if (gatilho.current?.isConnected) gatilho.current.focus();
      gatilho.current = null;
    }, 0);
    return () => clearTimeout(t);
  }, [aberta]);
  const { resposta, campanhas, isLoading, isError, atualizando, atualizar, erroAtualizar, tentarDeNovo } = dados;

  let tabela: ReactNode;
  // Dado antes do erro: falha ao atualizar (ex.: limite de 1/min) mantém a tabela lida, com o horário (plano §4.9).
  if (metricas.isError && !metricas.data) {
    tabela = (
      <div role="alert" className="rounded-lg border border-border bg-card p-4 text-sm">
        <p className="flex items-start gap-2">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
          Não foi possível ler as campanhas do período no Mercado Livre.
        </p>
        <Button variant="outline" size="sm" className={`mt-3 ${BOTAO}`} onClick={() => void metricas.refetch()}>Tentar novamente</Button>
      </div>
    );
  } else if (!metricas.data) {
    tabela = <CarregandoMarca rotulo="Carregando campanhas" mensagem="Lendo as campanhas do período…" />;
  } else if (metricas.data.estado !== 'ok' && metricas.data.estado !== 'parcial') {
    tabela = <AvisoAcesso estado={metricas.data.estado} />;
  } else {
    const nomes = new Map(metricas.data.campanhas.map(c => [c.id, c.nome]));
    const lidoEm = metricas.data.atual?.lidoEm;
    // Leitura parcial (E1 com falha ou paginação parada): lista incompleta, nunca "nenhuma campanha" (pré-merge I2).
    const completa = metricas.data.estado === 'ok' && metricas.data.atual?.completo !== false;
    const motivo = metricas.data.avisos.length > 0
      ? metricas.data.avisos.join(' ')
      : 'o Mercado Livre não devolveu todas as campanhas do período nesta leitura.';
    tabela = (
      <>
        {!completa && (
          <div role="alert" className="rounded-lg border border-border bg-card p-4 text-sm">
            <p className="flex items-start gap-2">
              <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
              {`Lista de campanhas incompleta: ${motivo} As campanhas exibidas podem não ser todas.`}
            </p>
            <Button variant="outline" size="sm" className={`mt-3 ${BOTAO}`} onClick={() => void metricas.refetch()}>Tentar novamente</Button>
          </div>
        )}
        {metricas.isError && (
          <p role="status" className="flex items-start gap-2 text-sm">
            <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
            {`Não foi possível atualizar as campanhas agora; os valores exibidos são da leitura${lidoEm ? ` das ${lidoAs(lidoEm)}` : ' anterior'}.`}
          </p>
        )}
        <TabelaCampanhas campanhas={metricas.data.campanhas} comparacao={metricas.data.comparacao} completa={completa}
          onAbrir={id => abrir({ id, nome: nomes.get(id) ?? `Campanha ${id}` })} />
      </>
    );
  }

  // Configuração atual: só o que ela acrescenta (alertas, avisos de margem e horário da leitura).
  const ok = resposta?.estado === 'ok' && campanhas;
  const comAlerta = ok ? campanhas.map(c => ({ c, n: c.familias.filter(f => f.alertas.length > 0).length })).filter(x => x.n > 0) : [];
  // Carregando ou sem conexão: nada a acrescentar (a tabela já mostra o aviso da conexão).
  const configuracao = isError && (
    <p role="status" className="flex flex-wrap items-center gap-2 text-sm">
      <AlertTriangle aria-hidden className="size-4 shrink-0 text-warning" />
      Configuração atual indisponível: estado, orçamento e produtos de cada campanha não foram lidos.
      <Button variant="outline" size="sm" className={BOTAO} onClick={tentarDeNovo}>Tentar de novo</Button>
    </p>
  );

  return (
    <div className="space-y-6">
      {conta}
      <section aria-labelledby="ads-campanhas-titulo" className="space-y-3">
        <h2 id="ads-campanhas-titulo" className="text-h3">Campanhas no período</h2>
        {ok && !resposta.aliquotasConfirmadas && (
          <p role="status" className="flex items-start gap-2 text-sm">
            <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
            <span>Confirme as alíquotas de imposto em <Link to="/configuracoes" className="font-medium underline underline-offset-2">Configurações</Link> para ver a margem.</span>
          </p>
        )}
        {ok && resposta.projecaoLimitada && (
          <p role="status" className="flex items-start gap-2 text-sm">
            <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-info" />
            Alguns anúncios ficaram fora da projeção de margem nesta leitura.
          </p>
        )}
        {comAlerta.length > 0 && (
          <div role="status" className="flex flex-wrap items-center gap-2 text-sm">
            <AlertTriangle aria-hidden className="size-4 shrink-0 text-warning" />
            <span>Famílias em alerta na configuração atual:</span>
            {comAlerta.map(({ c, n }) => (
              <Button key={c.id} type="button" variant="outline" size="sm" className={BOTAO}
                onClick={() => abrir({ id: c.id, nome: c.nome })}>
                {c.nome} · {n === 1 ? '1 família' : `${n} famílias`}
              </Button>
            ))}
          </div>
        )}
        {configuracao}
        {tabela}
      </section>

      {integridade}

      <div className="space-y-3 text-xs text-muted-foreground">
        {ok && (
          <div className="flex flex-wrap items-center gap-3">
            <span className="tabular-nums">Configuração lida às {lidoAs(resposta.lidoEm)}</span>
            <Button type="button" variant="outline" size="sm" className={BOTAO} disabled={atualizando} onClick={() => void atualizar()}>
              {atualizando && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
              {atualizando ? 'Atualizando…' : 'Atualizar configuração'}
            </Button>
            {erroAtualizar && (
              <span role="alert" className="inline-flex items-center gap-1.5 text-foreground">
                <AlertTriangle aria-hidden className="size-3.5 shrink-0 text-warning" />
                Não foi possível atualizar agora; a configuração exibida é da última leitura.
              </span>
            )}
          </div>
        )}
        <div className="space-y-1">
          <p>Métricas do período informadas pela API de Ads do Mercado Livre; estado, orçamento e produtos são a configuração atual.</p>
          <p>Margem para Ads = ACOS máximo que o produto aguenta sem prejuízo no preço atual.</p>
        </div>
      </div>

      {aberta && pedido && (
        <DetalheCampanha campanhaId={aberta.id} nome={aberta.nome} pedido={pedido}
          campanha={campanhas?.find(c => c.id === aberta.id) ?? null} aberto onFechar={() => setAberta(null)}
          competitividade={<Competitividade campanhaId={aberta.id} pedido={pedido} />} acoes={acoes}
          configuracao={isError || (resposta && resposta.estado !== 'ok') ? 'erro' : isLoading || !resposta ? 'carregando' : 'lida'} />
      )}
    </div>
  );
}
