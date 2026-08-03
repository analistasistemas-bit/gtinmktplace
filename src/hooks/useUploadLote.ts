import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { uploadFile, buildStoragePath } from '@/lib/storage';
import { chamarIngest } from '@/lib/ingest';
import { QK } from '@/lib/queries';
import { type SupportScope } from '@/lib/suporte';
import { canWrite, effectiveOrgId, useSupportStore } from '@/stores/support-store';

export type UploadStatus = 'idle' | 'criando' | 'enviando' | 'processando' | 'concluido' | 'erro';

export function storageOwnerForUpload(userId: string, orgId: string, supportScope: SupportScope | null): string {
  return supportScope === 'full' ? orgId : userId;
}

export function useUploadLote() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<UploadStatus>('idle');
  const [progresso, setProgresso] = useState(0);
  const [loteId, setLoteId] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const iniciar = useCallback(async (planilha: File, imagens: File[]) => {
    setErro(null);
    setProgresso(0);
    // O lote é inserido direto pelo cliente (fora do react-query), então nada invalida
    // QK.lotes sozinho — "Histórico de lotes" ficava com a lista de antes do upload até
    // um F5 (achado: lote #44 sumia da tela mesmo existindo no banco, inclusive após falha
    // no ingest). userId hoisted para o catch poder invalidar mesmo se o insert falhar cedo.
    let userId: string | undefined;

    try {
      setStatus('criando');
      const { data: ud } = await supabase.auth.getUser();
      userId = ud.user?.id;
      if (!userId) throw new Error('Sem sessão');
      const orgId = effectiveOrgId();
      if (!orgId) throw new Error('Sem organização');
      if (!canWrite()) throw new Error('Suporte somente leitura');
      const storageOwner = storageOwnerForUpload(userId, orgId, useSupportStore.getState().context?.scope ?? null);

      const { data: lote, error } = await supabase
        .from('lotes')
        .insert({ user_id: userId, org_id: orgId, status: 'importando' })
        .select()
        .single();
      if (error || !lote) throw error ?? new Error('Falha criando lote');

      setLoteId(lote.id);
      queryClient.invalidateQueries({ queryKey: QK.lotes(userId) });
      setStatus('enviando');

      const planilhaPath = buildStoragePath(storageOwner, lote.id, planilha.name);
      await uploadFile('imagens', planilhaPath, planilha);
      setProgresso(5);

      const total = imagens.length;
      const imagensPaths: string[] = [];
      const concorrencia = 4;
      let enviadas = 0;

      for (let i = 0; i < imagens.length; i += concorrencia) {
        const batch = imagens.slice(i, i + concorrencia);
        const paths = await Promise.all(
          batch.map(async (img) => {
            const p = buildStoragePath(storageOwner, lote.id, img.name);
            await uploadFile('imagens', p, img);
            enviadas += 1;
            setProgresso(5 + Math.floor((enviadas / total) * 80));
            return p;
          })
        );
        imagensPaths.push(...paths);
      }

      await supabase
        .from('lotes')
        .update({ planilha_path: planilhaPath, imagens_paths: imagensPaths })
        .eq('id', lote.id);

      setStatus('processando');
      setProgresso(90);
      const resultado = await chamarIngest(lote.id);
      setProgresso(100);
      setStatus('concluido');
      queryClient.invalidateQueries({ queryKey: QK.lotes(userId) });
      return resultado;
    } catch (err) {
      setStatus('erro');
      setErro(err instanceof Error ? err.message : String(err));
      if (userId) queryClient.invalidateQueries({ queryKey: QK.lotes(userId) });
      throw err;
    }
  }, [queryClient]);

  return { status, progresso, loteId, erro, iniciar };
}
