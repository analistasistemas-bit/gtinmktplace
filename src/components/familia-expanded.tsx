import { useRef, useState } from 'react';
import { Camera, Sparkles, Trash2 } from 'lucide-react';
import { StatusPill } from '@/components/ui/status-pill';
import { useQueryClient } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { VariacaoCard } from '@/components/variacao-card';
import { StatusInline, type SaveStatus } from '@/components/status-inline';
import { FotoCapaFamilia } from '@/components/foto-capa-familia';
import { PainelAnalise } from '@/components/painel-analise';
import { DiffEstoque } from '@/components/diff-estoque';
import {
  useUpdateVariacaoPreco,
  useUpdateVariacaoCor,
  useUpdateVariacaoGtin,
  useUpdateFamiliaTitulo,
  useUpdateFamiliaDescricao,
  useRegenerarCopy,
  useUpdateVariacaoPrincipal,
} from '@/hooks/useFamiliaMutations';
import { subirCapaFamilia, removerCapaFamilia, subirCapa2Familia, removerCapa2Familia } from '@/lib/upload-imagens';
import { setVariacaoExcluida } from '@/lib/publicar';
import { useImageUrl } from '@/hooks/useImageUrl';
import { QK } from '@/lib/queries';
import type { Familia } from '@/lib/tipos-dominio';

const FLASH_MS = 2000;

export function FamiliaExpanded({ familia }: { familia: Familia }) {
  const [titulo, setTitulo] = useState(familia.titulo);
  const [descricao, setDescricao] = useState(familia.descricao);
  const [variacoes, setVariacoes] = useState(familia.variacoes);

  const [tituloStatus, setTituloStatus] = useState<SaveStatus>(undefined);
  const [descricaoStatus, setDescricaoStatus] = useState<SaveStatus>(undefined);
  const [precoStatuses, setPrecoStatuses] = useState<Record<string, SaveStatus>>({});
  const [corStatuses, setCorStatuses] = useState<Record<string, SaveStatus>>({});
  const [gtinStatuses, setGtinStatuses] = useState<Record<string, SaveStatus>>({});

  const inputRef = useRef<HTMLInputElement>(null);
  const [trocando, setTrocando] = useState(false);
  const qc = useQueryClient();
  const { data: capaUrl } = useImageUrl(familia.capaStoragePath ?? familia.fotoCapaPath);
  const { data: capa2Url } = useImageUrl(familia.capa2StoragePath);
  const inputCapa2Ref = useRef<HTMLInputElement>(null);
  const [trocandoCapa2, setTrocandoCapa2] = useState(false);
  const updatePrincipal = useUpdateVariacaoPrincipal(familia.loteId);

  const updateTitulo = useUpdateFamiliaTitulo(familia.loteId);
  const updateDescricao = useUpdateFamiliaDescricao(familia.loteId);
  const updatePreco = useUpdateVariacaoPreco(familia.loteId);
  const updateCor = useUpdateVariacaoCor(familia.loteId);
  const updateGtin = useUpdateVariacaoGtin(familia.loteId);
  const regenerar = useRegenerarCopy(familia.loteId);

  function mudarPreco(codigo: string, novoPreco: number) {
    // O campo edita o preço de publicação (o que vai ao ML), não o preço da planilha.
    setVariacoes((vs) =>
      vs.map((v) => (v.codigo === codigo ? { ...v, precoPublicacao: novoPreco } : v)),
    );
  }

  function mudarCor(codigo: string, novaCor: string) {
    setVariacoes((vs) => vs.map((v) => (v.codigo === codigo ? { ...v, cor: novaCor } : v)));
  }

  function mudarGtin(codigo: string, novoGtin: string) {
    setVariacoes((vs) =>
      vs.map((v) => (v.codigo === codigo ? { ...v, gtin: novoGtin || null } : v))
    );
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

  function flashGtin(codigo: string, status: SaveStatus) {
    setGtinStatuses((s) => ({ ...s, [codigo]: status }));
    if (status === 'salvo') {
      setTimeout(() => {
        setGtinStatuses((s) => {
          const copy = { ...s };
          delete copy[codigo];
          return copy;
        });
      }, FLASH_MS);
    }
  }

  async function salvarGtin(codigo: string) {
    const v = variacoes.find((x) => x.codigo === codigo);
    const original = familia.variacoes.find((x) => x.codigo === codigo);
    if (!v?.id || !original || v.gtin === original.gtin) return;
    flashGtin(codigo, 'salvando');
    try {
      await updateGtin.mutateAsync({ id: v.id, gtin: v.gtin });
      flashGtin(codigo, 'salvo');
    } catch {
      flashGtin(codigo, 'erro');
    }
  }

  async function lidarTrocaCapa(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setTrocando(true);
    try {
      await subirCapaFamilia(familia.loteId, familia.codigoPai, file);
      qc.invalidateQueries({ queryKey: QK.familias(familia.loteId) });
    } catch (err) {
      alert(`Erro ao trocar capa: ${(err as Error).message}`);
    } finally {
      setTrocando(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function lidarRemoverCapa() {
    if (!familia.capaStoragePath) return;
    if (!confirm('Remover capa desta família?')) return;
    try {
      await removerCapaFamilia(familia.id, familia.capaStoragePath);
      qc.invalidateQueries({ queryKey: QK.familias(familia.loteId) });
    } catch (err) {
      alert(`Erro ao remover capa: ${(err as Error).message}`);
    }
  }

  async function lidarTrocaCapa2(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setTrocandoCapa2(true);
    try {
      await subirCapa2Familia(familia.loteId, familia.codigoPai, file);
      qc.invalidateQueries({ queryKey: QK.familias(familia.loteId) });
    } catch (err) {
      alert(`Erro ao subir 2ª foto: ${(err as Error).message}`);
    } finally {
      setTrocandoCapa2(false);
      if (inputCapa2Ref.current) inputCapa2Ref.current.value = '';
    }
  }

  async function lidarRemoverCapa2() {
    if (!familia.capa2StoragePath) return;
    if (!confirm('Remover a 2ª foto desta família?')) return;
    try {
      await removerCapa2Familia(familia.id, familia.capa2StoragePath);
      qc.invalidateQueries({ queryKey: QK.familias(familia.loteId) });
    } catch (err) {
      alert(`Erro ao remover 2ª foto: ${(err as Error).message}`);
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
                  <Button variant="ghost" size="sm" onClick={lidarRemoverCapa}>
                    <Trash2 className="mr-1.5 h-4 w-4" />
                    Remover
                  </Button>
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
                  <Button variant="ghost" size="sm" onClick={lidarRemoverCapa2}>
                    <Trash2 className="mr-1.5 h-4 w-4" /> Remover
                  </Button>
                )}
              </div>
              <input ref={inputCapa2Ref} type="file" accept="image/jpeg,image/png,image/jpg" className="hidden" onChange={lidarTrocaCapa2} />
            </div>
          </div>
        </div>
        <PainelAnalise familia={familia} />
      </div>
      <div className="grid grid-cols-2 gap-4">
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
              return (
              <div
                key={v.codigo}
                className={`flex items-start gap-2${v.excluidaDaPublicacao && !corNova ? ' opacity-50' : ''}`}
              >
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
                    statusGtin={gtinStatuses[v.codigo]}
                    onMudarPreco={mudarPreco}
                    onMudarCor={mudarCor}
                    onMudarGtin={mudarGtin}
                    onSalvarPreco={salvarPreco}
                    onSalvarCor={salvarCor}
                    onSalvarGtin={salvarGtin}
                  />
                </div>
              </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
