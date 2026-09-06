// ADR-0154: diálogo de criação de Kit Virtual — combina 2 a 6 produtos DISTINTOS já publicados
// num anúncio novo do Mercado Livre. Fluxo em 2 etapas (mesmo padrão de dialog-criar-kit.tsx,
// ADR-0151): 'selecionar' (busca + composição + foto) e 'preview' (título/descrição/desconto/
// margem — é a revisão inteira, "Herdadas por precedente": não existe card na tela Revisão).
//
// Admin-only por convenção do precedente: o gate fica em quem embute o diálogo (Publicados.tsx),
// não aqui — ver dialog-criar-kit.tsx, que também não checa isAdmin internamente.
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { CampoFoto } from '@/components/estoque/campo-foto';
import { supabase } from '@/lib/supabase';
import { effectiveOrgId, useSupportStore } from '@/stores/support-store';
import { storageOwnerForUpload } from '@/hooks/useUploadLote';
import { uploadFile, buildStoragePath } from '@/lib/storage';
import { round2 } from '@/lib/formato';
import { QK } from '@/lib/queries';
import {
  buscarComponentesKitVirtual, previewKitVirtual, criarKitVirtualEdge, subirFotoKitVirtualEdge,
  pctParaFracaoDesconto,
  type ComponenteParaPreviewKit, type PreviewKitVirtualResultado,
  type ComponenteSelecionadoKitVirtual, type ComponenteCandidatoKitVirtual,
} from '@/lib/kit-virtual';
import { ListaComponentesKitVirtual } from '@/components/kit-virtual/lista-componentes-kit-virtual';
import { PreviewKitVirtual } from '@/components/kit-virtual/preview-kit-virtual';

