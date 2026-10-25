// Aparência dos selos injetados na página do ML (anúncio e busca): tokens do app PubliAI no tema claro.
import type { TomDoSelo } from './selo';

// Cores do selo = tokens do app PubliAI (tema claro, a página do ML é clara). Shadow DOM: o CSS do ML não vaza.
export const CORES: Record<TomDoSelo, { fundo: string; borda: string; texto: string }> = {
  lucro: { fundo: 'oklch(0.97 0.035 150)', borda: 'oklch(0.86 0.08 150)', texto: 'oklch(0.42 0.13 150)' },
  prejuizo: { fundo: 'oklch(0.97 0.025 25)', borda: 'oklch(0.87 0.07 25)', texto: 'oklch(0.50 0.20 25)' },
  neutro: { fundo: 'oklch(0.97 0.006 277)', borda: 'oklch(0.89 0.008 277)', texto: 'oklch(0.36 0.02 277)' },
  proprio: { fundo: 'oklch(0.96 0.03 277)', borda: 'oklch(0.86 0.07 277)', texto: 'oklch(0.45 0.19 277)' },
};
export const MARCA =
  '<svg viewBox="0 0 64 64" fill="none" aria-hidden="true"><defs><linearGradient id="m" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">' +
  '<stop offset="0" stop-color="#5C5CEB"/><stop offset="1" stop-color="#9152E3"/></linearGradient></defs>' +
  '<g stroke="url(#m)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21H31"/><path d="M11 32H34"/><path d="M17 43H31"/><path d="M37 16 L53 32 L37 48"/></g>' +
  '<g fill="url(#m)"><circle cx="7" cy="21" r="3"/><circle cx="4" cy="32" r="3"/><circle cx="7" cy="43" r="3"/></g></svg>';

