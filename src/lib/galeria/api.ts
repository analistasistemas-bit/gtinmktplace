// ADR-0203: uma função por ação das edges `galeria-gerar`, `galeria-imagens`, `galeria-aprovar` e `galeria-aplicar`.
// Identidade = a linha de Publicados (`ml_item_id`); nunca `familia_id` sozinho (linhas split dividem a família).
// `functions.invoke` não popula `data` em não-2xx: status e corpo vêm de `corpoDoErroDaEdge`.
import { supabase } from '@/lib/supabase';
import { corpoDoErroDaEdge } from '@/lib/edge-erro';

export type Res<T> = { ok: true; dados: T } | { ok: false; status: number; erro: string; corpo: Record<string, unknown> };

async function chamar<T>(edge: string, body: Record<string, unknown>): Promise<Res<T>> {
  const { data, error } = await supabase.functions.invoke(edge, { body });
  if (!error) return { ok: true, dados: data as T };
  const d = await corpoDoErroDaEdge(error);
  return { ok: false, status: d?.status ?? 0, erro: typeof d?.corpo.error === 'string' ? d.corpo.error : 'rede', corpo: d?.corpo ?? {} };
}

// ADR-0203 (tela única): geração (`galeria-gerar`) e imagens (`galeria-imagens`). O preço vem sempre do servidor.
export interface AlertaImagem { tipo: string; nota: string }
export interface ImagemGaleria {
  /** `missao` = número da posição (1..7) no plano. */
  id: string; cor: string; missao: number; geracao: number; status: string;
  /** null = a conferência do texto da imagem ainda não terminou. */
  alertas: AlertaImagem[] | null; erro: string | null;
  /** Já confirmada (cobrada): a tela não confirma de novo. */
  exibida: boolean; url: string | null;
  /** Só aprova a do plano vigente (`plano_id`); as de roteiro antigo ficam sem Aprovar. */
  roteiro_id: string;
  /** Regra da RPC calculada no servidor: false com geração aberta, teto ou fora do plano vigente. */
  pode_gerar_de_novo: boolean;
  /** Preço congelado no pedido desta imagem (o que a RPC cobra ao exibir). */
  unit_cents: number | null;
}
export interface PosicaoGaleria { posicao: number; nome: string; indisponivel?: string }
/** `unit_cents` = preço do mês, só para pedido novo. `plano_id` = roteiro aprovado em formato 2 (null = ainda sem plano). */
export interface RespostaListar {
  titulo: string | null; cores: string[]; moda: boolean | null; unit_cents: number;
  posicoes: PosicaoGaleria[]; plano_id: string | null; imagens: ImagemGaleria[];
}

export const listarImagens = (mlItemId: string) =>
  chamar<RespostaListar>('galeria-imagens', { acao: 'listar', ml_item_id: mlItemId });
export const confirmarExibicao = (mlItemId: string, imagemIds: string[]) =>
  chamar<{ cobradas: number }>('galeria-imagens', { acao: 'confirmar_exibicao', ml_item_id: mlItemId, imagem_ids: imagemIds });
export const reportarInvalida = (mlItemId: string, imagemId: string) =>
  chamar<{ reportada: boolean }>('galeria-imagens', { acao: 'reportar_invalida', ml_item_id: mlItemId, imagem_id: imagemId });
export const gerarImagens = (mlItemId: string, p: { pedidoId: string; cores: string[]; missoes: number[]; unitCentsExibido: number; confirmarTroca?: boolean }) =>
  chamar<{ pedido_id: string; imagens: unknown[] }>('galeria-gerar', {
    pedido_id: p.pedidoId, ml_item_id: mlItemId, cores: p.cores, missoes: p.missoes,
    unit_cents_exibido: p.unitCentsExibido,
    ...(p.confirmarTroca ? { confirmar_troca: true } : {}),
  });

// Task 12: arquivo final composto no navegador → URL de upload assinada (upsert:false) → aprovar (`galeria-aprovar`).
export const prepararUploadFinal = (mlItemId: string, imagemId: string) =>
  chamar<{ path: string; token: string; signed_url: string }>('galeria-aprovar', { acao: 'preparar_upload', ml_item_id: mlItemId, imagem_id: imagemId });
export const aprovarFinal = (mlItemId: string, imagemId: string) =>
  chamar<{ status: 'aprovada' }>('galeria-aprovar', { acao: 'aprovar', ml_item_id: mlItemId, imagem_id: imagemId });
