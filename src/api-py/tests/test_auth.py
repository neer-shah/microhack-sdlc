from __future__ import annotations

import hashlib
import sqlite3
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from models.cart import CheckoutReceipt
from repositories.auth import COOKIE_NAME, hash_password, token_hash, verify_password
from test_carts import checkout_payload

PASSWORD = "correct horse battery staple"


def register(client: TestClient, email: str = "ada@example.com", **updates: object) -> dict:
    response = client.post(
        "/api/auth/register",
        json={"name": " Ada Cat ", "email": email, "password": PASSWORD, **updates},
    )
    assert response.status_code == 201, response.text
    return response.json()


def login(client: TestClient, email: str = "ada@example.com", **updates: object):
    return client.post("/api/auth/login", json={"email": email, "password": PASSWORD, **updates})


def add(client: TestClient, cart_id: str, quantity: int = 1, product_id: int = 1) -> dict:
    response = client.post(
        f"/api/carts/{cart_id}/items", json={"productId": product_id, "quantity": quantity}
    )
    assert response.status_code == 200, response.text
    return response.json()


def place_order(client: TestClient, cart_id: str) -> dict:
    cart = add(client, cart_id)
    response = client.post(f"/api/carts/{cart_id}/checkout", json=checkout_payload(cart))
    assert response.status_code == 201, response.text
    return response.json()


def test_register_normalizes_and_stores_only_password_and_session_hashes(
    client: TestClient, tmp_path: Path
) -> None:
    response = client.post(
        "/api/auth/register",
        json={"name": " Ada Cat ", "email": " ADA@EXAMPLE.COM ", "password": PASSWORD},
    )
    assert response.status_code == 201
    result = response.json()
    assert result["user"] == {"userId": 1, "name": "Ada Cat", "email": "ada@example.com", "role": "customer"}
    cookie = response.headers["set-cookie"]
    assert "HttpOnly" in cookie and "SameSite=lax" in cookie and "Path=/api" in cookie
    assert "Max-Age=604800" in cookie and "Secure" not in cookie
    token = client.cookies.get(COOKIE_NAME)
    assert len(token) == 64
    with closing(sqlite3.connect(tmp_path / "carts.db")) as db, db:
        encoded = db.execute("SELECT password_hash FROM users").fetchone()[0]
        stored, expires = db.execute("SELECT token_hash, expires_at FROM auth_sessions").fetchone()
        assert db.execute("SELECT user_id FROM carts").fetchone()[0] == 1
    assert PASSWORD not in encoded and encoded.startswith("scrypt$")
    assert verify_password(PASSWORD, encoded)
    assert stored == token_hash(token) and stored != token
    assert 604795 <= expires - int(time.time()) <= 604800
    assert client.get("/api/auth/me").json() == result
    assert login(client, " ADA@EXAMPLE.COM ").json() == result
    assert client.post(
        "/api/auth/register", json={"name": "Other", "email": "Ada@example.com", "password": PASSWORD}
    ).status_code == 409


def test_password_encoding_matches_node_scrypt_and_does_not_trim() -> None:
    salt = bytes.fromhex("00112233445566778899aabbccddeeff")
    expected = hashlib.scrypt(PASSWORD.encode(), salt=salt, n=16384, r=8, p=1, dklen=64).hex()
    assert verify_password(PASSWORD, f"scrypt${salt.hex()}${expected}")
    assert not verify_password(" " + PASSWORD, f"scrypt${salt.hex()}${expected}")
    assert not verify_password(PASSWORD, "bad format")
    assert verify_password(" " + PASSWORD + " ", hash_password(" " + PASSWORD + " "))


@pytest.mark.parametrize(
    "updates",
    [
        {"role": "admin"}, {"userId": 1}, {"name": " "}, {"name": "n" * 121},
        {"name": 123}, {"email": "invalid"}, {"email": "a" * 245 + "@example.com"},
        {"password": "short"}, {"password": "p" * 129}, {"password": 123456789012},
        {"guestCartId": "not-a-uuid"}, {"guestCartId": str(uuid4()).upper()},
    ],
)
def test_registration_rejects_invalid_or_spoofed_fields(client: TestClient, updates: dict) -> None:
    response = client.post(
        "/api/auth/register", json={"name": "Ada", "email": "ada@example.com", "password": PASSWORD, **updates}
    )
    assert response.status_code == 422


