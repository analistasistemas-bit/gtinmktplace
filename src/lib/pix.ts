// ADR-0193 D-9: Pix estático (BR Code / EMV MPM) com o valor exato do demonstrativo fechado.
// Gerado no browser porque o PDF do relatório mensal é montado no front (jsPDF).
// Estrutura TLV (ID 2 dígitos + tamanho 2 dígitos + valor) conforme o Manual de Padrões para Iniciação
// do Pix (BACEN, anexo BR Code): 00 formato, 26 conta (GUI br.gov.bcb.pix + chave), 52 MCC, 53 moeda,
// 54 valor, 58 país, 59 nome (≤ 25), 60 cidade (≤ 15), 62/05 txid (≤ 25 alfanumérico, `***` = sem txid),
// 63 CRC16.
import { normalizarBrCode } from '../../supabase/functions/_shared/platform-admin/validation';

function tlv(id: string, valor: string): string {
  return `${id}${String(valor.length).padStart(2, '0')}${valor}`;
}

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF, sem reflexão, xorout 0) — o exigido pelo BR Code. */
export function crc16(texto: string): string {
  let crc = 0xffff;
  for (let i = 0; i < texto.length; i++) {
    crc ^= texto.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export type PixInput = {
  chave: string;
  valorCents: number;
  nome: string;
  cidade: string;
  /** Ex.: id do demonstrativo. Fica só o alfanumérico, até 25; vazio vira `***`. */
  txid?: string;
};

export function pixPayload({ chave, valorCents, nome, cidade, txid }: PixInput): string {
  if (!Number.isSafeInteger(valorCents) || valorCents <= 0) throw new Error('Pix exige valor positivo em centavos');
  const chaveLimpa = chave.trim();
  if (!chaveLimpa || chaveLimpa.length > 77) throw new Error('chave Pix inválida');
  // A chave vai crua para o TLV: fora do ASCII imprimível, tamanho e CRC (em bytes) divergiriam.
  if (!/^[\x21-\x7e]+$/.test(chaveLimpa)) throw new Error('chave Pix deve ser ASCII (sem acento)');
  const nomeBr = normalizarBrCode(nome).slice(0, 25).trim();
  const cidadeBr = normalizarBrCode(cidade).slice(0, 15).trim();
  if (!nomeBr || !cidadeBr) throw new Error('Pix exige nome e cidade do favorecido');
  // txid só com [A-Za-z0-9] (ASCII por construção); nome e cidade já saem ASCII de normalizarBrCode.
  const txidBr = (txid ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***';
  const corpo = tlv('00', '01')
    + tlv('26', tlv('00', 'br.gov.bcb.pix') + tlv('01', chaveLimpa))
    + tlv('52', '0000')
    + tlv('53', '986')
    + tlv('54', (valorCents / 100).toFixed(2))
    + tlv('58', 'BR')
    + tlv('59', nomeBr)
    + tlv('60', cidadeBr)
    + tlv('62', tlv('05', txidBr))
    + '6304';
  return corpo + crc16(corpo);
}

/** QR do payload como PNG data URL (para `doc.addImage` do jsPDF). Lib carregada sob demanda. */
export async function pixQrDataUrl(payload: string): Promise<string> {
  const { toDataURL } = await import('qrcode');
  return toDataURL(payload, { type: 'image/png', errorCorrectionLevel: 'M', margin: 1, width: 512 });
}
