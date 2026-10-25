import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ publishJSON: vi.fn(), batchJSON: vi.fn() }));
vi.mock('../../../queue.ts', () => ({ qstashClient: () => ({ publishJSON: m.publishJSON, batchJSON: m.batchJSON }) }));

import {
  concluir, confirmarPosse, devolver, publicarUpdate, receberUpdate, reivindicar, varrerInbox,
} from '../inbox.ts';
import { fakeInboxAdmin } from './fake-inbox.ts';

type Linha = Record<string, any>;
const ORG = 'org-a';
const T0 = new Date('2026-10-25T12:00:00Z');
const seg = (s: number) => new Date(T0.getTime() + s * 1000);

const fakeAdmin = (linhas: Linha[] = []) => fakeInboxAdmin({ telegram_updates: linhas });

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('Deno', { env: { get: () => 'https://proj.supabase.co' } });
  m.publishJSON.mockResolvedValue({ messageId: 'm' });
  m.batchJSON.mockImplementation(async (msgs: unknown[]) => msgs.map(() => ({ messageId: 'x' })));
});

describe('receberUpdate', () => {
  it('nova → pendente (recebido/processando) → concluida (respondido/falhou)', async () => {
    const admin = fakeAdmin();
    expect(await receberUpdate(admin, ORG, 7, { update_id: 1, message: { text: '/hoje' } })).toBe('nova');
    expect(admin.linhas[0]).toMatchObject({ bot_id: 7, update_id: 1, org_id: ORG, payload: { update_id: 1, message: { text: '/hoje' } } });
    expect(await receberUpdate(admin, ORG, 7, { update_id: 1 })).toBe('pendente');
    admin.linhas[0].status = 'processando';
    expect(await receberUpdate(admin, ORG, 7, { update_id: 1 })).toBe('pendente');
    admin.linhas[0].status = 'respondido';
    expect(await receberUpdate(admin, ORG, 7, { update_id: 1 })).toBe('concluida');
    admin.linhas[0].status = 'falhou';
    expect(await receberUpdate(admin, ORG, 7, { update_id: 1 })).toBe('concluida');
  });
});

describe('publicarUpdate', () => {
  it('publica com dedup por tentativa e grava publicado_em', async () => {
    const admin = fakeAdmin([{ bot_id: 7, update_id: 1, org_id: ORG, status: 'recebido', tentativas: 2, publicado_em: null, recebido_em: T0.toISOString() }]);
    await publicarUpdate(admin, 7, 1);
    expect(m.publishJSON).toHaveBeenCalledWith({
      url: 'https://proj.supabase.co/functions/v1/telegram-bot', body: { bot_id: 7, update_id: 1 },
      retries: 3, deduplicationId: 'tg-7-1-2',
    });
    expect(admin.linhas[0].publicado_em).toBeTruthy();
  });
  it('lança se o QStash falhar', async () => {
    const admin = fakeAdmin([{ bot_id: 7, update_id: 1, org_id: ORG, status: 'recebido', tentativas: 0 }]);
    m.publishJSON.mockRejectedValue(new Error('qstash fora'));
    await expect(publicarUpdate(admin, 7, 1)).rejects.toThrow('qstash fora');
  });
});

describe('lease', () => {
  const nova = () => fakeAdmin([{ bot_id: 7, update_id: 1, org_id: ORG, payload: {}, status: 'recebido', tentativas: 0 }]);
  const pk = { botId: 7, updateId: 1 };

  it('duas reivindicações → uma vence', async () => {
    const admin = nova();
    const a = await reivindicar(admin, 7, 1, T0);
    expect(a?.leaseId).toBeTruthy();
    expect(a?.row.tentativas).toBe(1);
    expect(await reivindicar(admin, 7, 1, seg(5))).toBeNull();
  });

  it('execução vencida não confirma, não conclui nem devolve; B conclui', async () => {
    const admin = nova();
    const a = (await reivindicar(admin, 7, 1, T0))!;
    const b = (await reivindicar(admin, 7, 1, seg(61)))!;
    expect(b.leaseId).not.toBe(a.leaseId);
    expect(await confirmarPosse(admin, pk, a.leaseId, seg(62))).toBe(false);
    expect(await concluir(admin, pk, a.leaseId, 'respondido')).toBe(false);
    expect(await devolver(admin, pk, a.leaseId, 'x')).toBe(false);
    expect(admin.linhas[0]).toMatchObject({ status: 'processando', lease_id: b.leaseId });
    expect(await confirmarPosse(admin, pk, b.leaseId, seg(62))).toBe(true);
    expect(await concluir(admin, pk, b.leaseId, 'respondido')).toBe(true);
    expect(admin.linhas[0].status).toBe('respondido');
  });

  it('devolver volta a recebido; com 5 tentativas vira falhou', async () => {
    const admin = nova();
    for (let i = 1; i <= 5; i++) {
      const r = (await reivindicar(admin, 7, 1, T0))!;
      expect(await devolver(admin, pk, r.leaseId, 'envio falhou')).toBe(true);
      expect(admin.linhas[0].status).toBe(i < 5 ? 'recebido' : 'falhou');
    }
  });

  it('erro do banco lança', async () => {
    const admin = nova();
    admin.falhar.add('rpc:telegram_update_reivindicar').add('rpc:telegram_update_concluir');
    await expect(reivindicar(admin, 7, 1, T0)).rejects.toThrow('falha simulada');
    await expect(concluir(admin, pk, 'l', 'respondido')).rejects.toThrow('falha simulada');
  });
});

describe('varrerInbox', () => {
  it('republica recebido parado e processando vencido; ignora respondido e recente', async () => {
    const admin = fakeAdmin([
      { bot_id: 7, update_id: 1, status: 'recebido', tentativas: 0, publicado_em: seg(-300).toISOString(), recebido_em: seg(-300).toISOString() },
      { bot_id: 7, update_id: 2, status: 'processando', tentativas: 1, lease_ate: seg(-1).toISOString(), recebido_em: seg(-120).toISOString() },
      { bot_id: 7, update_id: 3, status: 'respondido', tentativas: 1, recebido_em: seg(-600).toISOString() },
      { bot_id: 7, update_id: 4, status: 'recebido', tentativas: 0, publicado_em: seg(-10).toISOString(), recebido_em: seg(-10).toISOString() },
    ]);
    expect(await varrerInbox(admin, T0)).toBe(2);
    const msgs = m.batchJSON.mock.calls.flatMap(([b]) => b);
    expect(msgs.map((x: any) => x.deduplicationId)).toEqual(['tg-7-1-0', 'tg-7-2-1']);
    expect(msgs[0].body).toEqual({ bot_id: 7, update_id: 1 });
    expect(m.publishJSON).not.toHaveBeenCalled();
  });

  it('lote cheio (200) publica a continuação com cursor', async () => {
    const linhas = Array.from({ length: 210 }, (_, i) => ({
      bot_id: 7, update_id: i + 1, status: 'recebido', tentativas: 0, publicado_em: null, recebido_em: seg(-300).toISOString(),
    }));
    const admin = fakeAdmin(linhas);
    expect(await varrerInbox(admin, T0)).toBe(200);
    expect(m.publishJSON).toHaveBeenCalledWith({
      url: 'https://proj.supabase.co/functions/v1/telegram-bot', body: { varrer: true, depois: { botId: 7, updateId: 200 } }, retries: 3,
    });
    expect(await varrerInbox(admin, T0, { botId: 7, updateId: 200 })).toBe(10);
  });
});
