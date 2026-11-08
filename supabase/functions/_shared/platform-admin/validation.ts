import { validarCnpj } from '../fiscal/validar.ts';
import { chatPrivado } from '../notificacoes/destinatario.ts';
import type { CommercialTermsInput, Month, PaymentProfileInput, PixKeyType } from './types.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const MONTH_START = /^(\d{4}-(0[1-9]|1[0-2]))-01$/;

function fail(message: string): never {
  throw new TypeError(message);
}

function object(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Condições comerciais inválidas');
  return input as Record<string, unknown>;
}

function cents(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) fail(`${field} deve ser um inteiro não negativo`);
  return value;
}

function month(value: unknown, field: string): Month {
  if (typeof value !== 'string' || !MONTH.test(value)) fail(`${field} deve ser YYYY-MM`);
  return value;
}

export function validateTerms(input: unknown): CommercialTermsInput {
  const value = object(input);
  if (typeof value.org_id !== 'string' || !UUID.test(value.org_id)) fail('org_id inválido');
  if (typeof value.starts_on !== 'string') fail('starts_on inválido');
  const starts = value.starts_on.match(MONTH_START);
  if (!starts) fail('starts_on deve ser o primeiro dia do mês');
  if (value.modality !== 1 && value.modality !== 2) fail('modalidade inválida');
  for (const tier of ['revenue_bps_t1', 'revenue_bps_t2', 'revenue_bps_t3', 'revenue_bps_t4'] as const) {
    const tierValue = value[tier];
    if (typeof tierValue !== 'number' || !Number.isSafeInteger(tierValue) || tierValue < 0 || tierValue > 10000) {
      fail(`${tier} deve estar entre 0 e 10000`);
    }
  }
  const monthlyFeeCents = cents(value.monthly_fee_cents, 'monthly_fee_cents');
  const sonarUnitCents = cents(value.sonar_unit_cents, 'sonar_unit_cents');
  if (value.modality === 1 && sonarUnitCents !== 0) {
    fail('Modalidade 1 não cobra Sonar do cliente: informe 0');
  }
  const imageUnitCents = value.image_unit_cents === undefined ? 0 : cents(value.image_unit_cents, 'image_unit_cents');
  if (value.modality === 2 && monthlyFeeCents !== 0) {
    fail('Modalidade 2 não tem infraestrutura separada: informe 0');
  }
  if (typeof value.reason !== 'string' || !value.reason.trim()) fail('reason é obrigatório');
  // ADR-0193 D-9: vencimento no mês seguinte à competência; ausente = dia 05.
  const dueDay = value.due_day === undefined ? 5 : value.due_day;
  if (typeof dueDay !== 'number' || !Number.isInteger(dueDay) || dueDay < 1 || dueDay > 28) fail('due_day deve estar entre 1 e 28');

  const setupFee = cents(value.setup_fee_cents, 'setup_fee_cents');
  let setupDueMonth: Month | null;
  if (setupFee === 0) {
    if (value.setup_due_month !== null) fail('setup_due_month deve ser null quando não há implantação');
    setupDueMonth = null;
  } else {
    setupDueMonth = month(value.setup_due_month, 'setup_due_month');
    if (setupDueMonth < starts[1]) fail('setup_due_month não pode anteceder starts_on');
  }

  return {
    org_id: value.org_id,
    starts_on: value.starts_on,
    modality: value.modality,
    monthly_fee_cents: monthlyFeeCents,
    revenue_bps_t1: value.revenue_bps_t1 as number,
    revenue_bps_t2: value.revenue_bps_t2 as number,
    revenue_bps_t3: value.revenue_bps_t3 as number,
    revenue_bps_t4: value.revenue_bps_t4 as number,
    sonar_unit_cents: sonarUnitCents,
    image_unit_cents: imageUnitCents,
    setup_fee_cents: setupFee,
    setup_due_month: setupDueMonth,
    reason: value.reason.trim(),
    due_day: dueDay,
  };
}

/** Remove acento e tudo que não for ASCII imprimível: o BR Code conta comprimento em bytes. */
export function normalizarBrCode(texto: string): string {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '').replace(/\s+/g, ' ').trim();
}

