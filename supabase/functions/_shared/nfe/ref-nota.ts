// ADR-0181 D-8: referência da nota de compra (`nfe:{chave44}:{nItem}`).
// Módulo FOLHA (sem nenhum import): usado por edges (Deno) e, depois, pelo Vite.
export const REF_NOTA = /^nfe:\d{44}:\d{1,3}$/;
