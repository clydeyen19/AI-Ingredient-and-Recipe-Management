from __future__ import annotations

import base64
import json
import os
import shutil
import sqlite3
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from openai import OpenAI
from pydantic import BaseModel, Field


ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

def root_relative_path(value: str | Path) -> Path:
    path = Path(value)
    return path if path.is_absolute() else ROOT / path


DB_PATH = root_relative_path(os.getenv("DATABASE_PATH", ROOT / "data" / "app.db"))
UPLOAD_DIR = root_relative_path(os.getenv("UPLOAD_DIR", ROOT / "uploads"))
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://127.0.0.1:5173")

DB_PATH.parent.mkdir(parents=True, exist_ok=True)
(UPLOAD_DIR / "ingredients").mkdir(parents=True, exist_ok=True)
(UPLOAD_DIR / "meals").mkdir(parents=True, exist_ok=True)

app = FastAPI(title="食材飲食管理 API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_ORIGIN, "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")


def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with get_db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS ingredients (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                category TEXT NOT NULL DEFAULT '其他',
                unit TEXT NOT NULL DEFAULT 'g',
                total_quantity REAL NOT NULL DEFAULT 0,
                remaining_quantity REAL NOT NULL DEFAULT 0,
                purchase_date TEXT,
                expiration_date TEXT,
                is_opened INTEGER NOT NULL DEFAULT 0,
                opened_date TEXT,
                location TEXT NOT NULL DEFAULT '冷藏',
                notes TEXT NOT NULL DEFAULT '',
                image_path TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS meal_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                meal_date TEXT NOT NULL,
                meal_type TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                image_path TEXT,
                ai_result TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS ingredient_usages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                meal_id INTEGER NOT NULL,
                ingredient_id INTEGER,
                ingredient_name TEXT NOT NULL,
                quantity REAL NOT NULL DEFAULT 0,
                unit TEXT NOT NULL DEFAULT 'g',
                confidence REAL NOT NULL DEFAULT 0,
                confirmed INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                FOREIGN KEY(meal_id) REFERENCES meal_logs(id) ON DELETE CASCADE,
                FOREIGN KEY(ingredient_id) REFERENCES ingredients(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS weekly_plans (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                week_start TEXT NOT NULL,
                plan_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            """
        )
        ensure_column(conn, "ingredients", "purchase_date", "TEXT")

        count = conn.execute("SELECT COUNT(*) FROM ingredients").fetchone()[0]
        if count == 0:
            seed_ingredients(conn)


def ensure_column(conn: sqlite3.Connection, table: str, column: str, definition: str) -> None:
    columns = [row["name"] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()]
    if column not in columns:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def seed_ingredients(conn: sqlite3.Connection) -> None:
    today = date.today()
    samples = [
        ("雞胸肉", "肉類", "g", 600, 420, (today + timedelta(days=2)).isoformat(), 1, "冷藏"),
        ("菠菜", "蔬菜", "g", 300, 180, (today + timedelta(days=1)).isoformat(), 1, "冷藏"),
        ("雞蛋", "蛋奶", "顆", 12, 8, (today + timedelta(days=7)).isoformat(), 0, "冷藏"),
        ("糙米", "主食/澱粉", "g", 1000, 760, None, 0, "常溫"),
    ]
    now = datetime.utcnow().isoformat()
    conn.executemany(
        """
        INSERT INTO ingredients
        (name, category, unit, total_quantity, remaining_quantity, expiration_date, is_opened, location, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [(name, cat, unit, total, remain, exp, opened, loc, now, now) for name, cat, unit, total, remain, exp, opened, loc in samples],
    )


@app.on_event("startup")
def on_startup() -> None:
    init_db()


class IngredientIn(BaseModel):
    name: str
    category: str = "其他"
    unit: str = "g"
    total_quantity: float = Field(default=0, ge=0)
    remaining_quantity: float = Field(default=0, ge=0)
    purchase_date: str | None = None
    expiration_date: str | None = None
    is_opened: bool = False
    opened_date: str | None = None
    location: str = "冷藏"
    notes: str = ""
    image_path: str | None = None


class UsageConfirm(BaseModel):
    usages: list[dict[str, Any]]


class QuantityUpdate(BaseModel):
    remaining_quantity: float = Field(ge=0)


class MealUpdate(BaseModel):
    meal_date: str
    meal_type: str
    description: str = ""


def row_to_ingredient(row: sqlite3.Row) -> dict[str, Any]:
    item = dict(row)
    item["is_opened"] = bool(item["is_opened"])
    item["days_until_expiry"] = days_until(item.get("expiration_date"))
    item["is_expiring_soon"] = item["days_until_expiry"] is not None and item["days_until_expiry"] <= 3
    item["is_low_stock"] = item["total_quantity"] > 0 and item["remaining_quantity"] / item["total_quantity"] <= 0.25
    return item


def days_until(value: str | None) -> int | None:
    if not value:
        return None
    try:
        return (date.fromisoformat(value) - date.today()).days
    except ValueError:
        return None


def save_upload(upload: UploadFile, folder: str) -> str:
    suffix = Path(upload.filename or "upload.jpg").suffix.lower() or ".jpg"
    name = f"{uuid.uuid4().hex}{suffix}"
    target = UPLOAD_DIR / folder / name
    with target.open("wb") as out:
        shutil.copyfileobj(upload.file, out)
    return f"/uploads/{folder}/{name}"


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "database": str(DB_PATH),
        "openai_configured": bool(os.getenv("OPENAI_API_KEY")),
    }


@app.get("/api/summary")
def summary() -> dict[str, Any]:
    with get_db() as conn:
        ingredients = [row_to_ingredient(row) for row in conn.execute("SELECT * FROM ingredients ORDER BY expiration_date IS NULL, expiration_date")]
    return {
        "total_items": len(ingredients),
        "expiring_soon": sum(1 for item in ingredients if item["is_expiring_soon"]),
        "opened_items": sum(1 for item in ingredients if item["is_opened"]),
        "low_stock": sum(1 for item in ingredients if item["is_low_stock"]),
        "urgent": [item for item in ingredients if item["is_expiring_soon"] or item["is_low_stock"]][:6],
    }


@app.get("/api/ingredients")
def list_ingredients() -> list[dict[str, Any]]:
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM ingredients ORDER BY expiration_date IS NULL, expiration_date, name").fetchall()
    return [row_to_ingredient(row) for row in rows]


@app.post("/api/ingredients")
def create_ingredient(payload: IngredientIn) -> dict[str, Any]:
    now = datetime.utcnow().isoformat()
    with get_db() as conn:
        existing = conn.execute(
            "SELECT * FROM ingredients WHERE lower(name)=lower(?) ORDER BY id LIMIT 1",
            (payload.name.strip(),),
        ).fetchone()
        if existing:
            conn.execute(
                """
                UPDATE ingredients
                SET category=?, total_quantity=total_quantity + ?, remaining_quantity=remaining_quantity + ?,
                    purchase_date=?, expiration_date=?, is_opened=?, opened_date=?, location=?, notes=?, image_path=COALESCE(?, image_path), updated_at=?
                WHERE id=?
                """,
                (
                    payload.category,
                    payload.total_quantity,
                    payload.remaining_quantity,
                    payload.purchase_date,
                    payload.expiration_date or existing["expiration_date"],
                    int(payload.is_opened),
                    payload.opened_date,
                    payload.location,
                    payload.notes or existing["notes"],
                    payload.image_path,
                    now,
                    existing["id"],
                ),
            )
            row = conn.execute("SELECT * FROM ingredients WHERE id = ?", (existing["id"],)).fetchone()
            return row_to_ingredient(row)
        cur = conn.execute(
            """
            INSERT INTO ingredients
            (name, category, unit, total_quantity, remaining_quantity, purchase_date, expiration_date, is_opened, opened_date, location, notes, image_path, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                payload.name,
                payload.category,
                payload.unit,
                payload.total_quantity,
                payload.remaining_quantity,
                payload.purchase_date,
                payload.expiration_date,
                int(payload.is_opened),
                payload.opened_date,
                payload.location,
                payload.notes,
                payload.image_path,
                now,
                now,
            ),
        )
        row = conn.execute("SELECT * FROM ingredients WHERE id = ?", (cur.lastrowid,)).fetchone()
    return row_to_ingredient(row)


@app.put("/api/ingredients/{ingredient_id}")
def update_ingredient(ingredient_id: int, payload: IngredientIn) -> dict[str, Any]:
    now = datetime.utcnow().isoformat()
    with get_db() as conn:
        conn.execute(
            """
            UPDATE ingredients
            SET name=?, category=?, unit=?, total_quantity=?, remaining_quantity=?, purchase_date=?, expiration_date=?, is_opened=?,
                opened_date=?, location=?, notes=?, image_path=?, updated_at=?
            WHERE id=?
            """,
            (
                payload.name,
                payload.category,
                payload.unit,
                payload.total_quantity,
                payload.remaining_quantity,
                payload.purchase_date,
                payload.expiration_date,
                int(payload.is_opened),
                payload.opened_date,
                payload.location,
                payload.notes,
                payload.image_path,
                now,
                ingredient_id,
            ),
        )
        row = conn.execute("SELECT * FROM ingredients WHERE id = ?", (ingredient_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "找不到食材")
    return row_to_ingredient(row)


@app.delete("/api/ingredients/{ingredient_id}")
def delete_ingredient(ingredient_id: int) -> dict[str, bool]:
    with get_db() as conn:
        cur = conn.execute("DELETE FROM ingredients WHERE id = ?", (ingredient_id,))
    if cur.rowcount == 0:
        raise HTTPException(404, "找不到食材")
    return {"ok": True}


@app.patch("/api/ingredients/{ingredient_id}/quantity")
def update_ingredient_quantity(ingredient_id: int, payload: QuantityUpdate) -> dict[str, Any]:
    with get_db() as conn:
        conn.execute(
            "UPDATE ingredients SET remaining_quantity=?, updated_at=? WHERE id=?",
            (payload.remaining_quantity, datetime.utcnow().isoformat(), ingredient_id),
        )
        row = conn.execute("SELECT * FROM ingredients WHERE id = ?", (ingredient_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "找不到食材")
    return row_to_ingredient(row)


@app.get("/api/meals")
def list_meals() -> list[dict[str, Any]]:
    with get_db() as conn:
        meals = conn.execute("SELECT * FROM meal_logs ORDER BY meal_date DESC, id DESC LIMIT 50").fetchall()
        output = []
        for meal in meals:
            usages = conn.execute("SELECT * FROM ingredient_usages WHERE meal_id = ?", (meal["id"],)).fetchall()
            item = dict(meal)
            item["ai_result"] = json.loads(item["ai_result"]) if item["ai_result"] else None
            item["usages"] = [dict(row) for row in usages]
            output.append(item)
    return output


@app.post("/api/meals")
def create_meal(
    meal_date: str = Form(...),
    meal_type: str = Form(...),
    description: str = Form(""),
    image: UploadFile | None = File(None),
) -> dict[str, Any]:
    image_path = save_upload(image, "meals") if image else None
    now = datetime.utcnow().isoformat()
    with get_db() as conn:
        cur = conn.execute(
            """
            INSERT INTO meal_logs (meal_date, meal_type, description, image_path, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (meal_date, meal_type, description, image_path, now, now),
        )
        row = conn.execute("SELECT * FROM meal_logs WHERE id = ?", (cur.lastrowid,)).fetchone()
    return {**dict(row), "ai_result": None, "usages": []}


@app.put("/api/meals/{meal_id}")
def update_meal(meal_id: int, payload: MealUpdate) -> dict[str, Any]:
    with get_db() as conn:
        conn.execute(
            """
            UPDATE meal_logs
            SET meal_date=?, meal_type=?, description=?, updated_at=?
            WHERE id=?
            """,
            (payload.meal_date, payload.meal_type, payload.description, datetime.utcnow().isoformat(), meal_id),
        )
        row = conn.execute("SELECT * FROM meal_logs WHERE id = ?", (meal_id,)).fetchone()
        usages = conn.execute("SELECT * FROM ingredient_usages WHERE meal_id = ?", (meal_id,)).fetchall() if row else []
    if row is None:
        raise HTTPException(404, "找不到餐點紀錄")
    item = dict(row)
    item["ai_result"] = json.loads(item["ai_result"]) if item["ai_result"] else None
    item["usages"] = [dict(usage) for usage in usages]
    return item


@app.delete("/api/meals/{meal_id}")
def delete_meal(meal_id: int) -> dict[str, bool]:
    with get_db() as conn:
        cur = conn.execute("DELETE FROM meal_logs WHERE id = ?", (meal_id,))
    if cur.rowcount == 0:
        raise HTTPException(404, "找不到餐點紀錄")
    return {"ok": True}


@app.post("/api/meals/{meal_id}/analyze")
def analyze_meal(meal_id: int) -> dict[str, Any]:
    with get_db() as conn:
        meal = conn.execute("SELECT * FROM meal_logs WHERE id = ?", (meal_id,)).fetchone()
        inventory = [row_to_ingredient(row) for row in conn.execute("SELECT * FROM ingredients").fetchall()]
    if not meal:
        raise HTTPException(404, "找不到餐點紀錄")
    result = call_openai_meal_analysis(dict(meal), inventory)
    with get_db() as conn:
        conn.execute("UPDATE meal_logs SET ai_result=?, updated_at=? WHERE id=?", (json.dumps(result, ensure_ascii=False), datetime.utcnow().isoformat(), meal_id))
        conn.execute("DELETE FROM ingredient_usages WHERE meal_id=? AND confirmed=0", (meal_id,))
        for usage in result.get("ingredient_usages", []):
            conn.execute(
                """
                INSERT INTO ingredient_usages
                (meal_id, ingredient_id, ingredient_name, quantity, unit, confidence, confirmed, created_at)
                VALUES (?, ?, ?, ?, ?, ?, 0, ?)
                """,
                (
                    meal_id,
                    usage.get("ingredient_id"),
                    usage.get("ingredient_name", ""),
                    float(usage.get("quantity") or 0),
                    usage.get("unit", "g"),
                    float(usage.get("confidence") or 0),
                    datetime.utcnow().isoformat(),
                ),
            )
    return result


@app.post("/api/meals/{meal_id}/confirm-usages")
def confirm_usages(meal_id: int, payload: UsageConfirm) -> dict[str, Any]:
    with get_db() as conn:
        meal = conn.execute("SELECT * FROM meal_logs WHERE id = ?", (meal_id,)).fetchone()
        if not meal:
            raise HTTPException(404, "找不到餐點紀錄")
        conn.execute("DELETE FROM ingredient_usages WHERE meal_id=? AND confirmed=0", (meal_id,))
        for usage in payload.usages:
            ingredient_id = usage.get("ingredient_id")
            quantity = float(usage.get("quantity") or 0)
            if ingredient_id and quantity > 0:
                conn.execute(
                    "UPDATE ingredients SET remaining_quantity = MAX(0, remaining_quantity - ?), updated_at=? WHERE id=?",
                    (quantity, datetime.utcnow().isoformat(), ingredient_id),
                )
            conn.execute(
                """
                INSERT INTO ingredient_usages
                (meal_id, ingredient_id, ingredient_name, quantity, unit, confidence, confirmed, created_at)
                VALUES (?, ?, ?, ?, ?, ?, 1, ?)
                """,
                (
                    meal_id,
                    ingredient_id,
                    usage.get("ingredient_name", ""),
                    quantity,
                    usage.get("unit", "g"),
                    float(usage.get("confidence") or 0),
                    datetime.utcnow().isoformat(),
                ),
            )
    return {"ok": True}


@app.get("/api/usage/weekly")
def weekly_usage() -> dict[str, Any]:
    week_start = date.today() - timedelta(days=date.today().weekday())
    week_end = week_start + timedelta(days=6)
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT iu.ingredient_name, iu.unit, SUM(iu.quantity) AS quantity, COUNT(*) AS uses
            FROM ingredient_usages iu
            JOIN meal_logs m ON m.id = iu.meal_id
            WHERE iu.confirmed = 1 AND m.meal_date BETWEEN ? AND ?
            GROUP BY iu.ingredient_name, iu.unit
            ORDER BY quantity DESC
            """,
            (week_start.isoformat(), week_end.isoformat()),
        ).fetchall()
    return {
        "week_start": week_start.isoformat(),
        "week_end": week_end.isoformat(),
        "items": [dict(row) for row in rows],
    }


@app.post("/api/ai/analyze-ingredient")
def analyze_ingredient(image: UploadFile | None = File(None), text: str = Form("")) -> dict[str, Any]:
    image_path = save_upload(image, "ingredients") if image else None
    return call_openai_ingredient_analysis(text, image_path)


@app.post("/api/weekly-plan")
def weekly_plan() -> dict[str, Any]:
    with get_db() as conn:
        inventory = [row_to_ingredient(row) for row in conn.execute("SELECT * FROM ingredients").fetchall()]
        meals = [dict(row) for row in conn.execute("SELECT meal_date, meal_type, description, ai_result FROM meal_logs ORDER BY meal_date DESC LIMIT 21").fetchall()]
    result = call_openai_weekly_plan(inventory, meals)
    with get_db() as conn:
        conn.execute(
            "INSERT INTO weekly_plans (week_start, plan_json, created_at) VALUES (?, ?, ?)",
            (date.today().isoformat(), json.dumps(result, ensure_ascii=False), datetime.utcnow().isoformat()),
        )
    return result


@app.get("/api/weekly-plan/latest")
def latest_weekly_plan() -> dict[str, Any] | None:
    with get_db() as conn:
        row = conn.execute("SELECT * FROM weekly_plans ORDER BY id DESC LIMIT 1").fetchone()
    if not row:
        return fallback_weekly_plan([], [])
    return json.loads(row["plan_json"])


def require_openai() -> OpenAI:
    if not os.getenv("OPENAI_API_KEY"):
        raise HTTPException(400, "尚未設定 OPENAI_API_KEY；手動紀錄仍可使用，AI 功能暫停。")
    return OpenAI()


def image_to_data_url(image_path: str | None) -> str | None:
    if not image_path:
        return None
    path = ROOT / image_path.lstrip("/")
    if not path.exists():
        return None
    mime = "image/png" if path.suffix.lower() == ".png" else "image/jpeg"
    data = base64.b64encode(path.read_bytes()).decode("utf-8")
    return f"data:{mime};base64,{data}"


def parse_json_output(response: Any) -> dict[str, Any]:
    text = getattr(response, "output_text", "")
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise HTTPException(502, f"AI 回傳格式不是有效 JSON：{exc}") from exc


def call_openai_meal_analysis(meal: dict[str, Any], inventory: list[dict[str, Any]]) -> dict[str, Any]:
    client = require_openai()
    content: list[dict[str, Any]] = [
        {
            "type": "input_text",
            "text": (
                "請根據餐點描述/照片與現有庫存，推測餐點名稱、可能使用食材與大約用量。"
                "只輸出 JSON，ingredient_id 必須盡量對應庫存 id；不確定就用 null。"
                f"\n餐點：{meal.get('meal_type')} {meal.get('description')}"
                f"\n庫存：{json.dumps(inventory, ensure_ascii=False)}"
            ),
        }
    ]
    data_url = image_to_data_url(meal.get("image_path"))
    if data_url:
        content.append({"type": "input_image", "image_url": data_url})
    response = client.responses.create(
        model=OPENAI_MODEL,
        input=[{"role": "user", "content": content}],
        text={
            "format": {
                "type": "json_schema",
                "name": "meal_analysis",
                "schema": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "dish_name": {"type": "string"},
                        "summary": {"type": "string"},
                        "ingredient_usages": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "additionalProperties": False,
                                "properties": {
                                    "ingredient_id": {"anyOf": [{"type": "integer"}, {"type": "null"}]},
                                    "ingredient_name": {"type": "string"},
                                    "quantity": {"type": "number"},
                                    "unit": {"type": "string"},
                                    "confidence": {"type": "number"},
                                },
                                "required": ["ingredient_id", "ingredient_name", "quantity", "unit", "confidence"],
                            },
                        },
                    },
                    "required": ["dish_name", "summary", "ingredient_usages"],
                },
                "strict": True,
            }
        },
    )
    return parse_json_output(response)


def call_openai_ingredient_analysis(text: str, image_path: str | None) -> dict[str, Any]:
    client = require_openai()
    content: list[dict[str, Any]] = [
        {
            "type": "input_text",
            "text": "請根據食材照片或文字，建議食材資料。只輸出 JSON。保存期限是建議值，不代表食品安全判斷。文字：" + text,
        }
    ]
    data_url = image_to_data_url(image_path)
    if data_url:
        content.append({"type": "input_image", "image_url": data_url})
    response = client.responses.create(
        model=OPENAI_MODEL,
        input=[{"role": "user", "content": content}],
        text={
            "format": {
                "type": "json_schema",
                "name": "ingredient_suggestion",
                "schema": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "name": {"type": "string"},
                        "category": {"type": "string"},
                        "unit": {"type": "string"},
                        "estimated_quantity": {"type": "number"},
                        "suggested_expiration_date": {"type": "string"},
                        "is_opened": {"type": "boolean"},
                        "storage": {"type": "string"},
                        "notes": {"type": "string"},
                        "image_path": {"anyOf": [{"type": "string"}, {"type": "null"}]},
                    },
                    "required": ["name", "category", "unit", "estimated_quantity", "suggested_expiration_date", "is_opened", "storage", "notes", "image_path"],
                },
                "strict": True,
            }
        },
    )
    result = parse_json_output(response)
    result["image_path"] = image_path
    return result


def call_openai_weekly_plan(inventory: list[dict[str, Any]], meals: list[dict[str, Any]]) -> dict[str, Any]:
    available = [
        {
            "id": item["id"],
            "name": item["name"],
            "category": item["category"],
            "remaining_quantity": item["remaining_quantity"],
            "unit": item["unit"],
            "days_until_expiry": item["days_until_expiry"],
            "is_opened": item["is_opened"],
        }
        for item in inventory
        if item.get("remaining_quantity", 0) > 0
    ]
    if not os.getenv("OPENAI_API_KEY"):
        return fallback_weekly_plan(available, meals)
    client = OpenAI()
    response = client.responses.create(
        model=OPENAI_MODEL,
        input=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_text",
                        "text": (
                            "請根據目前庫存規劃未來 7 天早中晚餐。嚴格限制："
                            "1) 只能使用 available_inventory 裡 name 完全相同的食材；"
                            "2) 不可以新增、假設、替代、推薦任何不在清單內的食材、調味料或配料；"
                            "3) 每餐 ingredients 陣列必須列出會用到的庫存食材 name；"
                            "4) meal title 也只能由這些庫存食材組合描述，不可出現清單外食材；"
                            "5) 優先使用 days_until_expiry <= 3 或 is_opened=true 的食材。"
                            "6) 參考近期餐點，前一天或最近兩餐已吃過的主食/菜色，隔天不要立刻重複；"
                            "7) 早餐要符合一般早餐邏輯，優先蛋奶、水果、飲品、輕主食；避免煎餃、義大利麵、重口味肉類餐作為早餐；"
                            "8) 午餐與晚餐可使用較完整的肉類、海鮮、主食搭配，但也要避免連續兩天高度重複。"
                            "只輸出 JSON。"
                            f"\navailable_inventory：{json.dumps(available, ensure_ascii=False)}"
                            f"\n近期餐點：{json.dumps(meals, ensure_ascii=False)}"
                        ),
                    }
                ],
            }
        ],
        text={
            "format": {
                "type": "json_schema",
                "name": "weekly_plan",
                "schema": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "strategy": {"type": "string"},
                        "priority_ingredients": {"type": "array", "items": {"type": "string"}},
                        "days": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "additionalProperties": False,
                                "properties": {
                                    "day": {"type": "string"},
                                    "breakfast": {"$ref": "#/$defs/meal"},
                                    "lunch": {"$ref": "#/$defs/meal"},
                                    "dinner": {"$ref": "#/$defs/meal"},
                                    "use_first": {"type": "array", "items": {"type": "string"}},
                                },
                                "required": ["day", "breakfast", "lunch", "dinner", "use_first"],
                            },
                        },
                    },
                    "$defs": {
                        "meal": {
                            "type": "object",
                            "additionalProperties": False,
                            "properties": {
                                "title": {"type": "string"},
                                "ingredients": {"type": "array", "items": {"type": "string"}},
                            },
                            "required": ["title", "ingredients"],
                        }
                    },
                    "required": ["strategy", "priority_ingredients", "days"],
                },
                "strict": True,
            }
        },
    )
    return sanitize_weekly_plan(parse_json_output(response), available)


def fallback_weekly_plan(inventory: list[dict[str, Any]], meals: list[dict[str, Any]]) -> dict[str, Any]:
    priority = [
        item["name"]
        for item in sorted(
            inventory,
            key=lambda x: (x["days_until_expiry"] is None, x["days_until_expiry"] if x["days_until_expiry"] is not None else 999, not x["is_opened"]),
        )
        if item.get("remaining_quantity", 0) > 0
    ][:5]
    staples = priority or [item["name"] for item in inventory[:3]]
    breakfast_pool = [
        item["name"]
        for item in inventory
        if item["category"] in {"蛋奶", "水果", "飲品"} or any(key in item["name"] for key in ["蛋", "牛奶", "奶", "優格", "水果"])
    ]
    if not breakfast_pool:
        breakfast_pool = [name for name in staples if not any(key in name for key in ["煎餃", "義大利麵", "麵", "披薩"])] or staples[:1]
    lunch_dinner_pool = staples or [item["name"] for item in inventory]
    days = []
    for idx in range(7):
        breakfast = [breakfast_pool[idx % len(breakfast_pool)]] if breakfast_pool else []
        day_ingredients = [lunch_dinner_pool[(idx + offset) % len(lunch_dinner_pool)] for offset in range(min(3, len(lunch_dinner_pool)))] if lunch_dinner_pool else []
        lunch = day_ingredients[:2]
        dinner = day_ingredients[1:3] or day_ingredients
        focus = breakfast[0] if breakfast else "目前無庫存"
        days.append(
            {
                "day": f"Day {idx + 1}",
                "breakfast": {"title": f"{focus} 早餐", "ingredients": breakfast},
                "lunch": {"title": f"{'、'.join(lunch)} 午餐", "ingredients": lunch},
                "dinner": {"title": f"{'、'.join(dinner)} 晚餐", "ingredients": dinner},
                "use_first": list(dict.fromkeys(day_ingredients + breakfast)),
            }
        )
    return {
        "strategy": "未設定 OpenAI API key，先用本機規則產生：優先消耗快過期、已開封與低庫存食材。",
        "priority_ingredients": priority,
        "days": days,
    }


def sanitize_weekly_plan(plan: dict[str, Any], inventory: list[dict[str, Any]]) -> dict[str, Any]:
    allowed = {item["name"] for item in inventory if item.get("remaining_quantity", 0) > 0}
    breakfast_candidates = [
        item["name"]
        for item in inventory
        if item["name"] in allowed and (
            item.get("category") in {"蛋奶", "水果", "飲品"}
            or any(key in item["name"] for key in ["蛋", "牛奶", "鮮奶", "奶", "優格", "水果", "蘋果", "香蕉"])
        )
    ]
    forbidden_breakfast = ["煎餃", "義大利麵", "拉麵", "披薩", "牛排", "豬肉片", "牛肉片", "豬絞肉"]
    if not breakfast_candidates:
        breakfast_candidates = [
            item["name"]
            for item in inventory
            if item["name"] in allowed and not any(key in item["name"] for key in forbidden_breakfast)
        ][:3]
    plan["priority_ingredients"] = [name for name in plan.get("priority_ingredients", []) if name in allowed]
    previous_titles: set[str] = set()
    for day_index, day in enumerate(plan.get("days", [])):
        day["use_first"] = [name for name in day.get("use_first", []) if name in allowed]
        for slot in ("breakfast", "lunch", "dinner"):
            meal = day.get(slot)
            if isinstance(meal, str):
                matched = [name for name in allowed if name in meal]
                day[slot] = {"title": "、".join(matched) if matched else "庫存食材餐", "ingredients": matched}
                continue
            ingredients = [name for name in meal.get("ingredients", []) if name in allowed]
            if not ingredients:
                ingredients = day["use_first"][:1] or plan["priority_ingredients"][:1]
            if slot == "breakfast":
                if breakfast_candidates:
                    breakfast_allowed = set(breakfast_candidates)
                    ingredients = [ingredient for ingredient in ingredients if ingredient in breakfast_allowed]
                if (
                    any(any(key in ingredient for key in forbidden_breakfast) for ingredient in ingredients)
                    or not ingredients
                ):
                    replacement = breakfast_candidates[day_index % len(breakfast_candidates)] if breakfast_candidates else None
                    ingredients = [replacement] if replacement else ingredients
            title = "、".join(ingredients) if ingredients else "目前無可用庫存"
            if title in previous_titles and len(allowed) > len(ingredients):
                alternative_pool = breakfast_candidates if slot == "breakfast" and breakfast_candidates else list(allowed)
                alternative = next((name for name in alternative_pool if name not in ingredients and name not in title), None)
                if alternative:
                    ingredients = [alternative] + ingredients[:1]
                    title = "、".join(ingredients)
            day[slot] = {"title": title, "ingredients": ingredients}
            previous_titles.add(title)
    return plan


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=False)
