// Pulse (ADR-0119): radar dirigido de concorrência — preços e vendedores dos produtos de
// catálogo dos nossos anúncios, com price-to-win e simulador de margem.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Activity, Plus, RefreshCw, Search, TrendingUp, Unlink, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { KpiCard } from '@/components/ui/kpi-card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  contarPulse, filtrarProdutos, temFiltroAtivo, FILTROS_VAZIOS,
  type FiltrosPulse, type FocoPulse, type StatusAnuncio,
} from '@/lib/pulse-filtros';
import { PageHeader } from '@/components/ui/page-header';
import { BorderTrail } from '@/components/ui/border-trail';
import { PulsoAoVivo } from '@/components/ui/ao-vivo';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { TabelaRadar } from '@/components/pulse/tabela-radar';
import { DialogDetalhe } from '@/components/pulse/dialog-detalhe';
import { DialogAdicionar } from '@/components/pulse/dialog-adicionar';
import { AbaAlertas } from '@/components/pulse/aba-alertas';
import { DialogReprecificar } from '@/components/pulse/dialog-reprecificar';
import { useModulosHabilitados } from '@/hooks/useModulosHabilitados';
import { QK } from '@/lib/queries';
import {
  fetchPulseProdutos, fetchPulseResumoOfertas, coletarPulseAgora, contarPulseAlertas,
  fetchContextoMargemEmLote, fetchPulseHistoricoOfertas, type PulseProduto,
} from '@/lib/pulse';
import { cn } from '@/lib/utils';
import { fmtInt } from '@/lib/formato';
import { useCountUp } from '@/hooks/use-count-up';
import PulseSonar from './PulseSonar';

/** Alvo único da reprecificação: a aba Alertas e a linha do Radar alimentam o MESMO dialog. */
type AlvoReprecificar = { codigoPai: string | null; precoInicial: number | null; produtoId: string | null };

function coletaMaisRecente(produtos: PulseProduto[]): string | null {
  let maisRecente: string | null = null;
  for (const produto of produtos) {
    if (produto.ultimo_snapshot_em && (!maisRecente || produto.ultimo_snapshot_em > maisRecente)) {
      maisRecente = produto.ultimo_snapshot_em;
    }
  }
  return maisRecente;
}

function horarioColeta(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso));
}

/** Isola o re-render por frame da animação nos cards — o rAF não pode repintar a tabela inteira. */
function ValorAnimado({ n }: { n: number }) {
  return <>{fmtInt(useCountUp(n))}</>;
}

