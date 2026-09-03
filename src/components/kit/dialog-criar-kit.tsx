// ADR-0151 D-2/D-4: gatilho de criação de kit vinculado a partir da tela Publicados.
// Etapa 1 escolhe os tamanhos; etapa 2 é o preview editável — a revisão inteira do kit,
// sem passar por process-familia nem por card na Revisão.
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { QK } from '@/lib/queries';
import { supabase } from '@/lib/supabase';
import { effectiveOrgId, useSupportStore } from '@/stores/support-store';
import { storageOwnerForUpload } from '@/hooks/useUploadLote';
import { uploadFile, buildStoragePath } from '@/lib/storage';
import {
  TAMANHOS_KIT, TITULO_MAX_KIT, tituloDoKit, descricaoDoKit, criarKitVinculado,
  type BaseParaKit, type KitFormValues,
} from '@/lib/kit';
import { PreviewKit, valorInicialPreview, type KitPreviewValue } from '@/components/kit/preview-kit';

const MENSAGEM_POR_MOTIVO: Record<string, string> = {
  base_multivariacao: 'Kit vinculado só existe para produto sem variação de cor.',
  base_sem_custo: 'Cadastre o custo do produto-base antes de criar kits (o custo do kit é derivado dele).',
  kit_duplicado: 'Já existe um kit desse tamanho para este produto.',
};

