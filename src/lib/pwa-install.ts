export const COOLDOWN_KEY = 'pwa_install_dismissed_until';

/**
 * Checa se o app está sendo executado no modo standalone (instalado como PWA).
 */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;

  const isStandaloneMedia = window.matchMedia?.('(display-mode: standalone)')?.matches ?? false;
  const isIosStandalone = Boolean(
    (navigator as unknown as { standalone?: boolean })?.standalone
  );

  return isStandaloneMedia || isIosStandalone;
}

/**
 * Checa se o dispositivo é iOS (iPhone, iPad, iPod ou iPadOS moderno) e não está instalado.
 */
export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (isStandalone()) return false;

  const ua = navigator.userAgent || '';
  const isIosDevice = /iPhone|iPad|iPod/i.test(ua);
  const isIpadOS =
    navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1;

  return isIosDevice || isIpadOS;
}

/**
 * Checa se o aviso de instalação foi dispensado e se o cooldown ainda está ativo.
 */
export function isDismissed(): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    const until = localStorage.getItem(COOLDOWN_KEY);
    if (!until) return false;
    const expiresAt = Number(until);
    if (isNaN(expiresAt)) return false;
    return Date.now() < expiresAt;
  } catch {
    return false;
  }
}

/**
 * Define o cooldown no localStorage para não exibir o banner por N dias.
 */
export function setDismissCooldown(days = 7): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const expiresAt = Date.now() + days * 24 * 60 * 60 * 1000;
    localStorage.setItem(COOLDOWN_KEY, String(expiresAt));
  } catch {
    // LocalStorage quota ou desabilitado — ignora silenciosamente
  }
}

/**
 * Limpa o cooldown no localStorage (útil para testes ou reativação).
 */
export function clearDismissCooldown(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(COOLDOWN_KEY);
  } catch {
    // ignora
  }
}
