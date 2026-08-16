// Pulse (ADR-0119): texto do alerta por tipo, para o painel e para o sino. Função pura — sem I/O.
import type { PulseAlerta } from './pulse';
import { fmtBRL } from './formato';

export function textoAlerta(alerta: PulseAlerta): string {
  // Sem nome da ficha, "um produto do radar" lê melhor que o código do ML — e melhor ainda que a
  // palavra "produto" solta, que produzia frases como "Novo concorrente em produto a R$ 50".
  const p = alerta.pulse_produtos;
  const titulo = p?.titulo ?? (p?.catalog_product_id ? `ficha ${p.catalog_product_id}` : 'um produto do radar');
  const payload = alerta.payload;
  const valor = (v: unknown) => (Number.isFinite(Number(v)) ? fmtBRL(Number(v)) : null);
  switch (alerta.tipo) {
    case 'preco_caiu': {
      const de = valor(payload.de);
      const para = valor(payload.para);
      return de && para
        ? `Menor preço de ${titulo} caiu de ${de} para ${para}`
        : `Menor preço de ${titulo} caiu`;
    }
    case 'novo_concorrente': {
      const preco = valor(payload.preco);
      return preco ? `Novo concorrente em ${titulo} a ${preco}` : `Novo concorrente em ${titulo}`;
    }
    case 'concorrente_saiu':
      return `Um concorrente saiu de ${titulo}`;
    default:
      // Tipo novo vindo de um deploy da edge: melhor uma linha genérica que uma linha em branco.
      return `Mudança no mercado de ${titulo}`;
  }
}
