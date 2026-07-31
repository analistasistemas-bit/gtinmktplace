/** Arredonda a 2 casas (centavos). Fonte única do arredondamento monetário no backend (Deno). */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Centavos inteiros com arredondamento decimal-seguro: inspeciona o 3º dígito decimal do TEXTO
 * do número em vez de multiplicar o float por 100. `1.005 * 100` em IEEE 754 dá
 * `100.49999999999999` (`round2` arredondaria para 1.00), enquanto `1.005::numeric(12,2)` no
 * Postgres dá 1.01 — sem isto, comparar um valor recém-recebido (float cru) contra o mesmo valor
 * já gravado (arredondado pelo Postgres na escrita) barraria um retry legítimo por engano.
 *
 * Não substitui `round2`/`precoCentavos` (preço de publicação, faturamento): aqueles cobrem o
 * caminho de dinheiro já em produção e não precisam do guard de notação exponencial abaixo.
 * Esta função existe só para o guard de divergência do cadastro (`preco`, `custo`, dimensões).
 *
 * Aceita string (colunas `numeric` do PostgREST chegam como texto). Notação exponencial
 * (`|n| < 1e-6` ou `>= 1e21` — nunca ocorre em preço/peso digitados por humano, mas pode ocorrer
 * em resíduo de subtração de ponto flutuante) cai no arredondamento float padrão, que é seguro
 * para essa faixa: o empate `x.xx5` só existe perto de valores "normais".
 */
export function centavosExatos(valor: number | string | null | undefined): number | null {
  if (valor == null) return null;
  const n = typeof valor === 'string' ? Number(valor) : valor;
  if (!Number.isFinite(n)) return null;
  const texto = typeof valor === 'string' ? valor.trim() : n.toString();
  if (/e/i.test(texto)) return Math.round(n * 100);
  const negativo = texto.startsWith('-');
  const semSinal = negativo ? texto.slice(1) : texto;
  const [inteiroTxt, decimalTxt = ''] = semSinal.split('.');
  const decimalPad = (decimalTxt + '000').slice(0, 3);
  let centavos = Number(inteiroTxt || '0') * 100 + Number(decimalPad.slice(0, 2));
  if (Number(decimalPad[2]) >= 5) centavos += 1;
  return negativo ? -centavos : centavos;
}
