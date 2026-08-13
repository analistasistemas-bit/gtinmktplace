import { useEffect, useState } from 'react';

/**
 * Detecta a extensão "PubliAI — Resolver catálogo no ML" pelo marcador que o content script
 * dela grava em <html data-publiai-extensao>. O content script roda em document_idle, depois
 * do mount do React — daí a rechecagem única com timer.
 */
export function useExtensaoCatalogo(): boolean {
  const [presente, setPresente] = useState(
    () => document.documentElement.dataset.publiaiExtensao != null,
  );
  useEffect(() => {
    if (presente) return;
    const t = window.setTimeout(
      () => setPresente(document.documentElement.dataset.publiaiExtensao != null),
      1500,
    );
    return () => window.clearTimeout(t);
  }, [presente]);
  return presente;
}
