import { describe, it, expect } from 'vitest';
import { montarReqMsgML } from '../mensagem';

describe('montarReqMsgML', () => {
  it('URL com tag=post_sale; from e to como string', () => {
    const { url, body } = montarReqMsgML(10, 20, 30, 'Olá');
    expect(url).toBe('https://api.mercadolibre.com/messages/packs/10/sellers/20?tag=post_sale');
    expect(JSON.parse(body)).toEqual({ from: { user_id: '20' }, to: { user_id: '30' }, text: 'Olá' });
  });

  it('com anexo, o corpo leva attachments', () => {
    expect(JSON.parse(montarReqMsgML(10, 20, 30, 'Olá', 'a.png').body).attachments).toEqual(['a.png']);
  });

  it('sem anexo, o corpo não tem a chave attachments', () => {
    expect(JSON.parse(montarReqMsgML(10, 20, 30, 'Olá', null).body)).not.toHaveProperty('attachments');
    expect(JSON.parse(montarReqMsgML(10, 20, 30, 'Olá').body)).not.toHaveProperty('attachments');
  });
});
