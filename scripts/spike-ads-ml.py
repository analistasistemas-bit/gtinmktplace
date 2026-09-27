#!/usr/bin/env python3
"""Spike 053 — Product Ads (Mercado Ads) do Mercado Livre (SÓ LEITURA).

Uso:
  python3 scripts/spike-ads-ml.py conexoes
  python3 scripts/spike-ads-ml.py coletar <connection_id> <saida_dir> [dias=90]

- Lê SUPABASE_ACCESS_TOKEN do ambiente ou do `.env.local` da raiz (nunca imprime).
- Lê o access token da conexão ML via `public.get_connection_tokens(...)` na Management API
  (SQL read-only). O token fica só em memória e no header Authorization.
- NUNCA renova o token. Token vencido → registra e sai sem chamar o ML.
- No ML, apenas GET. Para no 1º 429. Teto de chamadas por execução: MAX_CHAMADAS.
- Grava as respostas em <saida_dir>/<n>-<chamada>.json com nomes de conta mascarados.
"""
import datetime
import json
import os
import pathlib
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

PROJETO = "txvncrgkoynoxwopfkbp"
ML = "https://api.mercadolibre.com"
RAIZ = pathlib.Path(__file__).resolve().parent.parent
MAX_CHAMADAS = int(os.environ.get("SPIKE_MAX_CHAMADAS", "70"))
MASCARAR = {"advertiser_name", "account_name", "nickname", "email", "first_name", "last_name"}
METRICAS = ("clicks,prints,ctr,cost,cpc,acos,roas,cvr,sov,direct_amount,indirect_amount,total_amount,"
            "direct_units_quantity,indirect_units_quantity,units_quantity,direct_items_quantity,"
            "indirect_items_quantity,advertising_items_quantity,organic_units_quantity,"
            "organic_units_amount,organic_items_quantity")


def _env(nome):
    if os.environ.get(nome):
        return os.environ[nome]
    for linha in (RAIZ / ".env.local").read_text().splitlines():
        if linha.startswith(nome + "="):
            return linha.split("=", 1)[1].strip().strip('"')
    raise SystemExit(f"{nome} ausente")


def sql(query):
    assert query.lstrip().lower().startswith(("select", "with")), "só leitura"
    for _ in range(6):  # a Management API devolve 502 transitório do Cloudflare
        req = urllib.request.Request(
            f"https://api.supabase.com/v1/projects/{PROJETO}/database/query",
            data=json.dumps({"query": query}).encode(),
            headers={"Authorization": f"Bearer {_env('SUPABASE_ACCESS_TOKEN')}",
                     "Content-Type": "application/json", "User-Agent": "spike-ads"})
        try:
            return json.load(urllib.request.urlopen(req, timeout=60))
        except urllib.error.HTTPError as e:
            if e.code < 500:
                raise SystemExit(f"Management API HTTP {e.code}")
            time.sleep(2)
    raise SystemExit("Management API indisponível")


def mascarar(o):
    if isinstance(o, dict):
        return {k: ("***" if k in MASCARAR and v else mascarar(v)) for k, v in o.items()}
    if isinstance(o, list):
        return [mascarar(v) for v in o]
    return o


class Ml:
    def __init__(self, token, saida):
        self.token, self.saida, self.n, self.log = token, saida, 0, []

    def get(self, nome, caminho, versao="2"):
        if self.n >= MAX_CHAMADAS:
            raise SystemExit(f"teto de {MAX_CHAMADAS} chamadas atingido")
        self.n += 1
        req = urllib.request.Request(ML + caminho, method="GET", headers={
            "Authorization": f"Bearer {self.token}", "api-version": versao})
        t0 = time.monotonic()
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                corpo, status = r.read(), r.status
        except urllib.error.HTTPError as e:
            corpo, status = e.read(), e.code
        ms = round((time.monotonic() - t0) * 1000)
        try:
            corpo = mascarar(json.loads(corpo))
        except ValueError:
            corpo = {"_texto": corpo[:300].decode(errors="replace")}
        (self.saida / f"{self.n:03d}-{nome}.json").write_text(
            json.dumps({"http": status, "ms": ms, "path": caminho, "body": corpo}, indent=1, ensure_ascii=False))
        self.log.append((nome, status, ms))
        print(f"[{self.n}] {nome} http={status} {ms}ms {json.dumps(corpo, ensure_ascii=False)[:240]}")
        if status == 429:
            raise SystemExit("429 — parar e registrar")
        return status, corpo


def conexoes():
    for r in sql("select c.id, o.nome as org, c.canal, c.expires_at, c.scope, (c.conta_externa_id is not null) as tem_conta "
                 "from public.marketplace_connections c join public.organizations o on o.id = c.org_id "
                 "order by o.nome"):
        print(r)


