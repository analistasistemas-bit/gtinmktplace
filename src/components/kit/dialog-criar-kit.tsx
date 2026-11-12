// ADR-0151 D-2/D-4: gatilho de criação de kit vinculado a partir da tela Publicados.
// Etapa 1 escolhe os tamanhos; etapa 2 é o preview editável — a revisão inteira do kit,
// sem passar por process-familia nem por card na Revisão.
import { useCallback, useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { QK, buscarCategoriaML, type KitVinculado } from '@/lib/queries';
import { useCaminhoCategoria } from '@/hooks/useCaminhoCategoria';
import type { CategoriaCandidata } from '@/lib/tipos-dominio';
import { supabase } from '@/lib/supabase';
import { effectiveOrgId, useSupportStore } from '@/stores/support-store';
import { storageOwnerForUpload } from '@/hooks/useUploadLote';
import { uploadFile, buildStoragePath } from '@/lib/storage';
import { publicarFamilias } from '@/lib/publicar';
import { cn } from '@/lib/utils';
import {
  TAMANHOS_KIT, TITULO_MAX_KIT, tituloDoKit, descricaoDoKit, criarKitVinculado,
  type BaseParaKit, type KitFormValues,
} from '@/lib/kit';
import { EtapasKit } from '@/components/kit/etapas-kit';
import { PromocaoBaseKit } from '@/components/kit/promocao-base-kit';
import { GaleriaBaseKit } from '@/components/kit/galeria-base-kit';
import { useGaleriaBaseKit } from '@/hooks/useGaleriaBaseKit';
import { idsDaGaleria, type EscolhaGaleria, type GaleriaProposta } from '@/lib/kit-galeria';
import { GerarCapaUnidades, useCapasUnidades } from '@/components/kit/gerar-capa-unidades';
import { PreviewKit, valorInicialPreview, type KitPreviewValue } from '@/components/kit/preview-kit';

// Base fora do ML: sem leitura (a edge não é chamada); só a nota de que o kit leva a capa.
const BASE_NAO_PUBLICADA: GaleriaProposta = { fotos: [], avisos: ['base_nao_publicada'], indisponivel: false };

const MENSAGEM_POR_MOTIVO: Record<string, string> = {
  base_multivariacao: 'Kit vinculado só existe para produto sem variação de cor.',
  base_sem_custo: 'Cadastre o custo do produto-base antes de criar kits (o custo do kit é derivado dele).',
  kit_duplicado: 'Já existe um kit desse tamanho para este produto.',
};

/**
 * Categoria com o caminho inteiro do ML (`Bebês › Alimentação › Leite em Pó`). O caminho chega
 * por rede e é decoração: enquanto não chega — ou se falhar — mostra só o nome da categoria,
 * que já veio do banco/da busca. A folha fica em nó próprio para continuar clicável/legível.
 */
function CaminhoCategoria({ categoriaId, nome }: { categoriaId: string | null; nome: string | null }) {
  const { ancestrais, folha } = useCaminhoCategoria(categoriaId, nome);
  if (!categoriaId && !nome) return <span className="text-muted-foreground">ainda não definida</span>;
  return (
    <span>
      {ancestrais.length > 0 && <span className="text-muted-foreground">{ancestrais.join(' › ')} › </span>}
      <span className="font-medium">{folha}</span>
    </span>
  );
}

export function DialogCriarKit({ familiaBaseId, base, kitsExistentes, open, onOpenChange, baseNoMl = false }: {
  familiaBaseId: string;
  /** Base já publicada no ML (tem promoção a ler). Em Revisão: false, a edge nem é chamada. */
  baseNoMl?: boolean;
  base: BaseParaKit;
  /** Todos os status (não só vivos) — precisa do 'erro' pra oferecer "Reenviar" (I-1). */
  kitsExistentes: KitVinculado[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [etapa, setEtapa] = useState<'tamanhos' | 'preview'>('tamanhos');
  const [marcados, setMarcados] = useState<Set<number>>(new Set());
  const [chaves, setChaves] = useState<Record<number, string>>({});
  const [valores, setValores] = useState<Record<number, KitPreviewValue>>({});
  const [categoriaOverride, setCategoriaOverride] = useState<{ categoriaMlId: string; categoriaNome: string } | null>(null);
  const [buscaCategoriaAberta, setBuscaCategoriaAberta] = useState(false);
  const [queryCategoria, setQueryCategoria] = useState('');
  const [candidatosCategoria, setCandidatosCategoria] = useState<CategoriaCandidata[]>([]);
  const [buscandoCategoria, setBuscandoCategoria] = useState(false);
  // "Você recebe" de cada kit: o gate nasce fechado e só abre quando o preview informa que a conta
  // está pronta (ou confirmada). Setter estável e sem troca quando o valor não muda (sem loop de render).
  const [podeSeguir, setPodeSeguir] = useState<Record<number, boolean>>({});
  const aoMudarPodeSeguir = useCallback((n: number, pode: boolean) => {
    setPodeSeguir((prev) => (prev[n] === pode ? prev : { ...prev, [n]: pode }));
  }, []);

  // ADR-0204: escolha da galeria por tamanho (a leitura é uma por categoria, compartilhada entre os tamanhos).
  const [escolhasGaleria, setEscolhasGaleria] = useState<Record<number, EscolhaGaleria>>({});
  // ADR-0205: capa com N unidades por IA. Estado e request_id aqui: o PreviewKit desmonta em "Voltar".
  const capas = useCapasUnidades(familiaBaseId, open);

  // Reset ao abrir: chaves e valores novos por sessão de diálogo (as chaves só trocam
  // depois de sucesso confirmado, nunca durante a edição).
  useEffect(() => {
    if (!open) return;
    setEtapa('tamanhos');
    setMarcados(new Set());
    setChaves({});
    setValores({});
    setPodeSeguir({});
    setEscolhasGaleria({});
    setCategoriaOverride(null);
    setBuscaCategoriaAberta(false);
    setQueryCategoria('');
    setCandidatosCategoria([]);
  }, [open]);

  async function buscarCategoria() {
    if (!queryCategoria.trim()) return;
    setBuscandoCategoria(true);
    try {
      const r = await buscarCategoriaML(familiaBaseId, queryCategoria);
      setCandidatosCategoria(r.candidatos);
    } catch (e) {
      toast.error('Erro ao buscar categoria', { description: (e as Error).message });
    } finally {
      setBuscandoCategoria(false);
    }
  }

  function alternarTamanho(n: number, marcar: boolean) {
    setMarcados((prev) => {
      const novo = new Set(prev);
      if (marcar) novo.add(n); else novo.delete(n);
      return novo;
    });
    if (!marcar) setPodeSeguir((prev) => { const { [n]: _, ...resto } = prev; return resto; });
    if (marcar) {
      setChaves((prev) => (prev[n] ? prev : { ...prev, [n]: crypto.randomUUID() }));
      setValores((prev) => (prev[n]
        ? prev
        : { ...prev, [n]: valorInicialPreview(base, tituloDoKit(base.titulo, n), descricaoDoKit(base.descricao, n, base.titulo), n) }));
    }
  }

  const tamanhosMarcados = TAMANHOS_KIT.filter((n) => marcados.has(n));

  // M-1: ciclos de UPDATE (ou recriar um tamanho que falhou) podem deixar mais de uma linha
  // de `familias` para o mesmo multiplicador — mesma regra de canonicidade de `listarKitsVivos`
  // (`_shared/estoque/kit.ts`): uma por multiplicador, a mais recente por `criadoEm`.
  const kitMaisRecentePorTamanho = new Map<number, typeof kitsExistentes[number]>();
  for (const k of kitsExistentes) {
    const atual = kitMaisRecentePorTamanho.get(k.multiplicador);
    if (!atual || k.criadoEm > atual.criadoEm) kitMaisRecentePorTamanho.set(k.multiplicador, k);
  }

  const tituloInvalido = tamanhosMarcados.some((n) => (valores[n]?.titulo.length ?? 0) > TITULO_MAX_KIT);
  const precoInvalido = tamanhosMarcados.some((n) => !((valores[n]?.preco ?? 0) > 0));
  // Sem foto (nem a da base, nem uma nova escolhida) o anúncio vai ao ML sem capa — mesmo
  // requisito de LinhaVariacaoForm.fotoObrigatoria (ADR-0129 D-4).
  const semFotoInvalido = tamanhosMarcados.some((n) => !(valores[n]?.imagemPath || valores[n]?.fotoFile));
  const contaPronta = tamanhosMarcados.every((n) => podeSeguir[n] === true);
  const podeCriar = tamanhosMarcados.length > 0 && !tituloInvalido && !precoInvalido && !semFotoInvalido && contaPronta;
  const categoriaMlIdEfetiva = categoriaOverride?.categoriaMlId ?? base.categoriaMlId;

  // Só com a base publicada no ML (senão não há galeria a ler) e na etapa 2; falha da leitura não bloqueia.
  const galeriaBase = useGaleriaBaseKit(familiaBaseId, categoriaMlIdEfetiva, baseNoMl && open && etapa === 'preview' && tamanhosMarcados.length > 0);
  const lendoGaleria = galeriaBase.isFetching;

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
          // Falha da leitura = sem a chave (o servidor mantém só a capa).
          ...(galeriaBase.data ? { galeria: idsDaGaleria(galeriaBase.data, escolhasGaleria[n]) } : {}),
        };
      }));

      return criarKitVinculado({ familiaBaseId, kits, categoriaOverride });
    },
    onSuccess: (r) => {
      if (!r.ok) {
        toast.error('Falha ao criar kit', {
          description: (r.motivo && MENSAGEM_POR_MOTIVO[r.motivo]) ?? r.mensagem ?? r.motivo ?? 'Motivo não informado.',
        });
        return;
      }
      // Leva ao relatório pra acompanhar a publicação — só quando a edge devolveu o lote
      // (reenvio puro, com kitsFaltando vazio, não cria lote e não tem pra onde levar).
      const action = r.loteId
        ? { label: 'Acompanhar', onClick: () => navigate(`/relatorio/${r.loteId}`) }
        : undefined;
      // ADR-0204: o servidor descartou a galeria (releitura do ML falhou): o kit existe, mas só com a capa.
      if (r.avisos?.length) {
        toast.warning('O kit foi criado só com a capa', { description: r.avisos.join(' ') });
      }
      // ADR-0151 (Task 6, fix I2): o kit foi criado, mas o encadeamento da publicação é uma
      // etapa separada — `publicacaoOk: false` não pode virar sucesso silencioso.
      if (r.publicacaoOk === false) {
        toast.warning(
          tamanhosMarcados.length > 1 ? 'Kits criados, mas a publicação não foi encadeada' : 'Kit criado, mas a publicação não foi encadeada',
          {
            description: 'O cadastro foi salvo. Tente novamente em instantes — a lista de kits vinculados mostra o status atual.',
            ...(action ? { action } : {}),
          },
        );
      } else {
        toast.success(
          tamanhosMarcados.length > 1
            ? `${tamanhosMarcados.length} kits criados e enviados para publicação`
            : 'Kit criado e enviado para publicação',
          {
            description: 'Acompanhe o andamento no relatório.',
            ...(action ? { action } : {}),
          },
        );
      }
      qc.invalidateQueries({ queryKey: QK.publicados });
      // M-0: prefixo, não a chave por produto — a badge da Revisão consulta pela chave de
      // página (['kits-do-produto','pagina',[...]]), que nunca bateria com a chave por produto.
      qc.invalidateQueries({ queryKey: QK.kitsDoProdutoRaiz });
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

  // I-1: falha PARCIAL de uma submissão multi-kit deixa o lote técnico em 'concluido' (não
  // 'revisao'), então o kit em erro não ganha o card/botão "Reenviar N com erro" da Revisão
  // (esse caminho só existe quando TODOS os kits do lote falham). Reaproveita aqui o mesmo
  // fluxo que a Revisão usa pra reenviar — publicarFamilias([familiaId]) — pra não deixar o
  // kit preso em 'erro' sem saída (ver Decisão 4 do ADR-0151).
  const reenviarMutation = useMutation({
    mutationFn: (familiaId: string) => publicarFamilias([familiaId]),
    onSuccess: (r) => {
      // Mesmo cuidado do handler de criação acima: `resp.ok` (implícito no fetch não lançar)
      // não prova que a família foi de fato reclamada — publicar-familias devolve
      // `enfileiradas: 0` sem erro se o claim (`status in ('pronto','erro')`) não pegar nada.
      if (r.enfileiradas === 0) {
        toast.warning('Kit não foi reenviado', {
          description: 'Nenhuma família foi enfileirada. Verifique o status do kit e tente novamente.',
        });
        return;
      }
      toast.success('Kit reenviado para publicação');
      // M-0: prefixo, não a chave por produto — a badge da Revisão consulta pela chave de
      // página (['kits-do-produto','pagina',[...]]), que nunca bateria com a chave por produto.
      qc.invalidateQueries({ queryKey: QK.kitsDoProdutoRaiz });
      qc.invalidateQueries({ queryKey: QK.publicados });
      qc.invalidateQueries({ queryKey: ['lotes'] });
    },
    onError: (err) => {
      toast.error('Falha ao reenviar kit', {
        description: err instanceof Error ? err.message : String(err),
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !mutation.isPending && onOpenChange(v)}>
      <DialogContent
        processando={mutation.isPending}
        rotuloProcessando="Criando e publicando o kit"
        className="flex max-h-[85vh] w-full max-w-[calc(100vw-2rem)] flex-col p-0 sm:max-w-4xl"
      >
        {/* Rolagem num filho: no próprio Content o raio da borda (processando) rolaria junto. */}
        <div className="grid min-h-0 gap-4 overflow-y-auto p-4">
        <DialogHeader>
          <DialogTitle>Criar kit vinculado</DialogTitle>
          <DialogDescription>
            {etapa === 'tamanhos'
              ? 'Escolha os tamanhos de kit para este produto.'
              : `Confira e ajuste ${tamanhosMarcados.length > 1 ? `os ${tamanhosMarcados.length} kits` : 'o kit'} antes de criar — é a revisão inteira, não passa por outra tela.`}
          </DialogDescription>
        </DialogHeader>

        <EtapasKit
          atual={etapa}
          etapas={[{ id: 'tamanhos', rotulo: 'Tamanhos' }, { id: 'preview', rotulo: 'Anúncio' }]}
        />

        <div className="flex flex-col gap-1.5 rounded-md border bg-muted/30 p-3">
          {/* Categoria de origem sempre visível: é ela que o kit herda quando não há override
              (achado do Diego, 10/09/2026 — sem isso a troca é às cegas). */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <span className="text-muted-foreground">Categoria do produto:</span>
            <CaminhoCategoria categoriaId={base.categoriaMlId} nome={base.categoriaNome} />
            {!categoriaOverride && !buscaCategoriaAberta && (
              <Button type="button" variant="outline" size="sm" className="ml-auto h-7 text-xs" onClick={() => setBuscaCategoriaAberta(true)}>
                Trocar categoria
              </Button>
            )}
          </div>

          {categoriaOverride ? (
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-muted-foreground">Categoria do kit:</span>
              <CaminhoCategoria categoriaId={categoriaOverride.categoriaMlId} nome={categoriaOverride.categoriaNome} />
              <Button
                type="button" variant="ghost" size="sm" className="h-5 px-1"
                aria-label="Remover categoria escolhida"
                onClick={() => { setCategoriaOverride(null); setCandidatosCategoria([]); setQueryCategoria(''); }}
              >
                ×
              </Button>
            </div>
          ) : buscaCategoriaAberta ? (
            <div className="flex flex-col gap-1.5">
              <div className="flex gap-1">
                <Input
                  className="h-8 text-xs"
                  placeholder="Buscar categoria (ex.: leite infantil)"
                  value={queryCategoria}
                  onChange={(e) => setQueryCategoria(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && buscarCategoria()}
                />
                <Button type="button" size="sm" className="h-8 px-2" onClick={buscarCategoria} disabled={buscandoCategoria}>
                  Buscar
                </Button>
              </div>
              {candidatosCategoria.map((c) => (
                <button
                  key={c.categoriaId}
                  type="button"
                  onClick={() => {
                    setCategoriaOverride({ categoriaMlId: c.categoriaId, categoriaNome: c.categoriaNome });
                    setBuscaCategoriaAberta(false);
                  }}
                  className="rounded-md border p-1.5 text-left text-xs hover:bg-accent"
                >
                  <CaminhoCategoria categoriaId={c.categoriaId} nome={c.categoriaNome} />
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {baseNoMl && <PromocaoBaseKit familiaBaseId={familiaBaseId} ativo />}

        {etapa === 'tamanhos' ? (
          <div className="flex flex-col gap-2" role="group" aria-label="Tamanhos do kit">
            <span className="text-sm font-medium">Tamanhos do kit</span>
            {TAMANHOS_KIT.map((n) => {
              const existente = kitMaisRecentePorTamanho.get(n);
              const jaCriado = !!existente;
              const comErro = existente?.status === 'erro';
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
                    {jaCriado && !comErro && <span className="ml-2 text-xs text-muted-foreground">já criado</span>}
                    {comErro && <span className="ml-2 text-xs text-destructive">falhou ao publicar</span>}
                  </label>
                  {comErro && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="ml-auto h-7"
                      disabled={reenviarMutation.isPending}
                      onClick={() => reenviarMutation.mutate(existente!.familiaId)}
                    >
                      <RotateCw className={cn('mr-1 h-3 w-3', reenviarMutation.isPending && reenviarMutation.variables === existente!.familiaId && 'animate-spin')} />
                      Reenviar
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col gap-6" role="list" aria-label="Pré-visualização dos kits selecionados">
            {tamanhosMarcados.map((n, i) => (
              <PreviewKit
                key={n}
                n={n}
                indice={i + 1}
                total={tamanhosMarcados.length}
                base={base}
                value={valores[n]}
                categoriaMlId={categoriaMlIdEfetiva}
                onPodeSeguir={aoMudarPodeSeguir}
                galeria={(
                  <GaleriaBaseKit
                    n={n}
                    proposta={baseNoMl ? galeriaBase.data : BASE_NAO_PUBLICADA} carregando={baseNoMl && lendoGaleria} erro={baseNoMl && galeriaBase.isError}
                    escolha={escolhasGaleria[n]} desabilitado={mutation.isPending}
                    onChange={(e) => setEscolhasGaleria((prev) => ({ ...prev, [n]: e }))}
                  />
                )}
                capaUnidades={(
                  <GerarCapaUnidades
                    n={n} temCapa={!!base.fotoPath} estado={capas.estados[n]}
                    onGerar={() => void capas.gerar(n)}
                    onUsar={(path) => {
                      setValores((prev) => ({ ...prev, [n]: { ...prev[n], imagemPath: path, fotoFile: null } }));
                      capas.descartar(n);
                    }}
                  />
                )}
                onChange={(patch) => {
                  // Arquivo manual vence a candidata: volta a foto da base e descarta a geração.
                  if (patch.fotoFile) capas.descartar(n);
                  setValores((prev) => ({
                    ...prev, [n]: { ...prev[n], ...patch, ...(patch.fotoFile ? { imagemPath: base.fotoPath } : {}) },
                  }));
                }}
              />
            ))}
          </div>
        )}

        {etapa === 'preview' && (
          <p className="text-xs text-muted-foreground">
            O kit vai direto para o Mercado Livre — esta tela é a revisão.
          </p>
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
              <Button disabled={!podeCriar || lendoGaleria || mutation.isPending} onClick={() => mutation.mutate()}>
                {mutation.isPending ? 'Criando…' : 'Criar e publicar'}
              </Button>
            </>
          )}
        </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