export function DialogCriarKit({ familiaBaseId, base, kitsExistentes, open, onOpenChange }: {
  familiaBaseId: string;
  base: BaseParaKit;
  kitsExistentes: number[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const [etapa, setEtapa] = useState<'tamanhos' | 'preview'>('tamanhos');
  const [marcados, setMarcados] = useState<Set<number>>(new Set());
  const [chaves, setChaves] = useState<Record<number, string>>({});
  const [valores, setValores] = useState<Record<number, KitPreviewValue>>({});

  // Reset ao abrir: chaves e valores novos por sessão de diálogo (as chaves só trocam
  // depois de sucesso confirmado, nunca durante a edição).
  useEffect(() => {
    if (!open) return;
    setEtapa('tamanhos');
    setMarcados(new Set());
    setChaves({});
    setValores({});
  }, [open]);

  function alternarTamanho(n: number, marcar: boolean) {
    setMarcados((prev) => {
      const novo = new Set(prev);
      if (marcar) novo.add(n); else novo.delete(n);
      return novo;
    });
    if (marcar) {
      setChaves((prev) => (prev[n] ? prev : { ...prev, [n]: crypto.randomUUID() }));
      setValores((prev) => (prev[n]
        ? prev
        : { ...prev, [n]: valorInicialPreview(base, tituloDoKit(base.titulo, n), descricaoDoKit(base.descricao, n), n) }));
    }
  }

  const tamanhosMarcados = TAMANHOS_KIT.filter((n) => marcados.has(n));

  const tituloInvalido = tamanhosMarcados.some((n) => (valores[n]?.titulo.length ?? 0) > TITULO_MAX_KIT);
  const precoInvalido = tamanhosMarcados.some((n) => !((valores[n]?.preco ?? 0) > 0));
  // Sem foto (nem a da base, nem uma nova escolhida) o anúncio vai ao ML sem capa — mesmo
  // requisito de LinhaVariacaoForm.fotoObrigatoria (ADR-0129 D-4).
  const semFotoInvalido = tamanhosMarcados.some((n) => !(valores[n]?.imagemPath || valores[n]?.fotoFile));
  const podeCriar = tamanhosMarcados.length > 0 && !tituloInvalido && !precoInvalido && !semFotoInvalido;

  const mutation = useMutation({
    mutationFn: async () => {
      const { data: ud } = await supabase.auth.getUser();
      const userId = ud.user?.id;
      const orgId = effectiveOrgId();
      if (!userId || !orgId) throw new Error('Sem sessão');
      const storageOwner = storageOwnerForUpload(userId, orgId, useSupportStore.getState().context?.scope ?? null);

      const kits: KitFormValues[] = await Promise.all(tamanhosMarcados.map(async (n) => {
        const v = valores[n];
        let imagemPath = v.imagemPath;
        if (v.fotoFile) {
          const path = buildStoragePath(storageOwner, `kit-${chaves[n]}`, v.fotoFile.name);
          await uploadFile('imagens', path, v.fotoFile);
          imagemPath = path;
        }
        return {
          multiplicador: n,
          chaveCadastro: chaves[n],
          titulo: v.titulo,
          descricao: v.descricao,
          preco: v.preco,
          gtin: v.gtin.trim() || null,
          imagemPath,
          alturaCm: v.alturaCm,
          larguraCm: v.larguraCm,
          comprimentoCm: v.comprimentoCm,
          atacado: v.atacado.length > 0 ? v.atacado : null,
        };
      }));

      return criarKitVinculado({ familiaBaseId, kits });
    },
    onSuccess: (r) => {
      if (!r.ok) {
        toast.error('Falha ao criar kit', {
          description: (r.motivo && MENSAGEM_POR_MOTIVO[r.motivo]) ?? r.mensagem ?? r.motivo ?? 'Motivo não informado.',
        });
        return;
      }
      // ADR-0151 (Task 6, fix I2): o kit foi criado, mas o encadeamento da publicação é uma
      // etapa separada — `publicacaoOk: false` não pode virar sucesso silencioso.
      if (r.publicacaoOk === false) {
        toast.warning(
          tamanhosMarcados.length > 1 ? 'Kits criados, mas a publicação não foi encadeada' : 'Kit criado, mas a publicação não foi encadeada',
          { description: 'O cadastro foi salvo. Tente novamente em instantes — a lista de kits vinculados mostra o status atual.' },
        );
      } else {
        toast.success(tamanhosMarcados.length > 1 ? 'Kits criados' : 'Kit criado');
      }
      qc.invalidateQueries({ queryKey: QK.publicados });
      qc.invalidateQueries({ queryKey: QK.kitsDoProduto(base.codigoPai) });
      qc.invalidateQueries({ queryKey: QK.produtosEstoqueResumo });
      qc.invalidateQueries({ queryKey: ['lotes'] });
      onOpenChange(false);
    },
    onError: (err) => {
      toast.error('Falha ao criar kit', {
        description: err instanceof Error ? err.message : String(err),
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !mutation.isPending && onOpenChange(v)}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Criar kit vinculado</DialogTitle>
          <DialogDescription>
            {etapa === 'tamanhos'
              ? 'Escolha os tamanhos de kit para este produto.'
              : 'Confira e ajuste cada kit antes de criar — é a revisão inteira, não passa por outra tela.'}
          </DialogDescription>
        </DialogHeader>

        {etapa === 'tamanhos' ? (
          <div className="flex flex-col gap-2">
            {TAMANHOS_KIT.map((n) => {
              const jaCriado = kitsExistentes.includes(n);
              return (
                <div key={n} className="flex items-center gap-2">
                  <Checkbox
                    id={`kit-tamanho-${n}`}
                    checked={marcados.has(n)}
                    disabled={jaCriado}
                    onCheckedChange={(v) => alternarTamanho(n, v === true)}
                    aria-label={`Kit de ${n} unidades`}
                  />
                  <label htmlFor={`kit-tamanho-${n}`} className="cursor-pointer select-none text-sm">
                    Kit de {n} unidades
                    {jaCriado && <span className="ml-2 text-xs text-muted-foreground">já criado</span>}
                  </label>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {tamanhosMarcados.map((n) => (
              <PreviewKit
                key={n}
                n={n}
                base={base}
                value={valores[n]}
                onChange={(patch) => setValores((prev) => ({ ...prev, [n]: { ...prev[n], ...patch } }))}
              />
            ))}
          </div>
        )}

        <DialogFooter>
          {etapa === 'tamanhos' ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button disabled={tamanhosMarcados.length === 0} onClick={() => setEtapa('preview')}>
                Avançar
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setEtapa('tamanhos')} disabled={mutation.isPending}>
                Voltar
              </Button>
              <Button disabled={!podeCriar || mutation.isPending} onClick={() => mutation.mutate()}>
                {mutation.isPending ? 'Criando…' : 'Criar kits'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
