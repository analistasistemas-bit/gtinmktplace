#!/usr/bin/env python3
"""Roda um teste SQL (supabase/tests/*.sql) em produção numa transação SEMPRE desfeita.

Uso: python3 scripts/teste-sql-desfeito.py <teste.sql> [migration.sql ...]

Receita da memória reference_teste_sql_sem_docker (o banco local não reproduz a cadeia de migrations):
uma requisição `database/query` com `begin; timeouts; <migrations>; <corpo do teste>; raise 'TESTE_OK'; rollback;`.
Sucesso = erro P0001 TESTE_OK (toda asserção anterior passou). Qualquer falha também desfaz tudo.
Sem migrations = prova de vermelho (o mesmo teste tem que falhar).
"""
import json
import pathlib
import re
import sys
import urllib.error
import urllib.request

RAIZ = pathlib.Path(__file__).resolve().parent.parent
PROJETO = "txvncrgkoynoxwopfkbp"


def token():
    for linha in (RAIZ / ".env.local").read_text().splitlines():
        if linha.startswith("SUPABASE_ACCESS_TOKEN="):
            return linha.split("=", 1)[1].strip().strip('"')
    raise SystemExit("SUPABASE_ACCESS_TOKEN ausente")


def corpo_do_teste(sql: str) -> str:
    linhas = [l for l in sql.splitlines() if not l.lstrip().startswith("\\")]   # metacomandos psql
    s = "\n".join(linhas).strip()
    s = re.sub(r"^\s*begin\s*;", "", s, count=1, flags=re.I)
    s = re.sub(r"rollback\s*;\s*$", "", s, flags=re.I)
    return s


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    teste = corpo_do_teste(pathlib.Path(sys.argv[1]).read_text())
    migrations = "\n".join(pathlib.Path(m).read_text() for m in sys.argv[2:])
    sql = ("begin;\nset local lock_timeout = '2s';\nset local statement_timeout = '30s';\n"
           f"{migrations}\n{teste}\n"
           "do $$ begin raise exception 'TESTE_OK'; end $$;\nrollback;")
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{PROJETO}/database/query",
        data=json.dumps({"query": sql}).encode(),
        headers={"Authorization": f"Bearer {token()}", "Content-Type": "application/json", "User-Agent": "teste-sql"})
    try:
        urllib.request.urlopen(req, timeout=120)
        print("FALHOU: a transação terminou sem TESTE_OK (nada foi gravado: rollback)")
        sys.exit(1)
    except urllib.error.HTTPError as e:
        msg = e.read().decode(errors="replace")
        if "TESTE_OK" in msg and "P0001" in msg:
            print("PASSOU: TESTE_OK (transação desfeita)")
            return
        print(f"FALHOU (HTTP {e.code}): {msg[:1500]}")
        sys.exit(1)


if __name__ == "__main__":
    main()
