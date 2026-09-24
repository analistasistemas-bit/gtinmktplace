// Task 7 (ADR-0166 2026-09-24c): "Adicionar à grade" — estende a matriz Cor × Tamanho de um
// produto de grade JÁ PUBLICADO no Mercado Livre (User Products). Mesma família de fluxo do
// `dialog-adicionar-variacao.tsx` (ADR-0129: UPDATE direto, sem passar pela Revisão), mas a
// composição da tela é a de `dialog-cadastro-grade.tsx` — cabeçalho herdável + GeradorVariacoes +
// MatrizGrade — com os SKUs já publicados aparecendo TRAVADOS na própria matriz
// (`MatrizGrade.bloqueadas`, Task 6) em vez de uma segunda lista.
//
// Diferença central para o cadastro em grade: aqui o tipo (roupa/calçado) e o gênero NÃO são
// escolhidos pelo operador — são INFERIDOS da família publicada (`classificarFamilia`/
// `tipoDaGrade`, a MESMA fonte que a edge usa para validar). O operador só escolhe cores/tamanhos
// NOVOS; o que já existe é somente leitura.
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useTiposProdutoHabilitados } from '@/hooks/useTiposProdutoHabilitados';
import { supabase } from '@/lib/supabase';
import { QK } from '@/lib/queries';
import { parseNumeroPtBr } from '@/lib/formato';
import { effectiveOrgId, useSupportStore, canWrite } from '@/stores/support-store';
import { storageOwnerForUpload } from '@/hooks/useUploadLote';
import { uploadFile, buildStoragePath } from '@/lib/storage';
import { corpoDoErroDaEdge } from '@/lib/edge-erro';
import { fetchFamiliasNaoPublicadas, familiaEmVoo } from '@/lib/estoque-update-status';
import { classificarFamilia, LIMITE_VARIACOES_GERADAS, numeracaoPublicavel, opcoesDeTamanho, tipoDaGrade } from '@/lib/tamanhos';
import {
  aplicarEmMassa, chaveGrade, novaLinhaGrade, ordenarEixos, reconciliarGrade, resolverLinha,
  totaisDaGrade, totalDaGrade,
  type CampoHerdavel, type CamposHerdaveis, type LinhaGrade, type OpcoesMassa,
} from '@/lib/cadastro-grade';
import {
  bloqueadasDe, eixosExistentes, fotoHerdavel, payloadEstender, type SkuExistente,
} from '@/lib/estender-grade';
import { CampoFoto } from '@/components/estoque/campo-foto';
import { CORES_POPULARES, GeradorVariacoes } from '@/components/estoque/gerador-variacoes';
import { ROTULOS } from '@/components/estoque/detalhes-sku';
import { MatrizGrade } from '@/components/estoque/matriz-grade';
import { erroCampo } from '@/components/estoque/linha-variacao-form';
import { CAMPOS_NUMERICOS } from '@/components/estoque/use-cadastro-produto';
import { fetchVariacoesProduto, type ProdutoEstoqueResumo } from '@/lib/produtos-saldo';
import { cn } from '@/lib/utils';

const CABECALHO_VAZIO: CamposHerdaveis = {
  preco: '', custo: '', pesoGramas: '', alturaCm: '', larguraCm: '', comprimentoCm: '',
};

// Achado da revisão (rodada 1): mesma mensagem para as duas consultas que podem falhar
// (`fetchFamiliaPublicada`/`fetchFamiliaCanonicaId`) — nenhuma delas tem retry automático
// (padrão do projeto pra `useQuery` fora de `useTiposProdutoHabilitados`), então "tente de novo"
// aponta pro único jeito real de recuperar: fechar e reabrir o dialog.
const MSG_ERRO_CARGA = 'Não foi possível carregar o produto. Tente de novo.';

type Genero = 'masculino' | 'feminino' | 'unissex';

const ROTULO_GENERO: Record<Genero, string> = { masculino: 'Masculino', feminino: 'Feminino', unissex: 'Unissex' };

interface VariacaoPublicadaRaw {
  codigo: string; cor: string | null; tamanho: string | null; estoque: number;
  imagem_path: string | null; ml_picture_id: string | null;
  peso_gramas: number | null; altura_cm: number | null; largura_cm: number | null; comprimento_cm: number | null;
  custo: number | null; preco: number | null; excluida_da_publicacao: boolean;
}

