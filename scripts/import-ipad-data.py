#!/usr/bin/env python3
"""Merge a consistent BabyNote Core Data snapshot into the standalone web DB.

Dry-run by default. --apply requires a new --backup path. Existing rows, IDs,
deleted records and share keys are never changed. Exact-match deduplication uses
multisets, preserving the number of legitimately identical source records.
"""

import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import sqlite3


APPLE_EPOCH_SECONDS = 978307200
SPECS = [
    ("ZFEEDINGRECORD", "feeding_records", [
        ("started_at", "ZSTARTEDAT", "date"),
        ("ended_at", "ZENDEDAT", "optional_date"),
        ("formula_started_at", "ZFORMULASTARTEDAT", "optional_date"),
        ("feeding_type", "ZFEEDINGTYPERAWVALUE", "feeding"),
        ("amount_ml", "ZAMOUNTML", "optional_number"),
        ("note", "ZNOTE", "text"),
    ]),
    ("ZWEIGHTRECORD", "weight_records", [
        ("recorded_at", "ZRECORDEDAT", "date"),
        ("weight_kg", "ZWEIGHTKG", "number"), ("note", "ZNOTE", "text"),
    ]),
    ("ZMEDICATIONRECORD", "medication_records", [
        ("recorded_at", "ZRECORDEDAT", "date"), ("name", "ZNAME", "text"),
        ("dosage", "ZDOSAGE", "text"), ("note", "ZNOTE", "text"),
    ]),
    ("ZCHECKUPRECORD", "checkup_records", [
        ("recorded_at", "ZRECORDEDAT", "date"), ("location", "ZLOCATION", "text"),
        ("summary", "ZSUMMARY", "text"),
        ("attachment_path", "ZATTACHMENTPATH", "attachment"), ("note", "ZNOTE", "text"),
    ]),
    ("ZFETALMOVEMENTRECORD", "fetal_movement_records", [
        ("recorded_at", "ZRECORDEDAT", "date"),
        ("duration_minutes", "ZDURATIONMINUTESVALUE", "optional_integer"),
        ("movement_count", "ZMOVEMENTCOUNTVALUE", "optional_integer"),
        ("note", "ZNOTE", "text"),
    ]),
    ("ZBLOODGLUCOSERECORD", "blood_glucose_records", [
        ("recorded_at", "ZRECORDEDAT", "date"),
        ("moment", "ZMOMENTRAWVALUE", "glucose_moment"),
        ("value_mmol", "ZVALUEMMOL", "number"), ("note", "ZNOTE", "text"),
    ]),
    ("ZEXCRETIONRECORD", "excretion_records", [
        ("recorded_at", "ZRECORDEDAT", "date"),
        ("type", "ZTYPERAWVALUE", "excretion"), ("note", "ZNOTE", "text"),
    ]),
]


def convert(value, kind):
    if value is None and kind.startswith("optional_"):
        return None
    if kind in ("date", "optional_date"):
        if value is None or not math.isfinite(value):
            raise ValueError("Missing or non-finite timestamp")
        return round((value + APPLE_EPOCH_SECONDS) * 1000)
    if kind in ("number", "optional_number", "optional_integer"):
        if value is None or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise ValueError("Missing or non-finite numeric value")
        if kind == "optional_integer" and int(value) != value:
            raise ValueError("Fractional integer value")
        return value
    if kind in ("text", "attachment"):
        if value is not None and not isinstance(value, str):
            raise ValueError("Invalid text value")
        if kind == "attachment" and value:
            raise ValueError("Attachments require separate file migration")
        return value or ""
    if kind == "feeding":
        mapping = {"formula": "formula", "bottle": "formula", "mixed": "mixed",
                   "leftBreast": "mixed", "rightBreast": "mixed"}
        return mapping[value]
    if kind == "glucose_moment":
        if value not in {"beforeBreakfast", "afterBreakfast", "beforeLunch", "afterLunch",
                         "beforeDinner", "afterDinner", "beforeSleep"}:
            raise ValueError("Unknown glucose moment")
        return value
    if kind == "excretion":
        if value not in {"poop", "pee"}:
            raise ValueError("Unknown excretion type")
        return value
    raise ValueError("Unknown conversion")


def demo_rows(source):
    """Identify the two user-excluded records from the same seeding event."""
    checkups = list(source.execute(
        "SELECT Z_PK, ZRECORDEDAT FROM ZCHECKUPRECORD WHERE ZLOCATION='市妇幼' "
        "AND ZSUMMARY='常规产检正常' AND ZNOTE='下次两周后复查' "
        "AND coalesce(ZATTACHMENTPATH,'')=''"))
    movements = list(source.execute(
        "SELECT Z_PK, ZRECORDEDAT FROM ZFETALMOVEMENTRECORD "
        "WHERE ZMOVEMENTCOUNTVALUE=8 AND ZNOTE='晚上比较明显'"))
    result = set()
    for checkup in checkups:
        for movement in movements:
            if abs((checkup[1] + 5 * 86400) - (movement[1] + 4 * 3600)) < 0.001:
                result.add(("ZCHECKUPRECORD", checkup[0]))
                result.add(("ZFETALMOVEMENTRECORD", movement[0]))
    return result


