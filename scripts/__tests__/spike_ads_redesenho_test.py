#!/usr/bin/env python3
"""Teste de sentinelas do spike 058: nada sensível chega ao stdout. Sem rede.

Uso: python3 scripts/__tests__/spike_ads_redesenho_test.py
"""
import contextlib
import importlib.util
import io
import json
import pathlib
import urllib.error
import urllib.request

_spec = importlib.util.spec_from_file_location(
    "s058", pathlib.Path(__file__).resolve().parent.parent / "spike-ads-redesenho.py")
s058 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(s058)

TOKEN, NOME, EMAIL = "APP_USR-SENTINELA-TOKEN-123", "Maria Sentinela da Silva", "sentinela@exemplo.com"
SENTINELAS = (TOKEN, NOME, EMAIL, "Sentinela")


class Resp:
    def __init__(self, corpo, status=200):
        self._c, self.status = json.dumps(corpo).encode(), status

    def read(self):
        return self._c

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def captura(fn):
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        fn()
    return buf.getvalue()


def test_sem_sentinelas():
    linha = {"id": 123, "status": NOME, "name": NOME, "nickname": EMAIL, "date": EMAIL,
             "metrics": {"cost": 10.5, "clicks": 3, "prints": 100, "cpc": 3.5, "roas": 2.0, "cvr": 0.1,
                         "impression_share": 0.5, "total_amount": 50, "advertising_items_quantity": 2,
                         "nome_vazado": NOME, "email": EMAIL}}
    corpo = {"results": [linha, dict(linha)], "paging": {"total": 2, "limit": 50},
             "metrics_summary": {"cost": 21, "roas": 2.0, "x": TOKEN, "cvr": 0.1}}
    detalhe = {"id": 7, "status": "active", "strategy": NOME, "name": NOME, "advertiser_name": EMAIL,
               "metrics": {"cost": 1, "token": TOKEN, "organic_items_quantity": 4}, "metrics_summary": {"sov": 0.3}}

    def corre():
        s058.descreve_lista(corpo, "campanhas")
        s058.descreve_detalhe(detalhe)
        # Erro do ML com mensagem livre e code malicioso (espaços/@/nome).
        original = urllib.request.urlopen

        def falso(req, timeout=0):
            raise urllib.error.HTTPError("u", 400, "x", {}, io.BytesIO(json.dumps(
                {"message": f"conta {NOME} {EMAIL} {TOKEN}", "error": "bad_request", "code": EMAIL}).encode()))
        urllib.request.urlopen = falso
        try:
            s058.Ml(TOKEN).get("teste", "/x")
        finally:
            urllib.request.urlopen = original
    saida = captura(corre)
    for s in SENTINELAS:
        assert s not in saida, f"sentinela vazou: {s!r}\n{saida}"
    assert "bad_request" in saida and "<omitido>" in saida and "http=400" in saida, saida


def test_so_soma_aditivas():
    t = s058.totais([{"metrics": {"cost": 1, "cpc": 2, "roas": 3, "cvr": 4, "sov": 5, "impression_share": 6,
                                  "total_amount": 7, "direct_items_quantity": 8, "clicks": 9, "prints": 10}}] * 2)
    assert set(t) == {"cost", "total_amount", "direct_items_quantity", "clicks", "prints"}, t
    assert t["cost"][0] == 2


def test_retencao_e_ml_so_get():
    assert s058.BORDA_DIAS[0] == 90 and 91 in s058.BORDA_DIAS


def test_confirmado_exige_numero_valido_em_todas_as_linhas():
    ms = [{"cvr": 1.5, "a": None, "b": True, "c": "x", "d": 1}, {"cvr": 2, "a": 1, "b": 1, "c": 1}]
    assert s058.estado(ms, "cvr").startswith("confirmado 2/2")
    for k in ("a", "b", "c", "d"):  # nulo, booleano, texto, presente em 1/2
        assert s058.estado(ms, k).startswith("NÃO CONFIRMADO"), (k, s058.estado(ms, k))
    assert s058.estado(ms, "zzz") == "ausente"
    assert s058.estado([], "cvr").startswith("NÃO CONFIRMADO")


class MlFalso:
    """GET falso: 5xx em tudo, ou 400 quando o campo recusado é pedido."""
    def __init__(self, recusa=(), status_erro=None):
        self.recusa, self.status_erro, self.n = set(recusa), status_erro, 0

    def get(self, nome, caminho, versao="2"):
        self.n += 1
        if self.status_erro:
            return self.status_erro, {}
        pedidos = caminho.split("metrics=")[1].split("&")[0].split(",")
        if self.recusa & set(pedidos):
            return 400, {}
        return 200, {"results": [{"id": 1, "metrics": {k: 1 for k in pedidos}}]}


def test_5xx_nao_vira_recusado_e_400_isola_so_o_campo():
    ok, rec, fal = s058.sondar(MlFalso(status_erro=503), "E", "/x?a=1")
    assert not rec and not ok and set(fal) == set(s058.TODAS_MET.split(",")), (rec, fal)
    ok, rec, fal = s058.sondar(MlFalso(recusa={"cvr"}), "E", "/x?a=1")
    assert set(rec) == {"cvr"} and not fal, (rec, fal)  # só cvr; o resto fica classificável
    assert "sov" not in rec


def test_juntar_por_id_nao_por_posicao():
    a = {"results": [{"item_id": "A", "metrics": {"cost": 1}}, {"item_id": "B", "metrics": {"cost": 2}}]}
    b = {"results": [{"item_id": "B", "metrics": {"cvr": 20}}, {"item_id": "A", "metrics": {"cvr": 10}}]}
    j = s058.juntar([a, b])
    por = {r["item_id"]: r["metrics"] for r in j["results"]}
    assert por["A"] == {"cost": 1, "cvr": 10} and por["B"] == {"cost": 2, "cvr": 20}, por
    for ruim in ({"results": [{"item_id": "A", "metrics": {}}, {"item_id": "A", "metrics": {}}]},
                 {"results": [{"item_id": "A", "metrics": {}}]},
                 {"results": [{"item_id": "A", "metrics": {}}, {"item_id": "C", "metrics": {}}]}):
        try:
            s058.juntar([a, ruim])
        except ValueError:
            continue
        raise AssertionError(f"deveria rejeitar {ruim}")


if __name__ == "__main__":
    for nome, fn in list(globals().items()):
        if nome.startswith("test_"):
            fn()
            print("ok", nome)