def coletar(cx, saida, dias):
    assert all(c in "0123456789abcdef-" for c in cx), "connection_id inválido"
    saida.mkdir(parents=True, exist_ok=True)
    linha = sql(f"select access_token, expires_at from public.get_connection_tokens('{cx}'::uuid)")[0]
    token, expira = linha["access_token"], linha["expires_at"]
    del linha
    print(f"token expira em {expira}")
    if datetime.datetime.fromisoformat(expira.replace("Z", "+00:00")) <= datetime.datetime.now(datetime.timezone.utc):
        raise SystemExit("BLOCKED: token vencido; não renovar fora do app")
    ml = Ml(token, saida)
    hoje = datetime.date.today()
    d_from, d_to = (hoje - datetime.timedelta(days=dias)).isoformat(), (hoje - datetime.timedelta(days=1)).isoformat()
    per = f"date_from={d_from}&date_to={d_to}"

    st, adv = ml.get("advertisers", "/advertising/advertisers?product_id=PADS", versao="1")
    if st != 200 or not adv.get("advertisers"):
        print("SEM ADVERTISER / SEM PERMISSÃO — fim")
        return ml
    a = next((x for x in adv["advertisers"] if x.get("site_id") == "MLB"), adv["advertisers"][0])
    base = f"/marketplace/advertising/{a['site_id']}"
    adv_base = f"{base}/advertisers/{a['advertiser_id']}/product_ads"

    # Sem filters[status] o search omite campanhas em status "error", que têm gasto (spike 053).
    st, camp = ml.get("campaigns", f"{adv_base}/campaigns/search?limit=50&offset=0&{per}&metrics={METRICAS}"
                      "&metrics_summary=true&filters[status]=active,paused,deleted")
    ml.get("campaigns-daily", f"{adv_base}/campaigns/search?limit=50&offset=0&{per}&metrics={METRICAS}&aggregation_type=DAILY")
    for c in (camp.get("results") or [])[:5] if st == 200 else []:
        ml.get(f"campaign-{c['id']}-daily", f"{base}/product_ads/campaigns/{c['id']}?{per}&metrics={METRICAS}&aggregation_type=DAILY")

    grupos, off = [], 0
    while True:  # paginação do search de ad groups
        st, g = ml.get(f"adgroups-off{off}", f"{adv_base}/ad_groups/search?limit=100&offset={off}&{per}"
                       f"&metrics={METRICAS.upper()}&metrics_summary=true")
        if st != 200:
            break
        grupos += g.get("results") or []
        tot = (g.get("paging") or {}).get("total", 0)
        off += 100
        if off >= tot or off >= 1000:
            break
    json.dump(grupos, open(saida / "grupos.json", "w"), ensure_ascii=False, indent=1)

    # MLB → ad_group_id com custo por MLB. Endpoint "legado" (doc: removido em 30/06/26), ainda 200
    # em 27/09/26; a soma por MLB NÃO fecha com o total das campanhas (ver spike 053, seção 4).
    itens, off = [], 0
    while True:
        st, b = ml.get(f"ads-search-off{off}", f"{adv_base}/ads/search?limit=100&offset={off}&{per}"
                       "&metrics=clicks,prints,cost,direct_amount,indirect_amount,units_quantity")
        if st != 200:
            break
        itens += b.get("results") or []
        off += 100
        if off >= (b.get("paging") or {}).get("total", 0) or off >= 1000:
            break
    json.dump(itens, open(saida / "itens.json", "w"), ensure_ascii=False, indent=1)

    # Amostra: 1 grupo de cada tipo, com gasto primeiro.
    vistos = set()
    for g in sorted(grupos, key=lambda x: -((x.get("metrics") or {}).get("cost") or 0)):
        t = g.get("ad_group_type")
        if t in vistos:
            continue
        vistos.add(t)
        ml.get(f"adgroup-{t}-{g['id']}-ads", f"{base}/product_ads/ad_groups/{g['id']}/ads?{per}&metrics={METRICAS}")
        ml.get(f"adgroup-{t}-{g['id']}-daily", f"{base}/product_ads/ad_groups/{g['id']}?{per}"
               f"&metrics={METRICAS.upper()}&aggregation_type=daily")
    if grupos and campaigns_ok(camp):
        cid = camp["results"][0]["id"]
        ml.get(f"campaign-{cid}-adgroups-1dia", f"{base}/product_ads/campaigns/{cid}/ad_groups/metrics?"
               f"date_from={d_to}&date_to={d_to}&metrics={METRICAS}")
    # Limites: histórico além de 90 dias.
    velho = (hoje - datetime.timedelta(days=120)).isoformat()
    ml.get("campaigns-120d", f"{adv_base}/campaigns/search?limit=1&date_from={velho}&date_to={d_to}&metrics=cost")
    return ml


def campaigns_ok(camp):
    return isinstance(camp, dict) and bool(camp.get("results"))


def main():
    if len(sys.argv) >= 2 and sys.argv[1] == "conexoes":
        return conexoes()
    if len(sys.argv) < 4 or sys.argv[1] != "coletar":
        raise SystemExit(__doc__)
    ml = coletar(sys.argv[2], pathlib.Path(sys.argv[3]), int(sys.argv[4]) if len(sys.argv) > 4 else 90)
    lat = sorted(ms for _, s, ms in ml.log)
    print(f"chamadas={ml.n} latência mediana={lat[len(lat) // 2]}ms máx={lat[-1]}ms")


if __name__ == "__main__":
    main()
