#!/usr/bin/env python3
"""Eval runner: generate each config, assert must_contain / must_exclude.

Exit 0 and print 'ALL PASS' only when every case passes; else exit 1.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BASIS = os.path.normpath(os.path.join(HERE, ".."))
SKILL = os.path.normpath(os.path.join(BASIS, "..", "..", "skills", "sysprompt-gen"))
sys.path.insert(0, SKILL)
import generate as gen  # noqa: E402


def run():
    with open(os.path.join(HERE, "eval-set.json"), encoding="utf-8") as f:
        cases = json.load(f)["cases"]
    all_pass = True
    for c in cases:
        cfg = dict(c["config"])
        cfg.setdefault("layers", {})
        try:
            out = gen.generate(cfg, BASIS)
        except gen.GenError as e:
            print(f"FAIL  {c['name']}: generation error: {e}")
            all_pass = False
            continue
        misses = [m for m in c.get("must_contain", []) if m not in out]
        leaks = [x for x in c.get("must_exclude", []) if x in out]
        if misses or leaks:
            all_pass = False
            print(f"FAIL  {c['name']}")
            if misses:
                print(f"        missing must_contain: {misses}")
            if leaks:
                print(f"        present must_exclude: {leaks}")
        else:
            print(f"PASS  {c['name']}")
    print("ALL PASS" if all_pass else "SOME FAILED")
    return 0 if all_pass else 1


if __name__ == "__main__":
    sys.exit(run())
