#!/usr/bin/env python3
"""Nightly stock sync: warehouse system (WMS) export -> web shop stock API.
Runs from cron on ops-01 at 02:30 as svc-sync. Token comes from the environment.
Usage: python3 sync_stock.py --export /srv/wms/exports/stock_latest.csv [--dry-run]
"""
import argparse
import csv
import json
import logging
import os
import sys
import time
import urllib.request
from collections import defaultdict

SHOP_API = os.environ.get("KBS_SHOP_API", "https://shop-api.kestrelbay.example/v2")
SHOP_TOKEN = os.environ.get("KBS_SHOP_TOKEN")  # set in /etc/kbs/sync.env (root only)
BATCH_SIZE = 50
SAFETY_BUFFER = {"default": 2, "FW3": 3, "RB2": 5}  # units held back per SKU family
SKIP_ZONES = {"QC", "RTS", "DAMAGED"}  # stock in these bins is never sellable

log = logging.getLogger("sync_stock")


def read_export(path):
    """Return {sku: available_units} from the WMS export (one row per SKU and bin)."""
    totals = defaultdict(int)
    with open(path, newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            if row["bin_zone"] in SKIP_ZONES:
                continue
            available = int(row["on_hand"]) - int(row["allocated"])
            totals[row["sku"]] += max(available, 0)
    return totals


def apply_buffer(totals):
    result = {}
    for sku, qty in totals.items():
        buffer = SAFETY_BUFFER.get(sku.split("-")[0], SAFETY_BUFFER["default"])
        result[sku] = max(qty - buffer, 0)
    return result


def push(batch, dry_run=False):
    body = json.dumps({"items": [{"sku": s, "stock": q} for s, q in batch]}).encode()
    if dry_run:
        log.info("dry run: would send %d items", len(batch))
        return
    headers = {"Authorization": f"Bearer {SHOP_TOKEN}", "Content-Type": "application/json"}
    req = urllib.request.Request(f"{SHOP_API}/inventory/bulk", data=body, method="PUT", headers=headers)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                log.info("batch ok (%s), %d items", resp.status, len(batch))
                return
        except Exception as exc:  # retry on network errors and 5xx
            log.warning("attempt %d failed: %s", attempt + 1, exc)
            time.sleep(5 * (attempt + 1))
    raise RuntimeError("stock push failed after 3 attempts")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--export", required=True)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if not SHOP_TOKEN and not args.dry_run:
        log.error("KBS_SHOP_TOKEN is not set")
        return 2
    items = sorted(apply_buffer(read_export(args.export)).items())
    log.info("syncing %d SKUs", len(items))
    for i in range(0, len(items), BATCH_SIZE):
        push(items[i : i + BATCH_SIZE], dry_run=args.dry_run)
    return 0


if __name__ == "__main__":
    sys.exit(main())
