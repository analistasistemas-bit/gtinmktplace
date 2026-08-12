/** GTIN normalizado (sem zeros à esquerda) para casar entre ML e planilha. */
export const normGtin = (g: string) => g.replace(/^0+/, '');

// Espelha `gtinAusente` de supabase/functions/_shared/ml/publicar.ts — os dois runtimes não se
// importam, então a regra vive duplicada de propósito. Aqui a pergunta é outra: o operador
// digitou algo que o ML vai RECUSAR? Vazio e 3000* não avisam nada (são ausência conhecida, o
// anúncio sai como "sem código universal"); o que avisa é o número preenchido que não fecha o
// dígito verificador GS1 ou tem comprimento fora do padrão — foi o que derrubou o lote #46.
const COMPRIMENTOS_VALIDOS = new Set([8, 12, 13, 14]);

function checksumGs1Ok(digits: string): boolean {
  const corpo = digits.slice(0, -1);
  const verificador = Number(digits.slice(-1));
  let soma = 0;
  for (let i = 0; i < corpo.length; i++) {
    soma += Number(corpo[corpo.length - 1 - i]) * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (soma % 10)) % 10 === verificador;
}

/** true = valor preenchido que NÃO será enviado como GTIN ao ML (o anúncio sai sem código). */
export function gtinInvalido(gtin: string | null | undefined): boolean {
  const s = (gtin ?? '').trim();
  if (s === '') return false;
  if (/^3000/.test(s)) return false;
  if (!/^\d+$/.test(s)) return true;
  if (!COMPRIMENTOS_VALIDOS.has(s.length)) return true;
  return !checksumGs1Ok(s);
}
