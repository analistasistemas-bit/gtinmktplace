import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { uploadFile, buildStoragePath } from '@/lib/storage';
import { chamarIngest } from '@/lib/ingest';
import { useAuthStore } from '@/stores/auth-store';

export type UploadStatus = 'idle' | 'criando' | 'enviando' | 'processando' | 'concluido' | 'erro';

export function useUploadLote() {
  const [status, setStatus] = useState<UploadStatus>('idle');
  const [progresso, setProgresso] = useState(0);
  const [loteId, setLoteId] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const iniciar = useCallback(async (planilha: File, imagens: File[]) => {
    setErro(null);
    setProgresso(0);

    try {
      setStatus('criando');
      const { data: ud } = await supabase.auth.getUser();
      const userId = ud.user?.id;
      if (!userId) throw new Error('Sem sessão');
      const orgId = useAuthStore.getState().profile?.org_id;
      if (!orgId) throw new Error('Sem organização');

      const { data: lote, error } = await supabase
        .from('lotes')
        .insert({ user_id: userId, org_id: orgId, status: 'importando' })
        .select()
        .single();
      if (error || !lote) throw error ?? new Error('Falha criando lote');

      setLoteId(lote.id);
      setStatus('enviando');

      const planilhaPath = buildStoragePath(userId, lote.id, planilha.name);
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
            const p = buildStoragePath(userId, lote.id, img.name);
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
      return resultado;
    } catch (err) {
      setStatus('erro');
      setErro(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }, []);

  return { status, progresso, loteId, erro, iniciar };
}
