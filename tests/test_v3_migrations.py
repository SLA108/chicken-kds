#!/usr/bin/env python3
"""Exercise V3 D1-compatible SQLite constraints against an isolated in-memory fixture."""
import pathlib
import sqlite3
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


def setup():
    db = sqlite3.connect(":memory:")
    db.execute("PRAGMA foreign_keys=ON")
    db.executescript("""
    CREATE TABLE stores(id TEXT PRIMARY KEY);
    CREATE TABLE orders(
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES stores(id),
      status TEXT NOT NULL DEFAULT 'new', paid_at TEXT, kitchen_completed_at TEXT
    );
    CREATE TABLE payments(
      id TEXT PRIMARY KEY, order_id TEXT REFERENCES orders(id),
      store_id TEXT NOT NULL REFERENCES stores(id)
    );
    CREATE TABLE order_items(
      id TEXT PRIMARY KEY, order_id TEXT REFERENCES orders(id),
      is_done INTEGER DEFAULT 0, done_at TEXT, picked_up_at TEXT
    );
    INSERT INTO stores VALUES('a'),('b');
    INSERT INTO orders(id,store_id) VALUES('o1','a'),('o2','b');
    INSERT INTO order_items(id,order_id) VALUES('i1','o1');
    """)
    for name in ("0009_v3_write_integrity.sql", "0010_v3_kitchen_integrity.sql"):
        db.executescript((ROOT / "migrations" / name).read_text())
    return db


class MigrationIntegrity(unittest.TestCase):
    def setUp(self):
        self.db = setup()

    def tearDown(self):
        self.db.close()

    def test_payment_store_and_unique_order(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO payments VALUES('bad','o1','b')")
        self.db.execute("INSERT INTO payments VALUES('p1','o1','a')")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO payments VALUES('p2','o1','a')")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE payments SET store_id='b' WHERE id='p1'")

    def test_add_item_only_to_open_orders(self):
        self.db.execute("INSERT INTO order_items(id,order_id) VALUES('i2','o1')")
        for column, value in (("paid_at", "2026-01-01"), ("kitchen_completed_at", "2026-01-01")):
            self.db.execute(f"UPDATE orders SET {column}=? WHERE id='o1'", (value,))
            with self.assertRaises(sqlite3.IntegrityError):
                self.db.execute("INSERT INTO order_items(id,order_id) VALUES('blocked','o1')")
            self.db.execute(f"UPDATE orders SET {column}=NULL WHERE id='o1'")
        self.db.execute("UPDATE orders SET status='cancelled' WHERE id='o1'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO order_items(id,order_id) VALUES('blocked','o1')")

    def test_completed_order_rejects_dish_changes_but_allows_pickup(self):
        self.db.execute("UPDATE order_items SET is_done=1,done_at='ready' WHERE id='i1'")
        self.db.execute("UPDATE orders SET kitchen_completed_at='complete' WHERE id='o1'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE order_items SET is_done=0 WHERE id='i1'")
        self.db.execute("UPDATE order_items SET picked_up_at='picked' WHERE id='i1'")
        self.assertEqual(self.db.execute("SELECT picked_up_at FROM order_items WHERE id='i1'").fetchone()[0], "picked")
        self.db.execute("UPDATE orders SET kitchen_completed_at=NULL WHERE id='o1'")
        self.db.execute("UPDATE order_items SET is_done=0,done_at=NULL WHERE id='i1'")

    def test_cancelled_order_rejects_dish_changes(self):
        self.db.execute("UPDATE orders SET status='cancelled' WHERE id='o1'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE order_items SET done_at='ready' WHERE id='i1'")


if __name__ == "__main__":
    unittest.main()
