// Lógica de cadastro compartilhada pelos DOIS dialogs (cadastro normal e cadastro em grade).
// Extraída de dialog-cadastro-produto.tsx sem mudança de comportamento: os ~500 linhas de
// upload em lote / retry / 409 / chave idempotente eram closures internas do componente e não
// dava para reaproveitá-las sem duplicar. Os testes de dialog-cadastro-produto.test.tsx (900
// linhas) são a rede de segurança dessa extração.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { QK } from '@/lib/queries';
import { effectiveOrgId, useSupportStore, canWrite } from '@/stores/support-store';
import { storageOwnerForUpload } from '@/hooks/useUploadLote';
import {
  cadastrarProduto, uploadFotoProduto, ProdutoJaExisteError, CadastroResultadoAmbiguoError,
  type ResultadoCadastro,
} from '@/lib/produtos-saldo';
import type { ProdutoEntrada, VariacaoEntrada } from '@/lib/produto-entrada';
import { parseNum, type LinhaVariacao } from '@/components/estoque/linha-variacao-form';
import type { FiscalForm } from '@/components/estoque/etapa-fiscal-form';

export type AlvoFoto = Parameters<typeof uploadFotoProduto>[3];

// Todo campo numérico que `erroCampo` valida — usado pelo gate `podeSalvar` para travar o
// submit se QUALQUER um, em QUALQUER linha, tiver erro (não só `preco`).
export const CAMPOS_NUMERICOS = [
  'preco', 'custo', 'estoqueInicial', 'pesoGramas', 'alturaCm', 'larguraCm', 'comprimentoCm',
] as const;

// Normaliza `NaN` (texto inválido) para `null`. `podeSalvar` já garante que nenhum campo
// numérico de nenhuma linha tem erro antes de chegar aqui — NaN não deveria ocorrer; isto é
// só uma conversão defensiva de tipo, não a validação em si.
export function numOuNull(v: string): number | null {
  const n = parseNum(v);
  return typeof n === 'number' && !Number.isNaN(n) ? n : null;
}

export function montarPayload(
  pai: {
    nomePai: string; descricaoPai: string; unidade: string; fornecedor: string;
    origem: 'nacional' | 'importado';
    genero: 'masculino' | 'feminino' | 'unissex' | null;
  },
  linhas: LinhaVariacao[],
  chaveCadastro: string,
  // ADR-0135: só a org com o módulo fiscal preenche a etapa fiscal — sem módulo, `fiscal` fica
  // `undefined` e o payload sai byte a byte igual ao de hoje.
  fiscal?: FiscalForm,
): ProdutoEntrada {
  const variacoes: VariacaoEntrada[] = linhas.map((l) => ({
    nome: l.nome.trim() || null,
    // ADR-0166: string vazia vira null — a edge normaliza de novo, mas mandar '' faria o guard
    // de retry comparar '' contra null e divergir num retry legítimo.
    tamanho: l.tamanho.trim() || null,
    gtin: l.gtin.trim() || null,
    preco: numOuNull(l.preco) ?? 0,
    custo: numOuNull(l.custo),
    estoqueInicial: numOuNull(l.estoqueInicial),
    pesoGramas: numOuNull(l.pesoGramas),
    alturaCm: numOuNull(l.alturaCm),
    larguraCm: numOuNull(l.larguraCm),
    comprimentoCm: numOuNull(l.comprimentoCm),
  }));
  return {
    nomePai: pai.nomePai.trim(),
    descricaoPai: pai.descricaoPai.trim() || null,
    unidade: pai.unidade.trim() || null,
    fornecedor: pai.fornecedor.trim() || null,
    origem: pai.origem,
    genero: pai.genero,
    chaveCadastro,
    variacoes,
    ...(fiscal ? {
      fiscal: {
        ncm: fiscal.ncm,
        cest: fiscal.cest || null,
        origemNfe: Number(fiscal.origemNfe),
        fci: fiscal.fci || null,
        exTipi: fiscal.exTipi || null,
        tributacaoIcms: fiscal.tributacaoIcms,
      },
    } : {}),
  };
}

