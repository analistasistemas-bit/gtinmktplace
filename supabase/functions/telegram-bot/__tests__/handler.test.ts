import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  publishJSON: vi.fn(),
  batchJSON: vi.fn(),
  verificarAssinatura: vi.fn(),
  enviarTelegram: vi.fn(),
  consultarHoje: vi.fn(),
  consultarOntem: vi.fn(),
  consultarMes: vi.fn(),
  consultarTop: vi.fn(),
}));

vi.mock('../../_shared/queue.ts', () => ({
  qstashClient: () => ({ publishJSON: m.publishJSON, batchJSON: m.batchJSON }),
  verificarAssinatura: m.verificarAssinatura,
}));
vi.mock('../../_shared/notificacoes/telegram.ts', async (orig) => ({ ...(await orig<object>()), enviarTelegram: m.enviarTelegram }));
vi.mock('../../_shared/notificacoes/gerencial/consultas.ts', () => ({
  consultarHoje: m.consultarHoje, consultarOntem: m.consultarOntem, consultarMes: m.consultarMes, consultarTop: m.consultarTop,
}));

import { tratar } from '../handler.ts';
import { secretDaOrg } from '../../_shared/notificacoes/gerencial/bot.ts';
import { fakeInboxAdmin } from '../../_shared/notificacoes/gerencial/__tests__/fake-inbox.ts';
import {
  TEXTO_AJUDA, TEXTO_ERRO, TEXTO_SEM_ACESSO, TEXTO_SO_PRIVADO, TEXTO_VOLUME,
} from '../../_shared/notificacoes/gerencial/mensagens.ts';
import { ContextoIndisponivel, VolumeAcimaDoLimite } from '../../_shared/platform-admin/metrics-repository.ts';

const ORG = '11111111-1111-4111-8111-111111111111';
const CHAVE = 'chave-mestra';
const BOT = 7001;
const T0 = new Date('2026-10-25T12:00:00Z');
const URL_BOT = `https://proj.supabase.co/functions/v1/telegram-bot?org=${ORG}`;

let agora = T0;
const deps = (admin: any) => ({ admin, chave: CHAVE as string | undefined, agora: () => agora });

const cfg = (over = {}) => ({ org_id: ORG, telegram_bot_id: BOT, telegram_bot_token: 'tok', telegram_ativo: true, ...over });
const perfilAdmin = { org_id: ORG, telegram_chat_id: '42', is_admin: true, is_active: true };
const update = (texto = '/hoje', chat: Record<string, unknown> = { id: 42, type: 'private' }) =>
  ({ update_id: 1, message: { message_id: 9, text: texto, chat } });
const linha = (payload: unknown, over = {}) =>
  ({ bot_id: BOT, update_id: 1, org_id: ORG, payload, status: 'recebido', tentativas: 0, recebido_em: T0.toISOString(), ...over });

async function webhook(admin: any, body: unknown, secret: string | null, url = URL_BOT) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (secret !== null) headers['x-telegram-bot-api-secret-token'] = secret;
  return tratar(new Request(url, { method: 'POST', headers, body: JSON.stringify(body) }), deps(admin));
}
const job = (admin: any, body: unknown) => tratar(new Request('https://proj.supabase.co/functions/v1/telegram-bot', {
  method: 'POST', headers: { 'upstash-signature': 'sig' }, body: JSON.stringify(body),
}), deps(admin));

beforeEach(() => {
  vi.resetAllMocks();
  agora = T0;
  vi.stubGlobal('Deno', { env: { get: () => 'https://proj.supabase.co' } });
  m.publishJSON.mockResolvedValue({ messageId: 'm' });
  m.batchJSON.mockImplementation(async (msgs: unknown[]) => msgs.map(() => ({ messageId: 'x' })));
  m.verificarAssinatura.mockResolvedValue(true);
  m.enviarTelegram.mockResolvedValue(true);
  const kpis = { faturamento: 100, pedidos: 2, ticket: 50 };
  const l = { lucro: 10, motivo: null, pctVendaComLucro: 1, vendaSemCusto: 0, vendaSemImposto: 0, vendaCustoEstimado: 0, pedidosFreteNaoLido: 0, markup: 0.5 };
  m.consultarHoje.mockResolvedValue({ k: { hoje: kpis, mes: kpis, anterior: kpis, rotuloMes: 'Outubro', rotuloAnterior: '1–25/set' }, l });
});

