"""Shareholder loans — Rangrücktritt tracking for OR 725a/b compliance.

Each loan records:
  - direction (shareholder_to_gmbh or gmbh_to_shareholder)
  - whether it has a written Rangrücktritt subordination clause
  - optional supporting agreement PDF
  - repayment status
"""

from __future__ import annotations

from fastapi import APIRouter, Form, HTTPException

from db import get_db

router = APIRouter()


VALID_DIRECTIONS = {"shareholder_to_gmbh", "gmbh_to_shareholder"}


def _row(r) -> dict:
    return {
        "id": r["id"],
        "loan_date": r["loan_date"],
        "amount": r["amount"],
        "currency": r["currency"],
        "direction": r["direction"],
        "is_subordinated": bool(r["is_subordinated"]),
        "notes": r["notes"],
        "document_file": r["document_file"],
        "repayment_date": r["repayment_date"],
        "is_repaid": bool(r["is_repaid"]),
        "created_at": r["created_at"],
    }


@router.get("/shareholder-loans")
async def list_loans():
    with get_db() as db:
        rows = db.execute(
            "SELECT * FROM shareholder_loans ORDER BY loan_date DESC, id DESC"
        ).fetchall()
    return [_row(r) for r in rows]


@router.get("/shareholder-loans/summary")
async def summary():
    """Net position: shareholder → GmbH (positive) or vice versa (negative)."""
    with get_db() as db:
        rows = db.execute(
            "SELECT direction, COALESCE(SUM(amount),0) AS t, "
            "COALESCE(SUM(CASE WHEN is_subordinated=1 THEN amount ELSE 0 END),0) AS s, "
            "COALESCE(SUM(CASE WHEN is_repaid=1 THEN amount ELSE 0 END),0) AS r "
            "FROM shareholder_loans GROUP BY direction"
        ).fetchall()
    by_dir = {r["direction"]: dict(r) for r in rows}
    sh_to_gmbh = by_dir.get("shareholder_to_gmbh", {"t": 0, "s": 0, "r": 0})
    gmbh_to_sh = by_dir.get("gmbh_to_shareholder", {"t": 0, "s": 0, "r": 0})
    net = float(sh_to_gmbh.get("t", 0)) - float(gmbh_to_sh.get("t", 0))
    subordinated = float(sh_to_gmbh.get("s", 0))  # only inbound can be subordinated
    return {
        "net_owed_to_shareholder": round(net, 2),
        "total_in": float(sh_to_gmbh.get("t", 0)),
        "total_out": float(gmbh_to_sh.get("t", 0)),
        "subordinated_amount": round(subordinated, 2),
        "repaid_total": float(sh_to_gmbh.get("r", 0)) + float(gmbh_to_sh.get("r", 0)),
    }


@router.get("/shareholder-loans/{id}")
async def get_loan(id: int):
    with get_db() as db:
        r = db.execute("SELECT * FROM shareholder_loans WHERE id=?", (id,)).fetchone()
    if not r:
        raise HTTPException(404, "Loan not found")
    return _row(r)


@router.post("/shareholder-loans")
async def create_loan(
    loan_date: str = Form(...),
    amount: float = Form(...),
    currency: str = Form("CHF"),
    direction: str = Form("shareholder_to_gmbh"),
    is_subordinated: int = Form(0),
    notes: str = Form(""),
    repayment_date: str = Form(""),
    is_repaid: int = Form(0),
):
    if direction not in VALID_DIRECTIONS:
        raise HTTPException(400, f"direction must be one of {sorted(VALID_DIRECTIONS)}")
    if amount <= 0:
        raise HTTPException(400, "amount must be positive")
    with get_db() as db:
        cur = db.execute(
            """INSERT INTO shareholder_loans
               (loan_date, amount, currency, direction, is_subordinated, notes,
                repayment_date, is_repaid)
               VALUES (?,?,?,?,?,?,?,?)""",
            (loan_date, amount, currency, direction, is_subordinated, notes or None,
             repayment_date or None, is_repaid),
        )
    return {"id": cur.lastrowid}


@router.put("/shareholder-loans/{id}")
async def update_loan(
    id: int,
    loan_date: str = Form(...),
    amount: float = Form(...),
    currency: str = Form("CHF"),
    direction: str = Form("shareholder_to_gmbh"),
    is_subordinated: int = Form(0),
    notes: str = Form(""),
    repayment_date: str = Form(""),
    is_repaid: int = Form(0),
):
    if direction not in VALID_DIRECTIONS:
        raise HTTPException(400, f"direction must be one of {sorted(VALID_DIRECTIONS)}")
    with get_db() as db:
        if not db.execute("SELECT 1 FROM shareholder_loans WHERE id=?", (id,)).fetchone():
            raise HTTPException(404, "Loan not found")
        db.execute(
            """UPDATE shareholder_loans SET
               loan_date=?, amount=?, currency=?, direction=?, is_subordinated=?,
               notes=?, repayment_date=?, is_repaid=?, updated_at=datetime('now')
               WHERE id=?""",
            (loan_date, amount, currency, direction, is_subordinated,
             notes or None, repayment_date or None, is_repaid, id),
        )
    return {"message": "Loan updated"}


@router.delete("/shareholder-loans/{id}")
async def delete_loan(id: int):
    with get_db() as db:
        if not db.execute("SELECT 1 FROM shareholder_loans WHERE id=?", (id,)).fetchone():
            raise HTTPException(404, "Loan not found")
        db.execute("DELETE FROM shareholder_loans WHERE id=?", (id,))
    return {"message": "Loan deleted"}
