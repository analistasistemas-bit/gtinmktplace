export type TipoAviamento = 'linha' | 'botao' | 'fita' | 'outro';
export type TipoOrigem = 'regex' | 'ia' | 'manual';

// Palavras-chave por tipo (texto já normalizado: minúsculo, sem acento).
// Ordem importa: 'fita' antes de 'linha' para que "fita ... costura" caia em fita.
const REGRAS: { tipo: TipoAviamento; termos: string[] }[] = [
  { tipo: 'fita', termos: ['fita', 'fitas', 'cetim', 'gorgorao', 'gorgurao', 'vies', 'organza', 'renda', 'veludo', 'fitilho'] },
  { tipo: 'botao', termos: ['botao', 'botoes', 'pressao'] },
  { tipo: 'linha', termos: ['linha', 'linhas', 'linhao', 'costura', 'cost', 'bobina', 'cone', 'fio', 'fios'] },
];

function normalizar(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function temTermo(texto: string, termo: string): boolean {
  return new RegExp(`(?<![a-z0-9])${termo}(?![a-z0-9])`, 'i').test(texto);
}

/** Detecta o tipo de aviamento pelo nome (camada regex do ADR-0009). */
export function detectarTipoAviamento(nome: string): { tipo: TipoAviamento; origem: TipoOrigem } {
  const texto = normalizar(nome ?? '');
  for (const regra of REGRAS) {
    if (regra.termos.some((t) => temTermo(texto, t))) {
      return { tipo: regra.tipo, origem: 'regex' };
    }
  }
  return { tipo: 'outro', origem: 'regex' };
}
