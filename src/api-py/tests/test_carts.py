from __future__ import annotations

import asyncio
from pathlib import Path
import sqlite3
from uuid import uuid4

import aiosqlite
import pytest
from fastapi.testclient import TestClient

from main import app


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    source_root = Path(__file__).resolve().parents[2]
    monkeypatch.setenv("DB_FILE", str(tmp_path / "carts.db"))
    monkeypatch.setenv("DB_MIGRATIONS_DIR", str(source_root / "database" / "migrations"))
    with TestClient(app, raise_server_exceptions=False) as test_client:
        yield test_client


def delivery() -> dict[str, str]:
    return {
        "name": "  Ada Cat  ",
        "email": " ada@example.com ",
        "address": " 1 Cat Lane ",
        "city": " Meowtown ",
        "postalCode": " 12345 ",
        "country": " Catland ",
    }


def checkout_payload(
    cart: dict[str, object],
    *,
    checkout_id: str | None = None,
    **updates: object,
) -> dict[str, object]:
    return {
        "checkoutId": checkout_id or str(uuid4()),
        "expectedVersion": cart["version"],
        "expectedTotalCents": cart["totalCents"],
        "branchId": 1,
        "delivery": delivery(),
        **updates,
    }


def test_cart_persists_across_tabs_and_mutations_return_authoritative_prices(
    client: TestClient, tmp_path: Path
) -> None:
    cart_id = str(uuid4())

    empty = client.get(f"/api/carts/{cart_id}").json()
    assert empty == {
        "cartId": cart_id,
        "version": 0,
        "items": [],
        "totalCents": 0,
        "itemCount": 0,
    }
    with sqlite3.connect(tmp_path / "carts.db") as connection:
        assert connection.execute("SELECT COUNT(*) FROM carts WHERE cart_id = ?", (cart_id,)).fetchone()[0] == 0
    added = client.post(
        f"/api/carts/{cart_id}/items",
        json={"productId": 1, "quantity": 2},
    )
    assert added.status_code == 200
    expected_item = {
        "productId": 1,
        "name": "SmartFeeder One",
        "imgName": "feeder.png",
        "quantity": 2,
        "unitPriceCents": 9749,
        "lineTotalCents": 19498,
    }
    assert added.json()["items"] == [expected_item]
    assert added.json()["version"] == 1

    other_tab = client.get(f"/api/carts/{cart_id}").json()
    assert other_tab == added.json()
    increased = client.post(
        f"/api/carts/{cart_id}/items",
        json={"productId": 1, "quantity": 3},
    ).json()
    assert increased["items"][0]["quantity"] == 5
    assert increased["version"] == 2

    updated = client.put(
        f"/api/carts/{cart_id}/items/1",
        json={"quantity": 4},
    ).json()
    assert updated["items"][0]["quantity"] == 4
    assert updated["version"] == 3
    removed = client.delete(f"/api/carts/{cart_id}/items/1").json()
    assert removed["items"] == []
    assert removed["version"] == 4


def test_cart_validation_and_missing_entities(client: TestClient) -> None:
    cart_id = str(uuid4())
    assert client.get("/api/carts/not-a-uuid").status_code == 400
    for quantity in (0, 1000, True, 1.5, "2"):
        response = client.post(
            f"/api/carts/{cart_id}/items",
            json={"productId": 1, "quantity": quantity},
        )
        assert response.status_code == 422
    assert client.post(
        f"/api/carts/{cart_id}/items",
        json={"productId": 9999, "quantity": 1},
    ).status_code == 404
    assert client.put(
        f"/api/carts/{cart_id}/items/1",
        json={"quantity": 1},
    ).status_code == 404
    assert client.delete(f"/api/carts/{cart_id}/items/1").status_code == 404
    assert client.post(
        f"/api/carts/{cart_id}/checkout",
        json=checkout_payload(
            {"version": 0, "totalCents": 0},
            checkout_id=str(uuid4()),
            delivery={**delivery(), "email": "not-an-email"},
        ),
    ).status_code == 422


def test_checkout_is_atomic_idempotent_and_confirmation_is_persistent(
    client: TestClient, tmp_path: Path
) -> None:
    cart_id = str(uuid4())
    client.post(
        f"/api/carts/{cart_id}/items",
        json={"productId": 1, "quantity": 2},
    )
    cart = client.get(f"/api/carts/{cart_id}").json()
    checkout_id = str(uuid4())
    payload = checkout_payload(cart, checkout_id=checkout_id)
    first = client.post(f"/api/carts/{cart_id}/checkout", json=payload)

    assert first.status_code == 201
    receipt = first.json()
    assert receipt["checkoutId"] == checkout_id
    assert receipt["cartId"] == cart_id
    assert receipt["orderId"] > 0
    assert receipt["totalCents"] == cart["totalCents"]
    assert receipt["itemCount"] == 2
    assert receipt["delivery"] == {
        "name": "Ada Cat",
        "email": "ada@example.com",
        "address": "1 Cat Lane",
        "city": "Meowtown",
        "postalCode": "12345",
        "country": "Catland",
    }
    assert client.get(f"/api/carts/{cart_id}").json()["version"] == 2
    assert client.get(f"/api/carts/{cart_id}").json()["items"] == []

    retry = client.post(f"/api/carts/{cart_id}/checkout", json=payload)
    confirmation = client.get(f"/api/carts/{cart_id}/checkouts/{checkout_id}")
    assert retry.json() == receipt
    assert confirmation.json() == receipt

    async def order_rows() -> tuple[list[aiosqlite.Row], list[aiosqlite.Row]]:
        async with aiosqlite.connect(tmp_path / "carts.db") as connection:
            orders = await (await connection.execute("SELECT order_id FROM orders")).fetchall()
            details = await (
                await connection.execute(
                    "SELECT product_id, quantity, unit_price, notes FROM order_details WHERE order_id = ?",
                    (receipt["orderId"],),
                )
            ).fetchall()
        return orders, details

    orders, details = asyncio.run(order_rows())
    assert len(orders) == 1
    assert len(details) == 1
    assert details[0][0:2] == (1, 2)
    assert details[0][2] == pytest.approx(97.49)
    assert details[0][3] == ""


