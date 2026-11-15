// ADR-0154 + ADR-0206: diálogo de criação de Kit Virtual — combina 2 a 6 produtos DISTINTOS já
// publicados num anúncio novo do Mercado Livre. Duas etapas (mesmo visual de dialog-criar-kit.tsx):
// "1. Composição" (busca + composição) e "2. Anúncio" (capa por IA ou upload, título/descrição
// gerados por IA, desconto/margem e "você recebe vendendo avulso") — é a revisão inteira, não
// existe card na tela Revisão.
//
// Admin-only por convenção do precedente: o gate fica em quem embute o diálogo (Publicados.tsx),
// não aqui — ver dialog-criar-kit.tsx, que também não checa isAdmin internamente.
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Sparkles } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { CampoFoto } from '@/components/estoque/campo-foto';
import { EtapasKit } from '@/components/kit/etapas-kit';
import { supabase } from '@/lib/supabase';
import { effectiveOrgId, useSupportStore } from '@/stores/support-store';
import { storageOwnerForUpload } from '@/hooks/useUploadLote';
import { useModulosHabilitados } from '@/hooks/useModulosHabilitados';
import { uploadFile, buildStoragePath } from '@/lib/storage';
import { round2 } from '@/lib/formato';
import { QK } from '@/lib/queries';
import {
  buscarComponentesKitVirtual, previewKitVirtual, criarKitVirtualEdge, subirFotoKitVirtualEdge,
  pctParaFracaoDesconto,
  type PreviewKitVirtualResultado,
  type ComponenteSelecionadoKitVirtual, type ComponenteCandidatoKitVirtual,
  type KitVirtualParaRefazer,
} from '@/lib/kit-virtual';
import { corrigirRotuloQuantidade } from '../../../supabase/functions/_shared/ai/unidade.ts';
import { ListaComponentesKitVirtual } from '@/components/kit-virtual/lista-componentes-kit-virtual';
import { PreviewKitVirtual } from '@/components/kit-virtual/preview-kit-virtual';
import { GerarCapaKitVirtual, useCapaKitVirtual } from '@/components/kit-virtual/gerar-capa-kit-virtual';
import { RecebeAvulsoKitVirtual } from '@/components/kit-virtual/recebe-avulso-kit-virtual';

type Etapa = 'selecionar' | 'preview';
const ETAPAS = [{ id: 'selecionar', rotulo: 'Composição' }, { id: 'preview', rotulo: 'Anúncio' }] as const;

/** Produtos + quantidades sem ordem (mesmo critério do hook da capa): mudou → capa zerada. */
const assinaturaCapa = (s: ComponenteSelecionadoKitVirtual[]) =>
  s.map((c) => `${c.candidato.userProductId}:${c.quantidade}`).sort().join('|');
/** Produtos + quantidades NA ORDEM: o título da edge segue a `ordem` (principal primeiro). */
const assinaturaTextoDe = (s: ComponenteSelecionadoKitVirtual[]) =>
  s.map((c) => `${c.candidato.userProductId}:${c.quantidade}`).join('|');

type PedidoPreview = { gerarTexto: boolean; assinaturaTexto: string; assinaturaMargem: string; seq: number };

