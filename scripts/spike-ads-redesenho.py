#!/usr/bin/env python3
"""Spike 058 — métricas por período do Mercado Ads para o redesenho do /ads (SÓ LEITURA).

Uso:
  python3 scripts/spike-ads-redesenho.py conexoes
  python3 scripts/spike-ads-redesenho.py coletar <connection_id> [--dias 30] [--campaign-id ID]

PROTOCOLO: somente GET no ML (nenhum POST/PUT/DELETE). Token da conexão só em memória (via
get_connection_tokens, SQL read-only), nunca impresso, nunca renovado (vencido => BLOCKED).
Para no 1º HTTP 429. A conexão é escolhida explicitamente pelo connection_id.
ORÇAMENTO: no máximo {max} chamadas ao ML por execução (constante MAX_CHAMADAS_ML); ao atingir o
teto, o script aborta (retries/fallbacks entram na conta).

Janelas (datas BRT, terminando ontem): atual = últimos --dias; anterior = mesmos --dias imediatamente antes.
Mede: E1 campaigns/search (resumo, status históricos), E2 DAILY, E3/E4 detalhe + diária de uma campanha
(competitividade, organic_*, sov, cvr, *_items_quantity, *_units_quantity), /ads/search com métricas por
anúncio (seção 9 do plano) e a borda da retenção de 90 dias.

SAÍDA SANITIZADA (stdout; nada é gravado em disco): HTTP, campos presentes e tipos, totais agregados,
contagens e mensagem de erro do ML. Nunca token nem nomes (campanha/anúncio/conta/pessoa); IDs podem aparecer.
"""
import datetime
import importlib.util
import json
import pathlib
import sys
import time
import urllib.error
import urllib.request
import zoneinfo

_spec = importlib.util.spec_from_file_location("s053", pathlib.Path(__file__).with_name("spike-ads-ml.py"))
s053 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(s053)

MAX_CHAMADAS_ML = 40
__doc__ = __doc__.replace("{max}", str(MAX_CHAMADAS_ML))

BASE_MET = "clicks,prints,ctr,cost,cpc,acos,roas,cvr,sov,direct_amount,indirect_amount,total_amount"
QTD_MET = ("direct_items_quantity,indirect_items_quantity,advertising_items_quantity,direct_units_quantity,"
           "indirect_units_quantity,units_quantity,organic_items_quantity,organic_units_quantity,organic_units_amount")
COMP_MET = "impression_share,top_impression_share,lost_impression_share_by_budget,lost_impression_share_by_ad_rank"
TODAS_MET = f"{BASE_MET},{QTD_MET},{COMP_MET}"
STATUS_TODOS = "active,paused,deleted,error"
ANUNCIO_MET = "clicks,prints,cost,cpc,acos,direct_amount,indirect_amount,total_amount,units_quantity,advertising_items_quantity"
BORDA_DIAS = (89, 90, 91, 100)
# Únicos campos não numéricos do topo que podem aparecer (nenhum é nome).
PERMITIDOS = {"id", "campaign_id", "ad_group_id", "item_id", "status", "date", "strategy", "currency",
              "last_updated", "date_created", "channel", "budget"}


def tipo(v):
    return "null" if v is None else type(v).__name__


def campos(d):
    return {k: tipo(v) for k, v in sorted(d.items())} if isinstance(d, dict) else {}


def totais(linhas):
    """Σ dos campos numéricos (de metrics ou da linha) e em quantas linhas cada campo veio."""
    soma, presente = {}, {}
    for r in linhas:
        m = r.get("metrics") if isinstance(r.get("metrics"), dict) else r
        for k, v in m.items():
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                soma[k] = round(soma.get(k, 0) + v, 4)
                presente[k] = presente.get(k, 0) + 1
    return {k: (soma[k], f"{presente[k]}/{len(linhas)}") for k in sorted(soma)}


