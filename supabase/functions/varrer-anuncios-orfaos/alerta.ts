// Texto do aviso diário de órfãos ao dono do SaaS. Puro (sem Deno) para o vitest.
// Só o grupo vermelho da tela avisa: catálogo sem vínculo, externos e "provável Remover" são normais.
import { blocos } from '../_shared/notificacoes/telegram.ts';

export interface OrfaoBruto {
  ml_item_id: string;
  titulo: string | null;
  status: string | null;
  permalink: string | null;
  classe: 'perdido_do_app' | 'catalogo_sem_vinculo' | 'externo';
  provavel_remocao_pelo_app: boolean;
}

const STATUS: Record<string, string> = { active: 'ativo', paused: 'pausado' };

/** `null` = sem divergência (nada a enviar). */
export function montarAlertaOrfaos(
  org: string, r: { orfaos: OrfaoBruto[]; total_no_ml: number; truncado: boolean },
): string | null {
  const perdidos = r.orfaos.filter((o) => o.classe === 'perdido_do_app' && !o.provavel_remocao_pelo_app);
  if (perdidos.length === 0) return null;
  const n = perdidos.length;
  return blocos(
    [`⚠️ Anúncios sem vínculo — ${org}`],
    [`${n} ${n === 1 ? 'anúncio saiu do app e perdeu o vínculo' : 'anúncios saíram do app e perderam o vínculo'}:`],
    perdidos.map((o) => `• ${o.ml_item_id} ${o.titulo ?? '(sem título)'} (${STATUS[o.status ?? ''] ?? o.status ?? '?'})${o.permalink ? `\n  ${o.permalink}` : ''}`),
    [
      r.truncado && `Varredura parcial: a conta passou de 1000 anúncios no ML (${r.total_no_ml} conferidos).`,
      'Conferir em Publicados › Verificar agora.',
    ],
  );
}