def test_session_restores_revokes_and_expires(client: TestClient, tmp_path: Path) -> None:
    result = register(client)
    token = client.cookies.get(COOKIE_NAME)
    client.cookies.clear()
    assert client.get("/api/auth/me").status_code == 401
    client.cookies.set(COOKIE_NAME, token, path="/api")
    assert client.get("/api/auth/me").json() == result
    assert client.post("/api/auth/logout").status_code == 204
    assert client.get("/api/auth/me").status_code == 401
    client.cookies.set(COOKIE_NAME, token, path="/api")
    assert client.get("/api/auth/me").status_code == 401
    client.cookies.clear()
    assert login(client).status_code == 200
    with closing(sqlite3.connect(tmp_path / "carts.db")) as db, db:
        db.execute("UPDATE auth_sessions SET expires_at = ?", (int(time.time()) - 1,))
    assert client.get("/api/auth/me").status_code == 401
    response = client.post("/api/auth/logout")
    assert response.status_code == 204 and "Max-Age=0" in response.headers["set-cookie"]
    with closing(sqlite3.connect(tmp_path / "carts.db")) as db, db:
        assert db.execute("SELECT COUNT(*) FROM auth_sessions").fetchone()[0] == 0
    assert client.post("/api/auth/logout").status_code == 204


@pytest.mark.parametrize("variable", ["APP_ENV", "NODE_ENV"])
def test_production_session_cookie_is_secure(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, variable: str
) -> None:
    monkeypatch.setenv(variable, "production")
    response = client.post(
        "/api/auth/register", json={"name": "Ada", "email": "ada@example.com", "password": PASSWORD}
    )
    assert "Secure" in response.headers["set-cookie"]
    assert "Secure" in client.post("/api/auth/logout").headers["set-cookie"]


def test_login_is_generic_throttled_persistent_and_resets(
    client: TestClient, tmp_path: Path
) -> None:
    register(client)
    client.post("/api/auth/logout")
    wrong = login(client, password="wrong-password")
    missing = login(client, "missing@example.com")
    assert wrong.status_code == missing.status_code == 401
    assert wrong.json() == missing.json()
    assert login(client).status_code == 200
    client.post("/api/auth/logout")
    with closing(sqlite3.connect(tmp_path / "carts.db")) as db, db:
        assert db.execute(
            "SELECT COUNT(*) FROM auth_attempts WHERE attempt_key = ?",
            (token_hash("ada@example.com|testclient"),),
        ).fetchone()[0] == 0
    for _ in range(10):
        assert login(client, " ADA@example.com ", password="wrong-password").status_code == 401
    assert login(client).status_code == 429
    with closing(sqlite3.connect(tmp_path / "carts.db")) as db, db:
        assert db.execute(
            "SELECT attempts FROM auth_attempts WHERE attempt_key = ?",
            (token_hash("ada@example.com|testclient"),),
        ).fetchone()[0] == 10
        db.execute("UPDATE auth_attempts SET window_start = ?", (int(time.time()) - 901,))
    assert login(client).status_code == 200


def test_merge_sums_items_is_idempotent_and_tombstones_guest(client: TestClient, tmp_path: Path) -> None:
    guest = str(uuid4())
    add(client, guest, 2)
    account = register(client, guestCartId=guest)
    owned = account["cartId"]
    cart = client.get(f"/api/carts/{owned}").json()
    assert cart["items"][0]["quantity"] == 2 and cart["version"] == 1
    assert login(client, guestCartId=guest).json() == account
    assert client.get(f"/api/carts/{owned}").json() == cart
    with closing(sqlite3.connect(tmp_path / "carts.db")) as db, db:
        assert db.execute("SELECT merged_into, version FROM carts WHERE cart_id = ?", (guest,)).fetchone() == (owned, 2)
        assert db.execute("SELECT COUNT(*) FROM cart_items WHERE cart_id = ?", (guest,)).fetchone()[0] == 0
    client.post("/api/auth/logout")
    another_guest = str(uuid4())
    add(client, another_guest, 3)
    add(client, another_guest, 1, 2)
    assert login(client, guestCartId=another_guest).status_code == 200
    merged = client.get(f"/api/carts/{owned}").json()
    assert [item["quantity"] for item in merged["items"]] == [5, 1]
    for method, suffix, payload in [
        ("GET", "", None), ("POST", "/items", {"productId": 1, "quantity": 1}),
        ("PUT", "/items/1", {"quantity": 1}), ("DELETE", "/items/1", None),
        ("POST", "/checkout", checkout_payload(merged)),
    ]:
        assert client.request(method, f"/api/carts/{guest}{suffix}", json=payload).status_code == 404
    client.post("/api/auth/logout")
    assert client.get(f"/api/carts/{guest}").status_code == 404
    register(client, "other@example.com")
    assert login(client, "other@example.com", guestCartId=guest).status_code == 404


