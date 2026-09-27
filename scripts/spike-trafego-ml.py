#!/usr/bin/env python3
"""Spike 052 — contratos reais de visitas e de preço de oferta do Mercado Livre (SÓ LEITURA).

Uso:  python3 scripts/spike-trafego-ml.py <connection_id> <saida_dir> MLB1 [MLB2 ...]

- Lê SUPABASE_ACCESS_TOKEN do ambiente ou do `.env.local` da raiz (nunca imprime).
- Lê o access token da conexão ML via `select ... from public.get_connection_tokens(...)` na
  Management API (SQL read-only). O token fica só em memória e no header Authorization.
- NUNCA renova o token (o ML rotaciona o refresh token; renovar fora do app derruba a conexão).
  401 → aborta com a hora de expiração.
- Faz apenas GET no ML: /items?ids= (status), /items/{id}/visits/time_window (last=150 e
  last=10&ending=<data>) e /items/{id}/sale_price?context=channel_marketplace.
- Grava as respostas cruas em <saida_dir>/<MLB>-<chamada>.json e imprime latências.
"""
import json
import os
import pathlib
import sys
import time
import urllib.error
import urllib.request

PROJETO = "txvncrgkoynoxwopfkbp"
ML = "https://api.mercadolibre.com"
RAIZ = pathlib.Path(__file__).resolve().parent.parent


def _env(nome):
    if os.environ.get(nome):
        return os.environ[nome]
    for linha in (RAIZ / ".env.local").read_text().splitlines():
        if linha.startswith(nome + "="):
            return linha.split("=", 1)[1].strip().strip('"')
    raise SystemExit(f"{nome} ausente")


def sql(query):
    assert query.lstrip().lower().startswith("select"), "só SELECT"
    for _ in range(6):  # a Management API devolve 502 transitório do Cloudflare
        req = urllib.request.Request(
            f"https://api.supabase.com/v1/projects/{PROJETO}/database/query",
            data=json.dumps({"query": query}).encode(),
            headers={"Authorization": f"Bearer {_env('SUPABASE_ACCESS_TOKEN')}",
                     "Content-Type": "application/json", "User-Agent": "spike-trafego"})
        try:
            return json.load(urllib.request.urlopen(req, timeout=60))
        except urllib.error.HTTPError as e:
            if e.code < 500:
                raise SystemExit(f"Management API HTTP {e.code}")
            time.sleep(2)
    raise SystemExit("Management API indisponível")


def ml_get(token, caminho):
    req = urllib.request.Request(ML + caminho, headers={"Authorization": f"Bearer {token}"})
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            corpo, status = r.read(), r.status
    except urllib.error.HTTPError as e:
        corpo, status = e.read(), e.code
    ms = round((time.monotonic() - t0) * 1000)
    try:
        return status, json.loads(corpo), ms
    except ValueError:
        return status, {"_texto": corpo[:300].decode(errors="replace")}, ms


def main():
    if len(sys.argv) < 4:
        raise SystemExit(__doc__)
    cx, saida, mlbs = sys.argv[1], pathlib.Path(sys.argv[2]), sys.argv[3:]
    assert all(c in "0123456789abcdef-" for c in cx), "connection_id inválido"
    saida.mkdir(parents=True, exist_ok=True)

    linha = sql(f"select access_token, expires_at from public.get_connection_tokens('{cx}'::uuid)")[0]
    token, expira = linha["access_token"], linha["expires_at"]
    del linha
    print(f"token expira em {expira}")

    status, corpo, ms = ml_get(token, "/items?ids=" + ",".join(mlbs[:20]) + "&attributes=id,status,sub_status")
    if status == 401:
        raise SystemExit(f"BLOCKED: token expirado (expires_at={expira}); não renovar fora do app")
    for b in corpo if isinstance(corpo, list) else []:
        c = b.get("body", {})
        print(f"{c.get('id')}: status={c.get('status')} sub_status={c.get('sub_status')}")

    # ending em data fixa passada para testar se é exclusivo.
    ending = os.environ.get("SPIKE_ENDING", "2026-09-20")
    chamadas = {
        "visits150": "/items/{id}/visits/time_window?last=150&unit=day",
        "visits10-ending": "/items/{id}/visits/time_window?last=10&unit=day&ending=" + ending,
        "sale_price": "/items/{id}/sale_price?context=channel_marketplace",
    }
    lat = {k: [] for k in chamadas}
    for mlb in mlbs:
        for nome, tpl in chamadas.items():
            status, corpo, ms = ml_get(token, tpl.format(id=mlb))
            if status == 401:
                raise SystemExit(f"BLOCKED: 401 (expires_at={expira})")
            lat[nome].append(ms)
            (saida / f"{mlb}-{nome}.json").write_text(json.dumps({"http": status, "ms": ms, "body": corpo}, indent=1))
            res = corpo.get("results") if isinstance(corpo, dict) else None
            if res:  # a API devolve os pontos fora de ordem e omite os dias com zero visita
                res = sorted(res, key=lambda p: p["date"])
            resumo = (f"pontos={len(res)} primeiro={res[0]['date']} ultimos={[(p['date'], p['total']) for p in res[-3:]]} "
                      f"total_visits={corpo.get('total_visits')} janela={corpo.get('date_from')}..{corpo.get('date_to')}"
                      if res else json.dumps(corpo)[:200])
            print(f"{mlb} {nome} http={status} {ms}ms {resumo}")
    for nome, v in lat.items():
        v = sorted(v)
        print(f"latência {nome}: n={len(v)} mediana={v[len(v) // 2]}ms p90={v[int(len(v) * 0.9)]}ms max={v[-1]}ms")


if __name__ == "__main__":
    main()