/** null = enviado; senão a mensagem do Storage. */
export async function enviarFinal(path: string, token: string, arquivo: Blob): Promise<string | null> {
  const { error } = await supabase.storage.from('imagens').uploadToSignedUrl(path, token, arquivo, { contentType: 'image/jpeg' });
  return error ? error.message : null;
}

// Task 15: aplicar e reverter no ML (`galeria-aplicar`, só admin). Toda ação leva o `ml_item_id` da própria linha.
export type ModoAplicar = 'substituir' | 'adicionar';
export interface ManifestoItem { imagem_id: string; missao: number; final_sha256: string | null }
/** Prévia de um MLB (Fase C2): fotos da cor hoje (`sai` = riscada) e depois (`nova` = aprovada que entra). */
export interface PreviaItem {
  item_id: string;
  /** Variações da cor neste MLB que o Confirmar altera (a prévia mostra só a 1ª). Ausente = edge anterior. */
  variacoes?: number;
  antes: Array<{ id: string; url: string | null; sai: boolean }>;
  depois: Array<{ id: string; url: string | null; nova: boolean; missao?: number }>;
}
/** `previa` ausente = edge anterior à Fase C2 (a tela mostra só a lista de MLB e de imagens). */
export interface AplicacaoPreparada { aplicacao_id: string; status: 'preparada'; itens: string[]; manifesto: ManifestoItem[]; previa?: PreviaItem[] }
export interface ItemAplicacao {
  item_id: string; status: string; erro: string | null;
  /** Progresso da ida (ausente = edge anterior): fotos enviadas de `fotos_total`, troca feita e conferida. */
  fotos_total?: number; fotos_enviadas?: number; trocado?: boolean; conferido?: boolean;
}
export interface EstadoAplicacao {
  id: string; cor: string; modo: ModoAplicar; status: string; manifesto: ManifestoItem[]; itens: ItemAplicacao[];
}
/** Aplicações que ainda andam sozinhas no servidor: a tela repete a leitura enquanto houver uma. */
export const APLICACAO_EM_ANDAMENTO = new Set(['em_andamento', 'abortando', 'revertendo']);

const aplicar = <T,>(acao: string, mlItemId: string, extra: Record<string, unknown> = {}) =>
  chamar<T>('galeria-aplicar', { acao, ml_item_id: mlItemId, ...extra });
export const prepararAplicacao = (mlItemId: string, cor: string, modo: ModoAplicar) =>
  aplicar<AplicacaoPreparada>('preparar', mlItemId, { cor, modo });
export const confirmarAplicacao = (mlItemId: string, aplicacaoId: string) =>
  aplicar<{ status: 'em_andamento' }>('confirmar', mlItemId, { aplicacao_id: aplicacaoId });
export const reverterAplicacao = (mlItemId: string, aplicacaoId: string) =>
  aplicar<{ status: 'revertendo' }>('reverter', mlItemId, { aplicacao_id: aplicacaoId });
export const estadoAplicacoes = (mlItemId: string) =>
  aplicar<{ aplicacoes: EstadoAplicacao[] }>('estado', mlItemId);

