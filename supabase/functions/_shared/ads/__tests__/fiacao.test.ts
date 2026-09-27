import { describe, expect, it, vi } from 'vitest';
import { buscarML, dedupFanout, tratarRequisicao } from '../../trafego/fiacao.ts';
import type { RespostaML } from '../../trafego/sincronizar.ts';
import {
  HEADERS_ADS, HEADERS_ADVERTISER, dedupContinuacaoAds, dedupFanoutAds, getComReautenticacao, msgAdsDoCorpo,
  urlAdvertiser, urlBuscaGrupos, urlMembros, urlSerieGrupo,
} from '../fiacao.ts';

const J = { desde: '2026-09-12', ate: '2026-09-26' };

describe('fiação de Ads', () => {
  it('dedup com prefixo ads: nunca colide com o do tráfego (QStash deduplica por conta)', () => {
    expect(dedupFanoutAds('org-1', '2026-09-27')).toBe('ads_org-1_2026-09-27');
    expect(dedupFanoutAds('org-1', '2026-09-27')).not.toBe(dedupFanout('org-1', '2026-09-27'));
    expect(dedupContinuacaoAds({ org_id: 'org-1', rodada: '2026-09-27T14:17:00.123Z', cursor: '12', primeira: false, tentativa: 2 }))
      .toBe('ads_org-1_2026-09-27T14_17_00_123Z_12_2');
  });
  it('URLs e headers do spike 053: advertiser v1; demais v2; métricas em maiúsculas; daily minúsculo', () => {
    expect(urlAdvertiser()).toBe('/advertising/advertisers?product_id=PADS');
    expect(HEADERS_ADVERTISER).toEqual({ 'Api-Version': '1' });
    expect(HEADERS_ADS).toEqual({ 'api-version': '2' });
    const busca = urlBuscaGrupos(1000001, J, 100);
    expect(busca).toContain('/marketplace/advertising/MLB/advertisers/1000001/product_ads/ad_groups/search?limit=100&offset=100');
    expect(busca).toContain('date_from=2026-09-12&date_to=2026-09-26');
    expect(busca).toContain('metrics=CLICKS,PRINTS,COST,DIRECT_AMOUNT,INDIRECT_AMOUNT,TOTAL_AMOUNT,DIRECT_UNITS_QUANTITY,UNITS_QUANTITY');
    expect(busca).toContain('metrics_summary=true');
    expect(busca).toContain('filters[status]=ACTIVE,PAUSED,IDLE,EMPTY,HOLD');
    expect(urlSerieGrupo(3000001, J)).toBe('/marketplace/advertising/MLB/product_ads/ad_groups/3000001?date_from=2026-09-12&date_to=2026-09-26'
      + '&metrics=CLICKS,PRINTS,COST,DIRECT_AMOUNT,INDIRECT_AMOUNT,TOTAL_AMOUNT,DIRECT_UNITS_QUANTITY,UNITS_QUANTITY&aggregation_type=daily');
    expect(urlMembros(3000001, J, 0)).toBe('/marketplace/advertising/MLB/product_ads/ad_groups/3000001/ads?limit=100&offset=0&date_from=2026-09-12&date_to=2026-09-26&metrics=COST');
    for (const u of [busca, urlSerieGrupo(1, J), urlMembros(1, J, 0)]) {
      expect(u).not.toMatch(/ads\/search|product_ads\/items/); // endpoints legados proibidos
    }
  });
  it('buscarML manda os headers extras, só GET, e o Authorization não é sobrescrito', async () => {
    const f = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    const r = await buscarML('https://x/y', 'tok', f as unknown as typeof fetch, { 'api-version': '2', Authorization: 'x' });
    const init = (f.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.method).toBe('GET');
    expect(init.headers).toEqual({ 'api-version': '2', Authorization: 'Bearer tok' });
    expect(r).toEqual({ status: 200, retryAfterMs: null, corpo: { ok: true } });
  });
  it('401 no meio da cadeia: relê o token uma vez e repete; 401 de novo volta; 403 nunca repete', async () => {
    const r = (status: number): RespostaML => ({ status, retryAfterMs: null, corpo: null });
    let n = 0;
    const token = vi.fn(async () => (n === 0 ? 'velho' : 'novo'));
    const renovar = vi.fn(() => { n++; });
    const chamar = vi.fn(async (t: string) => r(t === 'velho' ? 401 : 200));
    expect((await getComReautenticacao(token, renovar, chamar)).status).toBe(200);
    expect(renovar).toHaveBeenCalledTimes(1);
    expect(chamar.mock.calls.map((c) => c[0])).toEqual(['velho', 'novo']);

    const sempre401 = vi.fn(async () => r(401));
    expect((await getComReautenticacao(async () => 't', () => {}, sempre401)).status).toBe(401);
    expect(sempre401).toHaveBeenCalledTimes(2);

    const deu403 = vi.fn(async () => r(403));
    const renovar403 = vi.fn();
    expect((await getComReautenticacao(async () => 't', renovar403, deu403)).status).toBe(403);
    expect(deu403).toHaveBeenCalledTimes(1);
    expect(renovar403).not.toHaveBeenCalled();
  });
  it('tratarRequisicao usa o rótulo do worker no log de erro', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await tratarRequisicao(new Request('https://x', { method: 'POST', body: '{"org_id":"org-1"}' }), {
      rotulo: 'coletar-ads-ml', verificar: async () => true, fanout: async () => 0, limpar: async () => {},
      sincronizar: async () => { throw new Error('boom'); },
    });
    expect(res.status).toBe(500);
    expect(erro).toHaveBeenCalledWith('[coletar-ads-ml]', 'boom');
    erro.mockRestore();
  });
  it('msgAdsDoCorpo só inclui falhou quando true (nunca grava false explícito no corpo publicado)', () => {
    const msg = { org_id: 'org-1', rodada: 'r1', cursor: '12', primeira: false, tentativa: 1 };
    const comFalha = msgAdsDoCorpo(msg, { falhou: true });
    expect(comFalha).toEqual({ ...msg, falhou: true });
    // o corpo publicado pelo QStash (JSON.stringify em publishJSON) preserva a flag intacta
    expect(JSON.parse(JSON.stringify(comFalha)).falhou).toBe(true);
    // dedup não muda com a flag: mesma cadeia, mesmo id
    expect(dedupContinuacaoAds(comFalha)).toBe(dedupContinuacaoAds(msg));
    // corpo sem a flag, corpo não-JSON (null) e corpo com falhou não-booleano → msg intocada, sem a chave
    expect(msgAdsDoCorpo(msg, {})).toBe(msg);
    expect(msgAdsDoCorpo(msg, null)).toBe(msg);
    expect(msgAdsDoCorpo(msg, { falhou: 'true' })).toBe(msg);
    expect('falhou' in msgAdsDoCorpo(msg, {})).toBe(false);
  });
  it('falhou sobrevive ao ciclo real corpo HTTP → msg → sincronizar (Rulings 2c-5/2c-6): '
    + 'tratarRequisicao (2b) repassa o corpo já parseado como 2º argumento, e o worker junta a flag de volta', async () => {
    const sincronizar = vi.fn(async (msg: { org_id: string; primeira: boolean }, bruto: Record<string, unknown>) => {
      expect(msgAdsDoCorpo(msg, bruto)).toEqual({ ...msg, falhou: true });
      return { resultado: 'ok' as const };
    });
    const req = new Request('https://x', { method: 'POST', body: '{"org_id":"org-1","falhou":true}' });
    const res = await tratarRequisicao(req, {
      verificar: async () => true, fanout: async () => 0, limpar: async () => {}, sincronizar,
    });
    expect(res.status).toBe(200);
    expect(sincronizar).toHaveBeenCalledTimes(1);
    const [msgChamado, brutoChamado] = sincronizar.mock.calls[0];
    // tratarRequisicao não conhece `falhou`: o msg que ele monta nunca traz o campo
    expect(msgChamado).toEqual({ org_id: 'org-1', primeira: false });
    // mas o 2º argumento é o corpo cru, e `falhou` sobrevive nele
    expect(brutoChamado).toEqual({ org_id: 'org-1', falhou: true });
  });
});