def test_merge_overflow_and_registration_failure_roll_back_everything(
    client: TestClient, tmp_path: Path
) -> None:
    owned = register(client)["cartId"]
    original = add(client, owned, 999)
    client.post("/api/auth/logout")
    guest = str(uuid4())
    before_guest = add(client, guest)
    assert login(client, guestCartId=guest).status_code == 409
    assert client.get("/api/auth/me").status_code == 401
    assert client.get(f"/api/carts/{guest}").json() == before_guest
    assert login(client).status_code == 200
    assert client.get(f"/api/carts/{owned}").json() == original
    client.post("/api/auth/logout")
    failed = client.post(
        "/api/auth/register",
        json={"name": "Other", "email": "other@example.com", "password": PASSWORD, "guestCartId": owned},
    )
    assert failed.status_code == 404
    with closing(sqlite3.connect(tmp_path / "carts.db")) as db, db:
        assert db.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 1
        assert db.execute("SELECT COUNT(*) FROM carts WHERE user_id IS NOT NULL").fetchone()[0] == 1
        assert db.execute("SELECT COUNT(*) FROM auth_sessions").fetchone()[0] == 0
    assert login(client, guestCartId=owned).status_code == 404
    assert login(client, guestCartId=str(uuid4())).status_code == 200


def test_login_recreates_missing_legacy_cart(client: TestClient, tmp_path: Path) -> None:
    old_cart = register(client)["cartId"]
    client.post("/api/auth/logout")
    with closing(sqlite3.connect(tmp_path / "carts.db")) as db, db:
        db.execute("DELETE FROM carts WHERE cart_id = ?", (old_cart,))
    response = login(client)
    assert response.status_code == 200
    assert response.json()["cartId"] != old_cart


def test_registration_session_failure_rolls_back_guest_merge(
    client: TestClient, tmp_path: Path
) -> None:
    guest = str(uuid4())
    before = add(client, guest, 2)
    with closing(sqlite3.connect(tmp_path / "carts.db")) as db, db:
        db.execute(
            """CREATE TRIGGER reject_session BEFORE INSERT ON auth_sessions
            BEGIN SELECT RAISE(ABORT, 'test session failure'); END;"""
        )
    response = client.post(
        "/api/auth/register",
        json={"name": "Ada", "email": "ada@example.com", "password": PASSWORD, "guestCartId": guest},
    )
    assert response.status_code == 500
    assert client.get("/api/auth/me").status_code == 401
    assert client.get(f"/api/carts/{guest}").json() == before
    with closing(sqlite3.connect(tmp_path / "carts.db")) as db:
        assert db.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0
        assert db.execute("SELECT COUNT(*) FROM carts WHERE user_id IS NOT NULL").fetchone()[0] == 0


def test_account_cart_mutations_require_owner_session(client: TestClient) -> None:
    cart_id = register(client)["cartId"]
    cart = add(client, cart_id)
    client.post("/api/auth/logout")
    for method, suffix, payload in [
        ("POST", "/items", {"productId": 1, "quantity": 1}),
        ("PUT", "/items/1", {"quantity": 2}),
        ("DELETE", "/items/1", None),
        ("POST", "/checkout", checkout_payload(cart)),
    ]:
        assert client.request(method, f"/api/carts/{cart_id}{suffix}", json=payload).status_code == 401
    assert login(client).status_code == 200
    assert client.get(f"/api/carts/{cart_id}").json() == cart


