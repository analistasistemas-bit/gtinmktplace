// Galeria IA (proposta 3.3/3.6): erro de uma linha, ao lado do campo, dizendo a correção. As mensagens do servidor
// (`validarRoteiro`) e da largura (`motivosDeTexto`) são internas ("headline", "R5.3", "Ficha Verdade"): aqui viram
// a frase da tela e o campo onde ela aparece. Campo null = linha no topo do cartão da imagem.
import { LIMITES } from '../../../supabase/functions/_shared/galeria/regras';
import { motivosDeTexto } from './compor';
import type { MissaoRoteiro } from './api';

/** `headline`, `subheadline`, `beneficios.0`, `etapas.1`, `legendas.0`, `specs`, `cena`, `contrato` ou null. */
export type CampoErro = string | null;
export interface ErroTela { campo: CampoErro; texto: string }

const LISTA: Record<string, string> = { 'benefício': 'beneficios', etapa: 'etapas', legenda: 'legendas' };
const CAMPO_LARGURA: Record<string, string> = { 'Título': 'headline', 'Subtítulo': 'subheadline', 'Benefício': 'beneficios', Etapa: 'etapas', Legenda: 'legendas' };

const encurte = (max: number) => `Texto longo demais para a imagem. Encurte para até ${max} palavras.`;

/** Uma mensagem do servidor (já sem "Missão N:") → campo e frase da tela. */
export function traduzirErro(msg: string, m?: MissaoRoteiro): ErroTela {
  const t = msg.replace(/^Missão \d+:\s*/, '');
  let r: RegExpExecArray | null;
  if ((r = /^(headline|subheadline) com \d+ palavras \(máx\. (\d+)\)/.exec(t))) return { campo: r[1], texto: encurte(Number(r[2])) };
  if ((r = /^(benefício|etapa|legenda) com \d+ palavras \(máx\. (\d+)\)/.exec(t))) {
    const k = LISTA[r[1]];
    const i = Math.max(0, ((m?.[k as 'beneficios'] ?? []) as string[]).findIndex((x) => x.trim().split(/\s+/).length > Number(r![2])));
    return { campo: `${k}.${i}`, texto: encurte(Number(r[2])) };
  }
  if (/cena vazia/.test(t)) return { campo: 'cena', texto: 'Descreva a cena da imagem.' };
  if (/Contrato de identidade vazio/.test(t)) return { campo: 'contrato', texto: 'Descreva como o produto deve aparecer nas imagens.' };
  if ((r = /termo proibido "(.+)"/.exec(t))) return { campo: null, texto: `"${r[1]}" não pode aparecer na imagem. Tire do texto.` };
  if ((r = /"(.+)" no texto não vem de fato citado/.exec(t))) return { campo: null, texto: `"${r[1]}" não está nos dados confirmados. Use um valor confirmado no passo 1.` };
  if (/etapa .* não é trecho/.test(t)) return { campo: 'etapas', texto: 'Cada passo precisa ser uma frase inteira das instruções do cadastro.' };
  if (/medida da embalagem|difere do fato|spec sem/.test(t)) return { campo: 'specs', texto: 'Esse valor não está nos dados confirmados. Escolha da lista.' };
  if (/varia entre os tamanhos/.test(t)) return { campo: null, texto: 'Usa um dado que muda de um tamanho para outro. Tire do texto.' };
  if (/não está na Ficha|só fato CONFIRMADO/.test(t)) return { campo: null, texto: 'Usa um dado que não foi confirmado. Confirme no passo 1 ou mude o texto.' };
  if (/sem fato confirmado/i.test(t)) return { campo: null, texto: 'Esta imagem precisa de ao menos um dado confirmado no passo 1.' };
  if (/Nenhum benefício/.test(t)) return { campo: 'beneficios.0', texto: 'Escreva ao menos um benefício.' };
  if (/Nenhuma especificação|Sem dado confirmado do produto/.test(t)) return { campo: 'specs', texto: 'Escolha ao menos um dado da lista.' };
  if (/Nenhuma etapa|Sem etapa de uso/.test(t)) return { campo: null, texto: 'O cadastro não tem instruções de uso.' };
  if (/Lupa em ajuste/.test(t)) return { campo: null, texto: 'Em breve.' };
  if (/não escreveu esta missão/.test(t)) return { campo: null, texto: 'A IA não escreveu esta imagem. Ligue e preencha os textos.' };
  if (/sem texto/.test(t)) return { campo: null, texto: 'Esta imagem não leva texto. Apague os textos dela.' };
  if (/repetida/.test(t)) return { campo: null, texto: 'Imagem repetida no roteiro.' };
  if ((r = /^(.+?) não aparece no layout/.exec(t))) return { campo: null, texto: `${r[1]} não aparece nesta imagem. Apague esse texto.` };
  if (/mais textos do que o layout/.test(t)) return { campo: null, texto: 'Há mais textos do que cabem nesta imagem. Apague os que sobram.' };
  if ((r = /^(Título|Subtítulo|Benefício|Etapa|Legenda|Rótulo|Valor) ?(\d*) não cabe em (\d+) linhas?/.exec(t))) {
    const base = CAMPO_LARGURA[r[1]];
    const campo = r[1] === 'Rótulo' || r[1] === 'Valor' ? 'specs' : r[2] && base !== 'headline' && base !== 'subheadline' ? `${base}.${Number(r[2]) - 1}` : base;
    return { campo, texto: 'Texto largo demais para a imagem. Encurte.' };
  }
  return { campo: null, texto: t.charAt(0).toUpperCase() + t.slice(1) };
}

