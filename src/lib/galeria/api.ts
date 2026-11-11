// ADR-0201 (Galeria da cor por IA), Task 7b: uma função por ação das edges `galeria-fatos` e `galeria-roteiro`.
// Identidade = a linha de Publicados (`ml_item_id`); nunca `familia_id` sozinho (linhas split dividem a família).
// `functions.invoke` não popula `data` em não-2xx: status e corpo vêm de `corpoDoErroDaEdge`.
import { supabase } from '@/lib/supabase';
import { corpoDoErroDaEdge } from '@/lib/edge-erro';
import type { TextosComposicao } from './compor';
import { lupaPendente } from '../../../supabase/functions/_shared/galeria/regras';
import { comLupa, type CaixaNorm } from '../../../supabase/functions/_shared/galeria/lupa';

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
  /** Lupa pela caixa do produto, por cor: situação de cada missão com lupa (geral 3/7, Moda 5/7). */
  lupa?: Record<string, Record<'geral' | 'moda', Record<number, SituacaoLupa>>>;
  /** Só na ação `montar` (cabeçalho, Fase C2): capa atual no ML (null/ausente = ícone), título e preço no ML e formato. */
  capa_url?: string | null;
  titulo_anuncio?: string | null;
  preco_anuncio?: number | null;
  formato?: 'legacy' | 'user_products';
}
export type SituacaoLupa = 'ok' | 'lendo' | 'indisponivel';
/** Caixas gravadas na referência (só com `situacao: 'ok'`); `hash` volta no aprovar. */
export interface LupaImagem {
  situacao: SituacaoLupa; produto?: CaixaNorm; detalhes?: CaixaNorm[]; ref_w?: number; ref_h?: number; hash?: string;
}

/**
 * Por que a missão não pode ser pedida para estas cores (null = pode): travada até o portão da Task 16, foto de
 * referência ainda sendo lida, ou sem detalhe do produto na foto. Missão sem lupa → null.
 */
export function motivoLupa(ficha: Ficha, cores: string[], missao: number, moda: boolean): string | null {
  if (lupaPendente(missao, moda)) return 'Em breve';
  // Sem `lupa` na ficha (resposta sem a leitura): não há o que mostrar; o galeria-gerar recusa com 409 se faltar.
  if (!comLupa(missao, moda) || !ficha.lupa) return null;
  const de = (s: SituacaoLupa) => cores.filter((c) => (ficha.lupa?.[c]?.[moda ? 'moda' : 'geral']?.[missao] ?? 'lendo') === s);
  const sem = de('indisponivel');
  if (sem.length > 0) return `sem detalhe do produto na foto: ${sem.join(', ')}`;
  const lendo = de('lendo');
  return lendo.length > 0 ? `preparando esta imagem, aguarde: ${lendo.join(', ')}` : null;
}

export interface MissaoRoteiro {
  missao: number; ativa: boolean; cena: string;
  headline?: string; subheadline?: string; beneficios?: string[];
  specs?: Array<{ campo: string; rotulo: string; valor: string }>;
  etapas?: string[]; legendas?: string[]; fatosUsados: string[];
  /** Por que nasceu desligada (Fase A): lupa travada, sem dado, erro que a poda não resolve. Só em missão desligada. */
  motivoDesligada?: string;
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
  /** Referência da cor/vista (assinada): a lupa da composição (Task 12). */
  ref_url: string | null;
  /** Missão com lupa: situação e caixas da referência; null = missão sem lupa. */
  lupa?: LupaImagem | null;
  /** Aprovar só a do roteiro aprovado atual (o servidor recusaria as demais). */
  roteiro_id: string;
  /** Regra da RPC calculada no servidor: false com 3 gerações válidas, geração aberta ou fora do roteiro aprovado. */
  pode_gerar_de_novo: boolean;
  /** Preço congelado no pedido desta imagem (o que a RPC cobra ao exibir); recorte = 0. */
  unit_cents: number | null;
}
/** Roteiro aprovado do anúncio (mesmo com rascunho mais novo por cima). */
export interface RoteiroAprovado {
  id: string; versao: number; familia_id: string; moda: boolean; missoes_ativas: number[];
  /** Textos das missões ativas do roteiro aprovado (composição do arquivo final, Task 12). */
  textos: Record<number, TextosComposicao>;
}
/** `unit_cents` = preço do mês, só para pedido novo. Imagens: as do roteiro aprovado + toda cena não exibida do anúncio. */
export interface RespostaListar {
  roteiro: RoteiroAprovado | null; unit_cents: number; imagens: ImagemGaleria[];
  // Task 6 (tela única); opcionais até a Task 8.
  titulo?: string | null; cores?: string[]; moda?: boolean | null;
  posicoes?: Array<{ posicao: number; nome: string; indisponivel?: string }>; plano_id?: string | null;
}

