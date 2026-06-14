import type { CanalId, ChannelConnector } from './contrato.ts';
import { mercadoLivreConnector } from './mercado-livre.ts';

const CONECTORES: Record<CanalId, ChannelConnector> = {
  mercado_livre: mercadoLivreConnector,
};

export function getConnector(canal: CanalId): ChannelConnector {
  const c = CONECTORES[canal];
  if (!c) throw new Error(`Canal não suportado: ${canal}`);
  return c;
}