export function DialogCriarKitVirtual({ open, onOpenChange, refazerDe }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** ADR-0154 D-8: presente só no fluxo de "Refazer kit" (Publicados.tsx) — o diálogo abre já
   *  com a composição/título/descrição/desconto/foto do kit encerrado, em vez de em branco (a
   *  alternativa que o Decisão 8 registra como rejeitada). Ausente = comportamento de sempre,
   *  sem mudança nenhuma. O listing type NÃO é pré-preenchido: a edge o deriva dos componentes
   *  a cada CREATE, senão trocar um componente no Refazer volta a dar `listing_type_mismatch`. */
  refazerDe?: KitVirtualParaRefazer;
}) {
  const qc = useQueryClient();
  const [etapa, setEtapa] = useState<Etapa>('selecionar');
  const [chaveCadastro, setChaveCadastro] = useState('');

  const [searchText, setSearchText] = useState('');
  const [searchTextAplicado, setSearchTextAplicado] = useState('');
  const [selecionados, setSelecionados] = useState<ComponenteSelecionadoKitVirtual[]>([]);

  const [fotoFile, setFotoFile] = useState<File | null>(null);
  const [fotoStoragePath, setFotoStoragePath] = useState<string | null>(null);
  const [fotoMlPictureId, setFotoMlPictureId] = useState<string | null>(null);
  /** Prévia da capa por IA escolhida (upload manual mostra a miniatura do próprio arquivo). */
  const [fotoUrlIA, setFotoUrlIA] = useState<string | null>(null);
  const [uploadingFoto, setUploadingFoto] = useState(false);

  const [descontoPct, setDescontoPct] = useState(0);
  const [titulo, setTitulo] = useState('');
  const [descricao, setDescricao] = useState('');
  /** Último texto entregue pela IA (ou herdado no Refazer): diferente dele = editado à mão. */
  const [textoBase, setTextoBase] = useState({ titulo: '', descricao: '' });
  const [tituloPadrao, setTituloPadrao] = useState(false);
  const [gerandoTexto, setGerandoTexto] = useState(false);
  const [previewResultado, setPreviewResultado] = useState<PreviewKitVirtualResultado | null>(null);

  // Assinaturas: a do texto pedido decide geração automática; a da capa (sem ordem) decide o
  // reset da foto; a da margem (ordem + preços + desconto) decide recálculo. As "atuais" filtram
  // respostas que chegam tarde.
  const assinaturaTexto = assinaturaTextoDe(selecionados);
  const assinaturaMargem = `${selecionados.map((s) => `${s.candidato.userProductId}:${s.quantidade}:${s.precoAtualML}`).join('|')}#${descontoPct}`;
  const textoPedidoRef = useRef<string | null>(null);
  /** Composição da foto atual — nunca limpa em erro de texto (senão a reentrada perderia a capa). */
  const capaComposicaoRef = useRef<string | null>(null);
  const margemPedidaRef = useRef<string | null>(null);
  const assinaturaTextoAtual = useRef(assinaturaTexto);
  const assinaturaMargemAtual = useRef(assinaturaMargem);
  assinaturaTextoAtual.current = assinaturaTexto;
  assinaturaMargemAtual.current = assinaturaMargem;
  const textoSeq = useRef(0);
  /** Cada troca de foto incrementa: upload ao Storage que termina depois de outra troca é ignorado. */
  const fotoSeq = useRef(0);

  // Reset ao abrir — mesmo padrão de dialog-criar-kit.tsx: chave nova por sessão de diálogo.
  // `refazerDe` (ADR-0154 D-8) troca o branco de sempre pela composição/título/descrição/
  // desconto/foto do kit que acabou de ser encerrado — e conta como texto já gerado para essa
  // composição (sem geração automática ao entrar na etapa 2).
  useEffect(() => {
    if (!open) return;
    setEtapa('selecionar');
    setChaveCadastro(crypto.randomUUID());
    setSearchText('');
    setSearchTextAplicado('');
    setUploadingFoto(false);
    setFotoFile(null);
    setFotoUrlIA(null);
    setPreviewResultado(null);
    setTituloPadrao(false);
    setGerandoTexto(false);
    fotoSeq.current++;
    margemPedidaRef.current = null;

    if (refazerDe) {
      const desc = corrigirRotuloQuantidade(refazerDe.descricao ?? '');
      setSelecionados(refazerDe.componentes);
      setFotoStoragePath(refazerDe.fotoStoragePath);
      setFotoMlPictureId(refazerDe.fotoMlPictureId);
      setDescontoPct(refazerDe.descontoPct);
      setTitulo(refazerDe.titulo);
      setDescricao(desc);
      setTextoBase({ titulo: refazerDe.titulo, descricao: desc });
      textoPedidoRef.current = assinaturaTextoDe(refazerDe.componentes);
      capaComposicaoRef.current = assinaturaCapa(refazerDe.componentes);
    } else {
      setSelecionados([]);
      setFotoStoragePath(null);
      setFotoMlPictureId(null);
      setDescontoPct(0);
      setTitulo('');
      setDescricao('');
      setTextoBase({ titulo: '', descricao: '' });
      textoPedidoRef.current = null;
      capaComposicaoRef.current = null;
    }
    // refazerDe só é lido nesta abertura (chave nova de diálogo); incluí-lo nas deps re-rodaria
    // o reset a cada render do pai que passe um objeto inline novo, apagando edição em curso.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // ── Capa ──────────────────────────────────────────────────────────────────────────────
  // O hook fica aqui (não na etapa 2): voltar à etapa 1 não pode perder a candidata nem o request_id.
  const componentesCapa = selecionados.map((s) => ({
    userProductId: s.candidato.userProductId, itemId: s.candidato.itemId ?? '', quantidade: s.quantidade, rotulo: s.candidato.title,
  }));
  const capa = useCapaKitVirtual(componentesCapa, open);
  const capaHabilitada = selecionados.length > 0 && selecionados.every((s) => !!s.candidato.itemId);
  const { data: modulos } = useModulosHabilitados();
  const capaIADisponivel = capaHabilitada && !!modulos?.includes('imagem_ia');

  /** Toda troca de capa zera arquivo, path e picture id JUNTOS — picture id velho nunca viaja com foto nova. */
  function trocarFoto(path: string | null, file: File | null, urlIA: string | null = null) {
    fotoSeq.current++;
    setFotoFile(file);
    setFotoStoragePath(path);
    setFotoMlPictureId(null);
    setFotoUrlIA(urlIA);
    setUploadingFoto(false);
  }

  async function handleEscolherFoto(file: File | null) {
    trocarFoto(null, file);
    if (!file) return;
    capa.descartar(); // arquivo manual vence a candidata da IA
    const seq = fotoSeq.current;
    setUploadingFoto(true);
    try {
      const { data: ud } = await supabase.auth.getUser();
      const userId = ud.user?.id;
      const orgId = effectiveOrgId();
      if (!userId || !orgId) throw new Error('Sem sessão');
      const storageOwner = storageOwnerForUpload(userId, orgId, useSupportStore.getState().context?.scope ?? null);
      const path = buildStoragePath(storageOwner, `kit-virtual-${chaveCadastro}`, file.name);
      await uploadFile('imagens', path, file);
      if (seq !== fotoSeq.current) return;
      setFotoStoragePath(path);
    } catch (e) {
      if (seq !== fotoSeq.current) return;
      toast.error('Falha ao enviar a foto do kit', { description: e instanceof Error ? e.message : String(e) });
      setFotoFile(null);
    } finally {
      if (seq === fotoSeq.current) setUploadingFoto(false);
    }
  }

  function usarCapaIA(path: string) {
    trocarFoto(path, null, capa.estado.fase === 'candidata' ? capa.estado.url : null);
  }

  // ADR-0154 D-5/ADR-0033: sobe a foto ao ML assim que ela assenta no Storage, não no publicar —
  // a propagação é assíncrona. Best-effort: falha aqui NÃO trava o diálogo, `criar-kit-virtual`
  // reusa o `foto_storage_path` e faz o upload no publicar (rede de segurança).
  //
  // `fotoMlPictureId` truthy já bloqueia: cobre o Refazer (ADR-0154 regra 3) — o path reusado
  // chega junto com o picture id antigo e reenviar a mesma imagem só atrasaria a propagação.
  // Toda troca de foto zera o picture id (`trocarFoto`), e o cleanup descarta a resposta da
  // subida da foto anterior.
  useEffect(() => {
    if (!fotoStoragePath || fotoMlPictureId) return;
    let cancelado = false;
    subirFotoKitVirtualEdge(fotoStoragePath).then((r) => {
      if (cancelado) return;
      if (r.ok) setFotoMlPictureId(r.pictureId);
      else console.warn('kit_virtual_subir_foto_ml_falhou', r.mensagem);
    });
    return () => { cancelado = true; };
  }, [fotoStoragePath, fotoMlPictureId]);

  const principal = selecionados[0] ?? null;
  // categoria_ml_id vem direto do candidato (a própria edge já leu do ML) — sem ele, o produto
  // não pode liderar a composição, porque preview-kit-virtual exige categoria_ml_id do principal.
  const categoriaMlIdPrincipal = principal?.candidato.categoriaMlId ?? null;
  const avisoKitVinculado = selecionados.some((s) => s.candidato.kitMultiplicador != null);

  const quantidadesValidas = selecionados.every((s) => s.quantidade >= 1 && s.quantidade <= 10);
  const precosValidos = selecionados.every((s) => s.precoAtualML > 0);
  const composicaoValida = selecionados.length >= 2 && selecionados.length <= 6 && quantidadesValidas;
  const fotoValida = !!fotoStoragePath && !uploadingFoto;
  // A foto NÃO trava o avanço (ela é escolhida na etapa 2); Decisão 5 exige foto só pra PUBLICAR.
  const podeAvancar = composicaoValida && precosValidos && !!categoriaMlIdPrincipal;

  // ── Preview (texto IA + margem) ───────────────────────────────────────────────────────
  const previewMutation = useMutation({
    mutationFn: (p: PedidoPreview & { input: Parameters<typeof previewKitVirtual>[0] }) => previewKitVirtual(p.input),
    // Roda para TODA execução (TanStack v5): cada resposta é filtrada pela assinatura do próprio pedido.
    onSuccess: (r, p) => {
      if (p.assinaturaMargem === assinaturaMargemAtual.current) setPreviewResultado(r);
      // Só um pedido de texto mexe em título/descrição; recálculo de desconto nunca sobrescreve.
      if (p.gerarTexto && p.assinaturaTexto === assinaturaTextoAtual.current) {
        const desc = r.descricao ?? '';
        setTitulo(r.titulo);
        setDescricao(desc);
        setTextoBase({ titulo: r.titulo, descricao: desc });
        setTituloPadrao(!r.tituloGeradoPorIA);
      }
    },
    onError: (err, p) => {
      // Texto que falhou NÃO volta a ser gerado sozinho (sobrescreveria o que o operador escreveu):
      // o retry é o "Regerar", que confirma se houver edição. A margem tenta de novo no próximo ajuste.
      if (margemPedidaRef.current === p.assinaturaMargem) margemPedidaRef.current = null;
      toast.error('Falha ao calcular o preview do kit', { description: err instanceof Error ? err.message : String(err) });
    },
    onSettled: (_r, _e, p) => {
      if (p.gerarTexto && p.seq === textoSeq.current) setGerandoTexto(false);
    },
  });

  function pedirPreview(gerarTexto: boolean) {
    margemPedidaRef.current = assinaturaMargem;
    if (gerarTexto) {
      textoPedidoRef.current = assinaturaTexto; // vale também para o Regerar
      setGerandoTexto(true);
    }
    previewMutation.mutate({
      gerarTexto, assinaturaTexto, assinaturaMargem, seq: gerarTexto ? ++textoSeq.current : textoSeq.current,
      input: {
        componentes: selecionados.map((s, i) => ({
          ordem: i,
          userProductId: s.candidato.userProductId,
          quantidade: s.quantidade,
          precoAtualML: s.precoAtualML,
          custo: s.candidato.custo,
          origem: s.candidato.origem,
          titulo: s.candidato.title,
          kitMultiplicador: s.candidato.kitMultiplicador,
        })),
        descontoPct: pctParaFracaoDesconto(descontoPct),
        categoriaMlIdPrincipal: categoriaMlIdPrincipal!,
        gerarDescricao: gerarTexto,
      },
    });
  }

  // Entrar na etapa 2: produtos/qtd mudaram → capa zerada; composição ou ordem mudou → texto IA
  // (título + descrição, já com a margem); só preço mudou → só a margem; nada → nenhuma chamada.
  useEffect(() => {
    if (etapa !== 'preview') return;
    const capaAtual = assinaturaCapa(selecionados);
    if (capaAtual !== capaComposicaoRef.current) {
      capaComposicaoRef.current = capaAtual;
      trocarFoto(null, null);
    }
    if (assinaturaTexto !== textoPedidoRef.current) {
      // Texto da composição anterior não pode sobreviver a uma falha da IA (publicaria título errado).
      setTitulo('');
      setDescricao('');
      setTextoBase({ titulo: '', descricao: '' });
      setTituloPadrao(false);
      setPreviewResultado(null);
      pedirPreview(true);
    } else if (assinaturaMargem !== margemPedidaRef.current) {
      setPreviewResultado(null);
      pedirPreview(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [etapa]);

  // Ajuste de desconto na etapa 2: só margem, debounced.
  useEffect(() => {
    if (etapa !== 'preview' || assinaturaMargem === margemPedidaRef.current) return;
    const t = setTimeout(() => pedirPreview(false), 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [descontoPct]);

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
    && titulo.trim().length > 0 && !gerandoTexto && !criarMutation.isPending;

  const secaoCapa = (
    <div className="flex flex-col gap-3">
      <GerarCapaKitVirtual
        estado={capa.estado}
        itens={componentesCapa.map(({ rotulo, quantidade }) => ({ rotulo, quantidade }))}
        onGerar={capa.gerar} onUsar={usarCapaIA} onDescartar={capa.descartar}
        habilitado={capaHabilitada}
      />
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">
          {capaIADisponivel ? 'Ou envie uma foto' : 'Foto do kit'}<span className="text-destructive"> *</span>
        </span>
        {fotoUrlIA && fotoStoragePath ? (
          <div className="flex h-20 items-center gap-2 rounded-md border border-primary/20 bg-primary/5 p-2">
            <img src={fotoUrlIA} alt="Capa do kit escolhida" className="size-14 shrink-0 rounded-md bg-background object-contain ring-1 ring-border" />
            <span className="flex flex-1 items-center gap-1 text-xs text-success">
              <Sparkles aria-hidden className="size-3" /> capa gerada por IA em uso
            </span>
            <Button type="button" variant="ghost" size="sm" className="h-6 shrink-0 px-1.5 text-xs" onClick={() => trocarFoto(null, null)}>
              Trocar
            </Button>
          </div>
        ) : (
          <CampoFoto
            id="kv-foto"
            ariaLabel="Foto do kit"
            arquivo={fotoFile}
            enviada={!!fotoStoragePath}
            opcional={false}
            onEscolher={handleEscolherFoto}
            onTrocar={() => trocarFoto(null, null)}
          />
        )}
        {uploadingFoto && <span className="text-xs text-muted-foreground">Enviando foto…</span>}
        {!fotoStoragePath && !uploadingFoto && (
          <span className="text-xs text-muted-foreground">
            Obrigatória (ADR-0154 D-5) — o kit não publica com a foto de um componente.
          </span>
        )}
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(v) => !criarMutation.isPending && onOpenChange(v)}>
      <DialogContent
        processando={criarMutation.isPending}
        rotuloProcessando="Publicando kit virtual"
        className="flex max-h-[85vh] w-full max-w-[calc(100vw-2rem)] flex-col p-0 sm:max-w-4xl"
      >
        {/* Rolagem num filho: no próprio Content o raio da borda (processando) rolaria junto. */}
        <div className="grid min-h-0 gap-4 overflow-y-auto p-4">
        <DialogHeader>
          <DialogTitle>Criar Kit Virtual</DialogTitle>
          <DialogDescription>
            {etapa === 'selecionar'
              ? 'Escolha de 2 a 6 produtos distintos e defina as quantidades.'
              : 'Confira e ajuste o kit antes de publicar — é a revisão inteira, não passa por outra tela.'}
          </DialogDescription>
        </DialogHeader>

        <EtapasKit atual={etapa} etapas={ETAPAS} />

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
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <PreviewKitVirtual
              capa={secaoCapa}
              componentes={selecionados}
              titulo={titulo}
              onTituloChange={setTitulo}
              descricao={descricao}
              onDescricaoChange={setDescricao}
              onRegerar={() => pedirPreview(true)}
              regerando={gerandoTexto}
              textoEditado={titulo !== textoBase.titulo || descricao !== textoBase.descricao}
              tituloPadrao={tituloPadrao}
              descontoPct={descontoPct}
              onDescontoPctChange={setDescontoPct}
              precoEstimado={precoEstimado}
              resultado={previewResultado}
              carregando={previewMutation.isPending && !previewResultado}
              avisoKitVinculado={avisoKitVinculado}
            />
            <RecebeAvulsoKitVirtual
              componentes={selecionados}
              liquidoKit={previewResultado?.margem.ok ? previewResultado.margem.liquido : null}
            />
            <p className="text-xs text-muted-foreground">O kit vai direto para o Mercado Livre — esta tela é a revisão.</p>
          </div>
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
