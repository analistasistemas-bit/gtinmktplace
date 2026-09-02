// Pulse (ADR-0133): a aba de alertas. Abre em "Ação" — os alertas que mudam decisão de preço.
// Informativo fica a um clique, e nunca disputa a mesma lista.
import { useMemo, useState } from 'react';
import {
  useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData,
} from '@tanstack/react-query';
import { toast } from 'sonner';
import { Bell, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { tabsListVariants, tabsTriggerClassName } from '@/components/ui/tabs';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { QK } from '@/lib/queries';
import { cn } from '@/lib/utils';
import {
  ALERTAS_POR_PAGINA, contarPulseAlertas, fetchPulseAlertas, marcarAlertasLidos,
  marcarAlertasLidosPorIds, type FiltroSeveridade, type PulseAlerta,
} from '@/lib/pulse';
import { agruparAlertasPorProduto } from '@/lib/pulse-alertas-grupo';
import { idadeAlerta, textoAlerta } from '@/lib/pulse-alerta-texto';

const FILTROS: { valor: FiltroSeveridade; rotulo: string }[] = [
  { valor: 'acao', rotulo: 'Ação' },
  { valor: 'info', rotulo: 'Informativo' },
  { valor: 'todos', rotulo: 'Todos' },
];

type PaginasAlertas = InfiniteData<PulseAlerta[], number>;

export function AbaAlertas({
  onVerProduto, onReprecificar, onVerRadar,
}: {
  onVerProduto: (produtoId: string) => void;
  onReprecificar: (alerta: PulseAlerta) => void;
  onVerRadar: () => void;
}) {
  const qc = useQueryClient();
  const [severidade, setSeveridade] = useState<FiltroSeveridade>('acao');

  // `data` fica `undefined` tanto pendente quanto em erro — os dois casos em que não existe número
  // verdadeiro. Nada de `?? 0`: "Marcar 0 como lidos" com a lista cheia atrás é uma promessa que a
  // tela não pode cumprir, e é exatamente o defeito que o D-7 mandou matar.
  //
  // Sem `placeholderData: keepPreviousData` de propósito: a chave muda por severidade, então o
  // valor anterior seria a contagem do OUTRO filtro — a mesma mentira com outra roupa.
  const { data: contagem } = useQuery({
    queryKey: QK.pulseAlertasContagem(severidade),
    queryFn: () => contarPulseAlertas(severidade),
    staleTime: 30_000,
  });
  // Necessária mesmo fora do filtro Informativo: é o número que o estado vazio de Ação oferece
  // como próximo passo ("Ver informativos (N)").
  const { data: contagemInfo } = useQuery({
    queryKey: QK.pulseAlertasContagem('info'),
    queryFn: () => contarPulseAlertas('info'),
    staleTime: 30_000,
  });

  const chaveLista = QK.pulseAlertas(severidade);

  const {
    data, isLoading, isError, isFetchNextPageError, refetch,
    fetchNextPage, hasNextPage, isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: chaveLista,
    queryFn: ({ pageParam }) => fetchPulseAlertas({ severidade, pagina: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (ultima, todas) => (ultima.length < ALERTAS_POR_PAGINA ? undefined : todas.length),
  });

  const invalidar = () => qc.invalidateQueries({ queryKey: ['pulse', 'alertas'] });

  const marcarLido = useMutation({
    // Lambda, não a referência nua: o react-query v5 passa um segundo argumento (contexto da
    // mutation) para a `mutationFn`, e o que vai ao banco tem que ser só a lista de ids.
    mutationFn: (ids: string[]) => marcarAlertasLidosPorIds(ids),
    // Update otimista: a linha sai na hora. Sem ele, o clique no ✓ só tinha efeito visível depois
    // do refetch de todas as páginas carregadas mais as duas contagens — até cinco idas ao banco
    // sem nenhuma resposta na tela. A linha inteira sai, e ela representa N alertas.
    onMutate: async (ids: string[]) => {
      await qc.cancelQueries({ queryKey: chaveLista });
      const anterior = qc.getQueryData<PaginasAlertas>(chaveLista);
      const fora = new Set(ids);
      qc.setQueryData<PaginasAlertas>(chaveLista, (atual) => (
        atual && { ...atual, pages: atual.pages.map((p) => p.filter((a) => !fora.has(a.id))) }
      ));
      // ponytail: a contagem fica para a invalidação do `onSettled`. Ajustá-la aqui exigiria mexer
      // em três chaves de cache (o filtro ativo, 'todos' e a severidade da própria linha) para
      // ganhar um round-trip; o número volta certo sozinho.
      // ponytail: remover uma linha pode deixar a última página com < ALERTAS_POR_PAGINA e sumir o
      // "Carregar mais" até a invalidação restaurar — auto-corrige no mesmo `onSettled`.
      return { anterior };
    },
    onError: (e: Error, _ids, ctx) => {
      if (ctx?.anterior) qc.setQueryData(chaveLista, ctx.anterior);
      toast.error(e.message);
    },
    onSettled: invalidar,
  });

  // Dedupe por id: uma inserção do coletor entre o refetch de duas páginas desloca a janela do
  // OFFSET e devolve a mesma linha nas duas. Com `key={alerta.id}` isso é chave duplicada no React
  // e renderização indefinida.
  const lista = useMemo(() => {
    const vistos = new Set<string>();
    return (data?.pages ?? []).flat().filter((a) => {
      if (vistos.has(a.id)) return false;
      vistos.add(a.id);
      return true;
    });
  }, [data]);

  // A linha é o PRODUTO, não o evento (ADR-0133 Errata 4 D-1). Agrupamento de exibição, sobre as
  // páginas já carregadas: `N movimentos` conta os alertas CARREGADOS e cresce a cada "Carregar mais".
  const grupos = useMemo(() => agruparAlertasPorProduto(lista), [lista]);
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());
  const alternarGrupo = (chave: string) => setExpandidos((s) => {
    const novo = new Set(s);
    if (!novo.delete(chave)) novo.add(chave);
    return novo;
  });

  // Teto do "marcar todos": o alerta mais novo já carregado. A lista vem em ordem decrescente, então
  // é o primeiro item. O invariante que ele garante é "nada MAIS NOVO do que o operador viu" — a
  // proteção é contra a corrida com o coletor (que roda em cron entre a contagem e o clique), NÃO
  // contra a paginação: o que for mais antigo é marcado mesmo sem ter sido rolado, e é isso que o
  // número do rótulo promete (ADR-0133, Errata 2).
  const maisNovoVisto = lista[0]?.criado_em ?? null;

  const marcarTodosLidos = useMutation({
    mutationFn: (ateCriadoEm: string) => marcarAlertasLidos(severidade, ateCriadoEm),
    // Mesmo argumento do ✓ de linha única, e mais forte em lote: com 145 não lidos, sem isto as 50
    // linhas ficam paradas na tela durante o update MAIS o refetch da lista e das duas contagens.
    // Esvaziar tudo é correto sob a âncora — a lista vem em ordem decrescente, então `maisNovoVisto`
    // é o máximo do que está renderizado e cada linha em cache é, por construção, `<= ateCriadoEm`.
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: chaveLista });
      const anterior = qc.getQueryData<PaginasAlertas>(chaveLista);
      qc.setQueryData<PaginasAlertas>(chaveLista, (atual) => (
        atual && { ...atual, pages: atual.pages.map(() => []) }
      ));
      return { anterior };
    },
    onError: (e: Error, _ate, ctx) => {
      if (ctx?.anterior) qc.setQueryData(chaveLista, ctx.anterior);
      toast.error(e.message);
    },
    onSettled: invalidar,
  });

  // Consulta quebrada não pode parecer "nenhum alerta" — é a primeira pergunta que a tela responde.
  const faixaErro = (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm text-destructive"
    >
      <span>Não foi possível carregar os alertas.</span>
      <Button
        variant="outline"
        size="sm"
        onClick={() => (isFetchNextPageError ? fetchNextPage() : refetch())}
      >
        Tentar de novo
      </Button>
    </div>
  );

  // Faixa em tela cheia SÓ quando não há nada para mostrar. Com lista já carregada, o erro vai
  // inline: um "Carregar mais" que falha não pode apagar os alertas e o seletor de severidade que
  // já estavam na tela (o `status` do react-query v5 vai a 'error' mesmo com `data` presente).
  if (isError && lista.length === 0) return faixaErro;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {/* Botões `aria-pressed` em vez de Tabs: sem TabsContent para `acao`/`info`/`todos`, o
            `aria-controls` que o Radix sempre emite apontava para ids inexistentes, e o leitor de
            tela anunciava duas "listas de guias" na mesma página. */}
        <div
          role="group"
          aria-label="Filtrar alertas por severidade"
          className="group/tabs flex gap-2"
        >
          <div data-variant="default" className={tabsListVariants()}>
            {FILTROS.map(({ valor, rotulo }) => {
              const ativo = severidade === valor;
              return (
                <button
                  key={valor}
                  type="button"
                  aria-pressed={ativo}
                  // `data-state` é o que o Radix marcava e o que o realce de ativo usa — replicá-lo
                  // dá a estes botões a aparência idêntica à das abas de verdade. Medido no CSS
                  // computado contra o dev server: "Ação" ativo e a aba "Alertas" ativa resolvem
                  // para o mesmo `oklab(1 0 0 / 0.042)`, e os inativos para transparente.
                  data-state={ativo ? 'active' : 'inactive'}
                  className={tabsTriggerClassName}
                  onClick={() => setSeveridade(valor)}
                >
                  {rotulo}
                </button>
              );
            })}
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => maisNovoVisto && marcarTodosLidos.mutate(maisNovoVisto)}
          disabled={contagem == null || !maisNovoVisto || marcarTodosLidos.isPending}
        >
          {contagem == null ? 'Marcar como lidos' : `Marcar ${contagem} como lidos`}
        </Button>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-1.5">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
        </div>
      ) : lista.length === 0 ? (
        severidade === 'acao' ? (
          <EmptyState
            icon={Bell}
            title="Nenhum alerta exige decisão agora"
            description="Movimentos de mercado sem decisão ficam em Informativo."
            action={
              <div className="flex flex-col items-center gap-2 sm:flex-row">
                <Button variant="outline" onClick={() => setSeveridade('info')}>
                  {contagemInfo == null ? 'Ver informativos' : `Ver informativos (${contagemInfo})`}
                </Button>
                <Button variant="ghost" onClick={onVerRadar}>
                  Ver mais caros no Radar
                </Button>
              </div>
            }
          />
        ) : (
          <EmptyState icon={Bell} title="Nenhum alerta pendente." />
        )
      ) : (
        <div className="flex flex-col gap-0 rounded-lg border">
          {grupos.map((g) => {
            const texto = textoAlerta(g.maisRecente);
            const idade = idadeAlerta(g.maisRecente.criado_em);
            const aberto = expandidos.has(g.chave);
            // Reprecificar segue o GRUPO: a queda mais recente do grupo, mesmo que um
            // `novo_concorrente` posterior seja quem a linha exibe. Sem isso, queda encoberta
            // perdia o botão (ADR-0133 Errata 4 D-1).
            const queda = [g.maisRecente, ...g.demais]
              .find((a) => a.tipo === 'preco_caiu' && a.pulse_produtos?.codigo_pai);
            return (
              <div key={g.chave} className="border-b px-4 py-2 text-sm last:border-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  {/* "Todos" é o único filtro que mistura as duas severidades — e o único lugar onde
                      ela ficaria invisível. Selo em texto, não só cor. */}
                  {severidade === 'todos' && (
                    <span
                      className={cn(
                        'shrink-0 rounded px-1.5 py-0.5 text-xs font-medium',
                        g.maisRecente.severidade === 'acao'
                          ? 'bg-warning text-warning-foreground'
                          : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {g.maisRecente.severidade === 'acao' ? 'Ação' : 'Info'}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate" title={texto}>{texto}</span>
                  {idade && <span className="shrink-0 text-xs text-muted-foreground">{idade}</span>}
                  {/* O total é de ALERTAS. O botão do topo continua contando alertas também —
                      é ele que descreve o que o clique faz no banco (D-7 e Errata 2). */}
                  {g.total > 1 && (
                    <button
                      type="button"
                      aria-expanded={aberto}
                      className="shrink-0 rounded px-1.5 py-0.5 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => alternarGrupo(g.chave)}
                    >
                      · {g.total} movimentos
                    </button>
                  )}
                  <div className="flex shrink-0 items-center gap-1.5">
                    {/* O texto do alerta entra no nome acessível dos três botões: 50 linhas por página
                        produziam 50 "Ver produto" indistinguíveis na navegação por lista de botões. */}
                    {g.produtoId && (
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label={`Ver produto: ${texto}`}
                        onClick={() => onVerProduto(g.produtoId!)}
                      >
                        Ver produto
                      </Button>
                    )}
                    {queda && (
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label={`Reprecificar: ${texto}`}
                        onClick={() => onReprecificar(queda)}
                      >
                        Reprecificar
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-11 w-11 sm:h-7 sm:w-7"
                      aria-label={`Marcar como lido: ${texto}`}
                      onClick={() => marcarLido.mutate(g.ids)}
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                {aberto && (
                  <ul className="mt-1 ml-1 border-l pl-3 text-xs text-muted-foreground">
                    {g.demais.map((a) => (
                      <li key={a.id} className="py-0.5">
                        {textoAlerta(a)} <span className="opacity-70">· {idadeAlerta(a.criado_em)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
          {hasNextPage && (
            <div className="flex justify-center border-t p-2">
              <Button variant="ghost" size="sm" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
                Carregar mais
              </Button>
            </div>
          )}
        </div>
      )}

      {isError && <div className="mt-3">{faixaErro}</div>}
    </div>
  );
}
