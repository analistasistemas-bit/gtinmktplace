export function gtinValido(gtin: string | null): boolean {
  if (!gtin) return false;
  const s = gtin.trim();
  if (!/^\d+$/.test(s)) return false;
  if (s.startsWith('3000')) return false; // código interno, não EAN GS1 real
  return [8, 12, 13, 14].includes(s.length);
}