/** Motivo de missão desligada, em uma frase da tela (null = sem motivo gravado). */
export const motivoDesligadaTela = (m: MissaoRoteiro): string | null =>
  (m.ativa || !m.motivoDesligada ? null : traduzirErro(m.motivoDesligada, m).texto);

/** Palavras por campo de texto (R6.1, `regras.ts`). */
export const LIMITE_DO_CAMPO: Record<string, number> = {
  headline: LIMITES.headline, subheadline: LIMITES.subheadline, beneficios: LIMITES.beneficio, etapas: LIMITES.etapa, legendas: LIMITES.legenda,
};

const palavras = (s: string) => (s.trim() === '' ? 0 : s.trim().split(/\s+/).length);

/**
 * Erros da tela para uma missão ligada: palavras e largura calculadas aqui (imediato, mesma conta do servidor e da
 * composição) e os do servidor traduzidos. Um por campo; o local vence (é o do texto que está na tela).
 */
export function errosDaMissao(m: MissaoRoteiro, moda: boolean, doServidor: string[]): ErroTela[] {
  if (!m.ativa) return [];
  const locais: ErroTela[] = [];
  const conta = (campo: string, texto: string | undefined, max: number) => {
    if (texto && palavras(texto) > max) locais.push({ campo, texto: encurte(max) });
  };
  conta('headline', m.headline, LIMITES.headline);
  conta('subheadline', m.subheadline, LIMITES.subheadline);
  for (const k of ['beneficios', 'etapas', 'legendas'] as const) (m[k] ?? []).forEach((x, i) => conta(`${k}.${i}`, x, LIMITE_DO_CAMPO[k]));
  const largura = motivosDeTexto(m.missao, { ...m, beneficios: m.beneficios?.filter((x) => x.trim()), etapas: m.etapas?.filter((x) => x.trim()), legendas: m.legendas?.filter((x) => x.trim()) }, moda)
    .map((x) => traduzirErro(x, m));
  // Contagem de palavras do servidor é a mesma daqui, mas do último texto salvo: a daqui reflete a tela.
  const servidor = doServidor.filter((x) => !/palavras \(máx\./.test(x)).map((x) => traduzirErro(x, m));
  const todos = [...locais, ...largura, ...servidor];
  const vistos = new Set<string>();
  return todos.filter((e) => {
    const k = e.campo ?? `-${e.texto}`;
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
}