class Ml:
    def __init__(self, token):
        self.token, self.n = token, 0

    def get(self, nome, caminho, versao="2"):
        if self.n >= MAX_CHAMADAS_ML:
            raise SystemExit(f"teto de {MAX_CHAMADAS_ML} chamadas atingido")
        self.n += 1
        req = urllib.request.Request(s053.ML + caminho, method="GET", headers={
            "Authorization": f"Bearer {self.token}", "api-version": versao})
        t0 = time.monotonic()
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                corpo, status = r.read(), r.status
        except urllib.error.HTTPError as e:
            corpo, status = e.read(), e.code
        ms = round((time.monotonic() - t0) * 1000)
        try:
            corpo = json.loads(corpo)
        except ValueError:
            corpo = {}
        print(f"\n[{self.n}] {nome} http={status} {ms}ms")
        if status != 200:
            msg = (corpo.get("message") or corpo.get("error") or "") if isinstance(corpo, dict) else ""
            print(f"  erro ML: {str(msg)[:200]}")
        if status == 429:
            raise SystemExit("429 — parar e registrar")
        return status, corpo if isinstance(corpo, dict) else {}


def descreve_lista(corpo, rotulo):
    res = [r for r in (corpo.get("results") or []) if isinstance(r, dict)]
    pag = corpo.get("paging") or {}
    print(f"  {rotulo}: {len(res)} linhas (paging total={pag.get('total')}, limit={pag.get('limit')})")
    if res:
        print(f"  campos da linha: {campos(res[0])}")
        if isinstance(res[0].get("metrics"), dict):
            print(f"  campos de metrics: {campos(res[0]['metrics'])}")
        stts = {}
        for r in res:
            stts[r.get("status")] = stts.get(r.get("status"), 0) + 1
        if any(stts):
            print(f"  status: {stts}")
        datas = sorted(r["date"] for r in res if isinstance(r.get("date"), str))
        if datas:
            print(f"  datas: {len(set(datas))} distintas, {datas[0]}..{datas[-1]}")
        print(f"  Σ por campo (valor, linhas com o campo): {totais(res)}")
    if isinstance(corpo.get("metrics_summary"), dict):
        print(f"  metrics_summary: {corpo['metrics_summary']}")
    return res


def descreve_detalhe(corpo):
    print(f"  campos do topo: {campos(corpo)}")
    print(f"  identificação: { {k: v for k, v in corpo.items() if k in PERMITIDOS} }")
    for bloco in ("metrics", "metrics_summary"):
        if isinstance(corpo.get(bloco), dict):
            print(f"  {bloco}: {corpo[bloco]}")
    return corpo.get("results") or []


def com_fallback(ml, nome, caminho, caminho_reduzido):
    st, c = ml.get(nome, caminho)
    if st == 400:
        print("  (400 com o conjunto completo de métricas; repetindo só com o conjunto base)")
        st, c = ml.get(nome + "-base", caminho_reduzido)
    return st, c


def hoje_brt():
    return datetime.datetime.now(zoneinfo.ZoneInfo("America/Sao_Paulo")).date()