export default function Pulse() {
  const { data: modulos, isLoading: modulosLoading } = useModulosHabilitados();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const tab = tabParam === 'sonar' || tabParam === 'alertas' ? tabParam : 'radar';
  const qc = useQueryClient();

  // `?tab=xyz` cai no Radar, mas o parâmetro mentiroso ficava na URL: o Radix não dispara
  // `onValueChange` para a aba já selecionada, então só sumia quando o operador clicava em outra.
  useEffect(() => {
    if (tabParam !== null && tabParam !== tab) setSearchParams({}, { replace: true });
  }, [tabParam, tab, setSearchParams]);

  const [adicionarAberto, setAdicionarAberto] = useState(false);
  const [detalheId, setDetalheId] = useState<string | null>(null);
  const [reprecificar, setReprecificar] = useState<AlvoReprecificar | null>(null);
  const [filtros, setFiltros] = useState<FiltrosPulse>(FILTROS_VAZIOS);

  const { data: produtos, isLoading, isError, error, refetch } = useQuery({
    queryKey: QK.pulseProdutos,
    queryFn: fetchPulseProdutos,
    enabled: !!modulos?.includes('pulse'),
    staleTime: 60_000,
  });

  // Badge da aba Alertas: só `acao` não lido, nunca o total (ADR-0133 D-6) — os alertas
  // históricos foram backfillados como `info`, então o número certo é 0 até haver decisão real.
  const { data: acaoPendente } = useQuery({
    queryKey: QK.pulseAlertasContagem('acao'),
    queryFn: () => contarPulseAlertas('acao'),
    enabled: !!modulos?.includes('pulse'),
    staleTime: 30_000,
  });

  // Uma única query de ofertas para a página inteira: KPIs e tabela leem o mesmo Map. A chave usa
  // os ids de TODOS os produtos (não os filtrados pela busca), senão cada tecla digitada criaria
  // uma entrada de cache nova e as colunas de mercado piscariam para "—".
  const ids = (produtos ?? []).map((p) => p.id);
  const { data: resumoOfertas, isLoading: resumoCarregando } = useQuery({
    queryKey: ['pulse', 'ofertas-resumo', ids],
    queryFn: () => fetchPulseResumoOfertas(ids),
    enabled: ids.length > 0,
  });

  // Consulta separada e de baixa prioridade: a série é enfeite decisório, não bloqueia a lista.
  // Desligada até o resumo chegar — a âncora do último ponto vem dele. A chave não depende do
  // resumo: um refetch dele só re-ancora o histórico depois do `staleTime`.
  const { data: historicoOfertas } = useQuery({
    queryKey: ['pulse', 'historico-ofertas', ids],
    queryFn: () => fetchPulseHistoricoOfertas(
      ids, new Map([...resumoOfertas!].map(([id, r]) => [id, r.menorObservado])),
    ),
    enabled: ids.length > 0 && !!resumoOfertas,
    staleTime: 5 * 60_000,
  });

  // Uma consulta para a página inteira (ADR-0119 Errata 12 D-3): 229 catálogos seriam 229 idas ao
  // PostgREST só para desenhar uma coluna.
  const codigosPai = [...new Set((produtos ?? []).map((p) => p.codigo_pai).filter((c): c is string => !!c))];
  const { data: contextosMargem, isError: contextoErro } = useQuery({
    queryKey: ['pulse', 'contexto-margem-lote', codigosPai],
    queryFn: () => fetchContextoMargemEmLote(codigosPai),
    enabled: codigosPai.length > 0,
    staleTime: 60_000,
  });

  const menorRelevanteDe = useCallback(
    (p: PulseProduto) => resumoOfertas?.get(p.id)?.menorRelevante ?? null,
    [resumoOfertas],
  );

  // Os números que respondem "tenho trabalho hoje?". Saem da mesma regra que filtra a lista, para
  // clicar num card de 12 devolver 12 linhas.
  const contagens = useMemo(
    () => contarPulse(produtos ?? [], menorRelevanteDe),
    [produtos, menorRelevanteDe],
  );
  /** Clicar no card já aplicado remove o recorte — o card é um interruptor, não um destino. */
  const alternarFoco = (foco: FocoPulse) =>
    setFiltros((f) => ({ ...f, foco: f.foco === foco ? null : foco }));

  const atualizar = useMutation({
    mutationFn: coletarPulseAgora,
    onSuccess: (r) => {
      toast.success(`✓ Radar atualizado — ${r.produtos} produto(s), ${r.alertas} alerta(s) novo(s)`);
      // Prefixo: também alcança o resumo de ofertas (menor preço/nº de ofertas) e qualquer
      // detalhe/contexto de margem abertos — todos derivam do que o coletor acabou de gravar.
      qc.invalidateQueries({ queryKey: ['pulse'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (modulosLoading) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Carregando…</div>;
  }
  if (!modulos?.includes('pulse')) return <Navigate to="/" replace />;

  const lista = produtos ?? [];
  const ofertasObservadas = [...(resumoOfertas?.values() ?? [])]
    .reduce((total, resumo) => total + resumo.nOfertas, 0);
  const ofertasRelevantes = [...(resumoOfertas?.values() ?? [])]
    .reduce((total, resumo) => total + resumo.nOfertasRelevantes, 0);
  const ultimaColeta = coletaMaisRecente(lista);
  const produtoDetalhe = lista.find((p) => p.id === detalheId) ?? null;
  const filtrada = filtrarProdutos(lista, filtros, menorRelevanteDe);
  const filtrando = temFiltroAtivo(filtros);

  return (
    <div className="p-4 md:p-6">
      <BorderTrail active={atualizar.isPending} radius={12} className="mb-6">
        <div className="relative z-[2] rounded-xl border border-primary/15 bg-gradient-to-br from-primary/[0.055] via-background to-background px-4 pt-4 shadow-sm md:px-5 md:pt-5">
          <PageHeader
            className="mb-3"
            title="Pulse"
            subtitle="Inteligência de mercado para detectar movimentos, priorizar decisões e proteger sua margem."
            actions={tab === 'radar' ? (
              <>
                <Button variant="outline" onClick={() => atualizar.mutate()} disabled={atualizar.isPending}>
                  <RefreshCw className={cn('mr-2 h-4 w-4', atualizar.isPending && 'animate-spin')} />
                  {atualizar.isPending ? 'Analisando mercado…' : 'Atualizar agora'}
                </Button>
                <Button onClick={() => setAdicionarAberto(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Adicionar produto
                </Button>
              </>
            ) : undefined}
          />
          {tab === 'radar' && lista.length > 0 && (
            <div role="group" className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-primary/10 py-3 text-xs text-muted-foreground" aria-label="Telemetria do Pulse">
              <span
                className="inline-flex items-center gap-1.5 font-medium text-foreground"
                title="Coleta completa todo dia às 06:00 e coleta rápida a cada 6h. A tela lê o que já foi coletado — use Atualizar agora para forçar uma leitura nova."
              >
                <PulsoAoVivo isFetching={atualizar.isPending} tom="primary" />
                {atualizar.isPending ? 'Motor analisando' : 'Monitorando mercado'}
              </span>
              <span><strong className="font-semibold text-foreground">{fmtInt(lista.length)}</strong> itens no radar</span>
              {resumoOfertas && (
                <>
                  <span><strong className="font-semibold text-foreground">{fmtInt(ofertasObservadas)}</strong> ofertas observadas</span>
                  <span><strong className="font-semibold text-foreground">{fmtInt(ofertasRelevantes)}</strong> relevantes</span>
                </>
              )}
              {ultimaColeta && <span className="ml-auto">Última leitura {horarioColeta(ultimaColeta)}</span>}
            </div>
          )}
        </div>
      </BorderTrail>

      <Tabs
        value={tab}
        onValueChange={(v) => setSearchParams(v === 'radar' ? {} : { tab: v }, { replace: true })}
      >
        <TabsList className="mb-4" aria-label="Seções do Pulse">
          <TabsTrigger value="radar">Radar</TabsTrigger>
          <TabsTrigger value="sonar">Sonar</TabsTrigger>
          <TabsTrigger value="alertas">
            Alertas
            {!!acaoPendente && (
              <span className="ml-1.5 rounded-full bg-warning px-1.5 text-xs font-medium text-warning-foreground">
                {acaoPendente}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="radar">
      {lista.length > 0 && (
        // Cada card é o atalho para as linhas que ele conta. "No radar" não filtra nada — ele
        // limpa: é o caminho de volta para a lista inteira depois de qualquer recorte.
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KpiCard
            size="compact"
            label="No radar"
            value={<ValorAnimado n={contagens.total} />}
            icon={Activity}
            tom="info"
            onClick={() => setFiltros(FILTROS_VAZIOS)}
            ativo={!filtrando}
          />
          <KpiCard
            size="compact"
            label="Mais caro que o mercado"
            value={<ValorAnimado n={contagens.maisCaro} />}
            icon={TrendingUp}
            tom={contagens.maisCaro > 0 ? 'warning' : 'success'}
            hint={contagens.comparaveis > 0 ? `de ${contagens.comparaveis} comparáveis` : 'sem comparação ainda'}
            onClick={() => alternarFoco('mais_caro')}
            ativo={filtros.foco === 'mais_caro'}
          />
          <KpiCard
            size="compact"
            label="Você é o menor preço"
            value={<ValorAnimado n={contagens.menorPreco} />}
            icon={TrendingUp}
            // Zero em "menor preço" não é bom nem ruim — verde com 0 lê como parabéns por nada.
            // Mesma alternância que "Mais caro que o mercado" já usa logo acima.
            tom={contagens.menorPreco > 0 ? 'success' : 'info'}
            onClick={() => alternarFoco('menor_preco')}
            ativo={filtros.foco === 'menor_preco'}
          />
          <KpiCard
            size="compact"
            label="Sem vínculo de catálogo"
            value={<ValorAnimado n={contagens.semVinculo} />}
            icon={Unlink}
            tom={contagens.semVinculo > 0 ? 'warning' : 'info'}
            hint={contagens.semVinculo > 0 ? 'não disputam a página' : undefined}
            onClick={() => alternarFoco('sem_vinculo')}
            ativo={filtros.foco === 'sem_vinculo'}
          />
        </div>
      )}

      {lista.length > 3 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={filtros.busca}
              onChange={(e) => setFiltros((f) => ({ ...f, busca: e.target.value }))}
              placeholder="Buscar por nome ou EAN"
              aria-label="Buscar produto no radar"
              className="h-9 pl-8"
            />
          </div>

          {/* Situação do anúncio no Mercado Livre — é o que o operador quer saber ("quais dos meus
              anúncios estão parados?"). O pausar/reativar do menu da linha é outra coisa: ele só
              tira o produto do acompanhamento, e a linha continua visível, esmaecida. */}
          <Select
            value={filtros.status}
            onValueChange={(v) => setFiltros((f) => ({ ...f, status: v as StatusAnuncio }))}
          >
            <SelectTrigger className="h-9 w-[205px]" aria-label="Filtrar por situação do anúncio">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os produtos</SelectItem>
              <SelectItem value="ativo">Só anúncios ativos</SelectItem>
              <SelectItem value="pausado">Só anúncios pausados</SelectItem>
            </SelectContent>
          </Select>

          {filtrando && (
            <Button variant="ghost" size="sm" className="h-9" onClick={() => setFiltros(FILTROS_VAZIOS)}>
              <X className="mr-1.5 h-3.5 w-3.5" />
              Limpar filtros
            </Button>
          )}
          {filtrando && (
            <span className="text-sm text-muted-foreground" role="status">
              {filtrada.length} de {lista.length}
            </span>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="flex flex-col gap-1.5">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
        </div>
      ) : isError ? (
        // Falha de leitura não pode se disfarçar de "radar vazio" — o operador leria "sem
        // concorrência nova" quando na verdade a consulta caiu.
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-4">
          <p className="text-sm font-medium text-destructive">Não foi possível carregar o radar.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {error instanceof Error ? error.message : 'Erro desconhecido ao consultar os produtos.'}
          </p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>
            Tentar de novo
          </Button>
        </div>
      ) : lista.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="Nenhum produto no radar ainda."
          description="O radar acompanha automaticamente os concorrentes dos seus anúncios de catálogo. Publique anúncios ou adicione um produto manualmente."
          action={<Button onClick={() => setAdicionarAberto(true)}>Adicionar produto</Button>}
        />
      ) : filtrada.length === 0 ? (
        <EmptyState
          icon={Search}
          title={filtros.busca.trim() ? `Nenhum produto para “${filtros.busca}”.` : 'Nenhum produto neste filtro.'}
          description="Ajuste o filtro, ou busque pelo nome do produto ou pelo EAN exibido sob ele."
          action={
            <Button variant="outline" onClick={() => setFiltros(FILTROS_VAZIOS)}>Limpar filtros</Button>
          }
        />
      ) : (
        <TabelaRadar
          produtos={filtrada}
          resumo={resumoOfertas}
          resumoCarregando={resumoCarregando}
          // Falha de leitura não pode virar esqueleto eterno: como na query irmã de ofertas, o
          // carregamento termina e a célula cai no travessão.
          contextos={codigosPai.length === 0 || contextoErro ? new Map() : contextosMargem}
          historico={historicoOfertas}
          onAbrirDetalhe={setDetalheId}
          onReprecificar={(p) => setReprecificar({
            codigoPai: p.codigo_pai!, precoInicial: p.meu_preco, produtoId: p.id,
          })}
        />
      )}
        </TabsContent>

        <TabsContent value="sonar">
          <PulseSonar />
        </TabsContent>

        <TabsContent value="alertas">
          <AbaAlertas
            onVerProduto={setDetalheId}
            onReprecificar={(a) => setReprecificar({
              codigoPai: a.pulse_produtos?.codigo_pai ?? null,
              precoInicial: Number(a.payload.para),
              produtoId: a.produto_id,
            })}
            onVerRadar={() => {
              setSearchParams({}, { replace: true });
              setFiltros((f) => ({ ...f, foco: 'mais_caro' }));
            }}
          />
        </TabsContent>
      </Tabs>

      <DialogAdicionar aberto={adicionarAberto} onFechar={() => setAdicionarAberto(false)} />
      <DialogDetalhe produto={produtoDetalhe} onFechar={() => setDetalheId(null)} />
      <DialogReprecificar
        codigoPai={reprecificar?.codigoPai ?? null}
        precoInicial={reprecificar?.precoInicial ?? null}
        custos={(() => {
          const p = lista.find((x) => x.id === reprecificar?.produtoId);
          return p
            ? {
                comissaoPct: p.comissao_pct, comissaoFixa: p.comissao_fixa,
                comissaoPreco: p.comissao_preco, frete: p.ptw_custos?.frete ?? null,
              }
            : null;
        })()}
        onFechar={() => setReprecificar(null)}
      />
    </div>
  );
}
