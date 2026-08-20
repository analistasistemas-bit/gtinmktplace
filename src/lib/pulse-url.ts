export function buildPulseSearchUrl({
  gtin,
  titulo,
}: {
  gtin: string | null;
  titulo: string | null;
}): string | null {
  const termo = gtin?.trim() || titulo?.trim();
  return termo ? `https://lista.mercadolivre.com.br/${encodeURIComponent(termo)}` : null;
}
