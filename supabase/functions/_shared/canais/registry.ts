import type { CanalId, ChannelConnector } from './contrato.ts';
import { mercadoLivreConnector } from './mercado-livre.ts';

const CONECTORES: Record<CanalId, ChannelConnector> = {
  mercado_livre: mercadoLivreConnector,
};

// E6 (ADR-0061 / D-E6.5): conectores extras injetáveis só em teste (ex.: fakeConnector).
// Produção nunca chama registrarConectorParaTeste → o mapa fica vazio.
const extras = new Map<string, ChannelConnector>();
export function registrarConectorParaTeste(c: ChannelConnector): void { extras.set(c.id, c); }

// Assinatura relaxada para `string` (o fan-out por canal passa o canal como string);
// callers atuais passam literal 'mercado_livre' → zero quebra.
export function getConnector(canal: string): ChannelConnector {
  const c = extras.get(canal) ?? CONECTORES[canal as CanalId];
  if (!c) throw new Error(`Canal não suportado: ${canal}`);
  return c;
}
