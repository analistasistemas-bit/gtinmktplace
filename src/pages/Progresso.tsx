import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle } from 'lucide-react';
import { useLote } from '@/hooks/useLotes';
import { useFamilias, useFamiliasResumo } from '@/hooks/useFamilias';
import { useLoteRealtime } from '@/hooks/useLoteRealtime';
import { PageHeader } from '@/components/ui/page-header';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { JornadaLote } from '@/components/jornada-lote';
import { resultadoPublicacao } from '@/lib/jornada';
import { totalAnomalias } from '@/lib/tipos-dominio';
import { familiasElegiveisEstoqueRapido, deveExibirGateEstoqueRapido } from '@/lib/estoque-rapido';
import { publicarFamilias } from '@/lib/publicar';
import { QK } from '@/lib/queries';

export default function Progresso() {
  const { loteId } = useParams<{ loteId: string }>();
  const nav = useNavigate();
  useLoteRealtime(loteId);

  const { data: lote } = useLote(loteId);
  // Realtime tem race condition se process-familia terminar antes da subscription
  // estabilizar (~1-2s). Polling de fallback enquanto o lote está em transito.
  const polling = lote?.status === 'processando' || lote?.status === 'importando';
  const { data: familias = [] } = useFamiliasResumo(loteId, {
    refetchInterval: polling ? 2500 : undefined,
  });
  // Famílias completas (com variações), só pra calcular elegibilidade do atalho de
  // 1-clique (ADR-0089) — o useFamiliasResumo acima não carrega variacoes. `useFamilias`
  // é bem mais pesada (select * + variacoes(*) + 3 sub-queries, ver fetchFamilias em
  // queries.ts) — só vale pollar perto do fim do processamento (achado da revisão
  // code-review-fable5 v1: pollar do início ao fim de lotes grandes desperdiça rede/DB
  // sem nenhum ganho, já que `elegiveis` só importa no momento da decisão final).
  const restamProcessando = familias.filter(
    (f) => f.status === 'pendente' || f.status === 'processando',
  ).length;
  const quaseTerminado =
    polling && familias.length > 0 && restamProcessando <= Math.max(1, Math.ceil(familias.length * 0.1));
  const { data: familiasCompletas = [], isSuccess: familiasCompletasCarregadas } = useFamilias(loteId, {
    refetchInterval: quaseTerminado ? 2500 : undefined,
  });
  const elegiveis = useMemo(
    () => familiasElegiveisEstoqueRapido(familiasCompletas),
    [familiasCompletas],
  );
  const [confirmando, setConfirmando] = useState(false);
  const qc = useQueryClient();

  useEffect(() => {
    if (lote?.status !== 'revisao' && lote?.status !== 'processando') return;
    if (!familiasCompletasCarregadas) return; // espera carregar antes de decidir
    const prontas = familias.filter((f) => f.status === 'pronto').length;
    if (prontas > 0 && prontas === familias.length && elegiveis.length === 0) {
      nav(`/revisao/${loteId}`);
    }
  }, [lote, familias, elegiveis, familiasCompletasCarregadas, loteId, nav]);

  if (!lote) {
    return (
      <div className="p-6 text-sm text-muted-foreground">Carregando…</div>
    );
  }

  const total = lote.totalFamilias;
  const prontas = familias.filter(
    (f) => f.status === 'pronto' || f.status === 'publicado'
  ).length;
  const erradas = familias.filter((f) => f.status === 'erro').length;
  const pct = total > 0 ? Math.round((prontas / total) * 100) : 0;

  const mostrarGateEstoqueRapido = deveExibirGateEstoqueRapido({
    loteStatus: lote.status,
    familias,
    elegiveis,
  });

  async function confirmarEstoqueRapido() {
    if (!loteId) return;
    setConfirmando(true);
    try {
      await publicarFamilias(
        elegiveis.map((f) => f.id),
        'gold_special',
        ['mercado_livre'],
        { somenteEstoqueGlobal: true },
      );
      qc.invalidateQueries({ queryKey: QK.familias(loteId) });
      qc.invalidateQueries({ queryKey: QK.lote(loteId) });
      toast.success(`${elegiveis.length} família(s) enfileirada(s) para atualização de estoque`, {
        description: 'Acompanhe o andamento no relatório.',
      });
      nav(`/relatorio/${loteId}`);
    } catch (e) {
      toast.error('Falha ao enfileirar a atualização de estoque', {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setConfirmando(false);
    }
  }

  const anomalias = lote.anomalias;
  const temAnomalias = totalAnomalias(anomalias) > 0;

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title={`Processando lote #${lote.numero}`}
        subtitle={`Status: ${lote.status} · ${prontas} de ${total} prontas${erradas > 0 ? ` · ${erradas} com erro` : ''}`}
        actions={
          // Saída manual para a Revisão. Um lote com família travada em 'pendente' (job de
          // IA perdido) fica em 'processando' para sempre: o auto-redirect da linha 51 só
          // dispara com TODAS prontas, e o botão do atalho de estoque só aparece quando há
          // elegíveis. Sem isto o operador fica preso nesta tela com famílias publicáveis.
          prontas > 0
            ? <Button variant="outline" onClick={() => nav(`/revisao/${loteId}`)}>Ir para a Revisão</Button>
            : undefined
        }
      />
      <div className="mb-6">
        <JornadaLote status={lote.status} resultado={resultadoPublicacao(familias)} />
      </div>
      {mostrarGateEstoqueRapido && (
        <div className="mb-4 space-y-3 rounded-lg border border-info/30 bg-info/5 px-4 py-3">
          <p className="text-sm font-medium">
            {elegiveis.length} família(s) prontas para atualizar estoque no Mercado
            Livre — sem alterar preço, foto ou criar cor nova.
          </p>
          <div className="flex gap-2">
            <Button onClick={confirmarEstoqueRapido} disabled={confirmando}>
              {confirmando ? 'Atualizando…' : `Atualizar estoque (${elegiveis.length})`}
            </Button>
            <Button variant="outline" onClick={() => nav(`/revisao/${loteId}`)} disabled={confirmando}>
              Revisar manualmente
            </Button>
          </div>
        </div>
      )}
      {temAnomalias && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning motion-safe:animate-in fade-in-0 duration-(--motion-duration-state) ease-enter">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Linhas descartadas da planilha:
            {anomalias.codigos_duplicados.length > 0 && (
              <> {anomalias.codigos_duplicados.length} código(s) duplicado(s)</>
            )}
            {anomalias.filhos_orfaos.length > 0 && (
              <> · {anomalias.filhos_orfaos.length} variação(ões) órfã(s)</>
            )}
            {anomalias.familias_sem_filho.length > 0 && (
              <> · {anomalias.familias_sem_filho.length} família(s) sem variação</>
            )}
          </span>
        </div>
      )}
      <Progress value={pct} className="h-2" />
      <ul className="mt-6 space-y-1 text-sm">
        {familias.map((f) => (
          <li key={f.id} className="border-b py-1">
            <div className="flex justify-between">
              <span>
                {f.codigoPai} — {f.titulo}
              </span>
              <span className="text-xs text-muted-foreground">{f.status}</span>
            </div>
            {f.status === 'erro' && f.erroMensagem && (
              <p className="mt-0.5 text-xs text-destructive">{f.erroMensagem}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
