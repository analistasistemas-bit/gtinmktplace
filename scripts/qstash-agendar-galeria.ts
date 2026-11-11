// ADR-0201 (Galeria da cor por IA): agendamentos do QStash da galeria. Idempotente (scheduleId fixo = upsert).
// - galeria-despachante: a cada 1 min (relógio da geração, da visão, da saga e das escritas adiadas).
// - galeria-retencao: 1×/dia às 04:00 BRT (07:00 UTC), agendamento próprio. Rodar só depois do deploy da edge
//   (antes, o QStash chamaria uma função inexistente).
// Rodar só no deploy (nunca em teste):
//   QSTASH_TOKEN=... SUPABASE_URL=https://<ref>.supabase.co \
//     deno run --allow-net --allow-env scripts/qstash-agendar-galeria.ts
import { Client } from 'npm:@upstash/qstash@^2';

const token = Deno.env.get('QSTASH_TOKEN');
const base = Deno.env.get('SUPABASE_URL')?.replace(/\/$/, '');
if (!token || !base) {
  console.error('QSTASH_TOKEN e SUPABASE_URL são obrigatórios');
  Deno.exit(1);
}

const agendas = [
  { scheduleId: 'galeria-despachante', funcao: 'galeria-despachante', cron: '* * * * *' },
  { scheduleId: 'galeria-retencao', funcao: 'galeria-retencao', cron: '0 7 * * *' },
];

const client = new Client({ token });
for (const a of agendas) {
  // retries: 0 — a próxima execução do relógio já é a nova tentativa.
  const r = await client.schedules.create({
    scheduleId: a.scheduleId, destination: `${base}/functions/v1/${a.funcao}`, cron: a.cron, retries: 0,
  });
  console.log(`${a.scheduleId}: ${a.cron} → ${a.funcao} (${r.scheduleId})`);
}