describe('roteamento', () => {
  it('sem header do Telegram nem do QStash → 401', async () => {
    const r = await tratar(new Request(URL_BOT, { method: 'POST', body: '{}' }), deps(fakeInboxAdmin()));
    expect(r.status).toBe(401);
  });
  it('assinatura QStash inválida → 401 (não cai no webhook)', async () => {
    m.verificarAssinatura.mockResolvedValue(false);
    expect((await job(fakeInboxAdmin(), { bot_id: BOT, update_id: 1 })).status).toBe(401);
  });
  it('TELEGRAM_WEBHOOK_KEY ausente → 500', async () => {
    const admin = fakeInboxAdmin({ configuracoes: [cfg()] });
    const r = await tratar(new Request(URL_BOT, { method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'x' }, body: '{}' }), { ...deps(admin), chave: undefined });
    expect(r.status).toBe(500);
  });
});

describe('webhook', () => {
  const secret = () => secretDaOrg(CHAVE, ORG, BOT);

  it('bot desvinculado (bot_id nulo) ou desativado → 200 sem gravar', async () => {
    for (const c of [cfg({ telegram_bot_id: null }), cfg({ telegram_ativo: false })]) {
      const admin = fakeInboxAdmin({ configuracoes: [c] });
      expect((await webhook(admin, update(), await secret())).status).toBe(200);
      expect(admin.linhas).toHaveLength(0);
    }
  });
  it('secret inválido (outra org ou outro bot) → 401 sem gravar', async () => {
    const admin = fakeInboxAdmin({ configuracoes: [cfg()] });
    expect((await webhook(admin, update(), await secretDaOrg(CHAVE, '22222222-2222-4222-8222-222222222222', BOT))).status).toBe(401);
    expect((await webhook(admin, update(), await secretDaOrg(CHAVE, ORG, BOT + 1))).status).toBe(401);
    expect(admin.linhas).toHaveLength(0);
  });
  it('org inválida na URL → 401', async () => {
    const admin = fakeInboxAdmin({ configuracoes: [cfg()] });
    expect((await webhook(admin, update(), await secret(), 'https://proj.supabase.co/functions/v1/telegram-bot?org=x')).status).toBe(401);
  });
  it('nova → grava e publica → 200', async () => {
    const admin = fakeInboxAdmin({ configuracoes: [cfg()] });
    expect((await webhook(admin, update(), await secret())).status).toBe(200);
    expect(admin.linhas[0]).toMatchObject({ bot_id: BOT, update_id: 1, org_id: ORG });
    expect(m.publishJSON).toHaveBeenCalledWith(expect.objectContaining({ body: { bot_id: BOT, update_id: 1 }, deduplicationId: `tg-${BOT}-1-0` }));
  });
  it('pendente (insert ok, publish falhou antes) → publica de novo → 200', async () => {
    const admin = fakeInboxAdmin({ configuracoes: [cfg()], telegram_updates: [linha(update())] });
    expect((await webhook(admin, update(), await secret())).status).toBe(200);
    expect(m.publishJSON).toHaveBeenCalledOnce();
  });
  it('concluída → 200 sem publicar', async () => {
    const admin = fakeInboxAdmin({ configuracoes: [cfg()], telegram_updates: [linha(update(), { status: 'respondido' })] });
    expect((await webhook(admin, update(), await secret())).status).toBe(200);
    expect(m.publishJSON).not.toHaveBeenCalled();
  });
  it('falha de insert ou de publish → 500 (o Telegram reenvia)', async () => {
    const admin = fakeInboxAdmin({ configuracoes: [cfg()] });
    admin.falhar.add('upsert');
    expect((await webhook(admin, update(), await secret())).status).toBe(500);
    const admin2 = fakeInboxAdmin({ configuracoes: [cfg()] });
    m.publishJSON.mockRejectedValue(new Error('qstash fora'));
    expect((await webhook(admin2, update(), await secret())).status).toBe(500);
  });
  it('update sem update_id → 200 sem gravar', async () => {
    const admin = fakeInboxAdmin({ configuracoes: [cfg()] });
    expect((await webhook(admin, { message: {} }, await secret())).status).toBe(200);
    expect(admin.linhas).toHaveLength(0);
  });
});