export function DialogCriarKitVirtual({ open, onOpenChange }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const [etapa, setEtapa] = useState<'selecionar' | 'preview'>('selecionar');
  const [chaveCadastro, setChaveCadastro] = useState('');

  const [searchText, setSearchText] = useState('');
  const [searchTextAplicado, setSearchTextAplicado] = useState('');
  const [selecionados, setSelecionados] = useState<ComponenteSelecionadoKitVirtual[]>([]);

  const [fotoFile, setFotoFile] = useState<File | null>(null);
  const [fotoStoragePath, setFotoStoragePath] = useState<string | null>(null);
  const [fotoMlPictureId, setFotoMlPictureId] = useState<string | null>(null);
  const [uploadingFoto, setUploadingFoto] = useState(false);

  const [descontoPct, setDescontoPct] = useState(0);
  const [titulo, setTitulo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [descricaoGeradaPorIA, setDescricaoGeradaPorIA] = useState(false);
  const [previewResultado, setPreviewResultado] = useState<PreviewKitVirtualResultado | null>(null);

  const tituloInicializadoRef = useRef(false);
  const primeiraPreviewFeitaRef = useRef(false);

  // Reset ao abrir — mesmo padrão de dialog-criar-kit.tsx: chave nova por sessão de diálogo.
  useEffect(() => {
    if (!open) return;
    setEtapa('selecionar');
    setChaveCadastro(crypto.randomUUID());
    setSearchText('');
    setSearchTextAplicado('');
    setSelecionados([]);
    setFotoFile(null);
    setFotoStoragePath(null);
    setFotoMlPictureId(null);
    setUploadingFoto(false);
    setDescontoPct(0);
    setTitulo('');
    setDescricao('');
    setDescricaoGeradaPorIA(false);
    setPreviewResultado(null);
    tituloInicializadoRef.current = false;
    primeiraPreviewFeitaRef.current = false;
  }, [open]);

  const buscaQuery = useQuery({
    queryKey: ['kit-virtual-busca-componentes', searchTextAplicado],
    queryFn: () => buscarComponentesKitVirtual(searchTextAplicado || undefined),
    enabled: open,
  });

  // ── Composição ────────────────────────────────────────────────────────────────────────
  function adicionar(c: ComponenteCandidatoKitVirtual) {
    setSelecionados((prev) => {
      if (prev.length >= 6 || prev.some((s) => s.candidato.userProductId === c.userProductId)) return prev;
      // Preço vem da própria edge (lido do ML, service_role/org-scoped); sem ele o campo nasce
      // zerado e editável — nunca um default silencioso (o operador confirma antes de avançar).
      return [...prev, { candidato: c, quantidade: 1, precoAtualML: c.precoAtualML ?? 0 }];
    });
  }
  function remover(userProductId: string) {
    setSelecionados((prev) => prev.filter((s) => s.candidato.userProductId !== userProductId));
  }
  function alterarQuantidade(userProductId: string, quantidade: number) {
    const q = Math.min(10, Math.max(1, Math.round(quantidade) || 1));
    setSelecionados((prev) => prev.map((s) => (s.candidato.userProductId === userProductId ? { ...s, quantidade: q } : s)));
  }
  function alterarPreco(userProductId: string, preco: number) {
    const p = Number.isFinite(preco) && preco >= 0 ? preco : 0;
    setSelecionados((prev) => prev.map((s) => (s.candidato.userProductId === userProductId ? { ...s, precoAtualML: p } : s)));
  }
  function tornarPrincipal(userProductId: string) {
    setSelecionados((prev) => {
      const idx = prev.findIndex((s) => s.candidato.userProductId === userProductId);
      if (idx <= 0) return prev;
      const novo = [...prev];
      const [item] = novo.splice(idx, 1);
      novo.unshift(item);
      return novo;
    });
  }

  async function handleEscolherFoto(file: File | null) {
    setFotoFile(file);
    setFotoStoragePath(null);
    setFotoMlPictureId(null);
    if (!file) return;
    setUploadingFoto(true);
    try {
      const { data: ud } = await supabase.auth.getUser();
      const userId = ud.user?.id;
      const orgId = effectiveOrgId();
      if (!userId || !orgId) throw new Error('Sem sessão');
      const storageOwner = storageOwnerForUpload(userId, orgId, useSupportStore.getState().context?.scope ?? null);
      const path = buildStoragePath(storageOwner, `kit-virtual-${chaveCadastro}`, file.name);
      await uploadFile('imagens', path, file);
      setFotoStoragePath(path);
    } catch (e) {
      toast.error('Falha ao enviar a foto do kit', { description: e instanceof Error ? e.message : String(e) });
      setFotoFile(null);
    } finally {
      setUploadingFoto(false);
    }
  }

  // ADR-0154 D-5/ADR-0033: sobe a foto ao ML assim que ela assenta no Storage, não no publicar —
  // a propagação é assíncrona. Best-effort: falha aqui NÃO trava o diálogo, `criar-kit-virtual`
  // reusa o `foto_storage_path` e faz o upload no publicar (rede de segurança, comportamento
  // anterior a este gap).
  useEffect(() => {
    if (!fotoStoragePath) return;
    let cancelado = false;
    subirFotoKitVirtualEdge(fotoStoragePath).then((r) => {
      if (cancelado) return;
      if (r.ok) setFotoMlPictureId(r.pictureId);
      else console.warn('kit_virtual_subir_foto_ml_falhou', r.mensagem);
    });
    return () => { cancelado = true; };
  }, [fotoStoragePath]);

  const principal = selecionados[0] ?? null;
  // categoria_ml_id vem direto do candidato (a própria edge já leu do ML) — sem ele, o produto
  // não pode liderar a composição, porque preview-kit-virtual exige categoria_ml_id do principal.
  const categoriaMlIdPrincipal = principal?.candidato.categoriaMlId ?? null;
  const avisoKitVinculado = selecionados.some((s) => s.candidato.kitMultiplicador != null);

  const quantidadesValidas = selecionados.every((s) => s.quantidade >= 1 && s.quantidade <= 10);
  const precosValidos = selecionados.every((s) => s.precoAtualML > 0);
  const composicaoValida = selecionados.length >= 2 && selecionados.length <= 6 && quantidadesValidas;
  const fotoValida = !!fotoStoragePath && !uploadingFoto;
  // A foto NÃO trava o avanço pra etapa de preview (ela é escolhida nesta mesma etapa, mas o
  // gate fica só no botão final) — Decisão 5 exige foto pra PUBLICAR, não pra revisar o preview.
  const podeAvancar = composicaoValida && precosValidos && !!categoriaMlIdPrincipal;

  function componentesParaPreview(): ComponenteParaPreviewKit[] {
    return selecionados.map((s, i) => ({
      ordem: i,
      userProductId: s.candidato.userProductId,
      quantidade: s.quantidade,
      precoAtualML: s.precoAtualML,
      custo: s.candidato.custo,
      origem: s.candidato.origem,
      titulo: s.candidato.title,
      kitMultiplicador: s.candidato.kitMultiplicador,
    }));
  }

  const previewMutation = useMutation({
    mutationFn: (gerarDescricao: boolean) => previewKitVirtual({
      componentes: componentesParaPreview(),
      descontoPct: pctParaFracaoDesconto(descontoPct),
      categoriaMlIdPrincipal: categoriaMlIdPrincipal!,
      gerarDescricao,
    }),
    onSuccess: (r, gerarDescricao) => {
      setPreviewResultado(r);
      // Decisão 4: descrição por IA só quando pedida — uma resposta com gerar_descricao=false
      // sempre traz `descricao: null` e NÃO pode apagar o texto que o operador já gerou/editou.
      if (gerarDescricao) {
        setDescricao(r.descricao ?? '');
        setDescricaoGeradaPorIA(true);
      }
      // Título nasce do template do servidor (Decisão 4) uma única vez — recálculo por causa
      // do desconto reenvia o MESMO template (a composição não muda nesta etapa), então
      // sobrescrever aqui apagaria uma edição manual do operador.
      if (!tituloInicializadoRef.current) {
        setTitulo(r.titulo);
        tituloInicializadoRef.current = true;
      }
    },
    onError: (err) => {
      toast.error('Falha ao calcular o preview do kit', { description: err instanceof Error ? err.message : String(err) });
    },
  });

  // Preview automático ao entrar na etapa + a cada ajuste de desconto (debounced) — nunca a
  // descrição por IA, que é ação explícita do operador (botão em PreviewKitVirtual).
  useEffect(() => {
    if (etapa !== 'preview') return;
    const atraso = primeiraPreviewFeitaRef.current ? 500 : 0;
    const t = setTimeout(() => {
      previewMutation.mutate(false);
      primeiraPreviewFeitaRef.current = true;
    }, atraso);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [etapa, descontoPct]);

  const criarMutation = useMutation({
    mutationFn: () => criarKitVirtualEdge({
      chaveCadastro,
      titulo,
      descricao: descricao.trim() || null,
      fotoStoragePath,
      fotoMlPictureId,
      componentes: selecionados.map((s) => ({
        userProductId: s.candidato.userProductId,
        quantidade: s.quantidade,
        descontoPct: pctParaFracaoDesconto(descontoPct),
        itemExternoId: s.candidato.itemId,
        codigo: s.candidato.codigo,
        codigoPai: s.candidato.codigoPai,
      })),
    }),
    onSuccess: (r) => {
      if (!r.ok) {
        toast.error('Falha ao criar kit', { description: r.mensagem ?? r.motivo ?? 'Motivo não informado.' });
        return;
      }
      toast.success(r.jaExistia ? 'Kit já publicado — reenvio sem alterações' : 'Kit criado e publicado no Mercado Livre');
      qc.invalidateQueries({ queryKey: QK.publicados });
      onOpenChange(false);
    },
    onError: (err) => {
      toast.error('Falha ao criar kit', { description: err instanceof Error ? err.message : String(err) });
    },
  });

  const somaComponentes = selecionados.reduce((t, s) => t + s.precoAtualML * s.quantidade, 0);
  const precoEstimado = round2(somaComponentes * (1 - descontoPct / 100));
  const podePublicar = composicaoValida && precosValidos && fotoValida && !!categoriaMlIdPrincipal
    && titulo.trim().length > 0 && !criarMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(v) => !criarMutation.isPending && onOpenChange(v)}>
      <DialogContent className="max-h-[85vh] w-full max-w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Criar Kit Virtual</DialogTitle>
          <DialogDescription>
            {etapa === 'selecionar'
              ? 'Escolha de 2 a 6 produtos distintos, defina quantidades e a foto do kit.'
              : 'Confira e ajuste o kit antes de publicar — é a revisão inteira, não passa por outra tela.'}
          </DialogDescription>
        </DialogHeader>

        {etapa === 'selecionar' ? (
          <div className="flex flex-col gap-4">
            <ListaComponentesKitVirtual
              searchText={searchText}
              onSearchTextChange={setSearchText}
              onBuscar={() => setSearchTextAplicado(searchText.trim())}
              carregando={buscaQuery.isFetching}
              erro={buscaQuery.error instanceof Error ? buscaQuery.error.message : null}
              elegiveis={buscaQuery.data?.elegiveis ?? []}
              inelegiveis={buscaQuery.data?.inelegiveis ?? []}
              selecionados={selecionados}
              onAdicionar={adicionar}
              onRemover={remover}
              onAlterarQuantidade={alterarQuantidade}
              onAlterarPreco={alterarPreco}
              onTornarPrincipal={tornarPrincipal}
            />

            {avisoKitVinculado && (
              <div role="status" className="rounded-md border border-warning/30 bg-warning/10 p-2 text-xs text-warning">
                Um dos componentes é um kit vinculado (ADR-0151) — a cadeia de estoque tem três
                níveis (produto-base → kit vinculado → este kit virtual).
              </div>
            )}

            {principal && !categoriaMlIdPrincipal && (
              <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
                &quot;{principal.candidato.title}&quot; não pode ser o principal — o Mercado Livre não
                devolveu a categoria dele. Torne outro item principal ou remova este.
              </div>
            )}

            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium text-foreground">Foto do kit<span className="text-destructive"> *</span></span>
              <CampoFoto
                id="kv-foto"
                ariaLabel="Foto do kit"
                arquivo={fotoFile}
                enviada={!!fotoStoragePath}
                opcional={false}
                onEscolher={handleEscolherFoto}
                onTrocar={() => { setFotoFile(null); setFotoStoragePath(null); }}
              />
              {uploadingFoto && <span className="text-xs text-muted-foreground">Enviando foto…</span>}
              {!fotoFile && (
                <span className="text-xs text-muted-foreground">
                  Obrigatória (ADR-0154 D-5) — o kit não publica com a foto de um componente.
                </span>
              )}
            </div>
          </div>
        ) : (
          <PreviewKitVirtual
            componentes={selecionados}
            titulo={titulo}
            onTituloChange={setTitulo}
            descricao={descricao}
            onDescricaoChange={setDescricao}
            onGerarDescricao={() => previewMutation.mutate(true)}
            gerandoDescricao={previewMutation.isPending && previewMutation.variables === true}
            descricaoGeradaPorIA={descricaoGeradaPorIA}
            descontoPct={descontoPct}
            onDescontoPctChange={setDescontoPct}
            precoEstimado={precoEstimado}
            resultado={previewResultado}
            carregando={previewMutation.isPending && !previewResultado}
            avisoKitVinculado={avisoKitVinculado}
          />
        )}

        <DialogFooter>
          {etapa === 'selecionar' ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button disabled={!podeAvancar} onClick={() => setEtapa('preview')}>Avançar</Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setEtapa('selecionar')} disabled={criarMutation.isPending}>
                Voltar
              </Button>
              <Button disabled={!podePublicar} onClick={() => criarMutation.mutate()}>
                {criarMutation.isPending ? 'Publicando…' : 'Publicar kit'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