export const listarImagens = (mlItemId: string) =>
  chamar<RespostaListar>('galeria-imagens', { acao: 'listar', ml_item_id: mlItemId });
export const confirmarExibicao = (mlItemId: string, imagemIds: string[]) =>
  chamar<{ cobradas: number }>('galeria-imagens', { acao: 'confirmar_exibicao', ml_item_id: mlItemId, imagem_ids: imagemIds });
export const reportarInvalida = (mlItemId: string, imagemId: string) =>
  chamar<{ reportada: boolean }>('galeria-imagens', { acao: 'reportar_invalida', ml_item_id: mlItemId, imagem_id: imagemId });
// ponytail: roteiroVersao opcional só até a Task 8 (tela antiga ainda envia).
export const gerarImagens = (mlItemId: string, p: { pedidoId: string; roteiroVersao?: number; cores: string[]; missoes: number[]; unitCentsExibido: number; confirmarTroca?: boolean }) =>
  chamar<{ pedido_id: string; imagens: unknown[] }>('galeria-gerar', {
    pedido_id: p.pedidoId, ml_item_id: mlItemId, cores: p.cores, missoes: p.missoes,
    unit_cents_exibido: p.unitCentsExibido,
    ...(p.roteiroVersao !== undefined ? { roteiro_versao: p.roteiroVersao } : {}),
    ...(p.confirmarTroca ? { confirmar_troca: true } : {}),
  });

// Task 12: arquivo final composto no navegador → URL de upload assinada (upsert:false) → aprovar (`galeria-aprovar`).
export const prepararUploadFinal = (mlItemId: string, imagemId: string) =>
  chamar<{ path: string; token: string; signed_url: string }>('galeria-aprovar', { acao: 'preparar_upload', ml_item_id: mlItemId, imagem_id: imagemId });
