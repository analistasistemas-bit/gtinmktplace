import { cn } from "@/lib/utils"

// A classe `.track-indeterminate` mora em src/index.css. Este componente existe só para que
// `role` e `aria-label` não sejam reescritos — e esquecidos — em cada lugar que mostra espera.
export function ProgressoIndeterminado({
  label,
  className,
}: {
  /** O que está acontecendo, na voz do sistema: "Enfileirando publicação". Nunca "Carregando". */
  label: string
  className?: string
}) {
  return (
    <div
      className={cn("track-indeterminate", className)}
      role="progressbar"
      aria-label={label}
    />
  )
}
