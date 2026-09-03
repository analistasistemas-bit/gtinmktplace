// ADR-0151 — derivações do kit vinculado no front. Puras e testadas: o preview que o
// operador confirma É o resultado final (D-3/D-4), então não pode haver segunda derivação
// no backend divergindo desta.
import { supabase } from './supabase';
import { corpoDoErroDaEdge } from './edge-erro';
import type { KitVinculado } from './queries';

export const TAMANHOS_KIT = [2, 3, 4, 5, 6] as const;

/** Teto do ML, igual ao TITULO_MAX de `_shared/ai/titulo-montar.ts:4`. */
export const TITULO_MAX_KIT = 60;

/**
 * O prefixo do kit é a informação que NÃO pode se perder — é o que diferencia este anúncio
 * do da base na busca do ML. Quando não cabe, quem encolhe é o título da base, cortado em
 * fronteira de palavra.
 */
export function tituloDoKit(tituloBase: string, n: number): string {
  const prefixo = `Kit ${n} Unidades`;
  const folga = TITULO_MAX_KIT - prefixo.length - 1;
  const base = tituloBase.trim();
  if (base.length <= folga) return `${prefixo} ${base}`;
  const cortado = base.slice(0, folga);
  const ultimoEspaco = cortado.lastIndexOf(' ');
  const limpo = (ultimoEspaco > 0 ? cortado.slice(0, ultimoEspaco) : cortado).trim();
  return `${prefixo} ${limpo}`;
}

function unidadesPt(n: number): string {
  return n === 1 ? '1 unidade' : `${n} unidades`;
}

/** Cabeçalhos de seção ADR-0115 — próximo cabeçalho encerra o bloco anterior. */
const EMOJI_CABECALHO = /^[🧵✅📌🎯❓🎨📦🚚]\s*\S/u;

function ehCabecalhoSecao(linha: string): boolean {
  const t = linha.trim();
  if (!t) return false;
  if (EMOJI_CABECALHO.test(t)) return true;
  return /^(?:O QUE VOCÊ RECEBE|CONTEÚDO DA EMBALAGEM|FAQ(?:\s|$)|ESPECIFICAÇÕES|PERGUNTAS SOBRE)/i.test(t);
}

function ehSecaoConteudo(linha: string): boolean {
  return /^(?:📦\s*)?(?:O QUE VOCÊ RECEBE|CONTEÚDO DA EMBALAGEM)\s*$/i.test(linha.trim());
}

function adaptarBulletsSecaoConteudo(bloco: string, n: number, titulo: string): { bloco: string; adaptado: boolean } {
  let adaptado = false;
  let out = bloco;
  const unidades = unidadesPt(n);

  for (const [re, repl] of [
    [/• 1 unidade de /g, `• ${unidades} de `],
    [/• 1 unidade com /g, `• ${unidades}, cada uma com `],
    [/• 1 unidade\s*$/gm, `• ${unidades}`],
    [/• 1 peças?\s*$/gim, `• ${n} peças`],
    [/• 1 caixa com \d+ unidades/gi, `• ${unidades} de ${titulo}`],
  ] as const) {
    const antes = out;
    out = out.replace(re, repl);
    if (out !== antes) adaptado = true;
  }

  return { bloco: out, adaptado };
}

function adaptarSecoesConteudo(desc: string, n: number, titulo: string): { desc: string; adaptado: boolean } {
  const linhas = desc.split('\n');
  let adaptado = false;
  const resultado: string[] = [];
  let i = 0;

  while (i < linhas.length) {
    const linha = linhas[i];
    if (ehSecaoConteudo(linha)) {
      resultado.push(linha);
      i++;
      const corpo: string[] = [];
      while (i < linhas.length && !ehCabecalhoSecao(linhas[i])) {
        corpo.push(linhas[i]);
        i++;
      }
      const { bloco, adaptado: a } = adaptarBulletsSecaoConteudo(corpo.join('\n'), n, titulo);
      if (a) adaptado = true;
      if (corpo.length > 0) resultado.push(bloco);
    } else {
      resultado.push(linha);
      i++;
    }
  }

  return { desc: resultado.join('\n'), adaptado };
}

/** Sugestão editável: unitário × N, com desconto opcional em % sobre o total. */
export function precoSugeridoDoKit(precoBase: number, n: number, descontoPct = 0): number {
  const bruto = precoBase * n;
  const liquido = bruto * (1 - descontoPct / 100);
  return Number(liquido.toFixed(2));
}

function temSecaoConteudo(desc: string): boolean {
  return /(?:📦\s*)?(?:O QUE VOCÊ RECEBE|CONTEÚDO DA EMBALAGEM)/i.test(desc);
}

function secaoOQueVoceRecebe(n: number, tituloBase: string): string {
  const unidades = unidadesPt(n);
  return `\n\n📦 O QUE VOCÊ RECEBE\n\n• ${unidades} de ${tituloBase.trim()}`;
}

export function descricaoDoKit(descricaoBase: string, n: number, tituloBase: string): string {
  let desc = descricaoBase.trimEnd();
  const unidades = unidadesPt(n);
  const kitComUnidades = `Kit com ${unidades}.`;
  const titulo = tituloBase.trim();

  desc = desc.replace(/\n\nKit com \d+ unidades\.?\s*$/gi, '');

  const conteudo = adaptarSecoesConteudo(desc, n, titulo);
  desc = conteudo.desc;

  desc = desc.replace(
    /Qual a unidade de venda\?\s*1 unidade\.?/gi,
    `Qual a unidade de venda? ${kitComUnidades}`,
  );
  desc = desc.replace(
    /(▪\s*[^\n]*?\?)\s*1 unidade\.?/gi,
    (match, pergunta: string) => {
      const p = pergunta.toLowerCase();
      if (/unidade de venda/.test(p)) return `${pergunta} ${kitComUnidades}`;
      if (/quantas unidades|quantidade/.test(p)) return `${pergunta} ${unidades}.`;
      if (/o que vem|o que acompanha/.test(p)) return `${pergunta} ${unidades} de ${titulo}.`;
      return match;
    },
  );
  if (!temSecaoConteudo(desc)) {
    desc = `${desc}${secaoOQueVoceRecebe(n, titulo)}`;
  }

  return desc;
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

/** M-0: badge "kits aguardando" da Revisão (BadgeKitsAguardando) — quantos kits, por
 *  produto-base, estão `status='pronto'` mas ainda sem `mlItemId` (criado, esperando a base
 *  publicar ou o reenvio após falha; ver ADR-0151 Decisão 4). */
export function contarKitsAguardandoPorPai(kits: KitVinculado[]): Map<string, number> {
  const porPai = new Map<string, number>();
  for (const k of kits) {
    if (k.status !== 'pronto' || k.mlItemId != null) continue;
    if (!k.kitBaseCodigoPai) continue;
    porPai.set(k.kitBaseCodigoPai, (porPai.get(k.kitBaseCodigoPai) ?? 0) + 1);
  }
  return porPai;
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
