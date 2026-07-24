import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Collapsible } from 'radix-ui';
import { FileText, RotateCw } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/ui/page-header';
import { Pagination } from '@/components/ui/pagination';
import { usePaginacao } from '@/hooks/usePaginacao';
import { useSessionState } from '@/hooks/useSessionState';
import { FamiliaRow } from '@/components/familia-row';
import { FamiliaExpanded } from '@/components/familia-expanded';
import { JornadaLote } from '@/components/jornada-lote';
import { DropZoneImagensExistente } from '@/components/drop-zone-imagens-existente';
import { useFamilias } from '@/hooks/useFamilias';
import { useLote } from '@/hooks/useLotes';
import { useLoteRealtime } from '@/hooks/useLoteRealtime';
import { uploadImagensLote } from '@/lib/upload-imagens';
import { QK, fetchConexoes } from '@/lib/queries';
import { familiaPublicavel, familiaIncompleta, idsPublicaveis, loteTemPublicacao, familiaPrecosDivergentes } from '@/lib/publicavel';
import { ordenarPorExcecao } from '@/lib/revisao-ordem';
import { coresNovasSemFoto } from '@/lib/cores-novas';
import { coresNovasComEstoque } from '@/lib/revisao-variacoes';
import { publicarFamilias, type ListingType } from '@/lib/publicar';
import { canaisOperaveis, canaisEmBreve } from '@/lib/canais';
import { LogoCanal } from '@/components/canal-badge';
import { useCanaisHabilitados } from '@/hooks/useCanaisHabilitados';
import { avisosCapabilities } from '@/lib/capabilities-canal';
import { useToggleDescontoLote, useReprocessar, useSetAtacadoLote } from '@/hooks/useFamiliaMutations';
import { AtacadoEditor } from '@/components/atacado-editor';
import { validarFaixas, type FaixaAtacado } from '@/lib/atacado';
import { cn } from '@/lib/utils';
import { temAlteracaoPreco } from '@/lib/preco-alterado';
import { exigeDivisaoUpdate } from '@/lib/grupos-preco';
import type { Familia } from '@/lib/tipos-dominio';

type FiltroOp = 'todos' | 'CREATE' | 'UPDATE' | 'avisos' | 'incompletas' | 'preco_alterado';

export function filtrarFamilias(
  familias: Familia[],
  filtro: FiltroOp,
  busca: string,
  soComCoresNovas = false,
): Familia[] {
  const buscaLower = busca.trim().toLowerCase();
  return familias.filter((f) => {
    if (filtro === 'CREATE' && f.operacao !== 'CREATE') return false;
    if (filtro === 'UPDATE' && f.operacao !== 'UPDATE') return false;
    if (filtro === 'avisos' && !f.precoAbaixo20pc) return false;
    if (filtro === 'incompletas' && !familiaIncompleta(f)) return false;
    if (filtro === 'preco_alterado' && !(f.operacao === 'UPDATE' && temAlteracaoPreco(f))) return false;
    if (soComCoresNovas && coresNovasComEstoque(f).length === 0) return false;
    if (!buscaLower) return true;
    return (
      f.titulo.toLowerCase().includes(buscaLower) ||
      f.codigoPai.includes(buscaLower) ||
      f.variacoes.some(
        (v) =>
          v.codigo.toLowerCase().includes(buscaLower) ||
          (v.gtin ?? '').toLowerCase().includes(buscaLower),
      )
    );
  });
}