const MENSAGENS: Record<string, string> = {
  catalogo: 'Anúncio de catálogo: a galeria não troca fotos de catálogo.',
  catalogo_desconhecido: 'Não foi possível confirmar no Mercado Livre se o anúncio é de catálogo.',
  conjunto_incompleto: 'Há tamanho desta cor ainda não publicado no anúncio.',
  sem_anuncio: 'O anúncio desta linha não foi encontrado.',
  variacao_nao_casa: 'A variação da cor não confere com o anúncio no Mercado Livre.',
  roteiro_nao_aprovado: 'Estas imagens são de uma versão anterior. Gere e aprove de novo.',
  sem_vista: 'Falta a foto de referência (costas ou lateral) que esta imagem exige.',
  teto: 'Você já gerou esta imagem 3 vezes.',
  em_andamento: 'Esta imagem já está sendo gerada.',
  cor_invalida: 'Cor fora deste anúncio.',
  sem_conexao_ml: 'Conecte a conta do Mercado Livre para gerar imagens.',
  modulo_desligado: 'O módulo de imagens por IA não está ligado nesta organização.',
  ml_indisponivel: 'Mercado Livre indisponível, tente de novo.',
  pedido_de_outro_anuncio: 'Este pedido pertence a outro anúncio.',
  pedido_invalido: 'Pedido inválido. Tente de novo.',
  familia_nao_vigente: 'O cadastro do anúncio mudou. Recarregamos os dados; confira e tente de novo.',
  anuncio_ambiguo: 'Não foi possível identificar este anúncio de forma única.',
  categoria_indisponivel: 'Não foi possível ler a categoria no Mercado Livre agora. Tente de novo em instantes.',
  ja_aprovada: 'Esta imagem já está aprovada.',
  desatualizada: 'Os dados do anúncio mudaram. Gere as imagens de novo.',
  plano_ia_falhou: 'Não foi possível preparar as imagens agora. Tente de novo.',
  plano_invalido: 'Não foi possível preparar as imagens agora. Tente de novo.',
  posicao_indisponivel: 'Faltam dados do produto para esta imagem.',
  plano_desatualizado: 'Os dados do anúncio mudaram.',
  sem_referencia: 'Falta a foto real desta cor no cadastro.',
  plano_antigo: 'Esta imagem é de uma versão anterior. Gere de novo.',
  // Erros gravados pelo worker na imagem (`galeria_imagens.erro`).
  roteiro_trocado: 'Os dados do anúncio mudaram enquanto a imagem era gerada. Gere de novo.',
  queda_repetida: 'A geração caiu duas vezes. Tente de novo.',
  cena_inutil: 'O gerador devolveu uma imagem inválida. Tente de novo.',
  provedor_indisponivel: 'O gerador de imagens está fora do ar. Tente de novo em instantes.',
  prazo_esgotado: 'A geração demorou demais. Tente de novo.',
  nao_aprovavel: 'Esta imagem não pode ser aprovada agora. Gere de novo ou recarregue a página.',
  nao_encontrada: 'Imagem não encontrada neste anúncio.',
  sem_upload: 'O arquivo final não foi preparado. Tente aprovar de novo.',
  sem_arquivo: 'O arquivo final não chegou ao servidor. Tente aprovar de novo.',
  upload_trocado: 'Outra aprovação desta imagem está em andamento. Tente de novo.',
  referencia_trocada: 'A foto de referência da cor mudou depois desta imagem. Gere de novo.',
  verificacao_pendente: 'A verificação da imagem ainda não terminou. Aguarde alguns segundos.',
  exibicao_pendente: 'A imagem ainda está sendo registrada. Aguarde alguns segundos e aprove de novo.',
  aprovacao_concorrente: 'Outra versão desta imagem foi aprovada ao mesmo tempo. Recarregue e confira.',
  somente_admin: 'Somente administradores podem aplicar ou reverter fotos no Mercado Livre.',
  sem_aprovadas: 'Esta cor não tem imagem aprovada.',
  sem_final: 'Há imagem aprovada sem o arquivo final. Aprove de novo.',
  migracao_pendente: 'O anúncio está em migração de variações no Mercado Livre. Tente depois.',
  formato_bloqueado: 'O formato deste anúncio exigiria alterar a quantidade; a galeria não faz isso.',
  mudou: 'As fotos do anúncio mudaram no Mercado Livre desde a prévia. Clique em Ver prévia de novo.',
  limite: 'Passaria do limite de fotos do Mercado Livre. Use Substituir.',
  variacao_ausente: 'Uma variação desta cor não foi encontrada no anúncio.',
  item_ocupado: 'Outra operação está mexendo neste anúncio. Tente em alguns minutos.',
  escrita_pendente: 'Há uma atualização do anúncio aguardando. Tente em alguns minutos.',
  reversao_incompleta: 'A reversão deste anúncio ficou incompleta. Confira as fotos no Mercado Livre.',
  falha_interna: 'Erro interno. Tente de novo.',
  rede: 'Sem conexão com o servidor.',
};
/** Código desconhecido nunca vai para a tela: texto genérico com ação; o código só no console. */
export const MENSAGEM_GENERICA = 'Não deu certo. Tente de novo; se repetir, avise o suporte.';
export function mensagemErro(e: string): string {
  const m = MENSAGENS[e];
  if (m) return m;
  // `provedor_<status>` / `provedor_<erro>` do worker: variam por provedor, o operador só precisa saber que caiu.
  if (e.startsWith('provedor_')) return MENSAGENS.provedor_indisponivel;
  console.warn('[galeria] erro sem mensagem:', e);
  return MENSAGEM_GENERICA;
}
