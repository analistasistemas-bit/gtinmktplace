// Kit com variação (ADR-0197, decisão 11). Caminho próprio, sem slots nem as regras de grade de
// copywriter-prompt.ts: o modelo só reescreve título e descrição da BASE dizendo que é kit de N
// peças. O que o sistema garante não depende do modelo: `posProcessarTituloKit` fixa "Kit N" no
// começo e o limite de 60; `posProcessarDescricaoKit` garante a menção às N peças.

export const LIMITE_TITULO_KIT = 60;

export interface InputTextoKit {
  nome: string;
  descricao: string;
  pecas: number;
  cores: string[];
}

export const SYSTEM_KIT_VARIACAO = `Você escreve anúncios do Mercado Livre Brasil. O produto abaixo será vendido como KIT de várias peças, em cores combinadas. Escreva um título e uma descrição do KIT, em português, usando só o que está no nome e na descrição do produto. Não invente medida, material, marca nem característica.
Título: até 50 caracteres, sem "Kit N" (o sistema acrescenta), sem emoji.
Descrição: parágrafos curtos e uma lista com o que o kit traz. Diga que é um kit e quantas peças ele tem.
Responda só um JSON: {"titulo": "...", "descricao": "..."}.`;

export function montarUserPromptKit(input: InputTextoKit): string {
  return [
    `Nome do produto: ${input.nome}`,
    `Descrição do produto:`,
    input.descricao,
    `Peças por kit: ${input.pecas}`,
    input.cores.length > 0 ? `Cores que podem ser combinadas: ${input.cores.join(', ')}` : '',
  ].filter(Boolean).join('\n');
}

/** Título sempre começa em "Kit N", sem repetir o que o modelo pôs, e cabe em 60 (corta em palavra inteira). */
export function posProcessarTituloKit(bruto: string, pecas: number): string {
  const prefixo = `Kit ${pecas}`;
  const resto = String(bruto ?? '')
    .replace(/\s+/g, ' ')
    .replace(/^\s*kit\s*(?:(?:de|com)\s*)?\d*\s*(pe[cç]as?|unidades?|un)?(?![\p{L}\d])[\s:|–-]*/iu, '')
    .trim();
  const completo = `${prefixo} ${resto}`.trim();
  if (completo.length <= LIMITE_TITULO_KIT) return completo;
  const corte = completo.slice(0, LIMITE_TITULO_KIT + 1);
  const espaco = corte.lastIndexOf(' ');
  return corte.slice(0, espaco > prefixo.length ? espaco : LIMITE_TITULO_KIT).trim();
}

/** Descrição abre dizendo que é kit de N peças quando o modelo não disse. */
export function posProcessarDescricaoKit(bruta: string, pecas: number): string {
  const texto = String(bruta ?? '').replace(/\r\n/g, '\n').trim();
  const diz = new RegExp(`kit[^\\n]{0,40}\\b${pecas}\\b`, 'i').test(texto)
    || new RegExp(`\\b${pecas}\\b[^\\n]{0,20}pe[cç]as`, 'i').test(texto);
  return diz ? texto : `Kit com ${pecas} peças.\n\n${texto}`.trim();
}