export default function Revisao() {
  const { loteId } = useParams();
  const nav = useNavigate();
  useLoteRealtime(loteId);
  const { data: familias = [], isLoading, error } = useFamilias(loteId);
  const { data: lote } = useLote(loteId);
  const [filtro, setFiltro] = useState<FiltroOp>('todos');
  const [busca, setBusca] = useState('');
  // Ligado por padrão: o operador foca nas cores com estoque; as zeradas (catálogo
  // que dorme até reposição) ficam escondidas até ele clicar para mostrá-las.
  const [ocultarSemEstoque, setOcultarSemEstoque] = useState(true);
  // Filtra a lista para só famílias com ≥1 cor nova (UPDATE: cor sem ml_variation_id
  // e com estoque — a que precisa de foto). Desligado por padrão.
  const [soComCoresNovas, setSoComCoresNovas] = useState(false);
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  // Expansão persistida por lista (sobrevive a sair/voltar da tela e ao refetch das famílias),
  // como o sort. Array em vez de Set porque sessionStorage é JSON (Set não serializa).
  const [expandidas, setExpandidas] = useSessionState<string[]>('expand:revisao', []);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [progresso, setProgresso] = useState<{ feito: number; total: number } | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [publicando, setPublicando] = useState(false);
  const [listingType, setListingType] = useState<ListingType>('gold_special');
  // Escolha global "Atualizar tudo × Somente estoque" para UPDATEs (ADR-0078 F1). Default
  // `false` = atualizar tudo, espelha o default do backend (`?? false`, 100% comportamento atual).
  const [somenteEstoqueGlobal, setSomenteEstoqueGlobal] = useState(false);
  // familiaIds que invertem a escolha global (override por produto).
  const [somenteEstoqueOverrides, setSomenteEstoqueOverrides] = useState<Set<string>>(new Set());
  // Seleção de canais (D6): grupo SEMPRE visível — operáveis marcáveis (se conectados),
  // em-breve desabilitados como vitrine. ML pré-marcado.
  const { data: conexoes = [] } = useQuery({ queryKey: QK.conexoes, queryFn: fetchConexoes });
  const { data: habilitados = ['mercado_livre'] } = useCanaisHabilitados();
  const [canaisSelecionados, setCanaisSelecionados] = useState<Set<string>>(new Set(['mercado_livre']));
  const operaveis = canaisOperaveis(habilitados);
  const emBreve = canaisEmBreve(habilitados);
  const canaisConectados = useMemo(() => new Set(conexoes.map((c) => c.canal)), [conexoes]);
  // Canais que realmente vão no payload: selecionados com conexão; vazio → ML (caminho atual).
  const { canaisEfetivos, semCanalMarcado } = useMemo(() => {
    const marcados = [...canaisSelecionados].filter((c) => canaisConectados.has(c));
    return { canaisEfetivos: marcados.length > 0 ? marcados : ['mercado_livre'], semCanalMarcado: marcados.length === 0 };
  }, [canaisSelecionados, canaisConectados]);
  // Variação-alvo ao clicar no selo de pendência do pai: expande + rola até ela.
  const [focoCritica, setFocoCritica] = useState<{ familiaId: string; codigo: string } | null>(null);
  const qc = useQueryClient();
  const toggleLote = useToggleDescontoLote(loteId ?? '');
  const setAtacadoLote = useSetAtacadoLote(loteId ?? '');
  const [atacadoAberto, setAtacadoAberto] = useState(false);
  const [faixasLote, setFaixasLote] = useState<FaixaAtacado[]>([{ min_unidades: 5, desconto_pct: 5 }]);
  const erroFaixasLote = validarFaixas(faixasLote);
  const reprocessarLote = useReprocessar(loteId ?? '');
  const todasComDesconto = familias.length > 0 && familias.every((f) => f.exibirComDesconto);
  // Ações em lote aplicam desconto/atacado às famílias do lote sem olhar preço por
  // cor (UPDATE ... WHERE lote_id, cego). Se alguma família tem cores com preços
  // diferentes, ela herdaria o mesmo bug do controle individual (ver familiaPrecosDivergentes)
  // — bloqueia a ativação em lote nesse caso.
  const familiasDivergentes = useMemo(() => familias.filter(familiaPrecosDivergentes), [familias]);
  const qtdErros = useMemo(() => familias.filter((f) => f.status === 'erro').length, [familias]);

  // O lote volta para 'revisao' quando ainda restam famílias publicáveis, escondendo
  // o relatório da última publicação (acessível via card do Dashboard só em 'concluido').
  // Este atalho reabre o relatório do lote enquanto houver ≥1 família já publicada.
  const temPublicacao = useMemo(() => loteTemPublicacao(familias), [familias]);

  const visiveis = useMemo(
    () => ordenarPorExcecao(filtrarFamilias(familias, filtro, busca, soComCoresNovas)),
    [familias, filtro, busca, soComCoresNovas],
  );
  const pag = usePaginacao(visiveis);
  const listaRef = useRef<HTMLDivElement>(null);

  const irPara = (p: number) => {
    pag.irPara(p);
    listaRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Mudar filtro/busca volta para a página 1. (idsSelecionaveis e counts
  // continuam derivando de `visiveis`/`familias`, a lista filtrada inteira.)
  useEffect(() => {
    pag.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtro, busca, soComCoresNovas]);
  // "Selecionar todos" age só sobre as famílias publicáveis visíveis (respeita
  // filtro/busca) — espelha a regra do toggleSelecao, que ignora as incompletas.
  const idsSelecionaveis = useMemo(() => idsPublicaveis(visiveis), [visiveis]);
  const todasSelecionadas =
    idsSelecionaveis.length > 0 && idsSelecionaveis.every((id) => selecionadas.has(id));
  const algumaSelecionada = idsSelecionaveis.some((id) => selecionadas.has(id));
  const familiasComCoresNovas = useMemo(
    () => familias.filter((f) => coresNovasComEstoque(f).length > 0).length,
    [familias],
  );
  const coresNovas = useMemo(() => coresNovasSemFoto(familias), [familias]);
  const totalCoresNovas = useMemo(
    () => coresNovas.reduce((acc, f) => acc + f.codigos.length, 0),
    [coresNovas],
  );

  async function lidarArquivosDrop(arquivos: File[]) {
    if (!loteId) return;
    const TAMANHO_CHUNK = 5;
    const acumulado = {
      ok: 0,
      ja_tinha: 0,
      sem_match: 0,
      capas_ok: 0,
      capas_sem_match: 0,
      erros: [] as Array<{ arquivo: string; motivo: string }>,
    };
    setUploadStatus(null);
    setProgresso({ feito: 0, total: arquivos.length });
    try {
      for (let i = 0; i < arquivos.length; i += TAMANHO_CHUNK) {
        const chunk = arquivos.slice(i, i + TAMANHO_CHUNK);
        const r = await uploadImagensLote(loteId, chunk);
        acumulado.ok += r.ok;
        acumulado.ja_tinha += r.ja_tinha;
        acumulado.sem_match += r.sem_match;
        acumulado.capas_ok += r.capas_ok;
        acumulado.capas_sem_match += r.capas_sem_match;
        acumulado.erros.push(...r.erros);
        setProgresso({
          feito: Math.min(i + TAMANHO_CHUNK, arquivos.length),
          total: arquivos.length,
        });
      }
      const partes = [
        `${acumulado.ok} cor(es) nova(s)`,
        `${acumulado.ja_tinha} cor(es) substituída(s)`,
        `${acumulado.sem_match} cor(es) sem match`,
        `${acumulado.capas_ok} capa(s)`,
        `${acumulado.capas_sem_match} capa(s) sem match`,
      ];
      if (acumulado.erros.length) partes.push(`${acumulado.erros.length} erro(s)`);
      setUploadStatus(`✓ ${partes.join(' · ')}`);
      qc.invalidateQueries({ queryKey: QK.familias(loteId) });
      if (acumulado.erros.length) console.error('Erros no upload:', acumulado.erros);
      setTimeout(() => setUploadStatus(null), 4000);
    } catch (e) {
      setUploadStatus(`✗ ${(e as Error).message}`);
      setTimeout(() => setUploadStatus(null), 6000);
    } finally {
      setProgresso(null);
    }
  }

  function toggleSelecao(id: string, valor: boolean) {
    setSelecionadas((prev) => {
      const novo = new Set(prev);
      if (valor) {
        const familia = familias.find((f) => f.id === id);
        if (familia && !familiaPublicavel(familia).ok) return prev;
        novo.add(id);
      } else {
        novo.delete(id);
      }
      return novo;
    });
  }

  function toggleTodas(marcar: boolean) {
    setSelecionadas((prev) => {
      const novo = new Set(prev);
      for (const id of idsSelecionaveis) {
        if (marcar) novo.add(id);
        else novo.delete(id);
      }
      return novo;
    });
  }

  function toggleCanal(canal: string, marcar: boolean) {
    setCanaisSelecionados((prev) => {
      const novo = new Set(prev);
      if (marcar) novo.add(canal);
      else novo.delete(canal);
      return novo;
    });
  }

  function toggleSomenteEstoqueOverride(familiaId: string, marcar: boolean) {
    setSomenteEstoqueOverrides((prev) => {
      const novo = new Set(prev);
      if (marcar) novo.add(familiaId);
      else novo.delete(familiaId);
      return novo;
    });
  }

  function toggleExpansao(id: string) {
    setExpandidas((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function irParaCritica(familiaId: string, codigo: string) {
    setExpandidas((prev) => (prev.includes(familiaId) ? prev : [...prev, familiaId]));
    setFocoCritica({ familiaId, codigo });
  }

  const counts = {
    todos: familias.length,
    CREATE: familias.filter((f) => f.operacao === 'CREATE').length,
    UPDATE: familias.filter((f) => f.operacao === 'UPDATE').length,
    avisos: familias.filter((f) => f.precoAbaixo20pc).length,
    incompletas: familias.filter((f) => familiaIncompleta(f)).length,
    preco_alterado: familias.filter((f) => f.operacao === 'UPDATE' && temAlteracaoPreco(f)).length,
  };

  const coresSelecionadas = familias
    .filter((f) => selecionadas.has(f.id))
    .reduce((acc, f) => acc + f.variacoes.filter((v) => !v.excluidaDaPublicacao).length, 0);

  const selecaoTemCreate = familias.some(
    (f) => selecionadas.has(f.id) && f.operacao === 'CREATE',
  );

  const selecaoTemUpdate = familias.some(
    (f) => selecionadas.has(f.id) && f.operacao === 'UPDATE',
  );

  // Selecionadas com badge "preço alterado" (D4/ADR-0078): candidatas ao override por produto.
  const familiasComPrecoAlterado = familias.filter(
    (f) => selecionadas.has(f.id) && f.operacao === 'UPDATE' && temAlteracaoPreco(f),
  );

  async function confirmarPublicacao() {
    if (!loteId) return;
    setPublicando(true);
    const total = selecionadas.size;
    try {
      await publicarFamilias([...selecionadas], listingType, canaisEfetivos, {
        somenteEstoqueGlobal,
        somenteEstoqueOverrides: [...somenteEstoqueOverrides],
      });
      // A edge `publicar-familias` já fez o claim síncrono (status→'publicando') antes de
      // enfileirar. Invalidar aqui força o Relatório a buscar esse status real já no mount —
      // sem isso, a cache 'pronto' da Revisão (staleTime 30s) mostrava "não publicada (não
      // selecionada)" por ~15s até o worker/realtime tocar a linha, parecendo travado.
      qc.invalidateQueries({ queryKey: QK.familias(loteId) });
      qc.invalidateQueries({ queryKey: QK.lote(loteId) });
      setSelecionadas(new Set());
      setSomenteEstoqueOverrides(new Set());
      setConfirmando(false);
      toast.success(`${total} família(s) enfileirada(s) para publicação`, {
        description: 'Acompanhe o andamento no relatório.',
      });
      nav(`/relatorio/${loteId}`);
    } catch (e) {
      toast.error('Falha ao enfileirar a publicação', {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setPublicando(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b bg-background px-4 pt-4 pb-0">
        <PageHeader
          title="Revisão"
          subtitle={`${familias.length} famílias`}
          className="mb-3"
          actions={
            loteId && familias.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                {qtdErros > 0 && (
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={reprocessarLote.isPending}
                    onClick={() =>
                      reprocessarLote.mutate(
                        { loteId },
                        {
                          onSuccess: (r) =>
                            toast.success(`${r.reenviadas} família(s) reenviada(s) para processamento`),
                          onError: (e) =>
                            toast.error('Falha ao reenviar', {
                              description: e instanceof Error ? e.message : String(e),
                            }),
                        },
                      )
                    }
                  >
                    <RotateCw className={cn('mr-1.5 h-4 w-4', reprocessarLote.isPending && 'animate-spin')} />
                    Reenviar {qtdErros} com erro
                  </Button>
                )}
                {temPublicacao && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => nav(`/relatorio/${loteId}`)}
                  >
                    <FileText className="mr-1.5 h-4 w-4" />
                    Ver relatório da última publicação
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className={!todasComDesconto && familiasDivergentes.length > 0 ? 'opacity-50' : undefined}
                  title={
                    !todasComDesconto && familiasDivergentes.length > 0
                      ? `${familiasDivergentes.length} família(s) do lote têm cores com preços diferentes: clique para saber por quê`
                      : undefined
                  }
                  onClick={() => {
                    const familiasUserProducts = familias.filter((f) => f.formatoPublicacaoMl === 'user_products');
                    if (!todasComDesconto && familiasUserProducts.length > 0) {
                      toast.error('Não é possível ativar desconto no lote', {
                        description: `${familiasUserProducts.length} família(s) são User Products (ex.: ${familiasUserProducts[0].titulo}). O Mercado Livre não permite desconto apenas visual nesse formato.`,
                      });
                      return;
                    }
                    if (!todasComDesconto && familiasDivergentes.length > 0) {
                      toast.error('Não é possível ativar desconto no lote', {
                        description: `${familiasDivergentes.length} família(s) têm cores com preços diferentes (ex.: ${familiasDivergentes[0].titulo}). O desconto usa um único preço-base por família, o que ficaria incorreto nas cores mais caras dessas famílias. Configure desconto/atacado POR FAIXA dentro de cada família divergente (a ação em lote é cega ao preço por cor).`,
                      });
                      return;
                    }
                    toggleLote.mutate(!todasComDesconto);
                  }}
                >
                  {todasComDesconto ? 'Desativar desconto no lote' : 'Ativar desconto no lote'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className={familiasDivergentes.length > 0 ? 'opacity-50' : undefined}
                  title={
                    familiasDivergentes.length > 0
                      ? `${familiasDivergentes.length} família(s) do lote têm cores com preços diferentes: clique para saber por quê`
                      : undefined
                  }
                  onClick={() => {
                    if (familiasDivergentes.length > 0) {
                      toast.error('Não é possível ativar atacado no lote', {
                        description: `${familiasDivergentes.length} família(s) têm cores com preços diferentes (ex.: ${familiasDivergentes[0].titulo}). O atacado usa um único preço-base por família, o que ficaria incorreto nas cores mais caras dessas famílias. Configure desconto/atacado POR FAIXA dentro de cada família divergente (a ação em lote é cega ao preço por cor).`,
                      });
                      return;
                    }
                    setFaixasLote([{ min_unidades: 5, desconto_pct: 5 }]);
                    setAtacadoAberto(true);
                  }}
                >
                  Atacado no lote
                </Button>
              </div>
            ) : undefined
          }
        />
        {lote && (
          <div className="mb-3">
            <JornadaLote status={lote.status} />
          </div>
        )}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 pb-3">
          <Tabs value={filtro} onValueChange={(v) => setFiltro(v as FiltroOp)} className="w-full sm:w-auto">
            <TabsList>
              <TabsTrigger value="todos">
                Todos <Badge variant="secondary" className="ml-1.5">{counts.todos}</Badge>
              </TabsTrigger>
              <TabsTrigger value="CREATE">
                CREATE <Badge variant="secondary" className="ml-1.5">{counts.CREATE}</Badge>
              </TabsTrigger>
              <TabsTrigger value="UPDATE">
                UPDATE <Badge variant="secondary" className="ml-1.5">{counts.UPDATE}</Badge>
              </TabsTrigger>
              <TabsTrigger value="avisos">
                Avisos <Badge variant="secondary" className="ml-1.5">{counts.avisos}</Badge>
              </TabsTrigger>
              <TabsTrigger value="incompletas">
                Incompletas <Badge variant="secondary" className="ml-1.5">{counts.incompletas}</Badge>
              </TabsTrigger>
              {counts.UPDATE > 0 && (
                <TabsTrigger value="preco_alterado">
                  Preço alterado <Badge variant="secondary" className="ml-1.5">{counts.preco_alterado}</Badge>
                </TabsTrigger>
              )}
            </TabsList>
          </Tabs>
          <Button
            variant={ocultarSemEstoque ? 'default' : 'outline'}
            size="sm"
            aria-pressed={ocultarSemEstoque}
            onClick={() => setOcultarSemEstoque((s) => !s)}
            title="Esconde as variações com estoque 0 nas famílias abertas"
          >
            Ocultar sem estoque
          </Button>
          <Input
            placeholder="Buscar por código ou nome..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="max-w-xs"
          />
        </div>
      </div>
      {filtro === 'avisos' && (
        <div className="border-b border-destructive/30 bg-destructive/5 px-4 py-2 text-xs text-destructive">
          Famílias com preço sugerido <strong>abaixo de 20%</strong> do preço da sua planilha.
          Reveja antes de aprovar para não vender no prejuízo.
        </div>
      )}
      {totalCoresNovas > 0 && (
        <div className="border-b border-warning/40 bg-warning/10 px-4 py-2 text-xs text-warning">
          <strong>{totalCoresNovas} cor(es) nova(s)</strong> vieram na planilha e precisam de foto
          para publicar. Expanda{' '}
          {coresNovas.map((f, i) => (
            <span key={f.codigoPai}>
              {i > 0 && ', '}
              <span className="font-medium">{f.titulo || f.codigoPai}</span> ({f.codigos.length})
            </span>
          ))}{' '}
          e use o botão de foto em cada cor nova.
        </div>
      )}
      {loteId && (
        <div className="border-b bg-background px-3 py-2">
          <DropZoneImagensExistente onArquivos={lidarArquivosDrop} />
          {progresso && (
            <div className="mt-2 space-y-1">
              <Progress value={(progresso.feito / Math.max(progresso.total, 1)) * 100} />
              <div role="status" className="text-xs text-muted-foreground">
                Processando {progresso.feito} de {progresso.total} imagem(ns)…
              </div>
            </div>
          )}
          {uploadStatus && !progresso && (
            <div role="status" className="mt-2 text-xs text-muted-foreground motion-safe:animate-in fade-in-0 duration-(--motion-duration-state) ease-enter">{uploadStatus}</div>
          )}
        </div>
      )}
      <div ref={listaRef} className="flex-1 overflow-auto">
        {isLoading ? (
          <div role="status" className="p-8 text-center text-sm text-muted-foreground">
            Carregando famílias...
          </div>
        ) : error ? (
          <div role="alert" className="p-8 text-center text-sm text-destructive">
            Erro ao carregar famílias: {(error as Error).message}
          </div>
        ) : (
          /* Entrada única no mount real dos resultados (contrato §8.1): o wrapper só é
             montado na transição loading→dados; filtro/paginação/refetch não re-animam. */
          <div className="motion-safe:animate-in fade-in-0 slide-in-from-bottom-2 duration-(--motion-duration-enter) ease-enter">
            {(visiveis.length > 0 || soComCoresNovas) && (
              <div className="flex items-center gap-3 border-b bg-muted/30 px-4 py-2">
                <Checkbox
                  id="sel-todos"
                  checked={todasSelecionadas ? true : algumaSelecionada ? 'indeterminate' : false}
                  onCheckedChange={(v) => toggleTodas(v === true)}
                  disabled={idsSelecionaveis.length === 0}
                  aria-label="Selecionar todas as famílias publicáveis"
                />
                <label htmlFor="sel-todos" className="cursor-pointer select-none text-sm text-muted-foreground">
                  {todasSelecionadas ? 'Desmarcar todos' : 'Selecionar todos'}
                  {idsSelecionaveis.length > 0 && ` (${idsSelecionaveis.length})`}
                </label>
                <Button
                  variant={soComCoresNovas ? 'default' : 'outline'}
                  size="sm"
                  className="ml-2"
                  aria-pressed={soComCoresNovas}
                  disabled={!soComCoresNovas && familiasComCoresNovas === 0}
                  onClick={() => setSoComCoresNovas((s) => !s)}
                  title="Mostra só as famílias que têm cores novas (precisam de foto)"
                >
                  Só com cores novas
                  {familiasComCoresNovas > 0 && ` (${familiasComCoresNovas})`}
                </Button>
              </div>
            )}
            {pag.itensPagina.map((familia) => (
              <div key={familia.id}>
                <FamiliaRow
                  familia={familia}
                  selecionada={selecionadas.has(familia.id)}
                  expandida={expandidas.includes(familia.id)}
                  onSelecionar={toggleSelecao}
                  onExpandir={toggleExpansao}
                  onIrParaCritica={irParaCritica}
                />
                {/* Radix Collapsible: mede a altura real e mantém o conteúdo montado só
                    durante a animação de saída — mesmo custo de mount de antes quando
                    fechada. Reversível (contrato §6.4); motion-safe = fallback explícito
                    (reduced-motion abre/fecha instantâneo, sem depender do bloco global). */}
                <Collapsible.Root open={expandidas.includes(familia.id)}>
                  <Collapsible.Content
                    className="overflow-hidden ease-reversible duration-(--motion-duration-state) motion-safe:data-[state=open]:animate-collapsible-down motion-safe:data-[state=closed]:animate-collapsible-up"
                  >
                    <FamiliaExpanded
                      familia={familia}
                      focoCodigo={focoCritica?.familiaId === familia.id ? focoCritica.codigo : null}
                      onFocoConcluido={() => setFocoCritica(null)}
                      ocultarSemEstoque={ocultarSemEstoque}
                    />
                  </Collapsible.Content>
                </Collapsible.Root>
              </div>
            ))}
            {visiveis.length > 0 && (
              <div className="px-4">
                <Pagination
                  rotuloItem="família"
                  paginaAtual={pag.paginaAtual}
                  totalPaginas={pag.totalPaginas}
                  inicio={pag.inicio}
                  fim={pag.fim}
                  total={pag.total}
                  tamanho={pag.tamanho}
                  onIrPara={irPara}
                  onTamanho={pag.setTamanho}
                />
              </div>
            )}
            {visiveis.length === 0 && (
              <div role="status" className="p-8 text-center text-sm text-muted-foreground">
                Nenhuma família encontrada com esses filtros.
              </div>
            )}
          </div>
        )}
      </div>
      {selecionadas.size > 0 && (
        /* Entrada da barra de ação (feedback de seleção); sem exit — sumir na hora ao
           desmarcar não pode atrasar a próxima ação (contrato §8.2 e regra 5). */
        <div className="sticky bottom-0 flex items-center justify-between border-t bg-background/95 px-4 py-3 shadow-md backdrop-blur motion-safe:animate-in fade-in-0 slide-in-from-bottom-2 duration-(--motion-duration-state) ease-enter">
          <div role="status" className="text-sm text-muted-foreground">
            {selecionadas.size} família(s) · {coresSelecionadas} cor(es) selecionada(s)
          </div>
          <Button onClick={() => setConfirmando(true)}>
            Publicar selecionada{selecionadas.size > 1 ? 's' : ''} →
          </Button>
        </div>
      )}
      <Dialog open={atacadoAberto} onOpenChange={setAtacadoAberto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Preço de atacado no lote inteiro</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Aplica estas faixas a <strong>todas</strong> as {familias.length} famílias do lote
            (sobrescreve o atacado individual). O preço de cada família é o dela.
          </p>
          <AtacadoEditor faixas={faixasLote} precoBase={0} onChange={setFaixasLote} />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setFaixasLote([]); setAtacadoLote.mutate([], {
              onSuccess: () => { toast.success('Atacado removido de todas as famílias'); setAtacadoAberto(false); },
            }); }}>
              Remover de todas
            </Button>
            <Button disabled={!!erroFaixasLote || setAtacadoLote.isPending}
              onClick={() => setAtacadoLote.mutate(faixasLote, {
                onSuccess: () => { toast.success('Atacado aplicado a todas as famílias do lote'); setAtacadoAberto(false); },
                onError: (e) => toast.error('Falha ao aplicar atacado', { description: e instanceof Error ? e.message : String(e) }),
              })}>
              {setAtacadoLote.isPending ? 'Aplicando…' : 'Aplicar a todas'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={confirmando} onOpenChange={setConfirmando}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Publicar no Mercado Livre</DialogTitle>
          </DialogHeader>
          <p className="text-sm">
            {selecaoTemCreate && selecaoTemUpdate ? (
              <>Vou publicar/atualizar <strong>{selecionadas.size}</strong> família(s) no Mercado Livre, com <strong>{coresSelecionadas}</strong> cor(es) no total.</>
            ) : !selecaoTemCreate && selecaoTemUpdate ? (
              <>Vou atualizar o estoque de <strong>{selecionadas.size}</strong> família(s) já publicada(s), com <strong>{coresSelecionadas}</strong> cor(es) no total.</>
            ) : (
              <>Vou publicar <strong>{selecionadas.size}</strong> família(s) como anúncios novos no Mercado Livre, com <strong>{coresSelecionadas}</strong> cor(es) no total.</>
            )}
          </p>
          {selecaoTemCreate && (
            <div className="mt-1">
              <span className="block text-xs font-semibold text-muted-foreground">Tipo de anúncio</span>
              <div className="mt-1 flex gap-2">
                {([
                  { v: 'gold_special', rotulo: 'Clássico', desc: 'comissão menor' },
                  { v: 'gold_pro', rotulo: 'Premium', desc: 'parcelamento + exposição' },
                ] as const).map((opt) => (
                  <button
                    key={opt.v}
                    type="button"
                    onClick={() => setListingType(opt.v)}
                    className={
                      listingType === opt.v
                        ? 'flex-1 rounded-lg border-2 border-primary bg-accent px-3 py-2 text-left'
                        : 'flex-1 rounded-lg border px-3 py-2 text-left text-muted-foreground hover:bg-accent/50'
                    }
                  >
                    <span className="block text-sm font-medium text-foreground">{opt.rotulo}</span>
                    <span className="block text-[11px]">{opt.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {selecaoTemUpdate && (
            <div className="mt-1">
              <span className="block text-xs font-semibold text-muted-foreground">Produtos já publicados</span>
              <div className="mt-1 flex gap-2">
                {([
                  { v: false, rotulo: 'Atualizar tudo', desc: 'preço, estoque e demais campos' },
                  { v: true, rotulo: 'Somente estoque', desc: 'preserva o preço no ar' },
                ] as const).map((opt) => (
                  <button
                    key={String(opt.v)}
                    type="button"
                    onClick={() => setSomenteEstoqueGlobal(opt.v)}
                    className={
                      somenteEstoqueGlobal === opt.v
                        ? 'flex-1 rounded-lg border-2 border-primary bg-accent px-3 py-2 text-left'
                        : 'flex-1 rounded-lg border px-3 py-2 text-left text-muted-foreground hover:bg-accent/50'
                    }
                  >
                    <span className="block text-sm font-medium text-foreground">{opt.rotulo}</span>
                    <span className="block text-[11px]">{opt.desc}</span>
                  </button>
                ))}
              </div>
              {familiasComPrecoAlterado.length > 0 && (
                <div className="mt-2 space-y-1">
                  <span className="block text-xs font-semibold text-muted-foreground">
                    {familiasComPrecoAlterado.length} produto(s) com preço alterado — exceção à escolha acima
                  </span>
                  {familiasComPrecoAlterado.map((f) => (
                    <label key={f.id} className="flex items-center gap-1.5 text-xs cursor-pointer">
                      <Checkbox
                        checked={somenteEstoqueOverrides.has(f.id)}
                        onCheckedChange={(v) => toggleSomenteEstoqueOverride(f.id, v === true)}
                        aria-label={`Exceção para ${f.titulo}`}
                      />
                      <span className="truncate">{f.titulo}</span>
                      <span className="text-muted-foreground">
                        ({somenteEstoqueOverrides.has(f.id)
                          ? (somenteEstoqueGlobal ? 'atualizar tudo' : 'somente estoque')
                          : (somenteEstoqueGlobal ? 'somente estoque' : 'atualizar tudo')})
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
          {(() => {
            // "Somente estoque" nunca empurra preço (invariante #3) — família nessa condição
            // efetiva nunca exige divisão de fato. Mesma fórmula do backend (resolverSomenteEstoque).
            const exigemDivisao = familias.filter(
              (f) =>
                selecionadas.has(f.id) &&
                !(somenteEstoqueOverrides.has(f.id) ? !somenteEstoqueGlobal : somenteEstoqueGlobal) &&
                exigeDivisaoUpdate(f),
            );
            if (exigemDivisao.length === 0) return null;
            return (
              <div className="mt-2 rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <p className="font-semibold">
                  ⚠ {exigemDivisao.length} produto(s) publicado(s) cujos novos preços exigem DIVIDIR o anúncio
                </p>
                {exigemDivisao.map((f) => (
                  <p key={f.id} className="truncate">· {f.titulo}</p>
                ))}
                <p className="mt-1">
                  Mover cores entre anúncios perde histórico, vendas e perguntas. Com "Atualizar tudo",
                  a publicação desses produtos vai <strong>falhar de propósito</strong> (nada é enviado
                  ao ML). Opções: marcar "Somente estoque" para eles (adia a decisão), igualar os preços
                  das cores do mesmo anúncio, ou remover o anúncio e republicar aceitando a perda.
                </p>
              </div>
            );
          })()}
          <div className="mt-1">
            <span className="block text-xs font-semibold text-muted-foreground">Publicar em</span>
            <div className="mt-1 flex flex-wrap gap-3">
              {operaveis.map((c) => {
                const conectado = canaisConectados.has(c.id);
                return (
                  <label
                    key={c.id}
                    className={cn('flex items-center gap-1.5 text-sm', conectado ? 'cursor-pointer' : 'cursor-not-allowed opacity-60')}
                    title={conectado ? undefined : 'Conecte este canal no menu Canais para publicar nele'}
                  >
                    <Checkbox
                      checked={canaisSelecionados.has(c.id)}
                      disabled={!conectado}
                      onCheckedChange={(v) => toggleCanal(c.id, v === true)}
                      aria-label={`Publicar em ${c.nome}`}
                    />
                    <LogoCanal canal={c.id} />
                    {c.nome}
                  </label>
                );
              })}
              {emBreve.map((c) => (
                <span key={c.id} className="flex items-center gap-1.5 text-sm text-muted-foreground opacity-50 grayscale" title="Em breve no PubliAI">
                  <Checkbox disabled aria-label={`${c.nome} (em breve)`} />
                  <LogoCanal canal={c.id} />
                  {c.nome} <span className="text-[10px] uppercase">em breve</span>
                </span>
              ))}
            </div>
          </div>
          {(() => {
            const titulos = familias.filter((f) => selecionadas.has(f.id)).map((f) => f.titulo);
            const avisos = avisosCapabilities(titulos, canaisEfetivos);
            return avisos.length > 0 ? (
              <div className="mt-1 rounded border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
                {avisos.map((a) => <p key={a}>{a}</p>)}
              </div>
            ) : null;
          })()}
          {publicando && (
            <div role="status" className="mt-1 space-y-2 motion-safe:animate-in fade-in-0 duration-(--motion-duration-state) ease-enter">
              <div className="track-indeterminate" role="progressbar" aria-label="Enfileirando publicação" />
              <p className="text-xs text-muted-foreground">
                Enfileirando famílias e enviando fotos ao Mercado Livre…
              </p>
            </div>
          )}
          {semCanalMarcado && (
            <p className="mt-1 text-xs text-warning">Marque ao menos um canal para publicar.</p>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={publicando} onClick={() => setConfirmando(false)}>Cancelar</Button>
            <Button disabled={publicando || semCanalMarcado} onClick={confirmarPublicacao}>
              {publicando ? 'Enfileirando…' : 'Confirmar publicação'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
