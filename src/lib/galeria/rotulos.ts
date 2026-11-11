// Galeria IA: nome legível de cada dado da ficha (a tela nunca mostra `atributo:*`, `*_cm`, `descricao_ml`).
// O rótulo também é o rótulo da spec que o operador escolhe na ficha técnica (missão 5), como a poda do servidor faz.
import type { Fato } from './api';
import { missoesDisponiveis } from '../../../supabase/functions/_shared/galeria/regras';

/** Espelho de `ROTULO_SPEC` (`_shared/galeria/roteiro.ts`, não exportado) + colunas da planilha. */
const ROTULOS: Record<string, string> = {
  nome: 'Nome', marca: 'Marca', origem: 'Origem', fornecedor: 'Fornecedor', unidade: 'Unidade',
  descricao_fornecedor: 'Descrição do fornecedor', titulo_ml: 'Título no Mercado Livre', descricao_ml: 'Descrição no Mercado Livre',
  peso_gramas: 'Peso da embalagem', altura_cm: 'Altura da embalagem', largura_cm: 'Largura da embalagem', comprimento_cm: 'Comprimento da embalagem',
  'atributo:BRAND': 'Marca', 'atributo:MATERIAL': 'Material', 'atributo:MAIN_MATERIAL': 'Material', 'atributo:LENGTH': 'Comprimento',
  'atributo:WIDTH': 'Largura', 'atributo:HEIGHT': 'Altura', 'atributo:COLOR': 'Cor', 'atributo:MODEL': 'Modelo',
  'atributo:UNITS_PER_PACK': 'Unidades por pacote',
};

/**
 * Medidas da embalagem (R8.1): nunca viram texto de imagem. Mesma lista de `MEDIDAS_EMBALAGEM` (`roteiro.ts`, que o
 * front não importa: puxa o cliente OpenRouter); paridade em `rotulos.test.ts`.
 */
export const EMBALAGEM: ReadonlySet<string> = new Set(['peso_gramas', 'altura_cm', 'largura_cm', 'comprimento_cm']);
/** Textos longos (Decisão do Diego, 11/11): seguem citáveis, mas ficam recolhidos e com confirmação própria. */
export const TEXTOS_LONGOS: ReadonlySet<string> = new Set(['descricao_fornecedor', 'descricao_ml', 'titulo_ml']);

const capitalizar = (s: string) => {
  const t = s.replace(/[_:]+/g, ' ').trim().toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

export function rotuloFato(f: Pick<Fato, 'campo' | 'evidencia'>): string {
  if (ROTULOS[f.campo]) return ROTULOS[f.campo];
  const nome = f.evidencia?.nome;
  if (typeof nome === 'string' && nome.trim() !== '' && nome !== f.campo.replace(/^atributo:/, '')) return nome.trim();
  return capitalizar(f.campo.replace(/^atributo:/, ''));
}

/** Nome de cada imagem (missão) para o operador, fora de Moda; Moda usa os nomes de `regras.ts`. */
export const IMAGEM_GERAL: Record<number, { nome: string; descricao: string }> = {
  1: { nome: 'Capa', descricao: 'Só a foto do produto, sem texto' },
  2: { nome: 'Onde usar', descricao: 'Título e subtítulo' },
  3: { nome: 'Detalhe com lupa', descricao: 'Aproxima a textura do produto' },
  4: { nome: 'Benefícios', descricao: 'Título e até 3 benefícios' },
  5: { nome: 'Ficha técnica', descricao: 'Até 4 dados confirmados' },
  6: { nome: 'Como usar', descricao: 'Título e até 4 passos' },
  7: { nome: 'Detalhes', descricao: 'Recortes do produto' },
};
export function nomeImagem(missao: number, moda: boolean): string {
  if (!moda) return IMAGEM_GERAL[missao]?.nome ?? `Imagem ${missao}`;
  return missoesDisponiveis(true, ['frente', 'costas', 'lateral']).find((m) => m.missao === missao)?.nome ?? `Imagem ${missao}`;
}

/** Dado que pode virar texto de imagem (a regra do servidor: CONFIRMADO ou NÃO CONFERIDO com ciência). */
export const usavel = (f: Fato) => f.estado === 'CONFIRMADO' || f.estado === 'NAO_CONFERIDO';