def test_old_guest_receipts_cannot_be_claimed(client: TestClient, tmp_path: Path) -> None:
    cart_id = register(client)["cartId"]
    receipt = place_order(client, cart_id)
    with closing(sqlite3.connect(tmp_path / "carts.db")) as db, db:
        db.execute("UPDATE orders SET user_id = NULL WHERE order_id = ?", (receipt["orderId"],))
    assert client.get("/api/me/orders").json() == []
    assert client.get(f"/api/me/orders/{receipt['orderId']}").status_code == 404
    assert client.get(f"/api/carts/{cart_id}/checkouts/{receipt['checkoutId']}").status_code == 404
    retry = client.post(
        f"/api/carts/{cart_id}/checkout",
        json=checkout_payload({"version": 1, "totalCents": receipt["totalCents"]}, checkout_id=receipt["checkoutId"]),
    )
    assert retry.status_code == 404


def test_history_is_limited_to_latest_100_receipts(client: TestClient, tmp_path: Path) -> None:
    cart_id = register(client)["cartId"]
    receipt = place_order(client, cart_id)
    with closing(sqlite3.connect(tmp_path / "carts.db")) as db, db:
        for _ in range(101):
            cursor = db.execute(
                """INSERT INTO orders (branch_id, order_date, name, description, status, user_id)
                VALUES (1, ?, 'Ada', '', 'pending', 1)""",
                (receipt["placedAt"],),
            )
            order_id = cursor.lastrowid
            clone = {**receipt, "checkoutId": str(uuid4()), "orderId": order_id}
            db.execute(
                "INSERT INTO cart_checkouts (checkout_id, cart_id, order_id, receipt_json) VALUES (?, ?, ?, ?)",
                (clone["checkoutId"], cart_id, order_id, CheckoutReceipt.model_validate(clone).model_dump_json()),
            )
    history = client.get("/api/me/orders").json()
    assert len(history) == 100
    assert [entry["orderId"] for entry in history] == list(range(102, 2, -1))
    assert client.get(f"/api/me/orders/{receipt['orderId']}").json() == receipt


def test_guest_checkout_and_receipts_require_sign_in(client: TestClient) -> None:
    guest = str(uuid4())
    cart = add(client, guest)
    assert client.post(f"/api/carts/{guest}/checkout", json=checkout_payload(cart)).status_code == 401
    assert client.get(f"/api/carts/{guest}/checkouts/{uuid4()}").status_code == 401
    for path in ["/api/me/orders", "/api/me/orders/1", "/api/orders", "/api/orders/1",
                 "/api/order-details", "/api/order-details/1"]:
        assert client.get(path).status_code == 401


def test_users_cannot_access_other_carts_orders_details_or_receipts(client: TestClient) -> None:
    owner = register(client)
    owned = owner["cartId"]
    first = place_order(client, owned)
    second = place_order(client, owned)
    order_id = first["orderId"]
    detail_id = client.get("/api/order-details").json()[0]["orderDetailId"]
    receipt_path = f"/api/carts/{owned}/checkouts/{first['checkoutId']}"
    assert client.get("/api/me/orders").json() == [second, first]
    assert client.get(f"/api/me/orders/{order_id}").json() == first
    assert len(client.get("/api/orders").json()) == 2
    assert client.get(f"/api/orders/{order_id}").json()["orderId"] == order_id
    assert client.get(f"/api/order-details/{detail_id}").json()["orderId"] == order_id
    client.post("/api/auth/logout")
    assert client.get(f"/api/carts/{owned}").status_code == 401
    assert client.get(receipt_path).status_code == 401
    register(client, "other@example.com")
    assert client.get("/api/me/orders").json() == []
    assert client.get("/api/orders").json() == []
    assert client.get("/api/order-details").json() == []
    for path in [
        f"/api/carts/{owned}", receipt_path, f"/api/me/orders/{order_id}",
        f"/api/orders/{order_id}", f"/api/order-details/{detail_id}",
    ]:
        assert client.get(path).status_code == 404
    for method, path, payload in [
        ("POST", f"/api/carts/{owned}/items", {"productId": 1, "quantity": 1}),
        ("PUT", f"/api/carts/{owned}/items/1", {"quantity": 1}),
        ("DELETE", f"/api/carts/{owned}/items/1", None),
        (
            "POST", f"/api/carts/{owned}/checkout",
            checkout_payload({"version": 4, "totalCents": 0}, checkout_id=first["checkoutId"]),
        ),
    ]:
        assert client.request(method, path, json=payload).status_code == 404
    assert login(client, guestCartId=owned).status_code == 404