export interface FotosDoCadastro {
  capa: Record<'capa' | 'capa2' | 'capa3', File | null>;
  /** Foto JÁ RESOLVIDA por linha, na MESMA ordem das `variacoes` do payload. O dialog de grade
   *  resolve a herança por cor (`resolverLinha`) ANTES de chamar — o hook nunca sabe de herança. */
  porLinha: (File | null)[];
}

export interface CadastroProdutoApi {
  chaveCadastro: string;
  salvando: boolean;
  resultado: ResultadoCadastro | null;
  enviandoFoto: boolean;
  enviandoFotos: { feitos: number; total: number } | null;
  falhasFoto: string[];
  fotosEnviadas: Set<string>;
  trocando: Set<string>;
  divergencia: { mensagem: string; loteId: string } | null;
  confirmarFechar: (() => void) | null;
  /** Alguma operação de rede em voo — fechar aqui é destrutivo. */
  ocupado: boolean;
  /** Cadastro gravado mas incompleto (fila ou estoque) — trava "Ir para a Revisão". */
  pendencias: boolean;
  salvar: (payload: ProdutoEntrada, fotos: FotosDoCadastro) => Promise<void>;
  subirFoto: (arquivo: File, alvo: AlvoFoto, loteId: string) => Promise<void>;
  reprocessar: (familiaId: string) => Promise<void>;
  comConfirmacao: (acao: () => void) => void;
  fecharConfirmacao: () => void;
  marcarEnviada: (chave: string) => void;
  marcarTrocando: (chave: string) => void;
  /** Um retry manual bem-sucedido tem que sair de `trocando`, senão o card não volta ao estado
   *  "✓ enviada" — é o comportamento de hoje, coberto pelo teste do item 1 da auditoria. */
  limparTrocando: (chave: string) => void;
  limparFalha: (rotulo: string) => void;
  irParaRevisao: (loteId: string) => void;
}

