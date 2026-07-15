import { infoCanal } from '@/lib/canais';

/**
 * Pré-validação por capability (spec D1/bloco D): avisos ANTES de publicar, derivados
 * do registry. Só valida o que o canal declara — canal sem capabilities não gera aviso.
 */
export function avisosCapabilities(titulos: string[], canais: string[]): string[] {
  const avisos: string[] = [];
  for (const id of canais) {
    const cap = infoCanal(id)?.capabilities;
    if (!cap) continue;
    const excedem = titulos.filter((t) => t.length > cap.tituloMax).length;
    if (excedem > 0) {
      const nome = infoCanal(id)!.nome;
      avisos.push(
        excedem === 1
          ? `1 título excede o limite de ${cap.tituloMax} caracteres do ${nome}.`
          : `${excedem} títulos excedem o limite de ${cap.tituloMax} caracteres do ${nome}.`,
      );
    }
  }
  return avisos;
}
