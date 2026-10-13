#!/usr/bin/env python3
"""Compile the engine-independent core with a tiny UE mock and run it against Content/Data (offline verification)."""
import os, subprocess, sys
here = os.path.dirname(os.path.abspath(__file__))
root = os.path.abspath(os.path.join(here, "..", ".."))
src = os.path.join(root, "Source", "CalgaryAfterDark")
out = os.path.join(here, "road_network_test")
cmd = ["g++", "-std=c++17", "-O1", "-Wall", "-Wno-unused-variable", "-Wno-sign-compare", "-I", os.path.join(here, "mock"), "-I", src,
       os.path.join(here, "road_network_test.cpp"), os.path.join(src, "CADRoadNetwork.cpp"), os.path.join(src, "CADTerrain.cpp"), "-o", out]
print(" ".join(cmd))
if subprocess.call(cmd) != 0:
    sys.exit(2)
sys.exit(subprocess.call([out, os.path.join(root, "Content", "Data")]))
