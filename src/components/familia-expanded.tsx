import { useEffect, useRef, useState } from 'react';
import { Camera, Sparkles, Trash2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { StatusPill } from '@/components/ui/status-pill';
import { useQueryClient } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { VariacaoCard } from '@/components/variacao-card';
import { StatusInline, type SaveStatus } from '@/components/status-inline';
import { FotoCapaFamilia } from '@/components/foto-capa-familia';
import { PainelAnalise } from '@/components/painel-analise';
import { CardCategoria } from '@/components/card-categoria';
import { DiffEstoque } from '@/components/diff-estoque';
import {
  useUpdateVariacaoPreco,
  useUpdateVariacaoCor,
  useUpdateFamiliaTitulo,
  useUpdateFamiliaDescricao,
  useRegenerarCopy,
  useUpdateVariacaoPrincipal,
} from '@/hooks/useFamiliaMutations';
import { subirCapaFamilia, removerCapaFamilia, subirCapa2Familia, removerCapa2Familia, subirCapa3Familia, removerCapa3Familia } from '@/lib/upload-imagens';
import { setVariacaoExcluida } from '@/lib/publicar';
import { criticasVariacao } from '@/lib/publicavel';
import { cn } from '@/lib/utils';
import { useImageUrl } from '@/hooks/useImageUrl';
import { QK } from '@/lib/queries';
import type { Familia } from '@/lib/tipos-dominio';

const FLASH_MS = 2000;

interface FamiliaExpandedProps {
  familia: Familia;
  focoCodigo?: string | null;
  onFocoConcluido?: () => void;
}

export function FamiliaExpanded({ familia, focoCodigo, onFocoConcluido }: FamiliaExpandedProps) {
  const [titulo, setTitulo] = useState(familia.titulo);
  const [descricao, setDescricao] = useState(familia.descricao);
  const [variacoes, setVariacoes] = useState(familia.variacoes);

  // Re-sincroniza o estado local quando o servidor altera a FOTO de alguma variação
  // (upload pela câmera → invalidate → refetch). Sem isso, o estado local — inicializado
  // só uma vez — ignora a foto nova e a linha continua "sem foto". Chaveado apenas por
  // código+foto p/ não descartar edições locais de cor/preço/GTIN ainda não salvas.
  const fotosKey = familia.variacoes.map((v) => `${v.codigo}:${v.fotoPath ?? ''}`).join('|');
  useEffect(() => {
    setVariacoes(familia.variacoes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fotosKey]);

  const [tituloStatus, setTituloStatus] = useState<SaveStatus>(undefined);
  const [descricaoStatus, setDescricaoStatus] = useState<SaveStatus>(undefined);
  const [precoStatuses, setPrecoStatuses] = useState<Record<string, SaveStatus>>({});
  const [corStatuses, setCorStatuses] = useState<Record<string, SaveStatus>>({});

  const inputRef = useRef<HTMLInputElement>(null);
  const [trocando, setTrocando] = useState(false);
  const qc = useQueryClient();
  const { data: capaUrl } = useImageUrl(familia.capaStoragePath ?? familia.fotoCapaPath);
  const { data: capa2Url } = useImageUrl(familia.capa2StoragePath);
  const inputCapa2Ref = useRef<HTMLInputElement>(null);
  const [trocandoCapa2, setTrocandoCapa2] = useState(false);
  const { data: capa3Url } = useImageUrl(familia.capa3StoragePath);
  const inputCapa3Ref = useRef<HTMLInputElement>(null);
  const [trocandoCapa3, setTrocandoCapa3] = useState(false);
  const updatePrincipal = useUpdateVariacaoPrincipal(familia.loteId);

  const updateTitulo = useUpdateFamiliaTitulo(familia.loteId);
  const updateDescricao = useUpdateFamiliaDescricao(familia.loteId);
  const updatePreco = useUpdateVariacaoPreco(familia.loteId);
  const updateCor = useUpdateVariacaoCor(familia.loteId);
  const regenerar = useRegenerarCopy(familia.loteId);

  // Foco numa variação (vindo do selo de pendência do pai): rola até ela e a realça.
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [flashCodigo, setFlashCodigo] = useState<string | null>(null);
  useEffect(() => {
    if (!focoCodigo) return;
    const el = rowRefs.current[focoCodigo];
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setFlashCodigo(focoCodigo);
    const t = setTimeout(() => setFlashCodigo(null), 2500);
    onFocoConcluido?.();
    return () => clearTimeout(t);
    // Depende só de focoCodigo de propósito: onFocoConcluido é arrow inline (muda
    // toda render) e incluí-la re-rolaria a cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focoCodigo]);

  function mudarPreco(codigo: string, novoPreco: number) {
    // O campo edita o preço de publicação (o que vai ao ML), não o preço da planilha.
    setVariacoes((vs) =>
      vs.map((v) => (v.codigo === codigo ? { ...v, precoPublicacao: novoPreco } : v)),
    );
  }

  function mudarCor(codigo: string, novaCor: string) {
    setVariacoes((vs) => vs.map((v) => (v.codigo === codigo ? { ...v, cor: novaCor } : v)));
  }

  function flash(setter: (s: SaveStatus) => void) {
    setter('salvo');
    setTimeout(() => setter(undefined), FLASH_MS);
  }

  function flashPreco(codigo: string, status: SaveStatus) {
    setPrecoStatuses((s) => ({ ...s, [codigo]: status }));
    if (status === 'salvo') {
      setTimeout(() => {
        setPrecoStatuses((s) => {
          const copy = { ...s };
          delete copy[codigo];
          return copy;
        });
      }, FLASH_MS);
    }
  }

  async function salvarTitulo() {
    if (titulo === familia.titulo) return;
    setTituloStatus('salvando');
    try {
      await updateTitulo.mutateAsync({ id: familia.id, titulo });
      flash(setTituloStatus);
    } catch {
      setTituloStatus('erro');
    }
  }

  async function salvarDescricao() {
    if (descricao === familia.descricao) return;
    setDescricaoStatus('salvando');
    try {
      await updateDescricao.mutateAsync({ id: familia.id, descricao });
      flash(setDescricaoStatus);
    } catch {
      setDescricaoStatus('erro');
    }
  }

  async function salvarPreco(codigo: string) {
    const editada = variacoes.find((x) => x.codigo === codigo);
    const original = familia.variacoes.find((x) => x.codigo === codigo);
    if (!editada?.id || !original) return;
    const novoPreco = editada.precoPublicacao;
    if (novoPreco == null || novoPreco === original.precoPublicacao) return;

    // Preço é por produto: replica o novo preço de publicação para todas as cores.
    setVariacoes((vs) => vs.map((x) => ({ ...x, precoPublicacao: novoPreco })));

    // Salva a cor editada + as demais cujo preço ainda diverge do novo.
    const alvos = variacoes.filter(
      (x) => x.id && (x.codigo === codigo || x.precoPublicacao !== novoPreco),
    );
    alvos.forEach((x) => flashPreco(x.codigo, 'salvando'));
    await Promise.all(
      alvos.map(async (x) => {
        try {
          await updatePreco.mutateAsync({ id: x.id!, preco: novoPreco });
          flashPreco(x.codigo, 'salvo');
        } catch {
          flashPreco(x.codigo, 'erro');
        }
      }),
    );
  }

  function flashCor(codigo: string, status: SaveStatus) {
    setCorStatuses((s) => ({ ...s, [codigo]: status }));
    if (status === 'salvo') {
      setTimeout(() => {
        setCorStatuses((s) => {
          const copy = { ...s };
          delete copy[codigo];
          return copy;
        });
      }, FLASH_MS);
    }
  }

  async function salvarCor(codigo: string) {
    const v = variacoes.find((x) => x.codigo === codigo);
    const original = familia.variacoes.find((x) => x.codigo === codigo);
    if (!v?.id || !original || v.cor === original.cor) return;
    flashCor(codigo, 'salvando');
    try {
      await updateCor.mutateAsync({ id: v.id, codigo: v.codigo, cor: v.cor });
      flashCor(codigo, 'salvo');
    } catch {
      flashCor(codigo, 'erro');
    }
  }

  async function lidarTrocaCapa(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setTrocando(true);
    try {
      await subirCapaFamilia(familia.loteId, familia.codigoPai, file);
      qc.invalidateQueries({ queryKey: QK.familias(familia.loteId) });
      toast.success('Foto-capa atualizada');
    } catch (err) {
      toast.error('Erro ao trocar capa', { description: (err as Error).message });
    } finally {
      setTrocando(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function lidarRemoverCapa() {
    if (!familia.capaStoragePath) return;
    try {
      await removerCapaFamilia(familia.id, familia.capaStoragePath);
      qc.invalidateQueries({ queryKey: QK.familias(familia.loteId) });
      toast.success('Foto-capa removida');
    } catch (err) {
      toast.error('Erro ao remover capa', { description: (err as Error).message });
    }
  }

  async function lidarTrocaCapa2(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setTrocandoCapa2(true);
    try {
      await subirCapa2Familia(familia.loteId, familia.codigoPai, file);
      qc.invalidateQueries({ queryKey: QK.familias(familia.loteId) });
      toast.success('2ª foto atualizada');
    } catch (err) {
      toast.error('Erro ao subir 2ª foto', { description: (err as Error).message });
    } finally {
      setTrocandoCapa2(false);
      if (inputCapa2Ref.current) inputCapa2Ref.current.value = '';
    }
  }

  async function lidarRemoverCapa2() {
    if (!familia.capa2StoragePath) return;
    try {
      await removerCapa2Familia(familia.id, familia.capa2StoragePath);
      qc.invalidateQueries({ queryKey: QK.familias(familia.loteId) });
      toast.success('2ª foto removida');
    } catch (err) {
      toast.error('Erro ao remover 2ª foto', { description: (err as Error).message });
    }
  }

  async function lidarTrocaCapa3(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setTrocandoCapa3(true);
    try {
      await subirCapa3Familia(familia.loteId, familia.codigoPai, file);
      qc.invalidateQueries({ queryKey: QK.familias(familia.loteId) });
      toast.success('3ª foto atualizada');
    } catch (err) {
      toast.error('Erro ao subir 3ª foto', { description: (err as Error).message });
    } finally {
      setTrocandoCapa3(false);
      if (inputCapa3Ref.current) inputCapa3Ref.current.value = '';
    }
  }

  async function lidarRemoverCapa3() {
    if (!familia.capa3StoragePath) return;
    try {
      await removerCapa3Familia(familia.id, familia.capa3StoragePath);
      qc.invalidateQueries({ queryKey: QK.familias(familia.loteId) });
      toast.success('3ª foto removida');
    } catch (err) {
      toast.error('Erro ao remover 3ª foto', { description: (err as Error).message });
    }
  }

  return (
    <div className="border-b bg-muted/30 p-4 text-sm">
      <DiffEstoque familia={familia} />
      <div className="mb-4 flex flex-col gap-4 border-b pb-4">
        {/* Faixa fina de fotos: a Análise (abaixo) é o foco da tela, então as fotos
            ficam compactas em uma linha, sem comer a largura. */}
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
          <div className="flex items-center gap-3">
            <FotoCapaFamilia capaUrl={capaUrl ?? null} tamanho="medium" />
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">Foto-capa do anúncio</span>
              <div className="flex gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => inputRef.current?.click()}
                  disabled={trocando}
                >
                  <Camera className="mr-1.5 h-4 w-4" />
                  {familia.capaStoragePath ? 'Trocar foto' : 'Subir capa'}
                </Button>
                {familia.capaStoragePath && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="sm">
                        <Trash2 className="mr-1.5 h-4 w-4" />
                        Remover
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Remover a foto-capa?</AlertDialogTitle>
                        <AlertDialogDescription>
                          A foto-capa desta família será removida. Você pode subir outra depois.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={lidarRemoverCapa}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Remover
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
              <input
                ref={inputRef}
                type="file"
                accept="image/jpeg,image/png,image/jpg"
                className="hidden"
                onChange={lidarTrocaCapa}
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <FotoCapaFamilia capaUrl={capa2Url ?? null} tamanho="medium" />
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">2ª foto (todas as cores)</span>
              <div className="flex gap-1.5">
                <Button variant="outline" size="sm" onClick={() => inputCapa2Ref.current?.click()} disabled={trocandoCapa2}>
                  <Camera className="mr-1.5 h-4 w-4" />
                  {familia.capa2StoragePath ? 'Trocar 2ª foto' : 'Subir 2ª foto'}
                </Button>
                {familia.capa2StoragePath && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="sm">
                        <Trash2 className="mr-1.5 h-4 w-4" /> Remover
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Remover a 2ª foto?</AlertDialogTitle>
                        <AlertDialogDescription>
                          A 2ª foto (aplicada a todas as cores) será removida. Você pode subir outra depois.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={lidarRemoverCapa2}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Remover
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
              <input ref={inputCapa2Ref} type="file" accept="image/jpeg,image/png,image/jpg" className="hidden" onChange={lidarTrocaCapa2} />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <FotoCapaFamilia capaUrl={capa3Url ?? null} tamanho="medium" />
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">3ª foto (todas as cores)</span>
              <div className="flex gap-1.5">
                <Button variant="outline" size="sm" onClick={() => inputCapa3Ref.current?.click()} disabled={trocandoCapa3}>
                  <Camera className="mr-1.5 h-4 w-4" />
                  {familia.capa3StoragePath ? 'Trocar 3ª foto' : 'Subir 3ª foto'}
                </Button>
                {familia.capa3StoragePath && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="sm">
                        <Trash2 className="mr-1.5 h-4 w-4" /> Remover
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Remover a 3ª foto?</AlertDialogTitle>
                        <AlertDialogDescription>
                          A 3ª foto (aplicada a todas as cores) será removida. Você pode subir outra depois.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={lidarRemoverCapa3}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Remover
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
              <input ref={inputCapa3Ref} type="file" accept="image/jpeg,image/png,image/jpg" className="hidden" onChange={lidarTrocaCapa3} />
            </div>
          </div>
          <div className="ml-auto">
            <CardCategoria familia={familia} />
          </div>
        </div>
        <PainelAnalise familia={familia} />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label htmlFor={`titulo-${familia.id}`} className="block text-xs font-semibold text-muted-foreground">TÍTULO</label>
            <StatusInline status={tituloStatus} />
          </div>
          <Input
            id={`titulo-${familia.id}`}
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            onBlur={salvarTitulo}
          />

          <div className="mb-1 mt-3 flex items-center justify-between">
            <label htmlFor={`descricao-${familia.id}`} className="block text-xs font-semibold text-muted-foreground">DESCRIÇÃO</label>
            <StatusInline status={descricaoStatus} />
          </div>
          <Textarea
            id={`descricao-${familia.id}`}
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            onBlur={salvarDescricao}
            rows={5}
          />

          <div className="mt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                regenerar.mutate(familia.id, {
                  onSuccess: (data) => {
                    setTitulo(data.titulo);
                    setDescricao(data.descricao);
                  },
                })
              }
              disabled={regenerar.isPending}
            >
              <Sparkles className="mr-2 h-4 w-4" />
              {regenerar.isPending ? 'Gerando…' : 'Regenerar descrição'}
            </Button>
          </div>

        </div>

        <div>
          <label className="mb-2 block text-xs font-semibold text-muted-foreground">
            VARIAÇÕES ({variacoes.length})
          </label>
          <div className="flex flex-col gap-2">
            {variacoes.map((v) => {
              // Cor nova (UPDATE sem variação no ML) é opt-in mas precisa ser editável
              // para o operador prepará-la (cor/preço/foto) antes de incluir — não esmaece.
              const corNova = familia.operacao === 'UPDATE' && !v.mlVariationId;
              // Cores com pendência (sem foto/cor/preço) ganham faixa âmbar p/ achar rápido.
              const criticas = criticasVariacao(v, familia.operacao);
              return (
              <div
                key={v.codigo}
                ref={(el) => { rowRefs.current[v.codigo] = el; }}
                className={cn(
                  // Borda esquerda reservada (transparente) em TODAS as linhas → as
                  // com crítica só trocam a cor, sem empurrar nem desalinhar as outras.
                  'scroll-mt-4 rounded-md border-l-4 border-transparent pl-2 transition-shadow',
                  v.excluidaDaPublicacao && !corNova && 'opacity-50',
                  criticas.length > 0 && 'border-warning bg-warning/10 py-1',
                  flashCodigo === v.codigo && 'ring-2 ring-warning ring-offset-2 ring-offset-background',
                )}
              >
                <div className="flex items-start gap-2">
                  <Checkbox
                    checked={!v.excluidaDaPublicacao}
                    aria-label={`Incluir cor ${v.cor || v.codigo} na publicação`}
                    className="mt-2 shrink-0"
                    onCheckedChange={async (marcado) => {
                      if (!v.id) return;
                      await setVariacaoExcluida(v.id, marcado !== true);
                      qc.invalidateQueries({ queryKey: QK.familias(familia.loteId) });
                    }}
                  />
                  {familia.operacao === 'UPDATE' && !v.mlVariationId && (
                    <StatusPill tone="success" className="mt-2 shrink-0">
                      nova
                    </StatusPill>
                  )}
                  {familia.operacao === 'CREATE' && !v.excluidaDaPublicacao && (
                    <label className="mt-2 flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
                      <input
                        type="radio"
                        name={`principal-${familia.id}`}
                        checked={familia.variacaoPrincipalCodigo === v.codigo}
                        onChange={() => updatePrincipal.mutate({ familiaId: familia.id, codigo: v.codigo })}
                      />
                      {familia.variacaoPrincipalCodigo === v.codigo ? (
                        <StatusPill tone="info">principal</StatusPill>
                      ) : 'principal'}
                    </label>
                  )}
                  <div className="flex-1">
                    <VariacaoCard
                      variacao={v}
                      loteId={familia.loteId}
                      statusPreco={precoStatuses[v.codigo]}
                      statusCor={corStatuses[v.codigo]}
                      onMudarPreco={mudarPreco}
                      onMudarCor={mudarCor}
                      onSalvarPreco={salvarPreco}
                      onSalvarCor={salvarCor}
                      categoriaMlId={familia.categoriaMlId}
                    />
                  </div>
                </div>
                {criticas.length > 0 && (
                  <div className="mt-1 flex items-center gap-1 pl-7 text-xs font-medium text-warning">
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                    {criticas.join(' · ')}
                  </div>
                )}
              </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
