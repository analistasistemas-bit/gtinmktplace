// Alarme de recusas do acesso de agentes (ADR-0210, emenda 4, decisão 2): passou de 1.000 recusas (401, 429, 503) no
// dia de Brasília, um aviso ao dono do SaaS. Melhor esforço: nunca lança nem muda a resposta; Redis fora não conta.
import { redisEvalInteiro, redisSet } from '../redis/client.ts';
import { diaBrt } from './limite.ts';

export const LIMITE_RECUSAS_DIA = 1000;
const TTL_DIA_S = 2 * 86_400;
/** Quem cruza o limite reserva o aviso por 60 s; se o envio falhar, a primeira recusa depois disso tenta de novo. */
const RESERVA_S = 60;
const TEMPO_REDIS_MS = 2000;

// KEYS = contador, aviso; ARGV = limite, ttl do contador, ttl da reserva. 1 = este chamador deve avisar.
const SCRIPT = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2])) end
if n > tonumber(ARGV[1]) and redis.call('SET', KEYS[2], '1', 'NX', 'EX', tonumber(ARGV[3])) then return 1 end
return 0
`;

const TEXTO = [
  '⚠️ Acesso de agentes: mais de 1.000 recusas hoje',
  'Pode ser um cliente com a chave errada ou alguém tentando entrar. Recusa não dá acesso a dados.',
  'Conferir os logs da função agentes. Se for abuso, reavaliar a assinatura na chave (ADR-0210, Emenda 3).',
].join('\n\n');

export async function registrarRecusa(agora: Date, enviar: (texto: string) => Promise<boolean>): Promise<void> {
  try {
    const dia = diaBrt(agora);
    const aviso = `agt:rec:aviso:v1:${dia}`;
    const r = await redisEvalInteiro(
      SCRIPT, [`agt:rec:v1:${dia}`, aviso], [LIMITE_RECUSAS_DIA, TTL_DIA_S, RESERVA_S], AbortSignal.timeout(TEMPO_REDIS_MS));
    if (r === 1 && await enviar(TEXTO)) await redisSet(aviso, '1', TTL_DIA_S);
  } catch {
    // Nunca a mensagem crua: pode carregar endereço ou credencial.
    console.warn('[agentes] alarme de recusas indisponível');
  }
}
