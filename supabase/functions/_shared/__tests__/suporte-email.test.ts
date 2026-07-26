import { afterEach, describe, expect, it, vi } from 'vitest';
import { enviarEmailSuporte } from '../suporte-email.ts';

afterEach(() => vi.unstubAllEnvs());

describe('enviarEmailSuporte', () => {
  it('rejeita configuração ausente sem expor segredo', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    vi.stubEnv('SUPPORT_EMAIL_FROM', '');
    await expect(enviarEmailSuporte({ to: 'admin@cliente.test', subject: 'Suporte', text: 'Abrir', appUrl: 'https://app.test' }))
      .rejects.toThrow('configuração de e-mail de suporte ausente');
  });

  it('envia link que somente abre o app', async () => {
    vi.stubEnv('RESEND_API_KEY', 'secret');
    vi.stubEnv('SUPPORT_EMAIL_FROM', 'suporte@daludi.test');
    const fetchSpy = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    await enviarEmailSuporte({ to: 'admin@cliente.test', subject: 'Suporte', text: 'Acesse a solicitação', appUrl: 'https://app.test' });

    const [, init] = fetchSpy.mock.calls[0];
    expect(fetchSpy.mock.calls[0][0]).toBe('https://api.resend.com/emails');
    expect(JSON.parse(init.body)).toMatchObject({
      from: 'suporte@daludi.test', to: ['admin@cliente.test'], subject: 'Suporte',
      html: expect.stringContaining('https://app.test/#/admin/suporte'),
    });
  });
});
