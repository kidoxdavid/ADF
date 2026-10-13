#!/usr/bin/env python3
"""Runs every offline check that does not need Unreal Engine:
   1. build_tables.py  - regenerates gameplay CSVs and validates mission graphs
   2. generate_map.py  - regenerates road/river/location CSVs and validates connectivity, grades, location references
   3. cpp_tests/run.py - compiles the engine-independent C++ core (road graph, A*, lane paths, signals, terrain)
                         against a tiny UE mock and runs it on the generated data
"""
import os, subprocess, sys
here = os.path.dirname(os.path.abspath(__file__))
steps = [("gameplay tables", ["build_tables.py"]), ("map data", ["generate_map.py", "--preview"]), ("C++ core", [os.path.join("cpp_tests", "run.py")])]
failed = False
for name, cmd in steps:
    print("\n=== %s ===" % name)
    rc = subprocess.call([sys.executable, os.path.join(here, cmd[0])] + cmd[1:], cwd=here)
    if rc != 0:
        print("*** FAILED: %s (exit %d)" % (name, rc)); failed = True
print("\nOVERALL:", "FAIL" if failed else "PASS")
sys.exit(1 if failed else 0)