describe('worker', () => {
  const tabelas = (payload = update(), over = {}) => ({
    configuracoes: [cfg()], profiles: [perfilAdmin], telegram_updates: [linha(payload, over)],
  });

  it('admin em chat privado: /hoje → envia e conclui respondido', async () => {
    const admin = fakeInboxAdmin(tabelas());
    expect((await job(admin, { bot_id: BOT, update_id: 1 })).status).toBe(200);
    expect(m.enviarTelegram).toHaveBeenCalledWith('tok', '42', expect.stringContaining('📅 Hoje'));
    expect(m.consultarHoje).toHaveBeenCalledWith(admin, ORG, T0);
    expect(admin.linhas[0].status).toBe('respondido');
  });

  it('reivindicar null (posse de outra execução) → 200 sem enviar; concorrentes → envia 1×', async () => {
    const admin = fakeInboxAdmin(tabelas());
    const [a, b] = await Promise.all([job(admin, { bot_id: BOT, update_id: 1 }), job(admin, { bot_id: BOT, update_id: 1 })]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(m.enviarTelegram).toHaveBeenCalledOnce();
  });

  it('execução vencida: lease venceu durante a consulta → não envia; B conclui', async () => {
    const admin = fakeInboxAdmin(tabelas());
    m.consultarHoje.mockImplementationOnce(async () => {
      agora = new Date(T0.getTime() + 61_000); // a consulta de A passou do lease
      const rB = await job(admin, { bot_id: BOT, update_id: 1 }); // B reivindica e responde
      expect(rB.status).toBe(200);
      return { k: { hoje: { faturamento: 1, pedidos: 1, ticket: 1 } }, l: { lucro: null, motivo: null, pctVendaComLucro: 0, vendaSemCusto: 0, vendaSemImposto: 0, vendaCustoEstimado: 0, pedidosFreteNaoLido: 0, markup: null } };
    });
    expect((await job(admin, { bot_id: BOT, update_id: 1 })).status).toBe(200);
    expect(m.enviarTelegram).toHaveBeenCalledOnce(); // só B
    expect(admin.linhas[0]).toMatchObject({ status: 'respondido', tentativas: 2 });
  });

  it('bot desvinculado ou desativado no processamento → falhou sem responder', async () => {
    for (const c of [cfg({ telegram_bot_id: BOT + 1 }), cfg({ telegram_ativo: false })]) {
      const admin = fakeInboxAdmin({ ...tabelas(), configuracoes: [c] });
      expect((await job(admin, { bot_id: BOT, update_id: 1 })).status).toBe(200);
      expect(admin.linhas[0]).toMatchObject({ status: 'falhou', erro: 'bot desvinculado' });
    }
    expect(m.enviarTelegram).not.toHaveBeenCalled();
  });

  it('sem acesso: chat sem profile, não-admin, profile de outra org → texto fixo, sem consulta', async () => {
    for (const profiles of [[], [{ ...perfilAdmin, is_admin: false }], [{ ...perfilAdmin, org_id: 'outra' }]]) {
      const admin = fakeInboxAdmin({ ...tabelas(), profiles });
      expect((await job(admin, { bot_id: BOT, update_id: 1 })).status).toBe(200);
      expect(m.enviarTelegram).toHaveBeenLastCalledWith('tok', '42', TEXTO_SEM_ACESSO);
    }
    expect(m.consultarHoje).not.toHaveBeenCalled();
  });

  it('grupo → só privado, mesmo com admin vinculado ao chat', async () => {
    const chat = { id: -100123, type: 'supergroup' };
    const admin = fakeInboxAdmin({ ...tabelas(update('/hoje', chat)), profiles: [{ ...perfilAdmin, telegram_chat_id: '-100123' }] });
    expect((await job(admin, { bot_id: BOT, update_id: 1 })).status).toBe(200);
    expect(m.enviarTelegram).toHaveBeenCalledWith('tok', '-100123', TEXTO_SO_PRIVADO);
    expect(m.consultarHoje).not.toHaveBeenCalled();
  });

  it('comando desconhecido → ajuda', async () => {
    const admin = fakeInboxAdmin(tabelas(update('oi')));
    expect((await job(admin, { bot_id: BOT, update_id: 1 })).status).toBe(200);
    expect(m.enviarTelegram).toHaveBeenCalledWith('tok', '42', TEXTO_AJUDA);
  });

  it('VolumeAcimaDoLimite → TEXTO_VOLUME (resposta normal)', async () => {
    m.consultarTop.mockRejectedValue(new VolumeAcimaDoLimite('muito'));
    const admin = fakeInboxAdmin(tabelas(update('/top')));
    expect((await job(admin, { bot_id: BOT, update_id: 1 })).status).toBe(200);
    expect(m.enviarTelegram).toHaveBeenCalledWith('tok', '42', TEXTO_VOLUME);
    expect(admin.linhas[0].status).toBe('respondido');
  });

  it('enviarTelegram false → devolve + 500; na 5ª tentativa vira falhou', async () => {
    m.enviarTelegram.mockResolvedValue(false);
    const admin = fakeInboxAdmin(tabelas());
    expect((await job(admin, { bot_id: BOT, update_id: 1 })).status).toBe(500);
    expect(admin.linhas[0]).toMatchObject({ status: 'recebido', erro: 'envio falhou', tentativas: 1 });
    admin.linhas[0].tentativas = 4;
    expect((await job(admin, { bot_id: BOT, update_id: 1 })).status).toBe(500);
    expect(admin.linhas[0].status).toBe('falhou');
  });

  it('erro de banco ou ContextoIndisponivel → devolve + 500', async () => {
    m.consultarHoje.mockRejectedValue(new ContextoIndisponivel('catálogo'));
    const admin = fakeInboxAdmin(tabelas());
    expect((await job(admin, { bot_id: BOT, update_id: 1 })).status).toBe(500);
    expect(admin.linhas[0]).toMatchObject({ status: 'recebido', erro: 'catálogo' });

    const admin2 = fakeInboxAdmin(tabelas());
    admin2.falhar.add('from:profiles');
    expect((await job(admin2, { bot_id: BOT, update_id: 1 })).status).toBe(500);
    expect(admin2.linhas[0].status).toBe('recebido');
    expect(m.enviarTelegram).not.toHaveBeenCalled();
  });
});

describe('worker — falhas nas bordas', () => {
  const tabelas = (over = {}) => ({ configuracoes: [cfg()], profiles: [perfilAdmin], telegram_updates: [linha(update(), over)] });

  it('erro na 5ª tentativa → avisa TEXTO_ERRO e encerra falhou', async () => {
    m.consultarHoje.mockRejectedValue(new ContextoIndisponivel('catálogo'));
    const admin = fakeInboxAdmin(tabelas({ tentativas: 4 }));
    expect((await job(admin, { bot_id: BOT, update_id: 1 })).status).toBe(500);
    expect(m.enviarTelegram).toHaveBeenCalledWith('tok', '42', TEXTO_ERRO);
    expect(admin.linhas[0].status).toBe('falhou');
  });

  it('concluir falha depois do envio → não devolve; grava respondido direto e nova execução não reenvia', async () => {
    const admin = fakeInboxAdmin(tabelas({ tentativas: 4 }));
    admin.falhar.add('rpc:telegram_update_concluir');
    expect((await job(admin, { bot_id: BOT, update_id: 1 })).status).toBe(200);
    expect(m.enviarTelegram).toHaveBeenCalledOnce();
    expect(m.enviarTelegram).not.toHaveBeenCalledWith('tok', '42', TEXTO_ERRO);
    expect(admin.linhas[0].status).toBe('respondido');
    // Lease vencido + varredura/retry: sem a marca, a linha seria reivindicada e o comando reenviado.
    agora = new Date(T0.getTime() + 61_000);
    expect((await job(admin, { bot_id: BOT, update_id: 1 })).status).toBe(200);
    expect(m.enviarTelegram).toHaveBeenCalledOnce();
  });

  it('concluir falha uma vez depois do envio → repete e conclui respondido', async () => {
    const admin = fakeInboxAdmin(tabelas());
    const rpcOriginal = admin.rpc.getMockImplementation();
    let falhou = false;
    admin.rpc.mockImplementation(async (fn: string, args: any) => {
      if (fn === 'telegram_update_concluir' && !falhou) { falhou = true; return { data: null, error: { message: 'timeout' } }; }
      return rpcOriginal(fn, args);
    });
    expect((await job(admin, { bot_id: BOT, update_id: 1 })).status).toBe(200);
    expect(m.enviarTelegram).toHaveBeenCalledOnce();
    expect(admin.linhas[0].status).toBe('respondido');
    expect(admin.linhas[0].erro).toBeNull();
  });
});

describe('varredura', () => {
  it('{ varrer: true } republica parados e ignora respondido', async () => {
    const admin = fakeInboxAdmin({
      telegram_updates: [
        linha({}, { update_id: 1, publicado_em: new Date(T0.getTime() - 300_000).toISOString() }),
        linha({}, { update_id: 2, status: 'processando', tentativas: 1, lease_ate: new Date(T0.getTime() - 1000).toISOString() }),
        linha({}, { update_id: 3, status: 'respondido', recebido_em: new Date(T0.getTime() - 600_000).toISOString() }),
      ],
    });
    const r = await job(admin, { varrer: true });
    expect(r.status).toBe(200);
    expect(m.batchJSON.mock.calls.flatMap(([b]) => b).map((x: any) => x.body.update_id)).toEqual([1, 2]);
  });
});
