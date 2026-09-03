// ADR-0151 — derivações do kit vinculado no front. Puras e testadas: o preview que o
// operador confirma É o resultado final (D-3/D-4), então não pode haver segunda derivação
// no backend divergindo desta.
import { supabase } from './supabase';
import { corpoDoErroDaEdge } from './edge-erro';

export const TAMANHOS_KIT = [2, 3, 4, 5, 6] as const;

/** Teto do ML, igual ao TITULO_MAX de `_shared/ai/titulo-montar.ts:4`. */
export const TITULO_MAX_KIT = 60;

/**
 * O sufixo do kit é a informação que NÃO pode se perder — é o que diferencia este anúncio
 * do da base na busca do ML. Quando não cabe, quem encolhe é o título da base, cortado em
 * fronteira de palavra.
 */
export function tituloDoKit(tituloBase: string, n: number): string {
  const sufixo = `Kit ${n} Unidades`;
  const folga = TITULO_MAX_KIT - sufixo.length - 1;
  const base = tituloBase.trim();
  if (base.length <= folga) return `${base} ${sufixo}`;
  const cortado = base.slice(0, folga);
  const ultimoEspaco = cortado.lastIndexOf(' ');
  const limpo = (ultimoEspaco > 0 ? cortado.slice(0, ultimoEspaco) : cortado).trim();
  return `${limpo} ${sufixo}`;
}

/** Sugestão editável: unitário × N, com desconto opcional em % sobre o total. */
export function precoSugeridoDoKit(precoBase: number, n: number, descontoPct = 0): number {
  const bruto = precoBase * n;
  const liquido = bruto * (1 - descontoPct / 100);
  return Number(liquido.toFixed(2));
}

export function descricaoDoKit(descricaoBase: string, n: number): string {
  return `${descricaoBase.trimEnd()}\n\nKit com ${n} unidades.`;
}

/** Campos da família-base usados para pré-preencher o preview (Decisão 4). */
export interface BaseParaKit {
  codigoPai: string;
  titulo: string;
  descricao: string;
  preco: number;
  custo: number | null;
  pesoGramas: number | null;
  alturaCm: number | null;
  larguraCm: number | null;
  comprimentoCm: number | null;
  fotoPath: string | null;
  estoque: number | null;
}

export interface KitFormValues {
  multiplicador: number;
  /**
   * Idempotência POR KIT (ADR-0096 D-9). `familias_org_chave_cadastro_key` é unique por
   * família, então uma chave só para a submissão inteira faria o 2º tamanho colidir (23505)
   * e o rollback derrubar todos — só kit único funcionaria. Um uuid por tamanho marcado.
   */
  chaveCadastro: string;
  titulo: string;
  descricao: string;
  preco: number;
  gtin: string | null;
  imagemPath: string | null;
  alturaCm: number;
  larguraCm: number;
  comprimentoCm: number;
  atacado: unknown[] | null;
}

export interface ResultadoCriarKit {
  ok: boolean;
  motivo?: string;
  mensagem?: string;
  /** Só presente quando `ok: true` (Task 6, fix I2) — a edge cria os kits e SEPARADAMENTE
   *  tenta encadear a publicação (base já no ar, caminho Publicados). `false` não é erro de
   *  criação: os kits existem, mas o encadeamento falhou e não pode ser escondido atrás de um
   *  `ok: true` genérico — quem chama trata isso na UI. */
  publicacaoOk?: boolean;
}

export async function criarKitVinculado(p: {
  familiaBaseId: string; kits: KitFormValues[];
}): Promise<ResultadoCriarKit> {
  const { data, error } = await supabase.functions.invoke('criar-kit-vinculado', {
    body: {
      familia_base_id: p.familiaBaseId,
      kits: p.kits.map((k) => ({
        multiplicador: k.multiplicador, chave_cadastro: k.chaveCadastro,
        titulo: k.titulo, descricao: k.descricao,
        preco: k.preco, gtin: k.gtin, imagem_path: k.imagemPath,
        altura_cm: k.alturaCm, largura_cm: k.larguraCm, comprimento_cm: k.comprimentoCm,
        atacado: k.atacado,
      })),
    },
  });
  if (error) {
    // supabase.functions.invoke NÃO popula `data` em resposta não-2xx — o `motivo` real
    // (base_multivariacao, categoria_sem_kit, kit_duplicado, ...) vive no corpo do erro.
    const detalhe = await corpoDoErroDaEdge(error);
    if (detalhe) {
      return {
        ok: false,
        motivo: typeof detalhe.corpo.motivo === 'string' ? detalhe.corpo.motivo : undefined,
        mensagem: typeof detalhe.corpo.error === 'string' ? detalhe.corpo.error : error.message,
      };
    }
    return { ok: false, motivo: 'rede', mensagem: error.message };
  }
  return data as ResultadoCriarKit;
}
