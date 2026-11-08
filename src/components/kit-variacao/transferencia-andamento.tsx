// ADR-0200 (adendo 08/11): andamento da transferência de kit (montar, desmontar, repor) em Publicados e no Gerenciar
// kit. Ativa: a mesma aura + raio de `lista-operacoes.tsx` (ADR-0163, emenda), sem animação nova; o CSS já respeita
// prefers-reduced-motion. Travada: neon vermelho parado. Sem transferência: nada.
import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { BorderTrail } from '@/components/ui/border-trail';
import '@/components/ui/glow-effect.css';
import { cn } from '@/lib/utils';
import { etapaTransferencia } from '@/lib/kit-transferencia-etapa';
import type { TransferenciaAberta } from '@/lib/kit-variacao-edge';

export function AuraTransferencia({ estado, className, children }: {
  estado: string | null | undefined; className?: string; children: ReactNode;
}) {
  const ativa = estado === 'ativa';
  return (
    <BorderTrail active={ativa} radius={6} className="rounded-md">
      <div
        data-estado={estado ?? undefined}
        aria-busy={ativa || undefined}
        className={cn(
          'rounded-md border',
          // Alcance menor que o padding da página: o app-shell corta o halo (mesmo ajuste de lista-operacoes).
          ativa && 'glow-effect-sombra [--glow-sombra-halo:12px] [--glow-sombra-nucleo:8px] [--glow-sombra-spread:2px]',
          estado === 'travada' && 'border-danger shadow-[0_0_10px_1px_color-mix(in_oklab,var(--danger)_45%,transparent)]',
          className,
        )}
      >
        {children}
      </div>
    </BorderTrail>
  );
}

/** Relógio de 1 s só enquanto conta a quarentena. */
function useAgora(ativo: boolean) {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    if (!ativo) return;
    const id = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(id);
  }, [ativo]);
  return agora;
}

const TIPO: Record<string, string> = {
  montar: 'Montagem', desmontar: 'Desmontagem', repor: 'Reposição', cancelamento: 'Cancelamento',
  sair_sobra: 'Guardar peças', entrada: 'Entrada', encerrar: 'Encerramento',
};

export function EtapaTransferencia({ t }: { t: TransferenciaAberta }) {
  const agora = useAgora(t.estado === 'ativa' && t.passo === 'aguardar');
  const e = etapaTransferencia(t, agora);
  const travada = t.estado === 'travada';
  return (
    <div className="text-xs">
      <p>
        <span className="font-medium">{TIPO[t.tipo] ?? t.tipo}</span>{' '}
        <span className={travada ? 'text-danger' : 'text-muted-foreground'}>
          {travada ? 'Travou em: ' : ''}{e.rotulo}{e.numero ? ` · passo ${e.numero} de ${e.total}` : ''}
        </span>
      </p>
      {/* Encerrar nunca trava: o motivo da pendência (itens, leitura falhando, faixa) aparece enquanto tenta. */}
      {t.tipo === 'encerrar' && !travada && t.alerta && <p className="mt-1 text-muted-foreground">{t.alerta}</p>}
      {travada && (
        <div className="mt-1 flex gap-1.5 text-danger">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <p>
            {t.alerta ? <>{t.alerta.replace(/\.$/, '')}. </> : null}
            Os anúncios envolvidos ficam pausados até alguém resolver: confira o motivo no Mercado Livre e, se não
            souber como seguir, chame o suporte.
          </p>
        </div>
      )}
    </div>
  );
}
