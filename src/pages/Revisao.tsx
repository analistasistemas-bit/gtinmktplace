import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { FileText } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
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
import { FamiliaRow } from '@/components/familia-row';
import { FamiliaExpanded } from '@/components/familia-expanded';
import { DropZoneImagensExistente } from '@/components/drop-zone-imagens-existente';
import { useFamilias } from '@/hooks/useFamilias';
import { uploadImagensLote } from '@/lib/upload-imagens';
import { QK } from '@/lib/queries';
import { familiaPublicavel, familiaIncompleta, idsPublicaveis, loteTemPublicacao } from '@/lib/publicavel';
import { coresNovasSemFoto } from '@/lib/cores-novas';
import { publicarFamilias, type ListingType } from '@/lib/publicar';
import { useToggleDescontoLote } from '@/hooks/useFamiliaMutations';
import type { Familia } from '@/lib/tipos-dominio';

type FiltroOp = 'todos' | 'CREATE' | 'UPDATE' | 'avisos' | 'incompletas';

export function filtrarFamilias(familias: Familia[], filtro: FiltroOp, busca: string): Familia[] {
  const buscaLower = busca.trim().toLowerCase();
  return familias.filter((f) => {
    if (filtro === 'CREATE' && f.operacao !== 'CREATE') return false;
    if (filtro === 'UPDATE' && f.operacao !== 'UPDATE') return false;
    if (filtro === 'avisos' && !f.precoAbaixo20pc) return false;
    if (filtro === 'incompletas' && !familiaIncompleta(f)) return false;
    if (!buscaLower) return true;
    return (
      f.titulo.toLowerCase().includes(buscaLower) ||
      f.codigoPai.includes(buscaLower) ||
      f.variacoes.some((v) => v.codigo.toLowerCase().includes(buscaLower))
    );
  });
}

export default function Revisao() {
  const { loteId } = useParams();
  const nav = useNavigate();
  const { data: familias = [], isLoading, error } = useFamilias(loteId);
  const [filtro, setFiltro] = useState<FiltroOp>('todos');
  const [busca, setBusca] = useState('');
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  const [expandidas, setExpandidas] = useState<Set<string>>(new Set());
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [progresso, setProgresso] = useState<{ feito: number; total: number } | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [publicando, setPublicando] = useState(false);
  const [listingType, setListingType] = useState<ListingType>('gold_special');
  // Variação-alvo ao clicar no selo de pendência do pai: expande + rola até ela.
  const [focoCritica, setFocoCritica] = useState<{ familiaId: string; codigo: string } | null>(null);
  const qc = useQueryClient();
  const toggleLote = useToggleDescontoLote(loteId ?? '');
  const todasComDesconto = familias.length > 0 && familias.every((f) => f.exibirComDesconto);

  // O lote volta para 'revisao' quando ainda restam famílias publicáveis, escondendo
  // o relatório da última publicação (acessível via card do Dashboard só em 'concluido').
  // Este atalho reabre o relatório do lote enquanto houver ≥1 família já publicada.
  const temPublicacao = useMemo(() => loteTemPublicacao(familias), [familias]);

  const visiveis = useMemo(() => filtrarFamilias(familias, filtro, busca), [familias, filtro, busca]);
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
  }, [filtro, busca]);
  // "Selecionar todos" age só sobre as famílias publicáveis visíveis (respeita
  // filtro/busca) — espelha a regra do toggleSelecao, que ignora as incompletas.
  const idsSelecionaveis = useMemo(() => idsPublicaveis(visiveis), [visiveis]);
  const todasSelecionadas =
    idsSelecionaveis.length > 0 && idsSelecionaveis.every((id) => selecionadas.has(id));
  const algumaSelecionada = idsSelecionaveis.some((id) => selecionadas.has(id));
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

  function toggleExpansao(id: string) {
    setExpandidas((prev) => {
      const novo = new Set(prev);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  }

  function irParaCritica(familiaId: string, codigo: string) {
    setExpandidas((prev) => new Set(prev).add(familiaId));
    setFocoCritica({ familiaId, codigo });
  }

  const counts = {
    todos: familias.length,
    CREATE: familias.filter((f) => f.operacao === 'CREATE').length,
    UPDATE: familias.filter((f) => f.operacao === 'UPDATE').length,
    avisos: familias.filter((f) => f.precoAbaixo20pc).length,
    incompletas: familias.filter((f) => familiaIncompleta(f)).length,
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

  async function confirmarPublicacao() {
    setPublicando(true);
    const total = selecionadas.size;
    try {
      await publicarFamilias([...selecionadas], listingType);
      setSelecionadas(new Set());
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
              <div className="flex items-center gap-2">
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
                  onClick={() => toggleLote.mutate(!todasComDesconto)}
                >
                  {todasComDesconto ? 'Desativar desconto no lote' : 'Ativar desconto no lote'}
                </Button>
              </div>
            ) : undefined
          }
        />
        <div className="flex items-center gap-3 pb-3">
          <Tabs value={filtro} onValueChange={(v) => setFiltro(v as FiltroOp)}>
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
            </TabsList>
          </Tabs>
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
              <div className="text-xs text-muted-foreground">
                Processando {progresso.feito} de {progresso.total} imagem(ns)…
              </div>
            </div>
          )}
          {uploadStatus && !progresso && (
            <div className="mt-2 text-xs text-muted-foreground">{uploadStatus}</div>
          )}
        </div>
      )}
      <div ref={listaRef} className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Carregando famílias...
          </div>
        ) : error ? (
          <div className="p-8 text-center text-sm text-destructive">
            Erro ao carregar famílias: {(error as Error).message}
          </div>
        ) : (
          <>
            {visiveis.length > 0 && (
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
              </div>
            )}
            {pag.itensPagina.map((familia) => (
              <div key={familia.id}>
                <FamiliaRow
                  familia={familia}
                  selecionada={selecionadas.has(familia.id)}
                  expandida={expandidas.has(familia.id)}
                  onSelecionar={toggleSelecao}
                  onExpandir={toggleExpansao}
                  onIrParaCritica={irParaCritica}
                />
                {expandidas.has(familia.id) && (
                  <FamiliaExpanded
                    familia={familia}
                    focoCodigo={focoCritica?.familiaId === familia.id ? focoCritica.codigo : null}
                    onFocoConcluido={() => setFocoCritica(null)}
                  />
                )}
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
              <div className="p-8 text-center text-sm text-muted-foreground">
                Nenhuma família encontrada com esses filtros.
              </div>
            )}
          </>
        )}
      </div>
      {selecionadas.size > 0 && (
        <div className="sticky bottom-0 flex items-center justify-between border-t bg-background/95 px-4 py-3 shadow-md backdrop-blur">
          <div className="text-sm text-muted-foreground">
            {selecionadas.size} família(s) · {coresSelecionadas} cor(es) selecionada(s)
          </div>
          <Button onClick={() => setConfirmando(true)}>
            Publicar selecionada{selecionadas.size > 1 ? 's' : ''} →
          </Button>
        </div>
      )}
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
          {publicando && (
            <div className="mt-1 space-y-2">
              <div className="track-indeterminate" role="progressbar" aria-label="Enfileirando publicação" />
              <p className="text-xs text-muted-foreground">
                Enfileirando famílias e enviando fotos ao Mercado Livre…
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={publicando} onClick={() => setConfirmando(false)}>Cancelar</Button>
            <Button disabled={publicando} onClick={confirmarPublicacao}>
              {publicando ? 'Enfileirando…' : 'Confirmar publicação'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