def integrity(db):
    if db.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
        raise ValueError("Database failed integrity check")


def read_source(path, skip_demo):
    source = sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)
    integrity(source)
    excluded = demo_rows(source) if skip_demo else set()
    source.row_factory = sqlite3.Row
    data = []
    stats = {}
    sides = 0
    for source_table, target_table, fields in SPECS:
        rows = list(source.execute(f'SELECT * FROM "{source_table}" ORDER BY Z_PK'))
        stats[target_table] = {"source": len(rows), "excluded_demo": 0}
        for row in rows:
            if (source_table, row["Z_PK"]) in excluded:
                stats[target_table]["excluded_demo"] += 1
                continue
            record = {name: convert(row[col], kind) for name, col, kind in fields}
            if target_table == "feeding_records" and row["ZFEEDINGTYPERAWVALUE"] in {"leftBreast", "rightBreast"}:
                side = "左侧" if row["ZFEEDINGTYPERAWVALUE"] == "leftBreast" else "右侧"
                record["note"] += ("\n" if record["note"] else "") + f"[旧 iPad 记录：{side}母乳喂养]"
                sides += 1
            if target_table == "excretion_records":
                record["amount"] = None
            data.append((source_table, row["Z_PK"], target_table, record))
    store_uuid = source.execute("SELECT Z_UUID FROM Z_METADATA").fetchone()[0]
    source.close()
    return data, stats, store_uuid, sides


def run(args):
    data, stats, store_uuid, sides = read_source(args.source, args.skip_demo)
    target = sqlite3.connect(args.target.resolve().as_uri() +
                             ("?mode=rw" if args.apply else "?mode=ro"), uri=True, timeout=30)
    integrity(target)
    if args.apply:
        if args.backup is None or args.backup.exists():
            raise ValueError("--apply requires a new, non-existing --backup path")
        target.execute("BEGIN IMMEDIATE")
    try:
        existing = {}
        anchors = {}
        for _, table, fields in SPECS:
            columns = [f[0] for f in fields] + (["amount"] if table == "excretion_records" else [])
            rows = target.execute(f'SELECT {",".join(columns)} FROM "{table}"').fetchall()
            existing[table] = Counter(rows)
            anchors[table] = {row[0] for row in rows}
            stats[table].update(before=len(rows), duplicates=0, inserted=0)
        pending = []
        for source_table, pk, table, record in data:
            fingerprint = tuple(record.values())
            if existing[table][fingerprint]:
                existing[table][fingerprint] -= 1
                stats[table]["duplicates"] += 1
            else:
                if fingerprint[0] in anchors[table]:
                    raise ValueError(f"Conflicting record at same timestamp: {source_table}/{pk}")
                pending.append((source_table, pk, table, record))
                stats[table]["inserted"] += 1
        if args.apply:
            args.backup.parent.mkdir(parents=True, exist_ok=True)
            # The reserved write lock prevents changes between this snapshot and import.
            snapshot_source = sqlite3.connect(args.target.resolve().as_uri() + "?mode=ro", uri=True)
            backup = sqlite3.connect(args.backup)
            snapshot_source.backup(backup)
            integrity(backup)
            backup.close()
            snapshot_source.close()
            os.chmod(args.backup, 0o600)
            for _, _, table, record in pending:
                columns = ','.join(record)
                target.execute(f'INSERT INTO "{table}" ({columns}) VALUES ({",".join("?" for _ in record)})', tuple(record.values()))
            for _, table, _ in SPECS:
                count = target.execute(f'SELECT count(*) FROM "{table}"').fetchone()[0]
                if count != stats[table]["before"] + stats[table]["inserted"]:
                    raise ValueError(f"Unexpected final count in {table}")
            integrity(target)
            target.commit()
        report = {
            "mode": "applied" if args.apply else "dry-run",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "source_store_uuid": store_uuid,
            "source_sha256": hashlib.sha256(args.source.read_bytes()).hexdigest(),
            "target": str(args.target),
            "backup": str(args.backup) if args.apply else None,
            "breastfeeding_side_preserved_in_notes": sides,
            "tables": stats,
            "total_to_insert": len(pending),
        }
        if args.report:
            args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
            os.chmod(args.report, 0o600)
        print(json.dumps(report, ensure_ascii=False, indent=2))
    except BaseException:
        target.rollback()
        raise
    finally:
        target.close()


if __name__ == "__main__":
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--target", type=Path, required=True)
    parser.add_argument("--skip-demo", action="store_true")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--backup", type=Path)
    parser.add_argument("--report", type=Path)
    run(parser.parse_args())
