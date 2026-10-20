#!/usr/bin/env python3
"""Spike 057 — aba Campanhas do /ads (SÓ LEITURA, emenda ADR-0179 de 2026-10-20).

Uso: python3 scripts/spike-ads-campanhas.py <connection_id> <saida_dir>

Mede: campos de campanha (estratégia, ROAS objetivo, orçamento, diagnóstico) e se existe busca de
anúncios no nível do anunciante (uma paginação) em vez de uma chamada por grupo.
Reaproveita sql/Ml/mascarar do spike 053: só GET, token nunca renovado nem impresso.
"""
import datetime
import importlib.util
import json
import pathlib
import sys

spec = importlib.util.spec_from_file_location("s053", pathlib.Path(__file__).with_name("spike-ads-ml.py"))
s053 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(s053)


def main(cx, saida):
    saida = pathlib.Path(saida)
    saida.mkdir(parents=True, exist_ok=True)
    linha = s053.sql(f"select access_token, expires_at from public.get_connection_tokens('{cx}'::uuid)")[0]
    ml = s053.Ml(linha["access_token"], saida)
    st, adv = ml.get("advertisers", "/advertising/advertisers?product_id=PADS", versao="1")
    a = next(x for x in adv["advertisers"] if x.get("site_id") == "MLB")
    base = f"/marketplace/advertising/MLB/advertisers/{a['advertiser_id']}/product_ads"
    hoje = datetime.date.today()
    per = f"date_from={hoje - datetime.timedelta(days=7)}&date_to={hoje}"
    st, camp = ml.get("campaigns", f"{base}/campaigns/search?limit=50&offset=0&{per}"
                      "&filters[status]=active,paused")
    ids = [c["id"] for c in (camp or {}).get("results", [])]
    for cid in ids[:3]:
        ml.get(f"campaign-{cid}", f"/marketplace/advertising/MLB/product_ads/campaigns/{cid}?{per}")
    # Candidatos de busca no nível do anunciante (o que responder 200 vale).
    for nome, cam in [
        ("ads-search", f"{base}/ads/search?limit=50&offset=0&{per}"),
        ("ads-search-metrics", f"{base}/ads/search?limit=50&offset=0&{per}&metrics=clicks,cost"),
        ("ads-search-campanha", f"{base}/ads/search?limit=50&offset=0&{per}&filters[campaign_id]={ids[0] if ids else 0}"),
        ("items-search", f"{base}/items/search?limit=50&offset=0&{per}"),
    ]:
        ml.get(nome, cam)
    print(json.dumps(ml.log, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