def test_checkout_rejects_stale_empty_invalid_and_conflicting_requests(client: TestClient) -> None:
    cart_id = str(uuid4())
    assert client.post(
        f"/api/carts/{cart_id}/checkout",
        json=checkout_payload(
            {"version": 0, "totalCents": 0},
            checkout_id=str(uuid4()),
        ),
    ).status_code == 409

    client.post(
        f"/api/carts/{cart_id}/items",
        json={"productId": 1, "quantity": 1},
    )
    cart = client.get(f"/api/carts/{cart_id}").json()
    stale = checkout_payload(cart)
    stale["expectedVersion"] = 0
    assert client.post(f"/api/carts/{cart_id}/checkout", json=stale).status_code == 409
    assert client.post(
        f"/api/carts/{cart_id}/checkout",
        json=checkout_payload(cart, branchId=999),
    ).status_code == 404

    checkout_id = str(uuid4())
    successful = client.post(
        f"/api/carts/{cart_id}/checkout",
        json=checkout_payload(cart, checkout_id=checkout_id),
    ).json()
    second_cart_id = str(uuid4())
    second_cart = client.post(
        f"/api/carts/{second_cart_id}/items",
        json={"productId": 1, "quantity": 1},
    ).json()
    conflict = client.post(
        f"/api/carts/{second_cart_id}/checkout",
        json=checkout_payload(second_cart, checkout_id=checkout_id),
    )
    assert conflict.status_code == 409
    assert client.get(f"/api/carts/{cart_id}/checkouts/{successful['checkoutId']}").status_code == 200
    assert client.get(f"/api/carts/{cart_id}/checkouts/{uuid4()}").status_code == 404


def test_checkout_rolls_back_order_when_order_detail_insert_fails(
    client: TestClient, tmp_path: Path
) -> None:
    cart_id = str(uuid4())
    client.post(
        f"/api/carts/{cart_id}/items",
        json={"productId": 1, "quantity": 1},
    )
    cart = client.get(f"/api/carts/{cart_id}").json()

    async def install_failing_trigger() -> None:
        async with aiosqlite.connect(tmp_path / "carts.db") as connection:
            await connection.execute(
                """
                CREATE TRIGGER reject_cart_order_detail
                BEFORE INSERT ON order_details
                BEGIN
                    SELECT RAISE(ABORT, 'test order detail failure');
                END;
                """
            )
            await connection.commit()

    asyncio.run(install_failing_trigger())
    response = client.post(
        f"/api/carts/{cart_id}/checkout",
        json=checkout_payload(cart),
    )
    assert response.status_code == 500
    assert client.get(f"/api/carts/{cart_id}").json() == cart

    async def persisted_counts() -> tuple[int, int]:
        async with aiosqlite.connect(tmp_path / "carts.db") as connection:
            orders = (await (await connection.execute("SELECT COUNT(*) FROM orders")).fetchone())[0]
            checkouts = (await (await connection.execute("SELECT COUNT(*) FROM cart_checkouts")).fetchone())[0]
        return orders, checkouts

    assert asyncio.run(persisted_counts()) == (0, 0)


def test_price_rounding_uses_half_up_cents(client: TestClient, tmp_path: Path) -> None:
    async def set_rounding_price() -> None:
        async with aiosqlite.connect(tmp_path / "carts.db") as connection:
            await connection.execute(
                "UPDATE products SET price = 1.005, discount = 0 WHERE product_id = 3"
            )
            await connection.commit()

    asyncio.run(set_rounding_price())
    response = client.post(
        f"/api/carts/{uuid4()}/items",
        json={"productId": 3, "quantity": 1},
    )
    assert response.status_code == 200
    assert response.json()["items"][0]["unitPriceCents"] == 101


def test_invalid_catalog_pricing_is_rejected(client: TestClient, tmp_path: Path) -> None:
    async def corrupt_discount() -> None:
        async with aiosqlite.connect(tmp_path / "carts.db") as connection:
            await connection.execute("UPDATE products SET discount = 1.5 WHERE product_id = 1")
            await connection.commit()

    asyncio.run(corrupt_discount())
    response = client.post(
        f"/api/carts/{uuid4()}/items",
        json={"productId": 1, "quantity": 1},
    )
    assert response.status_code == 500
