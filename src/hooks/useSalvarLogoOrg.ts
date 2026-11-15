import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { QK } from '@/lib/queries';
import { useOrgEfetivaId } from '@/hooks/useOrgEfetivaId';
import { BUCKET_LOGO_ORG } from '@/lib/org-logo';

export type VarianteLogo = 'claro' | 'escuro';

/** Caminho do objeto no bucket a partir da URL pública (`.../org-logos/<caminho>`). */
function caminhoDaUrl(url: string | null): string | null {
  const marca = `/${BUCKET_LOGO_ORG}/`;
  const i = url?.indexOf(marca) ?? -1;
  return i >= 0 ? url!.slice(i + marca.length) : null;
}

/** Envia (arquivo) ou remove (null) a logo de uma variante da org efetiva. */
export function useSalvarLogoOrg() {
  const orgId = useOrgEfetivaId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ variante, arquivo }: { variante: VarianteLogo; arquivo: File | null }) => {
      const coluna = variante === 'claro' ? 'logo_claro_url' : 'logo_escuro_url';
      const { data: atual, error: errLer } = await supabase.from('organizations').select(coluna).eq('id', orgId!).single();
      if (errLer) throw errLer;
      const anterior = caminhoDaUrl((atual as Record<string, string | null>)[coluna]);

      let novaUrl: string | null = null;
      if (arquivo) {
        const ext = arquivo.type.split('/')[1]!.replace('jpeg', 'jpg');
        // ponytail: timestamp no nome fura o cache do navegador/CDN sem precisar de versão.
        const caminho = `${orgId}/${variante}-${Date.now()}.${ext}`;
        const { error: errUp } = await supabase.storage.from(BUCKET_LOGO_ORG).upload(caminho, arquivo, { contentType: arquivo.type });
        if (errUp) throw errUp;
        novaUrl = supabase.storage.from(BUCKET_LOGO_ORG).getPublicUrl(caminho).data.publicUrl;
      }

      const { error: errUpd } = await supabase.from('organizations').update(variante === 'claro' ? { logo_claro_url: novaUrl } : { logo_escuro_url: novaUrl }).eq('id', orgId!);
      if (errUpd) throw errUpd;
      // Best-effort: arquivo antigo órfão não quebra nada, só ocupa espaço.
      if (anterior) await supabase.storage.from(BUCKET_LOGO_ORG).remove([anterior]);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.orgIdentidade(orgId) }),
  });
}
