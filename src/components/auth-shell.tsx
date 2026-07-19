import { Card } from '@/components/ui/card';
import { Logo } from '@/components/ui/logo';
import { cn } from '@/lib/utils';

interface AuthShellProps {
  /** Linha sob a logo hero (ex.: "Publicação de anúncios para Marketplaces"). */
  subtitle?: string;
  /** true → card anima fade-out (usado no sucesso antes de navegar). */
  saindo?: boolean;
  /** Conteúdo do card — form/estados específicos de cada página. */
  children: React.ReactNode;
}

/**
 * Shell compartilhado das telas de auth (login, reset-senha, definir-senha).
 * Sempre dark, independente do tema salvo do usuário — ver ADR-0080.
 */
export function AuthShell({ subtitle, saindo, children }: AuthShellProps) {
  return (
    <div
      className="dark relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-background p-4 text-foreground"
      style={{ colorScheme: 'dark' }}
    >
      <div aria-hidden className="auth-grid pointer-events-none absolute inset-0" />

      <div
        className="relative z-10 mb-8 flex flex-col items-center gap-3 duration-(--motion-duration-page) ease-enter animate-in fade-in zoom-in-95 fill-mode-both"
      >
        <div
          aria-hidden
          className="absolute -inset-x-20 -inset-y-12 -z-10 rounded-full bg-[image:var(--brand-gradient-soft)] opacity-50 blur-3xl"
        />
        <Logo
          className="gap-3"
          symbolClassName="h-14 w-14 sm:h-16 sm:w-16"
          wordmarkClassName="text-2xl sm:text-3xl"
        />
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      </div>

      <Card
        className={cn(
          'z-10 w-full max-w-sm border-border/60 bg-card/60 p-6 shadow-lg backdrop-blur-xl',
          saindo
            ? 'duration-(--motion-duration-overlay) ease-exit animate-out fade-out slide-out-to-top-2 fill-mode-forwards'
            : 'duration-(--motion-duration-enter) ease-enter delay-(--motion-duration-micro) animate-in fade-in slide-in-from-bottom-2 fill-mode-both',
        )}
      >
        {children}
      </Card>
    </div>
  );
}
