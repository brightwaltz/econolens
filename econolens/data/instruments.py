"""銘柄マスタのロード・検索。

同梱 CSV(seed_instruments.csv)を SQLite の instruments テーブルへ取り込み、
タグによる絞り込み検索を提供する。
"""

from __future__ import annotations

import csv
from dataclasses import dataclass

from .. import config, db


@dataclass(frozen=True)
class Instrument:
    code: str
    market: str
    name: str
    sector: str | None
    region_tags: str | None
    theme_tags: str | None
    currency: str | None
    note: str | None

    @property
    def region_list(self) -> list[str]:
        return _split_tags(self.region_tags)

    @property
    def theme_list(self) -> list[str]:
        return _split_tags(self.theme_tags)


def _split_tags(value: str | None) -> list[str]:
    """セミコロン区切りのタグ文字列をリストへ。"""
    if not value:
        return []
    return [t.strip() for t in value.split(";") if t.strip()]


def seed_from_csv() -> int:
    """同梱 CSV を instruments テーブルへ upsert する。取り込み件数を返す。"""
    db.init_db()
    rows: list[tuple] = []
    with open(config.SEED_INSTRUMENTS_CSV, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            rows.append(
                (
                    r["code"].strip(),
                    r["market"].strip(),
                    r["name"].strip(),
                    (r.get("sector") or "").strip() or None,
                    (r.get("region_tags") or "").strip() or None,
                    (r.get("theme_tags") or "").strip() or None,
                    (r.get("currency") or "").strip() or None,
                    (r.get("note") or "").strip() or None,
                )
            )
    with db.connect() as conn:
        conn.executemany(
            """
            INSERT INTO instruments
                (code, market, name, sector, region_tags, theme_tags, currency, note)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(code) DO UPDATE SET
                market=excluded.market, name=excluded.name, sector=excluded.sector,
                region_tags=excluded.region_tags, theme_tags=excluded.theme_tags,
                currency=excluded.currency, note=excluded.note
            """,
            rows,
        )
    return len(rows)


def _ensure_seeded(conn) -> None:
    """instruments が空ならシードする。"""
    count = conn.execute("SELECT COUNT(*) FROM instruments").fetchone()[0]
    if count == 0:
        seed_from_csv()


def list_instruments(
    market: str | None = None,
    theme: str | None = None,
    region: str | None = None,
) -> list[Instrument]:
    """マスタを絞り込んで返す。tag はタグ集合への部分一致(セミコロン区切り)。"""
    db.init_db()
    with db.connect() as conn:
        _ensure_seeded(conn)
        clauses: list[str] = []
        params: list[str] = []
        if market:
            clauses.append("market = ?")
            params.append(market)
        if theme:
            clauses.append("(';'||theme_tags||';') LIKE ?")
            params.append(f"%;{theme};%")
        if region:
            clauses.append("(';'||region_tags||';') LIKE ?")
            params.append(f"%;{region};%")
        where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
        sql = f"SELECT * FROM instruments{where} ORDER BY market, code"
        rows = conn.execute(sql, params).fetchall()
    return [_row_to_instrument(r) for r in rows]


def get_instrument(code: str) -> Instrument | None:
    """コード完全一致でマスタを引く。無ければ None。"""
    db.init_db()
    with db.connect() as conn:
        _ensure_seeded(conn)
        row = conn.execute(
            "SELECT * FROM instruments WHERE code = ?", (code,)
        ).fetchone()
    return _row_to_instrument(row) if row else None


def _row_to_instrument(row) -> Instrument:
    return Instrument(
        code=row["code"],
        market=row["market"],
        name=row["name"],
        sector=row["sector"],
        region_tags=row["region_tags"],
        theme_tags=row["theme_tags"],
        currency=row["currency"],
        note=row["note"],
    )