def main(cx, dias, campanha):
    assert all(c in "0123456789abcdef-" for c in cx), "connection_id inválido"
    linha = s053.sql(f"select access_token, expires_at from public.get_connection_tokens('{cx}'::uuid)")[0]
    token, expira = linha["access_token"], linha["expires_at"]
    del linha
    if datetime.datetime.fromisoformat(expira.replace("Z", "+00:00")) <= datetime.datetime.now(datetime.timezone.utc):
        raise SystemExit("BLOCKED: token vencido; não renovar fora do app")
    ml = Ml(token)

    d = datetime.timedelta
    ontem = hoje_brt() - d(days=1)
    atual = ((ontem - d(days=dias - 1)).isoformat(), ontem.isoformat())
    ant_fim = ontem - d(days=dias)
    anterior = ((ant_fim - d(days=dias - 1)).isoformat(), ant_fim.isoformat())
    print(f"janela atual={atual} anterior={anterior} (BRT, {dias} dias)")

    st, adv = ml.get("advertisers", "/advertising/advertisers?product_id=PADS", versao="1")
    if st != 200 or not adv.get("advertisers"):
        raise SystemExit("sem advertiser / sem permissão")
    a = next((x for x in adv["advertisers"] if x.get("site_id") == "MLB"), adv["advertisers"][0])
    base = f"/marketplace/advertising/{a['site_id']}"
    adv_base = f"{base}/advertisers/{a['advertiser_id']}/product_ads"

    def per(j):
        return f"date_from={j[0]}&date_to={j[1]}"

    janelas = (("atual", atual), ("anterior", anterior))
    camp_atual = []
    for rot, j in janelas:
        # E1: resumo + campanhas com todos os status históricos; se a rota recusar `error`, cai para os 3 usuais.
        st, c = ml.get(f"E1-{rot}", f"{adv_base}/campaigns/search?limit=50&offset=0&{per(j)}&metrics={TODAS_MET}"
                       f"&metrics_summary=true&filters[status]={STATUS_TODOS}")
        if st == 400:
            print("  (400; repetindo com status active,paused,deleted e sem competitividade)")
            st, c = ml.get(f"E1-{rot}-base", f"{adv_base}/campaigns/search?limit=50&offset=0&{per(j)}"
                           f"&metrics={BASE_MET},{QTD_MET}&metrics_summary=true&filters[status]=active,paused,deleted")
        if st == 200:
            res = descreve_lista(c, "campanhas")
            if rot == "atual":
                camp_atual = res
    for rot, j in janelas:
        st, c = ml.get(f"E2-{rot}", f"{adv_base}/campaigns/search?limit=50&offset=0&{per(j)}&metrics={BASE_MET},{QTD_MET}"
                       f"&aggregation_type=DAILY&filters[status]={STATUS_TODOS}")
        if st == 200:
            descreve_lista(c, "série diária da conta")

    cid = campanha or next((str(r["id"]) for r in sorted(
        camp_atual, key=lambda r: -float((r.get("metrics") or {}).get("cost") or 0)) if r.get("id")), None)
    print(f"\ncampanha do detalhe: {cid}")
    if cid:
        for rot, j in janelas:
            p = f"{base}/product_ads/campaigns/{cid}?{per(j)}"
            st, c = com_fallback(ml, f"E3-{rot}", f"{p}&metrics={TODAS_MET}", f"{p}&metrics={BASE_MET}")
            if st == 200:
                descreve_detalhe(c)
        for rot, j in janelas:
            p = f"{base}/product_ads/campaigns/{cid}?{per(j)}&aggregation_type=DAILY"
            st, c = com_fallback(ml, f"E4-{rot}", f"{p}&metrics={TODAS_MET}", f"{p}&metrics={BASE_MET}")
            if st == 200:
                descreve_lista({"results": descreve_detalhe(c)}, "série diária da campanha")

    # Seção 9: métricas por anúncio (E5; a doc marca como depreciado) — do anunciante e filtrado pela campanha.
    for rot, j in janelas:
        st, c = ml.get(f"E5-{rot}", f"{adv_base}/ads/search?limit=50&offset=0&{per(j)}&metrics={ANUNCIO_MET}")
        if st == 200:
            descreve_lista(c, "anúncios")
    if cid:
        st, c = ml.get("E5-atual-por-campanha", f"{adv_base}/ads/search?limit=50&offset=0&{per(atual)}"
                       f"&metrics={ANUNCIO_MET}&filters[campaign_id]={cid}")
        if st == 200:
            descreve_lista(c, "anúncios da campanha")

    # Borda da retenção: date_from N dias atrás até ontem.
    print("\n--- retenção ---")
    for n in BORDA_DIAS:
        df = (ontem - d(days=n)).isoformat()
        st, c = ml.get(f"retencao-{n}d", f"{adv_base}/campaigns/search?limit=1&offset=0&date_from={df}"
                       f"&date_to={ontem.isoformat()}&metrics=cost&metrics_summary=true")
        print(f"  date_from={df} ({n} dias atrás): http={st} summary={c.get('metrics_summary')}")
    print(f"\nchamadas ML: {ml.n}/{MAX_CHAMADAS_ML}")


if __name__ == "__main__":
    a = sys.argv[1:]
    if a == ["conexoes"]:
        s053.conexoes()
    elif len(a) >= 2 and a[0] == "coletar":
        dias, camp, i = 30, None, 2
        while i < len(a):
            if a[i] == "--dias" and i + 1 < len(a):
                dias = int(a[i + 1])
            elif a[i] == "--campaign-id" and i + 1 < len(a):
                camp = a[i + 1]
                assert camp.isdigit(), "campaign-id inválido"
            else:
                raise SystemExit(__doc__)
            i += 2
        assert 1 <= dias <= 90, "--dias entre 1 e 90"
        main(a[1], dias, camp)
    else:
        print(__doc__)
        raise SystemExit(0 if a in (["--help"], ["-h"]) else 2)
