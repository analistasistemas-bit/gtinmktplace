// Pulse (ADR-0119): texto do alerta por tipo, para o painel e para o sino. Função pura — sem I/O.
import type { PulseAlerta } from './pulse';
import { fmtBRL } from './formato';

export function textoAlerta(alerta: PulseAlerta): string {
  const titulo = alerta.pulse_produtos?.titulo ?? alerta.pulse_produtos?.catalog_product_id ?? 'produto';
  const payload = alerta.payload;
  switch (alerta.tipo) {
    case 'preco_caiu':
      return `Menor preço de ${titulo} caiu de ${fmtBRL(Number(payload.de))} para ${fmtBRL(Number(payload.para))}`;
    case 'novo_concorrente':
      return `Novo concorrente em ${titulo} a ${fmtBRL(Number(payload.preco))}`;
    case 'concorrente_saiu':
      return `Um concorrente saiu de ${titulo}`;
  }
}
