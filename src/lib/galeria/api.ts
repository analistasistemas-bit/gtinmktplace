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
  /** `url` vem resolvida da edge (assinada ou secure_url do ML); a tela nunca monta URL de CDN. */
  foto?: { origem: 'referencia' | 'ml'; ref: string; url?: string } | null;
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

/** Resposta de `ler`: roteiro vigente da família (ou null) e Moda ao vivo (null = categoria ilegível, com `aviso`). */
export type RespostaLer = { roteiro: null; moda: boolean | null; familia_id: string; aviso?: string }
  | (RespostaRoteiro & { moda: boolean | null; familia_id: string; aviso?: string });

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

export const lerRoteiro = (mlItemId: string) => chamar<RespostaLer>('galeria-roteiro', { acao: 'ler', ml_item_id: mlItemId });

const roteiro = (acao: string, mlItemId: string, familiaId: string, extra: Record<string, unknown> = {}) =>
  chamar<RespostaRoteiro>('galeria-roteiro', { acao, ml_item_id: mlItemId, familia_id: familiaId, ...extra });

export const criarRoteiro = (mlItemId: string, familiaId: string) => roteiro('criar', mlItemId, familiaId);
export const salvarRoteiro = (mlItemId: string, familiaId: string, roteiroId: string, conteudo: Roteiro) =>
  roteiro('salvar', mlItemId, familiaId, { roteiro_id: roteiroId, conteudo });
export const aprovarRoteiro = (mlItemId: string, familiaId: string, roteiroId: string, cienciaNaoConferido: string[]) =>
  chamar<{ roteiro_id: string; status: 'aprovado'; fatos_hash: string }>('galeria-roteiro', {
    acao: 'aprovar', ml_item_id: mlItemId, familia_id: familiaId, roteiro_id: roteiroId, ciencia_nao_conferido: cienciaNaoConferido,
  });

// Task 10: geração (`galeria-gerar`) e imagens (`galeria-imagens`). O preço vem sempre do servidor.
export interface AlertaImagem { tipo: string; nota: string }
export interface ImagemGaleria {
  id: string; cor: string; missao: number; geracao: number; origem: 'gerador' | 'recorte'; status: string;
  /** null = verificação por visão ainda não respondeu. */
  alertas: AlertaImagem[] | null; erro: string | null;
  /** Já confirmada (cobrada): a tela não confirma de novo. */
  exibida: boolean; url: string | null;
  /** Regra da RPC calculada no servidor: false com 3 gerações válidas ou geração aberta na (cor, missão). */
  pode_gerar_de_novo: boolean;
}
export interface RespostaListar { roteiro_id: string | null; unit_cents: number; imagens: ImagemGaleria[] }

export const listarImagens = (mlItemId: string, roteiroVersao: number) =>
  chamar<RespostaListar>('galeria-imagens', { acao: 'listar', ml_item_id: mlItemId, roteiro_versao: roteiroVersao });
export const confirmarExibicao = (mlItemId: string, imagemIds: string[]) =>
  chamar<{ cobradas: number }>('galeria-imagens', { acao: 'confirmar_exibicao', ml_item_id: mlItemId, imagem_ids: imagemIds });
export const reportarInvalida = (mlItemId: string, imagemId: string) =>
  chamar<{ reportada: boolean }>('galeria-imagens', { acao: 'reportar_invalida', ml_item_id: mlItemId, imagem_id: imagemId });
export const gerarImagens = (mlItemId: string, p: { pedidoId: string; roteiroVersao: number; cores: string[]; missoes: number[]; unitCentsExibido: number }) =>
  chamar<{ pedido_id: string; imagens: unknown[] }>('galeria-gerar', {
    pedido_id: p.pedidoId, ml_item_id: mlItemId, roteiro_versao: p.roteiroVersao, cores: p.cores, missoes: p.missoes,
    unit_cents_exibido: p.unitCentsExibido,
  });

const MENSAGENS: Record<string, string> = {
  catalogo: 'Anúncio de catálogo: a galeria não troca fotos de catálogo.',
  catalogo_desconhecido: 'Não foi possível confirmar no Mercado Livre se o anúncio é de catálogo.',
  conjunto_incompleto: 'Há SKU desta cor sem variação publicada no cadastro.',
  sem_anuncio: 'O anúncio desta linha não foi encontrado.',
  variacao_nao_casa: 'A variação da cor não confere com o anúncio no Mercado Livre.',
  roteiro_nao_aprovado: 'O roteiro aprovado mudou. Recarregue a galeria.',
  'conteudo.ciencia_nao_conferido': 'Há fatos não conferidos usados no texto. Volte ao roteiro e marque a ciência.',
  sem_vista: 'Falta a foto de referência da vista exigida pela missão.',
  teto: 'Limite de 3 gerações por missão neste roteiro.',
  em_andamento: 'Já há uma geração em andamento nesta missão.',
  missao_inativa: 'Há missão desativada no roteiro aprovado.',
  cor_invalida: 'Cor fora deste anúncio.',
  sem_conexao_ml: 'Conecte a conta do Mercado Livre para gerar imagens.',
  modulo_desligado: 'O módulo de imagens por IA não está ligado nesta organização.',
  ml_indisponivel: 'Mercado Livre indisponível, tente de novo.',
  pedido_de_outro_anuncio: 'Este pedido pertence a outro anúncio.',
  pedido_invalido: 'Pedido inválido.',
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
