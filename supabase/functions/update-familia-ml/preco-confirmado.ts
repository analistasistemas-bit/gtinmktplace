// ADR-0078 F1: preço de venda a confirmar em variacoes.preco_publicado_ml no sucesso do
// publish/update, por SKU. Base do badge "preço alterado" (Revisão).
// - Em "somente estoque" o operador escolheu NÃO mexer em preço → confirma o preço VIVO do
//   anúncio (inalterado), nunca o recalculado.
// - Em "atualizar tudo" confirma o preço enviado (precoFamilia); sem ele cai no vivo.
// null → nada a confirmar (não grava; não corrompe o sentinel "nunca publicado").
export function precoAConfirmar(p: {
  somenteEstoque: boolean;
  precoVivo: number | null;
  precoEnviado: number | null;
}): number | null {
  return p.somenteEstoque ? p.precoVivo : (p.precoEnviado ?? p.precoVivo);
}
