import { useRef, useState } from 'react';
import { AlertTriangle, Camera, Sparkles, Trash2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { VariacaoCard } from '@/components/variacao-card';
import { StatusInline, type SaveStatus } from '@/components/status-inline';
import { FotoCapaFamilia } from '@/components/foto-capa-familia';
import {
  useUpdateVariacaoPreco,
  useUpdateVariacaoCor,
  useUpdateFamiliaTitulo,
  useUpdateFamiliaDescricao,
  useRegenerarCopy,
} from '@/hooks/useFamiliaMutations';
import { subirCapaFamilia, removerCapaFamilia } from '@/lib/upload-imagens';
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

  const inputRef = useRef<HTMLInputElement>(null);
  const [trocando, setTrocando] = useState(false);
  const qc = useQueryClient();
  const { data: capaUrl } = useImageUrl(familia.capaStoragePath ?? familia.fotoCapaPath);

  const updateTitulo = useUpdateFamiliaTitulo(familia.loteId);
  const updateDescricao = useUpdateFamiliaDescricao(familia.loteId);
  const updatePreco = useUpdateVariacaoPreco(familia.loteId);
  const updateCor = useUpdateVariacaoCor(familia.loteId);
  const regenerar = useRegenerarCopy(familia.loteId);

  function mudarPreco(codigo: string, novoPreco: number) {
    setVariacoes((vs) => vs.map((v) => (v.codigo === codigo ? { ...v, preco: novoPreco } : v)));
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
    const v = variacoes.find((x) => x.codigo === codigo);
    const original = familia.variacoes.find((x) => x.codigo === codigo);
    if (!v?.id || !original || v.preco === original.preco) return;
    flashPreco(codigo, 'salvando');
    try {
      await updatePreco.mutateAsync({ id: v.id, preco: v.preco });
      flashPreco(codigo, 'salvo');
    } catch {
      flashPreco(codigo, 'erro');
    }
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

  return (
    <div className="border-b bg-muted/30 p-4 text-sm">
      <div className="mb-4 flex items-start gap-4 border-b pb-4">
        <FotoCapaFamilia capaUrl={capaUrl ?? null} tamanho="large" />
        <div className="flex flex-col gap-2">
          <span className="text-xs text-muted-foreground">Foto-capa do anúncio</span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => inputRef.current?.click()}
              disabled={trocando}
            >
              <Camera className="mr-2 h-4 w-4" />
              {familia.capaStoragePath ? 'Trocar foto' : 'Subir capa'}
            </Button>
            {familia.capaStoragePath && (
              <Button variant="ghost" size="sm" onClick={lidarRemoverCapa}>
                <Trash2 className="mr-2 h-4 w-4" />
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
      {familia.precoAbaixo20pc && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div>
            <div className="font-semibold text-destructive">
              Atenção: preço sugerido abaixo do mínimo aceitável
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              O preço sugerido pela estratégia <strong>{familia.estrategiaPreco}</strong> ficou
              mais de 20% abaixo do preço da sua planilha. Reveja antes de aprovar — pode estar
              vendendo no prejuízo.
            </div>
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="block text-xs font-semibold text-muted-foreground">TÍTULO</label>
            <StatusInline status={tituloStatus} />
          </div>
          <Input
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            onBlur={salvarTitulo}
          />

          <div className="mb-1 mt-3 flex items-center justify-between">
            <label className="block text-xs font-semibold text-muted-foreground">DESCRIÇÃO</label>
            <StatusInline status={descricaoStatus} />
          </div>
          <Textarea
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

          <div className="mt-4 flex items-center gap-2">
            <Badge variant={familia.estrategiaPreco === 'PROPRIO' ? 'outline' : 'secondary'}>
              {familia.estrategiaPreco}
            </Badge>
            <span className="text-xs text-muted-foreground">{familia.estrategiaMotivo}</span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Concorrência: <span className="font-medium">{familia.concorrencia}</span>
          </div>
        </div>

        <div>
          <label className="mb-2 block text-xs font-semibold text-muted-foreground">
            VARIAÇÕES ({variacoes.length})
          </label>
          <div className="flex flex-col gap-2">
            {variacoes.map((v) => (
              <VariacaoCard
                key={v.codigo}
                variacao={v}
                loteId={familia.loteId}
                statusPreco={precoStatuses[v.codigo]}
                statusCor={corStatuses[v.codigo]}
                onMudarPreco={mudarPreco}
                onMudarCor={mudarCor}
                onSalvarPreco={salvarPreco}
                onSalvarCor={salvarCor}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