interface FamiliaPublicada {
  id: string;
  genero: string | null;
  variacoes: VariacaoPublicadaRaw[];
}

// MESMA resolução da edge (adicionar-variacoes-familia/index.ts:146-157): família mais recente
// que já tem ml_item_id, por publicado_em desc. Uma tentativa de UPDATE que falhou DEPOIS da
// última publicação não entra aqui — o par que só existe nela aparece na matriz como célula NOVA
// comum (a edge valida contra a publicada de qualquer forma).
async function fetchFamiliaPublicada(codigoPai: string): Promise<FamiliaPublicada | null> {
  const { data, error } = await supabase
    .from('familias')
    .select('id, genero, variacoes(codigo, cor, tamanho, estoque, imagem_path, ml_picture_id, peso_gramas, altura_cm, largura_cm, comprimento_cm, custo, preco, excluida_da_publicacao)')
    .eq('codigo_pai', codigoPai).not('ml_item_id', 'is', null)
    .order('publicado_em', { ascending: false, nullsFirst: false }).limit(1);
  if (error) throw error;
  return (data?.[0] as FamiliaPublicada | undefined) ?? null;
}

// familia_id enviado à edge é a CANÔNICA (mais recente, criado_em desc) — igual ao dialog
// `dialog-adicionar-variacao.tsx`; a edge resolve a publicada sozinha a partir dela.
async function fetchFamiliaCanonicaId(codigoPai: string): Promise<{ id: string } | null> {
  const { data, error } = await supabase
    .from('familias').select('id').eq('codigo_pai', codigoPai)
    .order('criado_em', { ascending: false }).limit(1);
  if (error) throw error;
  return (data?.[0] as { id: string } | undefined) ?? null;
}

function estoqueValido(v: string): boolean {
  const n = parseNumeroPtBr(v);
  return typeof n === 'number' && Number.isInteger(n) && n > 0;
}

interface Confirmacao { titulo: string; texto: string; rotulo: string; acao: () => void }