export function useCadastroProduto(
  { aberto, onCadastrado }: { aberto: boolean; onCadastrado?: () => void },
): CadastroProdutoApi {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [chaveCadastro, setChaveCadastro] = useState(() => crypto.randomUUID());
  const [resultadoAmbiguo, setResultadoAmbiguo] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoCadastro | null>(null);
  const [enviandoFoto, setEnviandoFoto] = useState(false);
  const [enviandoFotos, setEnviandoFotos] = useState<{ feitos: number; total: number } | null>(null);
  const [falhasFoto, setFalhasFoto] = useState<string[]>([]);
  const [fotosEnviadas, setFotosEnviadas] = useState<Set<string>>(new Set());
  const [trocando, setTrocando] = useState<Set<string>>(new Set());
  const [divergencia, setDivergencia] = useState<{ mensagem: string; loteId: string } | null>(null);
  const [confirmarFechar, setConfirmarFechar] = useState<(() => void) | null>(null);

  // Reset ao FECHAR. `chaveCadastro` só regenera se o último resultado foi CONHECIDO — resultado
  // ambíguo (rede) preserva a chave pro retry ser reconhecido pela idempotência da edge, em vez
  // de criar um segundo produto.
  useEffect(() => {
    if (aberto) return;
    setResultado(null);
    if (!resultadoAmbiguo) setChaveCadastro(crypto.randomUUID());
    setDivergencia(null);
    setEnviandoFotos(null);
    setFalhasFoto([]);
    setFotosEnviadas(new Set());
    setTrocando(new Set());
    setConfirmarFechar(null);
  }, [aberto, resultadoAmbiguo]);

  const ocupado = salvando || enviandoFoto || enviandoFotos !== null;
  const pendencias = !!resultado && (!resultado.filaOk || resultado.falhasEstoque.length > 0);

  // `loteId` explícito (não lido de `resultado`): quando chamada pelo lote logo após
  // `setResultado(r)`, o state ainda não re-renderizou.
  async function subirFoto(arquivo: File, alvo: AlvoFoto, loteId: string) {
    setEnviandoFoto(true);
    try {
      const { data: ud } = await supabase.auth.getUser();
      const userId = ud.user?.id;
      const orgId = effectiveOrgId();
      if (!userId || !orgId) throw new Error('Sem sessão ou organização.');
      if (!canWrite()) throw new Error('Suporte somente leitura.');
      const owner = storageOwnerForUpload(userId, orgId, useSupportStore.getState().context?.scope ?? null);
      await uploadFotoProduto(owner, loteId, arquivo, alvo);
      qc.invalidateQueries({ queryKey: QK.produtosEstoqueResumo });
      toast.success('✓ Foto enviada');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao enviar a foto.');
      throw e;
    } finally {
      setEnviandoFoto(false);
    }
  }

  /**
   * Casamento POSICIONAL, correto por quatro invariantes encadeados:
   *   1. derivarCodigos numera na ordem do array           (_shared/produto/codigos.ts:38)
   *   2. montarLinhasProduto casa variacoes[i] ↔ codigos[i] (_shared/produto/validar.ts:102)
   *   3. a edge ordena a resposta por codigo                (cadastrar-produto/index.ts:256)
   *   4. todo codigo tem 8 digitos, entao ordem lexicografica = numerica
   * Se qualquer um deles mudar, a foto vai para o SKU errado EM SILENCIO.
   *
   * Contagem divergente = retry idempotente devolveu o cadastro ORIGINAL da edge, que pode ter
   * outra quantidade de variações. Pular o casamento é mais seguro que arriscar o índice errado.
   */
  async function subirLoteDeFotos(r: ResultadoCadastro, fotos: FotosDoCadastro) {
    const alvos: Array<{ arquivo: File; alvo: AlvoFoto; rotulo: string; chave: string }> = [];
    (['capa', 'capa2', 'capa3'] as const).forEach((tipo) => {
      const arquivo = fotos.capa[tipo];
      const rotulo = tipo === 'capa' ? 'Capa' : tipo === 'capa2' ? 'Capa 2' : 'Capa 3';
      if (arquivo) alvos.push({ arquivo, alvo: { tipo, familiaId: r.familiaId }, rotulo, chave: tipo });
    });
    const falhas: string[] = [];
    if (fotos.porLinha.length !== r.variacoes.length) {
      fotos.porLinha.forEach((f, i) => {
        if (f) falhas.push(`Variação (linha ${i + 1}, contagem divergente — vá pra Revisão)`);
      });
    } else {
      fotos.porLinha.forEach((f, i) => {
        const v = r.variacoes[i];
        if (f && v) {
          alvos.push({ arquivo: f, alvo: { tipo: 'variacao', variacaoId: v.id }, rotulo: v.codigo, chave: v.id });
        }
      });
    }
    if (alvos.length === 0 && falhas.length === 0) return;

    if (alvos.length > 0) {
      setEnviandoFotos({ feitos: 0, total: alvos.length });
      const enviadosNesteLote: string[] = [];
      for (const [i, a] of alvos.entries()) {
        try {
          await subirFoto(a.arquivo, a.alvo, r.loteId);
          enviadosNesteLote.push(a.chave);
        } catch {
          falhas.push(a.rotulo);
        }
        setEnviandoFotos({ feitos: i + 1, total: alvos.length });
      }
      setEnviandoFotos(null);
      setFotosEnviadas((prev) => new Set([...prev, ...enviadosNesteLote]));
    }
    setFalhasFoto(falhas);
  }

  async function salvar(payload: ProdutoEntrada, fotos: FotosDoCadastro) {
    setSalvando(true);
    setResultadoAmbiguo(false);
    try {
      const r = await cadastrarProduto(payload);
      setResultado(r);
      onCadastrado?.();
      setChaveCadastro(crypto.randomUUID());
      qc.invalidateQueries({ queryKey: QK.produtosEstoqueResumo });
      await subirLoteDeFotos(r, fotos);
      // Segunda invalidação OBRIGATÓRIA: `imagem_path`/`capa_storage_path` só são gravados
      // dentro de uploadFotoProduto, depois da primeira.
      qc.invalidateQueries({ queryKey: QK.produtosEstoqueResumo });
      if (r.filaOk && r.falhasEstoque.length === 0) toast.success('✓ Produto cadastrado');
    } catch (e) {
      if (e instanceof ProdutoJaExisteError) {
        setDivergencia({ mensagem: e.message, loteId: e.loteId });
        toast.error(e.message, {
          action: { label: 'Abrir na Revisão', onClick: () => navigate(`/revisao/${e.loteId}`) },
        });
      } else if (e instanceof CadastroResultadoAmbiguoError) {
        setResultadoAmbiguo(true);
        toast.error(e.message);
      } else {
        toast.error(e instanceof Error ? e.message : 'Falha ao cadastrar o produto.');
      }
    } finally {
      setSalvando(false);
    }
  }

  async function reprocessar(familiaId: string) {
    try {
      const { error } = await supabase.functions.invoke('reprocessar-familia', { body: { familia_id: familiaId } });
      if (error) throw error;
      toast.success('✓ Reenfileirado para o enriquecimento por IA');
      setResultado((r) => (r ? { ...r, filaOk: true } : r));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao reprocessar.');
    }
  }

  // Guarda ÚNICA por onde toda saída destrutiva passa — Escape, clique fora, "Cancelar",
  // "Fechar" e "Ir para a Revisão".
  function comConfirmacao(acao: () => void) {
    if (ocupado) return;
    if (falhasFoto.length > 0) { setConfirmarFechar(() => acao); return; }
    acao();
  }

  return {
    chaveCadastro, salvando, resultado, enviandoFoto, enviandoFotos, falhasFoto,
    fotosEnviadas, trocando, divergencia, confirmarFechar, ocupado, pendencias,
    salvar, subirFoto, reprocessar, comConfirmacao,
    fecharConfirmacao: () => setConfirmarFechar(null),
    marcarEnviada: (chave) => setFotosEnviadas((prev) => new Set(prev).add(chave)),
    marcarTrocando: (chave) => setTrocando((prev) => new Set(prev).add(chave)),
    limparTrocando: (chave) => setTrocando((prev) => { const p = new Set(prev); p.delete(chave); return p; }),
    limparFalha: (rotulo) => setFalhasFoto((prev) => prev.filter((x) => x !== rotulo)),
    irParaRevisao: (loteId) => navigate(`/revisao/${loteId}`),
  };
}

