-- ADR-0200 (adendo de 08/11, aviso ao terminar): montagem, desmontagem e reposição concluídas avisam no app e no
-- Telegram com o link do anúncio do kit. A marca só é gravada DEPOIS do envio (notificação com chave por
-- transferência, idempotente); sem ela, a varredura diária (reconciliar-estoque) tenta de novo.
alter table public.kit_transferencias add column if not exists aviso_fim_enviado_em timestamptz;

-- O que já terminou antes desta coluna não é avisado: a primeira varredura não pode despejar o histórico.
update public.kit_transferencias set aviso_fim_enviado_em = now()
 where estado <> 'ativa' and aviso_fim_enviado_em is null;

create index if not exists kit_transferencias_aviso_fim_pendente_idx
  on public.kit_transferencias (org_id)
  where estado = 'concluida' and aviso_fim_enviado_em is null;