@pytest.mark.parametrize("path", ["/api/orders", "/api/order-details"])
def test_legacy_writes_are_admin_only(client: TestClient, path: str) -> None:
    register(client)
    assert client.post(path, json={}).status_code == 403
    assert client.put(path + "/1", json={}).status_code == 403
    assert client.delete(path + "/1").status_code == 403


def test_admin_role_is_database_backed_and_legacy_orders_stay_unclaimed(
    client: TestClient, tmp_path: Path
) -> None:
    register(client)
    with closing(sqlite3.connect(tmp_path / "carts.db")) as db, db:
        db.execute("UPDATE users SET role = 'admin' WHERE user_id = 1")
    created = client.post(
        "/api/orders",
        json={"branchId": 1, "orderDate": "2026-10-27", "name": "Legacy", "description": "private", "status": "pending"},
    )
    assert created.status_code == 201
    order_id = created.json()["orderId"]
    detail = client.post(
        "/api/order-details",
        json={"orderId": order_id, "productId": 1, "quantity": 1, "unitPrice": 1, "notes": ""},
    )
    assert detail.status_code == 201
    assert client.get("/api/orders").json() == [created.json()]
    assert len(client.get("/api/order-details").json()) == 1
    with closing(sqlite3.connect(tmp_path / "carts.db")) as db, db:
        db.execute("UPDATE users SET role = 'customer' WHERE user_id = 1")
    assert client.get("/api/auth/me").json()["user"]["role"] == "customer"
    assert client.get("/api/orders").json() == []
    assert client.get("/api/order-details").json() == []
    assert client.get(f"/api/orders/{order_id}").status_code == 404
    assert client.get(f"/api/order-details/{detail.json()['orderDetailId']}").status_code == 404


def test_origin_protection_uses_cors_allowlist(client: TestClient) -> None:
    for origin in ["https://evil.example", "null", "http://localhost:5137.evil.example"]:
        response = client.post(
            "/api/auth/register", headers={"Origin": origin},
            json={"name": "Ada", "email": "ada@example.com", "password": PASSWORD},
        )
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "FORBIDDEN"
    register(client)
    for origin in ["http://localhost:5137", "https://my-app.app.github.dev", "https://my-app.azurecontainerapps.io"]:
        assert client.post("/api/auth/logout", headers={"Origin": origin}).status_code == 204
    assert login(client).status_code == 200
    assert client.post("/api/auth/logout", headers={"Origin": "https://evil.example"}).status_code == 403
    assert client.get("/api/auth/me").status_code == 200


def test_openapi_documents_account_and_order_receipt_responses(client: TestClient) -> None:
    schema = client.get("/openapi.json").json()
    paths = schema["paths"]
    auth_schema = paths["/api/auth/register"]["post"]["responses"]["201"]["content"]["application/json"]["schema"]
    assert auth_schema["$ref"] == "#/components/schemas/AuthResponse"
    assert "429" in paths["/api/auth/login"]["post"]["responses"]
    orders_schema = paths["/api/me/orders"]["get"]["responses"]["200"]["content"]["application/json"]["schema"]
    assert orders_schema["type"] == "array"
    assert orders_schema["items"]["$ref"] == "#/components/schemas/CheckoutReceipt"
    assert "401" in paths["/api/auth/me"]["get"]["responses"]


def test_concurrent_merge_only_applies_once(client: TestClient) -> None:
    owned = register(client)["cartId"]
    client.post("/api/auth/logout")
    guest = str(uuid4())
    add(client, guest, 2)
    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(executor.map(lambda _: login(client, guestCartId=guest), range(2)))
    assert [response.status_code for response in responses] == [200, 200]
    assert client.get(f"/api/carts/{owned}").json()["items"][0]["quantity"] == 2