/**
 * Sugestão de NCM pela IA, compartilhada pelos dois dialogs.
 *
 * A flag `ignore` NÃO é cerimônia: os dois dialogs ficam MONTADOS permanentemente nos call sites
 * (Estoque.tsx, viabilidade-linha.tsx), então fechar antes de a resposta chegar não cancela o
 * fetch. Sem ela, a resposta do produto A resolvia depois de fechado e aplicava o NCM de A no
 * produto B, reaberto com outro nome, rotulado "Sugerida por IA" (Fix round 1 / F1).
 *
 * O cleanup roda sempre que `aberto` OU `etapaFiscal` mudam — inclusive ao fechar, mesmo com
 * `etapaFiscal` ainda `true` nesse instante. `!aberto` no guard evita que reabrir a MESMA etapa
 * fiscal dispare um fetch novo antes de o reset (que já limpa a sugestão) rodar.
 *
 * `nome`/`descricao` são lidos DENTRO do efeito e de propósito NÃO entram nas dependências (é o
 * comportamento de hoje: a sugestão é pedida uma vez ao entrar na etapa fiscal, não a cada tecla).
 */
export function useSugestaoNcm(
  { aberto, etapaFiscal, nome, descricao }:
    { aberto: boolean; etapaFiscal: boolean; nome: string; descricao: string },
) {
  const [sugestao, setSugestao] = useState<{ ncm: string; justificativa: string } | null>(null);
  const [carregando, setCarregando] = useState(false);

  // Reset ao FECHAR — é exatamente onde o dialog de hoje limpa `sugestaoNcm` (efeito de reset
  // com dependência `[aberto]`). Sai do dialog e entra aqui junto com o state que ele limpa.
  useEffect(() => {
    if (!aberto) setSugestao(null);
  }, [aberto]);

  useEffect(() => {
    if (!aberto || !etapaFiscal || sugestao || carregando) return;
    let ignore = false;
    setCarregando(true);
    supabase.functions.invoke('sugerir-ncm', { body: { nome, descricao: descricao || undefined } })
      .then(({ data, error }) => {
        if (ignore || error) return;
        const r = data as { ncm: string | null; justificativa: string };
        if (r?.ncm) setSugestao({ ncm: r.ncm, justificativa: r.justificativa });
      })
      .catch(() => {})
      .finally(() => setCarregando(false));
    return () => { ignore = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [etapaFiscal, aberto]);

  return { sugestao, carregando, limpar: () => setSugestao(null) };
}
