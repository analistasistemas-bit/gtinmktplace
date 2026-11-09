// ADR-0201 (Galeria da cor por IA), Task 7b: uma função por ação das edges `galeria-fatos` e `galeria-roteiro`.
// Identidade = a linha de Publicados (`ml_item_id`); nunca `familia_id` sozinho (linhas split dividem a família).
// `functions.invoke` não popula `data` em não-2xx: status e corpo vêm de `corpoDoErroDaEdge`.
import { supabase } from '@/lib/supabase';
import { corpoDoErroDaEdge } from '@/lib/edge-erro';

export type EstadoFato = 'CONFIRMADO' | 'SUGERIDO' | 'DIVERGENTE' | 'NAO_CONFERIDO' | 'VARIA_POR_TAMANHO';
export interface Caixa { x: number; y: number; w: number; h: number }
export interface LeituraEtiqueta {
  legivel: boolean;
  valor?: string | null;
  foto?: { origem: 'referencia' | 'ml'; ref: string } | null;
  caixa?: Caixa | null;
}
export interface Fato {
  campo: string; valor: string; estado: EstadoFato; origem: string;
  evidencia?: Record<string, unknown>; etiqueta?: LeituraEtiqueta;
}
export type Vista = 'frente' | 'costas' | 'lateral';
export interface Ficha {
  anuncio_externo_id: string; familia_id: string; codigo_pai: string; cores: string[];
  fatos: Fato[]; fatos_hash: string; roteiro_desatualizado: boolean;
  referencias: Record<string, Partial<Record<Vista, { path?: string; erro?: string }>>>;
}

export interface MissaoRoteiro {
  missao: number; ativa: boolean; cena: string;
  headline?: string; subheadline?: string; beneficios?: string[];
  specs?: Array<{ campo: string; rotulo: string; valor: string }>;
  etapas?: string[]; legendas?: string[]; fatosUsados: string[];
}
export interface Roteiro {
  categoria: string; contrato: string; missoes: MissaoRoteiro[];
  ciencia_nao_conferido?: { campos: string[]; por: string; em: string };
}
export interface LinhaRoteiro { id: string; familia_id: string; versao: number; status: string; moda: boolean; conteudo: Roteiro }
export interface RespostaRoteiro {
  roteiro: LinhaRoteiro; erros: string[]; erros_por_missao: Record<string, string[]>; ciencia_pendente: string[]; fatos: Fato[];
}

export type Res<T> = { ok: true; dados: T } | { ok: false; status: number; erro: string; corpo: Record<string, unknown> };

async function chamar<T>(edge: string, body: Record<string, unknown>): Promise<Res<T>> {
  const { data, error } = await supabase.functions.invoke(edge, { body });
  if (!error) return { ok: true, dados: data as T };
  const d = await corpoDoErroDaEdge(error);
  return { ok: false, status: d?.status ?? 0, erro: typeof d?.corpo.error === 'string' ? d.corpo.error : 'rede', corpo: d?.corpo ?? {} };
}

const fatos = (acao: string, mlItemId: string, extra: Record<string, unknown> = {}) =>
  chamar<Ficha>('galeria-fatos', { acao, ml_item_id: mlItemId, ...extra });

export const montarFicha = (mlItemId: string) => fatos('montar', mlItemId);
export const confirmarFato = (mlItemId: string, familiaId: string, campo: string) => fatos('confirmar', mlItemId, { familia_id: familiaId, campo });
export const descartarFato = (mlItemId: string, familiaId: string, campo: string) => fatos('descartar', mlItemId, { familia_id: familiaId, campo });
export const manterCadastro = (mlItemId: string, familiaId: string, campo: string) => fatos('manter_cadastro', mlItemId, { familia_id: familiaId, campo });
export const corrigirCadastro = (mlItemId: string, familiaId: string, campo: string, valor: string) =>
  fatos('corrigir_cadastro', mlItemId, { familia_id: familiaId, campo, valor });
export const enviarVista = (mlItemId: string, familiaId: string, cor: string, vista: 'costas' | 'lateral', imagemBase64: string) =>
  fatos('enviar_vista', mlItemId, { familia_id: familiaId, cor, vista, imagem_base64: imagemBase64 });

const roteiro = (acao: string, mlItemId: string, familiaId: string, extra: Record<string, unknown> = {}) =>
  chamar<RespostaRoteiro>('galeria-roteiro', { acao, ml_item_id: mlItemId, familia_id: familiaId, ...extra });

export const criarRoteiro = (mlItemId: string, familiaId: string) => roteiro('criar', mlItemId, familiaId);
export const salvarRoteiro = (mlItemId: string, familiaId: string, roteiroId: string, conteudo: Roteiro) =>
  roteiro('salvar', mlItemId, familiaId, { roteiro_id: roteiroId, conteudo });
export const aprovarRoteiro = (mlItemId: string, familiaId: string, roteiroId: string, cienciaNaoConferido: string[]) =>
  chamar<{ roteiro_id: string; status: 'aprovado'; fatos_hash: string }>('galeria-roteiro', {
    acao: 'aprovar', ml_item_id: mlItemId, familia_id: familiaId, roteiro_id: roteiroId, ciencia_nao_conferido: cienciaNaoConferido,
  });

const MENSAGENS: Record<string, string> = {
  familia_nao_vigente: 'A família do anúncio mudou. Recarregamos a ficha; confira e tente de novo.',
  anuncio_ambiguo: 'Não foi possível identificar este anúncio de forma única.',
  categoria_mudou: 'A categoria do anúncio mudou (Moda × outras). Este roteiro não vale mais: crie um novo.',
  conteudo_mudou: 'O roteiro foi alterado em outra aba depois que você o abriu. Recarregamos; confira e aprove de novo.',
  categoria_indisponivel: 'Não foi possível ler a categoria no Mercado Livre agora. Tente de novo em instantes.',
  fato_divergente: 'Há fatos divergentes da etiqueta. Resolva-os na ficha antes de criar o roteiro.',
  ciencia_pendente: 'Marque a ciência dos fatos não conferidos usados no texto.',
  roteiro_invalido: 'O roteiro tem erros. Corrija nas missões indicadas.',
  roteiro_ia_falhou: 'A IA não conseguiu montar o roteiro. Tente de novo.',
  foto_nao_jpeg: 'Envie a foto em JPEG.',
  foto_invalida: 'Foto inválida ou grande demais (máx. 8 MB).',
  valor_invalido: 'O valor da etiqueta não é aceito para este atributo.',
  nao_rascunho: 'Este roteiro já foi aprovado. Edite para gerar uma nova versão.',
  falha_interna: 'Erro interno. Tente de novo.',
  rede: 'Sem conexão com o servidor.',
};
export const mensagemErro = (e: string) => MENSAGENS[e] ?? `Erro: ${e}`;
/** Erros que mudam o chão do operador: recarregar a ficha e descartar o roteiro em tela. */
export const ERROS_DE_RECARGA = new Set(['familia_nao_vigente', 'categoria_mudou', 'conteudo_mudou']);
