#!/usr/bin/env python3
"""Spike I2 Fatia 0 — total de Ads da conta por período (SÓ LEITURA).

Uso:
  python3 scripts/spike-ads-periodo.py <connection_id> <org_nome> <saida_dir>

Mede, para 7/30/90 dias até ontem: resumo de ad_groups/search × Σ paginada dos grupos,
resumo de campaigns/search (com e sem status `error`), série diária do anunciante e Σ gravada
em ml_ads_grupo_dia. Reusa os helpers do spike 053 (token só em memória, nunca renovado,
só GET, para no 1º 429).
"""
import datetime
import importlib.util
import pathlib
import sys

_spec = importlib.util.spec_from_file_location("s053", pathlib.Path(__file__).with_name("spike-ads-ml.py"))
s053 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(s053)

MET = "clicks,prints,cost,direct_amount,indirect_amount,total_amount"
STATUS = ("active,paused,deleted", "active,paused,deleted,error")


def r2(x):
    return round(float(x or 0), 2)


def main(cx, org, saida):
    assert all(c in "0123456789abcdef-" for c in cx), "connection_id inválido"
    assert org.replace(" ", "").isalnum(), "org inválida"
    saida.mkdir(parents=True, exist_ok=True)
    linha = s053.sql(f"select access_token, expires_at from public.get_connection_tokens('{cx}'::uuid)")[0]
    token, expira = linha["access_token"], linha["expires_at"]
    del linha
    if datetime.datetime.fromisoformat(expira.replace("Z", "+00:00")) <= datetime.datetime.now(datetime.timezone.utc):
        raise SystemExit("BLOCKED: token vencido; não renovar fora do app")
    ml = s053.Ml(token, saida)

    st, adv = ml.get("advertisers", "/advertising/advertisers?product_id=PADS", versao="1")
    if st != 200 or not adv.get("advertisers"):
        raise SystemExit("sem advertiser")
    a = next((x for x in adv["advertisers"] if x.get("site_id") == "MLB"), adv["advertisers"][0])
    base = f"/marketplace/advertising/{a['site_id']}"
    adv_base = f"{base}/advertisers/{a['advertiser_id']}/product_ads"

    ontem = datetime.date.today() - datetime.timedelta(days=1)
    janelas = {d: ((ontem - datetime.timedelta(days=d - 1)).isoformat(), ontem.isoformat()) for d in (7, 30, 90)}

    # Série diária do anunciante (90 dias), com e sem `error`.
    serie = {}
    for stt in STATUS:
        d0, d1 = janelas[90]
        st, c = ml.get(f"daily-{stt.count(',')}", f"{adv_base}/campaigns/search?limit=50&offset=0&date_from={d0}"
                       f"&date_to={d1}&metrics={MET}&aggregation_type=DAILY&filters[status]={stt}")
        serie[stt] = {r["date"]: float(r.get("cost") or 0) for r in (c.get("results") or [])} if st == 200 else None

    banco = {r["d"]: float(r["c"]) for r in s053.sql(
        "select d.dia::text d, sum(d.cost) c from ml_ads_grupo_dia d join organizations o on o.id = d.org_id "
        f"where o.nome = '{org}' and d.dia >= current_date - 95 group by 1")}

    print(f"\n=== {org} (ontem={ontem}, último dia no banco={max(banco) if banco else None}) ===")
    for dias, (d0, d1) in janelas.items():
        per = f"date_from={d0}&date_to={d1}"
        resumo, listado, off, total = None, 0.0, 0, 1
        while off < total:
            st, g = ml.get(f"groups-{dias}d-{off}", f"{adv_base}/ad_groups/search?limit=100&offset={off}&{per}"
                           f"&metrics={MET.upper()}&metrics_summary=true")
            if st != 200:
                break
            total = g["paging"]["total"]
            resumo = r2(g["metrics_summary"].get("cost"))
            listado += sum(float((x.get("metrics") or {}).get("cost") or 0) for x in g["results"])
            off += 100
        camp = {}
        for stt in STATUS:
            st, c = ml.get(f"camp-{dias}d-{stt.count(',')}", f"{adv_base}/campaigns/search?limit=50&offset=0&{per}"
                           f"&metrics={MET}&metrics_summary=true&filters[status]={stt}")
            camp[stt] = r2(c["metrics_summary"].get("cost")) if st == 200 else None
        dias_periodo = [(datetime.date.fromisoformat(d0) + datetime.timedelta(days=i)).isoformat() for i in range(dias)]
        s_serie = {stt: (r2(sum(serie[stt].get(d, 0) for d in dias_periodo)) if serie[stt] is not None else None,
                         sum(1 for d in dias_periodo if serie[stt] and d in serie[stt]))
                   for stt in STATUS}
        s_banco = r2(sum(banco.get(d, 0) for d in dias_periodo))
        print(f"\n{dias}d [{d0}..{d1}]")
        print(f"  ad_groups resumo={resumo}  Σ listados={r2(listado)}  ({total} grupos)")
        for stt in STATUS:
            print(f"  campaigns[{stt}] resumo={camp[stt]}  série Σ={s_serie[stt][0]} ({s_serie[stt][1]}/{dias} dias)")
        print(f"  banco Σ ml_ads_grupo_dia={s_banco}  → não identificado vs resumo grupos="
              f"{r2((resumo or 0) - s_banco)} ({round(100 * ((resumo or 0) - s_banco) / resumo, 2) if resumo else '-'} %)")
    print(f"\nchamadas ML: {ml.n}")


if __name__ == "__main__":
    if len(sys.argv) != 4:
        raise SystemExit(__doc__)
    main(sys.argv[1], sys.argv[2], pathlib.Path(sys.argv[3]))
