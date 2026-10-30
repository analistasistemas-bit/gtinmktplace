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


if __name__ == "__main__":
    for nome, fn in list(globals().items()):
        if nome.startswith("test_"):
            fn()
            print("ok", nome)
