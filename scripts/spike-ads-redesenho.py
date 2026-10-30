#!/usr/bin/env python3
"""Spike 058 — métricas por período do Mercado Ads para o redesenho do /ads (SÓ LEITURA).

Uso:
  python3 scripts/spike-ads-redesenho.py conexoes
  python3 scripts/spike-ads-redesenho.py coletar <connection_id> [--dias 30] [--campaign-id ID]
  python3 scripts/spike-ads-redesenho.py conciliar <connection_id>   # Task 04: campos, escalas, E5 completo

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
import math
import pathlib
import re
import sys
import time
import urllib.error
import urllib.request
import zoneinfo

_spec = importlib.util.spec_from_file_location("s053", pathlib.Path(__file__).with_name("spike-ads-ml.py"))
s053 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(s053)

# 60 = coletar (≤ 24) ou conciliar (≈ 36 na conta com 603 anúncios: 13 páginas de E5 + sondas de campos).
MAX_CHAMADAS_ML = 60
__doc__ = __doc__.replace("{max}", str(MAX_CHAMADAS_ML))

BASE_MET = "clicks,prints,ctr,cost,cpc,acos,roas,cvr,sov,direct_amount,indirect_amount,total_amount"
QTD_MET = ("direct_items_quantity,indirect_items_quantity,advertising_items_quantity,direct_units_quantity,"
           "indirect_units_quantity,units_quantity,organic_items_quantity,organic_units_quantity,organic_units_amount")
COMP_MET = "impression_share,top_impression_share,lost_impression_share_by_budget,lost_impression_share_by_ad_rank"
TODAS_MET = f"{BASE_MET},{QTD_MET},{COMP_MET}"
STATUS_TODOS = "active,paused,deleted,error"
ANUNCIO_MET = "clicks,prints,cost,cpc,acos,direct_amount,indirect_amount,total_amount,units_quantity,advertising_items_quantity"
BORDA_DIAS = (90, 91, 92, 100)  # idade de date_from em dias, contada de hoje BRT
# Únicos campos de identificação que podem aparecer (nenhum é nome); valores ainda passam por `seguro`.
PERMITIDOS = {"id", "campaign_id", "ad_group_id", "item_id", "status", "date", "strategy", "currency",
              "last_updated", "date_created", "channel", "budget"}
# Métricas permitidas (seção 2.3–2.7 do plano): só estes nomes, só valores numéricos/booleanos/null.
METRICAS_OK = set((TODAS_MET + "," + ANUNCIO_MET).split(","))
ADITIVAS = {"cost", "prints", "clicks"}
TOKEN = re.compile(r"^[a-z0-9_.-]{1,64}$", re.I)
DATA = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def aditiva(k):
    # Razões (cpc, roas, acos, ctr, cvr, sov, *_share) nunca são somadas.
    return k in ADITIVAS or k.endswith(("_amount", "_quantity"))


def seguro(v):
    """Strings só se forem token curto alfanumérico; o resto vira <omitido>."""
    return v if isinstance(v, str) and TOKEN.match(v) else "<omitido>"


def limpa_metricas(d):
    return {k: v for k, v in sorted(d.items())
            if k in METRICAS_OK and (v is None or isinstance(v, (int, float, bool)))}


def tipo(v):
    return "null" if v is None else type(v).__name__


def campos(d):
    return {k: tipo(v) for k, v in sorted(d.items()) if TOKEN.match(str(k))} if isinstance(d, dict) else {}


def totais(linhas):
    """Σ dos campos numéricos (de metrics ou da linha) e em quantas linhas cada campo veio."""
    soma, presente = {}, {}
    for r in linhas:
        m = r.get("metrics") if isinstance(r.get("metrics"), dict) else r
        for k, v in m.items():
            if aditiva(k) and isinstance(v, (int, float)) and not isinstance(v, bool):
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
        except (urllib.error.URLError, TimeoutError, OSError):
            corpo, status = b"", 0  # falha de rede: status 0, nunca confundida com recusa 4xx
        ms = round((time.monotonic() - t0) * 1000)
        try:
            corpo = json.loads(corpo)
        except ValueError:
            corpo = {}
        print(f"\n[{self.n}] {nome} http={status} {ms}ms")
        if status != 200:
            # Só tokens curtos (códigos); mensagens livres podem conter nomes/e-mails.
            erro = {k: seguro(corpo.get(k)) for k in ("error", "code") if isinstance(corpo, dict) and corpo.get(k)}
            print(f"  erro ML: {erro or '<omitido>'}")
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
            k = seguro(r.get("status")) if r.get("status") is not None else None
            stts[k] = stts.get(k, 0) + 1
        if any(stts):
            print(f"  status: {stts}")
        datas = sorted(r["date"] for r in res if isinstance(r.get("date"), str) and DATA.match(r["date"]))
        if datas:
            print(f"  datas: {len(set(datas))} distintas, {datas[0]}..{datas[-1]}")
        print(f"  Σ por campo (valor, linhas com o campo): {totais(res)}")
    if isinstance(corpo.get("metrics_summary"), dict):
        print(f"  metrics_summary: {limpa_metricas(corpo['metrics_summary'])}")
    return res


def descreve_detalhe(corpo):
    print(f"  campos do topo: {campos(corpo)}")
    ident = {k: (v if isinstance(v, (int, float, bool)) or v is None else seguro(v))
             for k, v in sorted(corpo.items()) if k in PERMITIDOS}
    print(f"  identificação: {ident}")
    for bloco in ("metrics", "metrics_summary"):
        if isinstance(corpo.get(bloco), dict):
            print(f"  {bloco}: {limpa_metricas(corpo[bloco])}")
    return corpo.get("results") or []


def com_fallback(ml, nome, caminho, caminho_reduzido):
    st, c = ml.get(nome, caminho)
    if st == 400:
        print("  (400 com o conjunto completo de métricas; repetindo só com o conjunto base)")
        st, c = ml.get(nome + "-base", caminho_reduzido)
    return st, c


def conexoes():
    """Lista conexões sem nomes: só ids, canal, vigência do token e se há conta externa."""
    for r in s053.sql("select id, org_id, canal, conta_externa_id, expires_at from public.marketplace_connections "
                      "order by criado_em"):
        vigente = bool(r["expires_at"]) and datetime.datetime.fromisoformat(
            r["expires_at"].replace("Z", "+00:00")) > datetime.datetime.now(datetime.timezone.utc)
        print({"connection_id": r["id"], "org_id": r["org_id"], "canal": r["canal"],
               "status": "token_vigente" if vigente else "token_vencido", "conta_externa_id": r["conta_externa_id"]})


def hoje_brt():
    return datetime.datetime.now(zoneinfo.ZoneInfo("America/Sao_Paulo")).date()


def metricas_de(corpo):
    """Dicts de métricas de uma resposta: linhas (metrics ou a própria linha), metrics e metrics_summary."""
    out = []
    for r in corpo.get("results") or []:
        if isinstance(r, dict):
            out.append(r["metrics"] if isinstance(r.get("metrics"), dict) else r)
    out += [corpo[b] for b in ("metrics", "metrics_summary") if isinstance(corpo.get(b), dict)]
    return out


def valido(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def estado(ms, k):
    """Classe de um campo em N linhas: confirmado só se numérico válido (bool/texto/nulo não contam) em TODAS."""
    n = len(ms)
    if n == 0:
        return "NÃO CONFIRMADO: sem linhas"
    pres = [m[k] for m in ms if k in m]
    if not pres:
        return "ausente"
    ok = [v for v in pres if valido(v)]
    nulos = sum(1 for v in pres if v is None)
    if len(ok) == n:
        faixa = f" min={min(ok)} max={max(ok)}" if not aditiva(k) else ""
        return f"confirmado {len(ok)}/{n}{faixa}"
    return (f"NÃO CONFIRMADO: válido {len(ok)}/{n}, nulo {nulos}, inválido {len(pres) - len(ok) - nulos}, "
            f"ausente {n - len(pres)}")


def sondar(ml, rotulo, caminho, pedidos=TODAS_MET):
    """Pede todos os campos; em 4xx (≠429) isola por subdivisão; 5xx/rede = falha operacional, nunca recusa.
    Devolve (corpos 200, recusados {campo: http}, falhas {campo: http})."""
    ok, rec, fal = [], {}, {}

    def tenta(ks, nome):
        st, c = ml.get(nome, f"{caminho}&metrics={','.join(ks)}")
        if st == 200:
            ok.append(c)
        elif 400 <= st < 500 and len(ks) > 1:
            m = len(ks) // 2
            tenta(ks[:m], nome + "a")
            tenta(ks[m:], nome + "b")
        else:
            for k in ks:
                (rec if 400 <= st < 500 else fal)[k] = f"http={st}"

    todos = pedidos.split(",")
    st, c = ml.get(f"{rotulo}-todas", f"{caminho}&metrics={pedidos}")
    if st == 200:
        ok.append(c)
    elif 400 <= st < 500:
        # Competitividade vai campo a campo; o resto subdivide só se também for recusado.
        comp = [k for k in todos if k in COMP_MET.split(",")]
        resto = [k for k in todos if k not in comp]
        tenta(resto, f"{rotulo}-resto")
        for k in comp:
            tenta([k], f"{rotulo}-{k}")
    else:
        fal = {k: f"http={st}" for k in todos}
    return ok, rec, fal


def imprime(rotulo, ms, rec, fal, pedidos=TODAS_MET):
    print(f"  CLASSIFICAÇÃO {rotulo} ({len(ms)} linhas/blocos):")
    for k in pedidos.split(","):
        r = (f"RECUSADO ({rec[k]})" if k in rec else f"FALHA OPERACIONAL, não classificado ({fal[k]})" if k in fal
             else estado(ms, k))
        print(f"    {k}: {r}")


def classifica(ml, rotulo, caminho, pedidos=TODAS_MET):
    ok, rec, fal = sondar(ml, rotulo, caminho, pedidos)
    corpo = juntar(ok)
    imprime(rotulo, metricas_de(corpo), rec, fal, pedidos)
    return corpo


def dinheiro(k):
    return k == "cost" or k.endswith("_amount")


def chave(r):
    for k in ("item_id", "date", "id", "campaign_id"):
        if r.get(k) is not None:
            return (k, r[k])
    raise ValueError("linha sem identificador estável (item_id/date/id/campaign_id)")


def juntar(corpos):
    """Une respostas de grupos de métricas pelo identificador estável da linha. Rejeita duplicatas e
    conjuntos de linhas diferentes (nunca por posição)."""
    if not corpos:
        return {}
    out = json.loads(json.dumps(corpos[0]))
    idx = {}
    for r in out.get("results") or []:
        k = chave(r)
        if k in idx:
            raise ValueError(f"identificador duplicado: {k}")
        idx[k] = r
    for c in corpos[1:]:
        outros = {}
        for r in c.get("results") or []:
            k = chave(r)
            if k in outros:
                raise ValueError(f"identificador duplicado: {k}")
            outros[k] = r
        if set(outros) != set(idx):
            raise ValueError("respostas com conjuntos de linhas diferentes")
        for k, rb in outros.items():
            ra = idx[k]
            if isinstance(ra.get("metrics"), dict) and isinstance(rb.get("metrics"), dict):
                ra["metrics"].update(rb["metrics"])
            else:
                ra.update(rb)
        for b in ("metrics", "metrics_summary"):
            if isinstance(out.get(b), dict) and isinstance(c.get(b), dict):
                out[b].update(c[b])
    return out


def razoes(m):
    """Valor nativo × recálculo por fórmula candidata (só imprime; nenhuma fórmula é escolhida)."""
    def d(a, b):
        return round(a / b, 6) if isinstance(a, (int, float)) and isinstance(b, (int, float)) and b else None
    g = m.get
    return {"ctr": (g("ctr"), d(g("clicks"), g("prints"))),
            "acos": (g("acos"), d(g("cost"), g("total_amount"))),
            "roas": (g("roas"), d(g("total_amount"), g("cost"))),
            "cpc": (g("cpc"), d(g("cost"), g("clicks"))),
            "cvr_nativo": g("cvr"),
            "cvr/advertising_items": d(g("advertising_items_quantity"), g("clicks")),
            "cvr/units": d(g("units_quantity"), g("clicks")),
            "cvr/direct_items": d(g("direct_items_quantity"), g("clicks")),
            "cvr/direct_units": d(g("direct_units_quantity"), g("clicks")),
            "sov": g("sov")}


def conciliar(cx):
    token, ml, a = abre(cx)
    d = datetime.timedelta
    ontem = hoje_brt() - d(days=1)
    j = ((ontem - d(days=29)).isoformat(), ontem.isoformat())
    base = f"/marketplace/advertising/{a['site_id']}"
    adv_base = f"{base}/advertisers/{a['advertiser_id']}/product_ads"
    per = f"date_from={j[0]}&date_to={j[1]}"
    print(f"janela atual={j}")
    c1 = classifica(ml, "E1", f"{adv_base}/campaigns/search?limit=50&offset=0&{per}&metrics_summary=true"
                    f"&filters[status]={STATUS_TODOS}")
    res = [r for r in c1.get("results") or [] if isinstance(r, dict)]
    resumo = c1.get("metrics_summary") if isinstance(c1.get("metrics_summary"), dict) else {}
    print(f"  ESCALA resumo E1: {razoes(resumo)}")
    for r in res:
        if isinstance(r.get("metrics"), dict) and (r["metrics"].get("clicks") or 0) > 0:
            print(f"  ESCALA campanha {r.get('id')}: {razoes(r['metrics'])}")
    classifica(ml, "E2", f"{adv_base}/campaigns/search?limit=50&offset=0&{per}&aggregation_type=DAILY"
               f"&filters[status]={STATUS_TODOS}")
    cid = next((str(r["id"]) for r in sorted(res, key=lambda r: -float((r.get("metrics") or {}).get("cost") or 0))
                if r.get("id")), None)
    print(f"campanha do detalhe: {cid}")
    if cid:
        c3 = classifica(ml, "E3", f"{base}/product_ads/campaigns/{cid}?{per}")
        for m in metricas_de(c3):
            print(f"  ESCALA E3: {razoes(m)}")
            print(f"  COMPETITIVIDADE E3: { {k: m.get(k) for k in COMP_MET.split(',')} }")
        classifica(ml, "E4", f"{base}/product_ads/campaigns/{cid}?{per}&aggregation_type=DAILY")
    # E5: campos pedidos por anúncio (todas as métricas) na 1ª página e conciliação completa por Σ.
    p5 = f"{adv_base}/ads/search?limit=50&{per}"
    ok5, rec5, fal5 = sondar(ml, "E5", f"{p5}&offset=0")
    c5 = juntar(ok5)
    total = (c5.get("paging") or {}).get("total") or 0
    anuncios = [r for r in c5.get("results") or [] if isinstance(r, dict)]
    pedidos5 = ",".join(k for k in TODAS_MET.split(",") if k not in rec5 and k not in fal5)
    for off in range(50, total, 50):
        st, c = ml.get(f"E5-pag-{off}", f"{p5}&offset={off}&metrics={pedidos5}")
        if st != 200:
            raise SystemExit("página de E5 falhou; conciliação incompleta")
        anuncios += [r for r in c.get("results") or [] if isinstance(r, dict)]
    # Classificação de E5 sobre TODAS as páginas (não só a 1ª).
    imprime("E5", [r["metrics"] if isinstance(r.get("metrics"), dict) else r for r in anuncios], rec5, fal5)
    ids = [r.get("item_id") for r in anuncios]
    print(f"\nE5: {len(anuncios)} anúncios lidos de paging.total={total}; item_id distintos={len(set(ids))}")
    cent = {}
    for r in anuncios:
        for k, v in (r.get("metrics") or {}).items():
            if aditiva(k) and isinstance(v, (int, float)) and not isinstance(v, bool):
                cent[k] = cent.get(k, 0) + round(v * 100 if dinheiro(k) else v)
    for k in sorted(cent):
        conta = resumo.get(k)
        alvo = round(conta * 100) if dinheiro(k) and conta is not None else conta
        print(f"  Σ anúncios {k}: {cent[k]} | resumo E1 da conta: {alvo} | diferença: "
              f"{None if alvo is None else round(cent[k] - alvo, 2)} (centavos para valores em R$)")
    dif = [abs(((r.get('metrics') or {}).get('acos') or 0) - 100 * ((r['metrics']['cost'] / r['metrics']['total_amount'])))
           for r in anuncios if (r.get("metrics") or {}).get("total_amount")]
    print(f"  acos por anúncio × 100·cost/total_amount: {len(dif)} anúncios com receita; maior diferença absoluta "
          f"{round(max(dif), 4) if dif else None}")
    print(f"\nchamadas ML: {ml.n}/{MAX_CHAMADAS_ML}")


def abre(cx):
    assert all(c in "0123456789abcdef-" for c in cx), "connection_id inválido"
    linha = s053.sql(f"select access_token, expires_at from public.get_connection_tokens('{cx}'::uuid)")[0]
    token, expira = linha["access_token"], linha["expires_at"]
    del linha
    if datetime.datetime.fromisoformat(expira.replace("Z", "+00:00")) <= datetime.datetime.now(datetime.timezone.utc):
        raise SystemExit("BLOCKED: token vencido; não renovar fora do app")
    ml = Ml(token)
    st, adv = ml.get("advertisers", "/advertising/advertisers?product_id=PADS", versao="1")
    if st != 200 or not adv.get("advertisers"):
        raise SystemExit("sem advertiser / sem permissão")
    return token, ml, next((x for x in adv["advertisers"] if x.get("site_id") == "MLB"), adv["advertisers"][0])


def main(cx, dias, campanha):
    token, ml, a = abre(cx)

    d = datetime.timedelta
    ontem = hoje_brt() - d(days=1)
    atual = ((ontem - d(days=dias - 1)).isoformat(), ontem.isoformat())
    ant_fim = ontem - d(days=dias)
    anterior = ((ant_fim - d(days=dias - 1)).isoformat(), ant_fim.isoformat())
    print(f"janela atual={atual} anterior={anterior} (BRT, {dias} dias)")

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

    # Borda da retenção: date_from = hoje BRT − n (n = idade do date_from), date_to = ontem.
    print("\n--- retenção ---")
    for n in BORDA_DIAS:
        df = (hoje_brt() - d(days=n)).isoformat()
        incl = (ontem - datetime.date.fromisoformat(df)).days + 1
        st, c = ml.get(f"retencao-{n}d", f"{adv_base}/campaigns/search?limit=1&offset=0&date_from={df}"
                       f"&date_to={ontem.isoformat()}&metrics=cost&metrics_summary=true")
        resumo = limpa_metricas(c["metrics_summary"]) if isinstance(c.get("metrics_summary"), dict) else None
        print(f"  date_from={df} (hoje − {n}) date_to={ontem.isoformat()} ({incl} dias inclusivos): "
              f"http={st} summary={resumo}")
    print(f"\nchamadas ML: {ml.n}/{MAX_CHAMADAS_ML}")


if __name__ == "__main__":
    a = sys.argv[1:]
    if a == ["conexoes"]:
        conexoes()
    elif len(a) == 2 and a[0] == "conciliar":
        conciliar(a[1])
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
