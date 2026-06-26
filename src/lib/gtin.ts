/** GTIN normalizado (sem zeros à esquerda) para casar entre ML e planilha. */
export const normGtin = (g: string) => g.replace(/^0+/, '');