/** `lupaHash` = hash das caixas usadas na composição (missão com lupa); o servidor confere com o gravado. */
export const aprovarFinal = (mlItemId: string, imagemId: string, lupaHash?: string) =>
  chamar<{ status: 'aprovada' }>('galeria-aprovar', { acao: 'aprovar', ml_item_id: mlItemId, imagem_id: imagemId, lupa_hash: lupaHash });
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
export interface ItemAplicacao { item_id: string; status: string; erro: string | null }
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
  roteiro_nao_aprovado: 'Os textos aprovados mudaram. Recarregue a galeria.',
  'conteudo.ciencia_nao_conferido': 'Há dados sem etiqueta usados nos textos. Volte ao passo 2 e marque "usar mesmo assim".',
  sem_vista: 'Falta a foto de referência (costas ou lateral) que esta imagem exige.',
  teto: 'Você já gerou esta imagem 3 vezes.',
  em_andamento: 'Esta imagem já está sendo gerada.',
  missao_inativa: 'Há imagem desligada nos textos aprovados. Aprove os textos de novo no passo 2.',
  cor_invalida: 'Cor fora deste anúncio.',
  sem_conexao_ml: 'Conecte a conta do Mercado Livre para gerar imagens.',
  modulo_desligado: 'O módulo de imagens por IA não está ligado nesta organização.',
  ml_indisponivel: 'Mercado Livre indisponível, tente de novo.',
  pedido_de_outro_anuncio: 'Este pedido pertence a outro anúncio.',
  pedido_invalido: 'Pedido inválido. Tente de novo.',
  familia_nao_vigente: 'O cadastro do anúncio mudou. Recarregamos os dados; confira e tente de novo.',
  anuncio_ambiguo: 'Não foi possível identificar este anúncio de forma única.',
  categoria_mudou: 'A categoria do anúncio mudou. Os textos não valem mais: crie novos no passo 2.',
  conteudo_mudou: 'Os textos foram alterados em outra aba depois que você abriu. Recarregamos; confira e aprove de novo.',
  categoria_indisponivel: 'Não foi possível ler a categoria no Mercado Livre agora. Tente de novo em instantes.',
  fato_divergente: 'Há dados diferentes da etiqueta. Resolva no passo 1 antes de criar os textos.',
  ciencia_pendente: 'Marque "usar mesmo assim" para os dados sem etiqueta usados nos textos.',
  roteiro_invalido: 'Os textos têm erros. Corrija nas imagens indicadas.',
  roteiro_ia_falhou: 'A IA não conseguiu escrever os textos. Tente de novo.',
  foto_nao_jpeg: 'Envie a foto em JPEG.',
  foto_invalida: 'Foto inválida ou grande demais (máx. 8 MB).',
  valor_invalido: 'O valor da etiqueta não é aceito para este atributo.',
  nao_rascunho: 'Estes textos já foram aprovados. Edite para criar uma nova versão.',
  ja_aprovada: 'Esta imagem já está aprovada.',
  desatualizada: 'Os dados do anúncio mudaram. Gere as imagens de novo.',
  plano_ia_falhou: 'Não foi possível preparar as imagens agora. Tente de novo.',
  plano_invalido: 'Não foi possível preparar as imagens agora. Tente de novo.',
  posicao_indisponivel: 'Faltam dados do produto para esta imagem.',
  plano_desatualizado: 'Os dados do anúncio mudaram.',
  sem_referencia: 'Falta a foto real desta cor no cadastro.',
  plano_antigo: 'Esta imagem é de uma versão anterior. Gere de novo.',
  nao_aprovavel: 'Esta imagem não pode ser aprovada agora. Gere de novo ou recarregue a página.',
  nao_encontrada: 'Imagem não encontrada neste anúncio.',
  sem_upload: 'O arquivo final não foi preparado. Tente aprovar de novo.',
  sem_arquivo: 'O arquivo final não chegou ao servidor. Tente aprovar de novo.',
  upload_trocado: 'Outra aprovação desta imagem está em andamento. Tente de novo.',
  referencia_trocada: 'A foto de referência da cor mudou depois desta imagem. Gere de novo.',
  verificacao_pendente: 'A verificação da imagem ainda não terminou. Aguarde alguns segundos.',
  exibicao_pendente: 'A imagem ainda está sendo registrada. Aguarde alguns segundos e aprove de novo.',
  lupa_pendente: 'Esta imagem ainda não está disponível.',
  lupa_lendo: 'A foto de referência ainda está sendo preparada. Tente de novo em instantes.',
  lupa_indisponivel: 'Sem detalhe do produto na foto de referência desta cor: esta imagem fica indisponível.',
  lupa_desatualizada: 'O recorte mudou depois que a imagem foi montada (ou a página está desatualizada). Recarregue e aprove de novo.',
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
  console.warn('[galeria] erro sem mensagem:', e);
  return MENSAGEM_GENERICA;
}
/** Erros que mudam o chão do operador: recarregar a ficha e descartar o roteiro em tela. */
export const ERROS_DE_RECARGA = new Set(['familia_nao_vigente', 'categoria_mudou', 'conteudo_mudou']);