export function DialogEstenderGrade({ produto, aberto, onFechar, onNaoEhGrade }: {
  produto: ProdutoEstoqueResumo | null;
  aberto: boolean;
  onFechar: () => void;
  /** A família publicada não é grade (ou o resumo divergiu dela) — o roteador cai para o dialog
   *  antigo. Nunca chamado pra 'mista': esse caso mostra aviso de bloqueio aqui mesmo. */
  onNaoEhGrade: () => void;
}) {
  const qc = useQueryClient();
  const codigoPai = produto?.codigoPai;

  // Objeto INTEIRO da query (não só `data`): `isError` é o que distingue "ainda carregando"
  // (`data === undefined`, sem erro) de "falhou" (idem, mas `isError === true`) — sem isso um
  // erro de rede deixava a tela presa no skeleton pra sempre (achado da revisão, rodada 1).
  const familiaPublicadaQuery = useQuery({
    queryKey: ['familia-publicada-grade', codigoPai],
    queryFn: () => fetchFamiliaPublicada(codigoPai!),
    enabled: aberto && !!produto,
  });
  const familiaPublicada = familiaPublicadaQuery.data;
  const familiaCanonicaQuery = useQuery({
    queryKey: ['familia-canonica-grade', codigoPai],
    queryFn: () => fetchFamiliaCanonicaId(codigoPai!),
    enabled: aberto && !!produto,
  });
  const familiaCanonica = familiaCanonicaQuery.data;
  // Saldo CANÔNICO (mesma fonte que a tela Estoque mostra) para as células travadas — a família
  // publicada pode não ser a mais recente em saldo (ex.: uma entrada de mercadoria posterior).
  const { data: variacoesCanonicas } = useQuery({
    queryKey: QK.variacoesEstoque(codigoPai ?? ''),
    queryFn: () => fetchVariacoesProduto(codigoPai!),
    enabled: aberto && !!produto,
  });
  const { data: famRows } = useQuery({
    queryKey: QK.familiasNaoPublicadas,
    queryFn: fetchFamiliasNaoPublicadas,
    enabled: aberto && !!produto,
  });
  const emVoo = !!produto && familiaEmVoo(famRows ?? [], produto.codigoPai);

  const tiposQuery = useTiposProdutoHabilitados();
  const tiposHabilitados = tiposQuery.data ?? [];
  const carregandoTipos = tiposQuery.data === undefined && !tiposQuery.isError;

  const [cores, setCores] = useState<Set<string>>(new Set());
  const [tamanhos, setTamanhos] = useState<Set<string>>(new Set());
  const [removidas, setRemovidas] = useState<Set<string>>(new Set());
  const [linhas, setLinhas] = useState<LinhaGrade[]>([]);
  const [cabecalho, setCabecalho] = useState<CamposHerdaveis>(CABECALHO_VAZIO);
  const [fotoPorCor, setFotoPorCor] = useState<Record<string, File | null>>({});
  const [chave, setChave] = useState(() => crypto.randomUUID());
  const [salvando, setSalvando] = useState(false);
  const [tentouSalvar, setTentouSalvar] = useState(false);
  const [confirmar, setConfirmar] = useState<Confirmacao | null>(null);

  // Reset ao FECHAR — mesmo padrão de dialog-cadastro-grade.tsx.
  useEffect(() => {
    if (aberto) return;
    setCores(new Set()); setTamanhos(new Set()); setRemovidas(new Set());
    setLinhas([]); setCabecalho(CABECALHO_VAZIO); setFotoPorCor({});
    setChave(crypto.randomUUID());
    setTentouSalvar(false);
    setConfirmar(null);
  }, [aberto]);

  const vivas = familiaPublicada?.variacoes ?? [];
  // FONTE ÚNICA "é grade" — a MESMA função que a edge usa (`_shared/produto/tipos-produto-valores`
  // reexportada em `@/lib/tamanhos`). 'simples' cai pro dialog antigo (via `onNaoEhGrade`); a
  // recém-carregada é o único disparo válido, por isso a dependência em `familiaPublicada`.
  const classe = classificarFamilia(
    vivas.map((v) => ({ tamanho: v.tamanho, excluida_da_publicacao: v.excluida_da_publicacao })),
  );
  useEffect(() => {
    // `null` = a consulta resolveu e não achou família publicada nenhuma — resumo (`temTamanho`)
    // defasado de um produto ainda não publicado no ML. O dialog antigo já sabe tratar "produto
    // sem publicação" (mostra o erro que a edge devolve ao tentar); não travar aqui numa tela
    // vazia pra sempre (achado da revisão, rodada 1).
    if (familiaPublicada === null) { onNaoEhGrade(); return; }
    if (familiaPublicada && classe === 'simples') onNaoEhGrade();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familiaPublicada, classe]);

  const estoqueCanonicoPorCodigo = new Map((variacoesCanonicas ?? []).map((v) => [v.codigo, v.estoque]));
  // TODAS as variações da família publicada, incluídas e excluídas (Codex r3 #1 do brief):
  // excluída fica travada também — a edge recusa o par de qualquer forma.
  const skus: SkuExistente[] = vivas.map((v) => ({
    codigo: v.codigo,
    cor: v.cor ?? '',
    tamanho: v.tamanho ?? '',
    estoque: estoqueCanonicoPorCodigo.get(v.codigo) ?? v.estoque,
    temFoto: !!(v.imagem_path || v.ml_picture_id),
    excluida: v.excluida_da_publicacao,
  }));
  // Tipo e eixos "fixos" (checkbox travado, não removível) vêm SÓ das incluídas — uma excluída
  // não decide o que o anúncio é nem traz coluna/linha nova para a grade (Codex r5/r6 do brief).
  const incluidos = skus.filter((s) => !s.excluida);
  const eixosFixos = eixosExistentes(incluidos);
  const tipo = classe === 'grade' ? tipoDaGrade(incluidos.map((s) => s.tamanho)) : null;
  const gruposTamanho = opcoesDeTamanho(tipo ? [tipo] : []);
  const generoNorm = (familiaPublicada?.genero as Genero | null) ?? null;

  // Semeia cores/tamanhos com os eixos já publicados assim que a família chega — só ACRESCENTA
  // (nunca some, e checkbox fixo não pode ser desmarcado), então rodar de novo em cada refetch é
  // inofensivo.
  useEffect(() => {
    if (!familiaPublicada) return;
    setCores((prev) => new Set([...prev, ...eixosFixos.cores]));
    setTamanhos((prev) => new Set([...prev, ...eixosFixos.tamanhos]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familiaPublicada]);

  // Reconciliação — mesmo padrão de dialog-cadastro-grade.tsx (efeito central), com uma diferença:
  // os SKUs já publicados (incluídos e excluídos) entram como "já existentes" — nunca viram
  // `novas`, então a matriz nunca duplica uma célula travada como linha editável.
  useEffect(() => {
    if (salvando) return;
    const canonicos = gruposTamanho.flatMap((g) => g.valores);
    const eixosOrdenados = ordenarEixos(cores, tamanhos, { cores: CORES_POPULARES, tamanhos: canonicos });
    const jaExistentes = skus.map((s) => ({ cor: s.cor, tamanho: s.tamanho }));
    const podadas = reconciliarGrade(eixosOrdenados.cores, eixosOrdenados.tamanhos, removidas, jaExistentes).removidas;
    if (podadas.size !== removidas.size) { setRemovidas(podadas); return; }
    setLinhas((prev) => {
      const r = reconciliarGrade(eixosOrdenados.cores, eixosOrdenados.tamanhos, removidas, [...prev, ...jaExistentes]);
      if (r.novas.length === 0 && r.remover.length === 0) return prev;
      const fora = new Set(r.remover);
      const todas = [
        ...prev.filter((l) => !fora.has(chaveGrade(l.cor, l.tamanho))),
        ...r.novas.map((c) => novaLinhaGrade(c.cor, c.tamanho)),
      ];
      const pos = new Map(r.ordem.map((k, i) => [k, i]));
      return todas.sort((a, b) => (
        (pos.get(chaveGrade(a.cor, a.tamanho)) ?? 0) - (pos.get(chaveGrade(b.cor, b.tamanho)) ?? 0)
      ));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cores, tamanhos, removidas, salvando]);

  // Prefill do cabeçalho pelo SKU de referência (menor código entre os NÃO excluídos) — mesma
  // regra de `irmaRef` em dialog-adicionar-variacao.tsx. Só toca campo ainda vazio (pristine).
  const irmasPorCodigo = [...vivas].sort((a, b) => a.codigo.localeCompare(b.codigo, 'pt-BR'));
  const irmaRef = irmasPorCodigo.find((v) => !v.excluida_da_publicacao) ?? irmasPorCodigo[0] ?? null;
  useEffect(() => {
    if (!aberto || !irmaRef) return;
    setCabecalho((prev) => ({
      ...prev,
      ...(prev.pesoGramas === '' && prev.alturaCm === '' && prev.larguraCm === '' && prev.comprimentoCm === ''
        ? {
          pesoGramas: irmaRef.peso_gramas != null ? String(irmaRef.peso_gramas) : '',
          alturaCm: irmaRef.altura_cm != null ? String(irmaRef.altura_cm) : '',
          larguraCm: irmaRef.largura_cm != null ? String(irmaRef.largura_cm) : '',
          comprimentoCm: irmaRef.comprimento_cm != null ? String(irmaRef.comprimento_cm) : '',
        }
        : {}),
      ...(prev.custo === '' && irmaRef.custo != null ? { custo: String(irmaRef.custo) } : {}),
      ...(prev.preco === '' && irmaRef.preco != null ? { preco: String(irmaRef.preco) } : {}),
    }));
  }, [aberto, irmaRef]);

  function temDado(l: LinhaGrade): boolean {
    return l.gtin.trim() !== '' || l.estoqueInicial.trim() !== ''
      || Object.keys(l.overrides).length > 0 || 'foto' in l;
  }

  function mudarCores(proximas: Set<string>) {
    if (salvando) return;
    if (totalDaGrade([...proximas], [...tamanhos], removidas) > LIMITE_VARIACOES_GERADAS) return;
    const saindo = [...cores].filter((c) => !proximas.has(c) && !eixosFixos.cores.has(c));
    const afetadas = linhas.filter((l) => saindo.includes(l.cor));
    if (afetadas.some(temDado)) {
      setConfirmar({
        titulo: 'Remover as linhas dessa cor?',
        texto: `${afetadas.length} linha(s) já têm dado preenchido e serão apagadas.`,
        rotulo: 'Remover mesmo assim',
        acao: () => setCores(proximas),
      });
      return;
    }
    setCores(proximas);
  }

  function mudarTamanhos(proximos: Set<string>) {
    if (salvando) return;
    if (totalDaGrade([...cores], [...proximos], removidas) > LIMITE_VARIACOES_GERADAS) return;
    const saindo = [...tamanhos].filter((t) => !proximos.has(t) && !eixosFixos.tamanhos.has(t));
    const afetadas = linhas.filter((l) => saindo.includes(l.tamanho));
    if (afetadas.some(temDado)) {
      setConfirmar({
        titulo: 'Remover as linhas desse tamanho?',
        texto: `${afetadas.length} linha(s) já têm dado preenchido e serão apagadas.`,
        rotulo: 'Remover mesmo assim',
        acao: () => setTamanhos(proximos),
      });
      return;
    }
    setTamanhos(proximos);
  }

  function removerLinha(cor: string, tamanho: string) {
    if (salvando) return;
    setRemovidas((prev) => new Set(prev).add(chaveGrade(cor, tamanho)));
    setLinhas((prev) => prev.filter((x) => !(x.cor === cor && x.tamanho === tamanho)));
  }

  function reincluirLinha(cor: string, tamanho: string) {
    if (salvando) return;
    const proximas = new Set(removidas);
    proximas.delete(chaveGrade(cor, tamanho));
    if (totalDaGrade([...cores], [...tamanhos], proximas) > LIMITE_VARIACOES_GERADAS) return;
    setRemovidas(proximas);
  }

  function aplicarMassa(opts: OpcoesMassa) {
    if (salvando) return;
    // `aplicarEmMassa` é um `map` sobre `linhas` — as travadas nem existem nela, então o
    // preenchimento em massa NUNCA alcança uma célula já publicada (decisão R6 do controlador).
    setLinhas((prev) => aplicarEmMassa(prev, opts));
  }

  function patchLinha(clientId: string, patch: Partial<LinhaGrade>) {
    setLinhas((prev) => prev.map((x) => (x.clientId === clientId ? { ...x, ...patch } : x)));
  }

  function patchOverride(clientId: string, campo: CampoHerdavel, valor: string) {
    setLinhas((prev) => prev.map((x) => (
      x.clientId === clientId ? { ...x, overrides: { ...x.overrides, [campo]: valor } } : x
    )));
  }

  function destravar(clientId: string, campo: CampoHerdavel) {
    setLinhas((prev) => prev.map((x) => (
      x.clientId === clientId
        ? { ...x, overrides: { ...x.overrides, [campo]: resolverLinha(cabecalho, fotoPorCor, x)[campo] } }
        : x
    )));
  }

  function voltarAHerdar(clientId: string, campo: CampoHerdavel) {
    setLinhas((prev) => prev.map((x) => {
      if (x.clientId !== clientId) return x;
      const { [campo]: _removido, ...resto } = x.overrides;
      return { ...x, overrides: resto };
    }));
  }

  const resolvidas = linhas.map((l) => resolverLinha(cabecalho, fotoPorCor, l));
  const eixos = ordenarEixos(cores, tamanhos, {
    cores: CORES_POPULARES,
    tamanhos: gruposTamanho.flatMap((g) => g.valores),
  });
  const totais = totaisDaGrade(resolvidas, eixos.cores, eixos.tamanhos);
  const bloqueadas = bloqueadasDe(skus);

  // O cartesiano de `cores`/`tamanhos` JÁ inclui os eixos fixos (semeados acima) — somar
  // `skus.length` contaria as células travadas duas vezes (Codex #7 do brief).
  const coresBloqueadas = new Set(
    CORES_POPULARES.filter((c) => !cores.has(c)
      && totalDaGrade([...cores, c], [...tamanhos], removidas) > LIMITE_VARIACOES_GERADAS),
  );
  const tamanhosBloqueados = new Set(
    gruposTamanho.flatMap((g) => g.valores).filter((t) => !tamanhos.has(t) && (
      totalDaGrade([...cores], [...tamanhos, t], removidas) > LIMITE_VARIACOES_GERADAS
      // Neste fluxo o UPDATE vai direto ao ML (Codex #9): numeração sem guia de tamanhos BLOQUEIA,
      // não é só aviso como no cadastro.
      || (tipo === 'calcado' && !!generoNorm && !numeracaoPublicavel(t, generoNorm))
    )),
  );
  const bloquearNovaCor =
    totalDaGrade([...cores, '\u0001hipotetica'], [...tamanhos], removidas) > LIMITE_VARIACOES_GERADAS;

  const avisoTamanho = (v: string) => (
    tipo === 'calcado' && !!generoNorm && !numeracaoPublicavel(v, generoNorm)
      ? 'não publica no Mercado Livre para este gênero'
      : null
  );

  // Estados de bloqueio (Step 5 do brief), na ordem: hook ainda em voo, erro do hook, tipo
  // indefinido/misto, tipo desativado na org. Todos travam o Salvar; nenhum some antes de resolver.
  const motivoBloqueioTipo: string | null = tiposQuery.isError
    ? 'Não foi possível confirmar os tipos de produto da organização. Tente de novo.'
    : classe === 'mista'
      ? 'SKUs publicados com e sem tamanho — fale com o suporte.'
      : classe === 'grade' && tipo === null
        ? 'Os tamanhos publicados deste produto não pertencem a um único tipo — fale com o suporte.'
        : tipo && !tiposHabilitados.includes(tipo)
          ? `O tipo ${tipo === 'roupa' ? 'Roupa' : 'Calçado'} está desativado nesta organização — peça ao administrador da plataforma para reativar.`
          : null;
  const bloqueadoPorTipo = carregandoTipos || !!motivoBloqueioTipo;

  const podeSalvar = !!familiaCanonica && !bloqueadoPorTipo && !emVoo && linhas.length > 0
    && resolvidas.every((r) => CAMPOS_NUMERICOS.every((c) => !erroCampo(c, r[c])))
    && resolvidas.every((r) => estoqueValido(r.estoqueInicial))
    && resolvidas.every((r) => r.foto != null || fotoHerdavel(r.cor, skus) != null);

  async function salvar() {
    if (!produto || !familiaCanonica) return;
    setTentouSalvar(true);
    setSalvando(true);
    try {
      if (!canWrite()) throw new Error('Suporte somente leitura.');
      const { data: ud } = await supabase.auth.getUser();
      const userId = ud.user?.id;
      const orgId = effectiveOrgId();
      if (!userId || !orgId) throw new Error('Sem sessão ou organização.');
      const owner = storageOwnerForUpload(userId, orgId, useSupportStore.getState().context?.scope ?? null);

      const imagemPorClientId = new Map<string, string>();
      for (const r of resolvidas) {
        if (r.foto instanceof File) {
          const path = await uploadFile(
            'imagens', buildStoragePath(owner, chave, `${r.clientId}-${r.foto.name}`), r.foto,
          );
          imagemPorClientId.set(r.clientId, path);
        }
      }
      const variacoes = payloadEstender(resolvidas, skus, imagemPorClientId);

      const { data, error } = await supabase.functions.invoke('adicionar-variacoes-familia', {
        body: { familia_id: familiaCanonica.id, chave, variacoes },
      });
      if (error) {
        const detalhe = await corpoDoErroDaEdge(error);
        const conflitos = detalhe?.corpo.conflitos as string[] | undefined;
        // `validarGrade`/`validarEntrada` (edge) respondem com `erros: [{campo, mensagem}]` — é o
        // formato mais provável de 400 NESTE fluxo (par duplicado, numeração sem guia, etc.).
        // Mesmo helper `corpoDoErroDaEdge` do dialog atual; leitura de `erros[]` copiada de
        // `cadastrarProduto` (produtos-saldo.ts), já usada em outro fluxo desta tela.
        const erros = detalhe?.corpo.erros as Array<{ mensagem: string }> | undefined;
        throw new Error(erros?.length
          ? erros.map((e) => e.mensagem).join('\n')
          : conflitos?.length
            ? `${String(detalhe?.corpo.error)} (${conflitos.join(', ')})`
            : String(detalhe?.corpo.error ?? (error as Error).message));
      }
      const r = data as {
        loteId: string; familiaId: string; publicacaoOk: boolean; falhasEstoque: string[]; codigos: string[];
      };
      qc.invalidateQueries({ queryKey: QK.familiasNaoPublicadas });
      qc.invalidateQueries({ queryKey: QK.produtosEstoqueResumo });
      qc.invalidateQueries({ queryKey: QK.variacoesEstoque(produto.codigoPai) });
      qc.setQueryData(QK.variacoesRecemAdicionadas(produto.codigoPai), r.codigos);
      toast.success('✓ Grade estendida — atualizando o anúncio');
      if (!r.publicacaoOk) {
        toast.warning('Gravado, mas a publicação não foi disparada — conclua pela tela Lotes.');
      }
      if (r.falhasEstoque.length > 0) {
        toast.warning(`Estoque inicial não aplicado em: ${r.falhasEstoque.join(', ')}. Use "Dar entrada" para corrigir.`);
      }
      onFechar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao estender a grade.');
    } finally {
      setSalvando(false);
    }
  }

  const campoHerdavel = (campo: CampoHerdavel, obrigatorio = false) => {
    const { rotulo, prefixo, sufixo } = ROTULOS[campo];
    const id = `estender-cab-${campo}`;
    const erro = erroCampo(campo, cabecalho[campo]);
    return (
      <div key={campo} className="flex flex-col gap-1.5">
        <span className="flex items-baseline gap-1 text-sm font-medium">
          <label htmlFor={id}>{rotulo}</label>
          {obrigatorio && <span className="text-destructive" aria-hidden="true">*</span>}
        </span>
        <div className="relative">
          {prefixo && (
            <span className="pointer-events-none absolute inset-y-0 left-2 flex items-center text-xs text-muted-foreground">
              {prefixo}
            </span>
          )}
          <Input
            id={id}
            className={cn(prefixo && 'pl-8', sufixo && 'pr-8')}
            value={cabecalho[campo]}
            disabled={salvando}
            onChange={(e) => setCabecalho((prev) => ({ ...prev, [campo]: e.target.value }))}
          />
          {sufixo && (
            <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs text-muted-foreground">
              {sufixo}
            </span>
          )}
        </div>
        {erro && tentouSalvar && <span className="text-xs text-destructive">{erro}</span>}
      </div>
    );
  };

  // Cores sem foto herdável — novas ou já publicadas mas sem NENHUMA irmã com foto.
  const coresSemFotoHerdavel = eixos.cores.filter((cor) => fotoHerdavel(cor, skus) === null);

  return (
    <>
      <Dialog open={aberto} onOpenChange={(o) => { if (!o && !salvando) onFechar(); }}>
        {/* sm: obrigatório (tailwind-merge não funde `max-w-*` sem o mesmo prefixo do default do
            componente) — mesmo comentário de dialog-cadastro-grade.tsx:432-434. */}
        <DialogContent
          processando={salvando}
          rotuloProcessando="Enviando a grade nova ao Mercado Livre"
          className="max-h-[90vh] sm:max-w-5xl overflow-y-auto"
        >
          <DialogHeader>
            <DialogTitle>Adicionar à grade</DialogTitle>
            <DialogDescription>
              {produto?.nomePai}. Os SKUs novos vão direto para o Mercado Livre, sem passar pela
              Revisão. Os já publicados não mudam.
            </DialogDescription>
          </DialogHeader>

          {familiaPublicadaQuery.isError ? (
            // Sem isto a consulta que falha nunca sai de `data === undefined` e a tela ficava no
            // skeleton pra sempre (achado da revisão, rodada 1) — `isError` é o único sinal de
            // que não adianta esperar mais.
            <div className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
              <span>{MSG_ERRO_CARGA}</span>
            </div>
          ) : !familiaPublicada ? (
            <Skeleton className="h-40 w-full" />
          ) : classe === 'simples' ? null : (
            <div className="flex min-w-0 flex-col gap-4">
              {familiaCanonicaQuery.isError && (
                // A matriz continua legível (a família PUBLICADA carregou) — só falta o
                // `familia_id` que vai no payload. `podeSalvar` já trava sozinho por
                // `!!familiaCanonica`; este aviso é o motivo VISÍVEL (achado da revisão, rodada 1
                // — sem ele o botão travava sem explicação nenhuma).
                <div className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
                  <span>{MSG_ERRO_CARGA}</span>
                </div>
              )}

              {emVoo && (
                <div className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
                  <span>
                    Já existe uma atualização em andamento para este produto. Aguarde concluir na
                    tela Lotes.
                  </span>
                </div>
              )}

              <div className="flex items-center justify-between rounded-md border border-dashed px-3 py-2 text-sm">
                <span>{produto?.nomePai}</span>
                <span className="text-muted-foreground">
                  Gênero: {generoNorm ? ROTULO_GENERO[generoNorm] : '—'}
                </span>
              </div>

              {carregandoTipos ? (
                <Skeleton className="h-8 w-full" />
              ) : motivoBloqueioTipo ? (
                <div className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
                  <span>{motivoBloqueioTipo}</span>
                </div>
              ) : null}

              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">Valores das linhas novas</span>
                <span className="text-xs text-muted-foreground">
                  Preenchidos uma vez e herdados por toda a grade nova. Cada linha pode destravar
                  o campo que for exceção.
                </span>
                <div className="grid gap-3 sm:grid-cols-3">
                  {campoHerdavel('preco', true)}
                  {campoHerdavel('custo')}
                  {campoHerdavel('pesoGramas')}
                  {campoHerdavel('alturaCm')}
                  {campoHerdavel('larguraCm')}
                  {campoHerdavel('comprimentoCm')}
                </div>
              </div>

              <GeradorVariacoes
                gruposTamanho={gruposTamanho}
                cores={cores}
                tamanhos={tamanhos}
                coresBloqueadas={coresBloqueadas}
                tamanhosBloqueados={tamanhosBloqueados}
                bloquearNovaCor={bloquearNovaCor}
                avisoTamanho={avisoTamanho}
                desabilitado={salvando || bloqueadoPorTipo}
                coresFixas={eixosFixos.cores}
                tamanhosFixos={eixosFixos.tamanhos}
                onMudarCores={mudarCores}
                onMudarTamanhos={mudarTamanhos}
              />

              {coresSemFotoHerdavel.length > 0 && (
                <div className="flex flex-col gap-2">
                  <span className="text-sm font-medium">Foto por cor</span>
                  <span className="text-xs text-muted-foreground">
                    Cores novas precisam de foto. Tamanhos novos de cores já publicadas usam a
                    foto da cor.
                  </span>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {coresSemFotoHerdavel.map((cor, i) => (
                      <div key={cor} className="flex flex-col gap-1">
                        <span className="text-xs text-muted-foreground">{cor}</span>
                        <CampoFoto
                          id={`estender-foto-cor-${i}`}
                          ariaLabel={`Foto da cor ${cor}`}
                          arquivo={fotoPorCor[cor] ?? null}
                          disabled={salvando}
                          opcional
                          onEscolher={(f) => setFotoPorCor((prev) => ({ ...prev, [cor]: f }))}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {eixos.cores.length > 0 && eixos.tamanhos.length > 0 && (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Grade</span>
                    <span className="text-xs text-muted-foreground">
                      {linhas.length} SKU(s) novo(s) · {totais.geral} unidades
                    </span>
                  </div>
                  <MatrizGrade
                    linhas={linhas}
                    resolvidas={resolvidas}
                    cores={eixos.cores}
                    tamanhos={eixos.tamanhos}
                    removidas={removidas}
                    desabilitado={salvando || bloqueadoPorTipo}
                    bloqueadas={bloqueadas}
                    onMudarLinha={patchLinha}
                    onMudarOverride={patchOverride}
                    onDestravar={destravar}
                    onVoltarAHerdar={voltarAHerdar}
                    onRemoverCelula={removerLinha}
                    onReincluirCelula={reincluirLinha}
                    onAplicarMassa={aplicarMassa}
                  />
                </div>
              )}

              <span className="text-xs text-muted-foreground">* obrigatório</span>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={onFechar} disabled={salvando}>Cancelar</Button>
            <Button onClick={salvar} disabled={!podeSalvar || salvando}>
              {salvando ? 'Enviando…' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmar} onOpenChange={(o) => { if (!o) setConfirmar(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmar?.titulo}</AlertDialogTitle>
            <AlertDialogDescription>{confirmar?.texto}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continuar aqui</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { const c = confirmar; setConfirmar(null); c?.acao(); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {confirmar?.rotulo}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
