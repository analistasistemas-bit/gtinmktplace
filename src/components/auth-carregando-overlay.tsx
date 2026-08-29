import { Check } from 'lucide-react';
import { GlowEffect } from '@/components/ui/glow-effect';
import { Logo } from '@/components/ui/logo';
import { cn } from '@/lib/utils';
import { useReducedMotion } from '@/motion/reduced-motion';
import './auth-carregando-overlay.css';

export interface AuthCarregandoOverlayProps {
  /** Exibe o overlay de carregamento ou sucesso. */
  visivel: boolean;
  /** true → troca o pulso por confirmação antes de navegar. */
  sucesso?: boolean;
}

/**
 * Overlay de login: logo PubliAI com aura (GlowEffect) enquanto a sessão autentica.
 * Cobre o shell inteiro para o formulário não competir com o feedback visual.
 */
export function AuthCarregandoOverlay({ visivel, sucesso = false }: AuthCarregandoOverlayProps) {
  const reduz = useReducedMotion();

  if (!visivel) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={sucesso ? 'Login realizado' : 'Entrando'}
      className={cn(
        'fixed inset-0 z-50 flex items-center justify-center bg-background/75 backdrop-blur-md',
        !reduz && 'motion-safe:animate-in motion-safe:fade-in motion-safe:duration-(--motion-duration-enter)',
      )}
    >
      <GlowEffect ativo forte radius={999} className="rounded-full">
        <div className="flex flex-col items-center gap-4 px-10 py-12">
          {sucesso ? (
            <div
              className={cn(
                'flex h-20 w-20 items-center justify-center rounded-full bg-primary/15 shadow-brand',
                !reduz && 'motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:duration-(--motion-duration-state) motion-safe:ease-success',
              )}
            >
              <Check aria-hidden className="h-10 w-10 text-primary" strokeWidth={2.5} />
            </div>
          ) : (
            <Logo
              className={cn('auth-carregando__logo gap-4', !reduz && 'motion-safe:animate-in motion-safe:zoom-in-95')}
              symbolClassName="h-20 w-20"
              wordmarkClassName="text-3xl"
            />
          )}
          <p className="text-sm text-muted-foreground">{sucesso ? 'Entrando no painel…' : 'Entrando…'}</p>
        </div>
      </GlowEffect>
    </div>
  );
}
