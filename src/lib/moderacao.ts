const MOTIVO_LABEL: Record<string, string> = {
  forbidden: 'Proibido pelo ML',
  waiting_for_patch: 'Aguardando correção',
  poor_quality_thumbnail: 'Foto reprovada',
  poor_quality_picture: 'Foto reprovada',
};

/** Traduz o(s) sub_status cru(s) do ML em texto legível. Vários vêm separados por vírgula. */
export function traduzirMotivoModeracao(motivo: string | null): string | null {
  if (!motivo) return null;
  return motivo
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((c) => MOTIVO_LABEL[c] ?? c)
    .join(' · ');
}