export function validarCpf(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  const dv = (n: number) => {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(cpf[i]) * (n + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(cpf[9]) && dv(10) === Number(cpf[10]);
}

// Schema `Email` da API-DICT (BACEN, bcb.gov.br/content/estabilidadefinanceira/pix/API-DICT.html), literal:
// só ASCII minúsculo; o DICT limita a chave a 77 caracteres.
const EMAIL_DICT = /^[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;

const PIX_KEY_TYPES: readonly PixKeyType[] = ['cpf', 'cnpj', 'email', 'phone', 'random'];
const LIMITES_TEXTO = { beneficiary_name: 60, bank_name: 60, branch: 20, account: 30, city: 60 } as const;

function texto(value: unknown, field: keyof typeof LIMITES_TEXTO): string {
  if (typeof value !== 'string' || !value.trim()) fail(`${field} é obrigatório`);
  const result = value.trim();
  if (result.length > LIMITES_TEXTO[field]) fail(`${field} deve ter no máximo ${LIMITES_TEXTO[field]} caracteres`);
  return result;
}

/** Dados de recebimento da Daludi (ADR-0193 D-9). Nome ≤ 25 e cidade ≤ 15 depois de normalizados são
 *  os limites dos campos 59/60 do BR Code: validar aqui evita Pix com favorecido truncado em silêncio. */
export function validatePaymentProfile(input: unknown): PaymentProfileInput {
  const value = object(input);
  const beneficiaryName = texto(value.beneficiary_name, 'beneficiary_name');
  const city = texto(value.city, 'city');
  if (!normalizarBrCode(beneficiaryName) || normalizarBrCode(beneficiaryName).length > 25) fail('beneficiary_name deve ter até 25 caracteres sem acento (limite do Pix)');
  if (!normalizarBrCode(city) || normalizarBrCode(city).length > 15) fail('city deve ter até 15 caracteres sem acento (limite do Pix)');
  if (typeof value.document !== 'string') fail('document é obrigatório');
  const document = value.document.replace(/\D/g, '');
  if (!(document.length === 11 ? validarCpf(document) : document.length === 14 && validarCnpj(document))) fail('document deve ser CPF ou CNPJ válido');
  if (typeof value.pix_key_type !== 'string' || !PIX_KEY_TYPES.includes(value.pix_key_type as PixKeyType)) fail('pix_key_type inválido');
  const pixKeyType = value.pix_key_type as PixKeyType;
  if (typeof value.pix_key !== 'string' || !value.pix_key.trim()) fail('pix_key é obrigatória');
  const raw = value.pix_key.trim();
  let pixKey: string;
  switch (pixKeyType) {
    case 'cpf': pixKey = raw.replace(/[.\-\s]/g, ''); if (!validarCpf(pixKey)) fail('pix_key não é um CPF válido'); break;
    case 'cnpj': pixKey = raw.replace(/[.\-/\s]/g, ''); if (!/^\d{14}$/.test(pixKey) || !validarCnpj(pixKey)) fail('pix_key não é um CNPJ válido'); break;
    case 'email': pixKey = raw.toLowerCase(); if (pixKey.length > 77 || !EMAIL_DICT.test(pixKey)) fail('pix_key não é um e-mail válido (formato do DICT: sem acento, minúsculo, até 77)'); break;
    case 'phone': {
      const digits = raw.replace(/\D/g, '');
      pixKey = `+${digits.startsWith('55') && digits.length >= 12 ? digits : `55${digits}`}`;
      if (!/^\+55\d{10,11}$/.test(pixKey)) fail('pix_key deve ser celular com DDD (+55DDDNÚMERO)');
      break;
    }
    case 'random': pixKey = raw.toLowerCase(); if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(pixKey)) fail('pix_key aleatória deve ser um UUID'); break;
  }
  return {
    beneficiary_name: beneficiaryName,
    document,
    bank_name: texto(value.bank_name, 'bank_name'),
    branch: texto(value.branch, 'branch'),
    account: texto(value.account, 'account'),
    pix_key_type: pixKeyType,
    pix_key: pixKey,
    city,
  };
}

// ADR-0193 D-11: assinatura do aviso de fechamento mensal (super-admin, chat privado).
/** Valida a assinatura do aviso vinda da Central. Ativo exige chat privado (valores de todas as orgs). */
export function validarAssinaturaAviso(body: { chat_id?: unknown; ativo?: unknown }): { chatId: string | null; ativo: boolean } {
  const chat = String(body.chat_id ?? '').trim();
  const ativo = body.ativo === true;
  if (chat && !/^-?\d+$/.test(chat)) throw new TypeError('chat_id deve ser numérico (ex.: 123456789)');
  if (ativo && !chatPrivado(chat)) throw new TypeError('chat_id de conversa privada (número positivo) é obrigatório para receber o aviso');
  return { chatId: chat || null, ativo };
}
