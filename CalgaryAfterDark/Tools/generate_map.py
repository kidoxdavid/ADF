#!/usr/bin/env python3
"""
Calgary After Dark - map data generator.

Builds the fictionalized Calgary road graph, river and location tables that the Unreal
project loads at runtime (Content/Data/*.csv), then validates them:
  * graph connectivity (drivable core must be one strongly connected component)
  * maximum road grade
  * every location reachable by car using the SAME turn rule the C++ router uses
  * mission references in Missions*.csv resolve to real locations

World units: METRES. +X = east, +Y = south (matches Unreal's left-handed X-forward/Y-right
when viewed from above). The C++ side multiplies by 100 to get Unreal centimetres.

Usage:  python3 Tools/generate_map.py [--preview]
"""
import csv, math, os, random, sys, heapq, collections

random.seed(1403)  # deterministic output
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "Content", "Data")
PREVIEW = os.path.join(HERE, "..", "Docs", "map_preview.png")

# ----------------------------------------------------------------------------- terrain model
# Must match Source/CalgaryAfterDark/CADTerrain.cpp
RIVER_CTRL = [(-4700, -900, 50), (-3500, -800, 55), (-2400, -700, 60), (-1500, -950, 60),
              (-700, -1250, 65), (0, -1200, 65), (700, -1000, 70), (1400, -1150, 70),
              (2200, -1500, 75), (3200, -1300, 80), (4700, -1100, 80)]
WATER_Z = -3.0
VALLEY_DEPTH = 6.0
RAMP_START_X = -3750.0
RAMP_SLOPE = 0.10
BRIDGE_Z = 0.0


def catmull(pts, step):
    """Sample a Catmull-Rom spline through pts (tuples, any extra values are lerped)."""
    out = []
    n = len(pts)
    P = [pts[0]] + list(pts) + [pts[-1]]
    for i in range(n - 1):
        p0, p1, p2, p3 = P[i], P[i + 1], P[i + 2], P[i + 3]
        seglen = math.dist(p1[:2], p2[:2])
        k = max(1, int(seglen / step))
        for j in range(k):
            t = j / k
            t2, t3 = t * t, t * t * t
            v = []
            for d in range(len(p1)):
                v.append(0.5 * ((2 * p1[d]) + (-p0[d] + p2[d]) * t + (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * t2
                                + (-p0[d] + 3 * p1[d] - 3 * p2[d] + p3[d]) * t3))
            out.append(tuple(v))
    out.append(tuple(pts[-1]))
    return out


RIVER = catmull(RIVER_CTRL, 60)


def seg_closest(p, a, b):
    ax, ay = a[0], a[1]
    bx, by = b[0], b[1]
    dx, dy = bx - ax, by - ay
    l2 = dx * dx + dy * dy
    t = 0.0 if l2 == 0 else max(0.0, min(1.0, ((p[0] - ax) * dx + (p[1] - ay) * dy) / l2))
    return t, (ax + dx * t, ay + dy * t)


def river_info(x, y):
    best, bw = 1e18, 60
    for i in range(len(RIVER) - 1):
        t, c = seg_closest((x, y), RIVER[i], RIVER[i + 1])
        d = math.hypot(x - c[0], y - c[1])
        if d < best:
            best = d
            bw = RIVER[i][2] + (RIVER[i + 1][2] - RIVER[i][2]) * t
    return best, bw


def smoothstep(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def height(x, y):
    d, w = river_info(x, y)
    h = -VALLEY_DEPTH * (1 - smoothstep(w, w + 60, d))
    if x < RAMP_START_X:
        h += (RAMP_START_X - x) * RAMP_SLOPE
    return h


# ----------------------------------------------------------------------------- road kinds
KINDS = {  # kind: (lanes per direction, speed kph)
    "Highway": (3, 100), "Expressway": (2, 80), "Arterial": (2, 60), "Collector": (1, 50),
    "Local": (1, 40), "Ramp": (1, 60), "Industrial": (2, 50), "Service": (1, 30), "Path": (0, 0),
}
VEHICLE_KINDS = {k for k in KINDS if k != "Path"}
ANG = math.radians(6)


def R(u, v):
    """Rotated downtown/Beltline grid -> world metres."""
    return (u * math.cos(ANG) - v * math.sin(ANG), u * math.sin(ANG) + v * math.cos(ANG))


def poly_len(p):
    return sum(math.dist(p[i][:2], p[i + 1][:2]) for i in range(len(p) - 1))


def resample(pts, step):
    out = [pts[0]]
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        L = math.dist(a[:2], b[:2])
        k = max(1, int(math.ceil(L / step)))
        for j in range(1, k + 1):
            t = j / k
            out.append(tuple(a[d] + (b[d] - a[d]) * t for d in range(len(a))))
    return out


def offset_poly(pts, d):
    """Offset to the RIGHT of travel direction by d metres (negative = left)."""
    out = []
    n = len(pts)
    for i in range(n):
        a = pts[max(0, i - 1)]
        b = pts[min(n - 1, i + 1)]
        dx, dy = b[0] - a[0], b[1] - a[1]
        L = math.hypot(dx, dy) or 1
        out.append((pts[i][0] + (-dy / L) * d, pts[i][1] + (dx / L) * d) + tuple(pts[i][2:]))
    return out


def y_at(poly, x):
    for i in range(len(poly) - 1):
        a, b = poly[i], poly[i + 1]
        if (a[0] - x) * (b[0] - x) <= 0 and a[0] != b[0]:
            t = (x - a[0]) / (b[0] - a[0])
            return a[1] + (b[1] - a[1]) * t
    return poly[-1][1]


def nearest_on(poly, p):
    best = (1e18, None)
    for i in range(len(poly) - 1):
        t, c = seg_closest(p, poly[i], poly[i + 1])
        d = math.dist(p, c)
        if d < best[0]:
            best = (d, c)
    return best[1]


# ----------------------------------------------------------------------------- network builder
class Net:
    def __init__(self):
        self.raw = []  # dicts: pts[(x,y)], z[], kind, name, oneway, bridge[]
        self.nodes = []  # [x,y,z]
        self.node_key = {}
        self.edges = []  # dicts

    # -- adding ------------------------------------------------------------------------
    def add(self, pts, kind, name="", oneway=False, zfn=None, rate=1.0):
        pts = [(float(p[0]), float(p[1])) for p in pts]
        # densify near the river so bridge boundaries are found, and for long segments on curved roads
        dense = [pts[0]]
        for i in range(len(pts) - 1):
            a, b = pts[i], pts[i + 1]
            L = math.dist(a, b)
            mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
            rd, rw = river_info(*mid)
            step = 20.0 if rd < rw + 260 + L / 2 else (100.0 if kind in ("Highway", "Expressway") else 1e9)
            k = max(1, int(math.ceil(L / step)))
            for j in range(1, k + 1):
                t = j / k
                dense.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
        z = []
        for p in dense:
            rd, rw = river_info(*p)
            zz = BRIDGE_Z if rd < rw + 60 else height(*p)
            if zfn:
                zz = zfn(p, zz)
            z.append(zz)
        bridge = []
        for i in range(len(dense) - 1):
            mid = ((dense[i][0] + dense[i + 1][0]) / 2, (dense[i][1] + dense[i + 1][1]) / 2)
            rd, rw = river_info(*mid)
            bridge.append(rd < rw + 75)
        self.raw.append(dict(pts=dense, z=z, kind=kind, name=name, oneway=oneway, bridge=bridge))
        return len(self.raw) - 1

    def conflicts(self, pts, clearance, ignore=()):
        for i in range(len(pts) - 1):
            for ri, r in enumerate(self.raw):
                if ri in ignore:
                    continue
                for j in range(len(r["pts"]) - 1):
                    if seg_seg_dist(pts[i], pts[i + 1], r["pts"][j], r["pts"][j + 1]) < clearance:
                        return True
        return False

    # -- build -------------------------------------------------------------------------
    def node(self, x, y, z):
        key = (round(x / 2.5), round(y / 2.5), round(z / 3.0))
        if key in self.node_key:
            return self.node_key[key]
        self.nodes.append([x, y, z])
        self.node_key[key] = len(self.nodes) - 1
        return self.node_key[key]

    def planarize(self):
        segs = []  # (raw, i)
        grid = collections.defaultdict(list)
        CELL = 150.0
        for ri, r in enumerate(self.raw):
            for i in range(len(r["pts"]) - 1):
                a, b = r["pts"][i], r["pts"][i + 1]
                sid = len(segs)
                segs.append((ri, i))
                for cx in range(int(min(a[0], b[0]) // CELL), int(max(a[0], b[0]) // CELL) + 1):
                    for cy in range(int(min(a[1], b[1]) // CELL), int(max(a[1], b[1]) // CELL) + 1):
                        grid[(cx, cy)].append(sid)
        splits = collections.defaultdict(dict)  # (ri,i) -> {rounded key: (t, x, y, z)}

        def seg(sid):
            ri, i = segs[sid]
            r = self.raw[ri]
            return r["pts"][i], r["pts"][i + 1], r["z"][i], r["z"][i + 1]

        done = set()
        for cell, ids in grid.items():
            for ai in range(len(ids)):
                for bi in range(ai + 1, len(ids)):
                    s1, s2 = ids[ai], ids[bi]
                    if (s1, s2) in done:
                        continue
                    done.add((s1, s2))
                    r1, i1 = segs[s1]
                    r2, i2 = segs[s2]
                    if r1 == r2 and abs(i1 - i2) <= 1:
                        continue
                    a, b, za, zb = seg(s1)
                    c, d, zc, zd = seg(s2)
                    hit = seg_intersect(a, b, c, d)
                    if hit:
                        t, u, p = hit
                        z1 = za + (zb - za) * t
                        z2 = zc + (zd - zc) * u
                        if abs(z1 - z2) > 2.5:
                            continue  # grade separated (overpass)
                        z = (z1 + z2) / 2
                        for sid, tt in ((s1, t), (s2, u)):
                            if 0.002 < tt < 0.998:
                                splits[segs[sid]][(round(p[0] / 2), round(p[1] / 2))] = (tt, p[0], p[1], z)
                    # T-junctions: endpoints of one raw polyline landing on the interior of the other
                    for (sa, sb) in ((s1, s2), (s2, s1)):
                        ra, ia = segs[sa]
                        rb, ib = segs[sb]
                        if ra == rb:
                            continue
                        A, B, zA, zB = seg(sa)
                        C, D, zC, zD = seg(sb)
                        for ep, ez, is_end in ((A, zA, ia == 0), (B, zB, ia == len(self.raw[ra]["pts"]) - 2)):
                            if not is_end:
                                continue
                            tt, c2 = seg_closest(ep, C, D)
                            if 0.002 < tt < 0.998 and math.dist(ep, c2) < 2.5:
                                zc2 = zC + (zD - zC) * tt
                                if abs(zc2 - ez) <= 2.5:
                                    splits[(rb, ib)][(round(ep[0] / 2), round(ep[1] / 2))] = (tt, ep[0], ep[1], ez)
        # emit edges
        for ri, r in enumerate(self.raw):
            chain = []
            for i in range(len(r["pts"]) - 1):
                a, b = r["pts"][i], r["pts"][i + 1]
                za, zb = r["z"][i], r["z"][i + 1]
                if not chain:
                    chain.append((a[0], a[1], za, r["bridge"][i]))
                for (t, x, y, z) in sorted(splits.get((ri, i), {}).values()):
                    chain.append((x, y, z, r["bridge"][i]))
                chain.append((b[0], b[1], zb, r["bridge"][i]))
            for i in range(len(chain) - 1):
                p, q = chain[i], chain[i + 1]
                if math.dist(p[:2], q[:2]) < 1.0:
                    continue
                bz = q[3]
                za, zb = (BRIDGE_Z, BRIDGE_Z) if bz else (p[2], q[2])
                na, nb = self.node(p[0], p[1], za), self.node(q[0], q[1], zb)
                if na == nb:
                    continue
                self.edges.append(dict(a=na, b=nb, kind=r["kind"], name=r["name"], oneway=r["oneway"], bridge=bz))
        # drop duplicate edges
        seen, uniq = set(), []
        for e in self.edges:
            k = (e["a"], e["b"]) if e["oneway"] else tuple(sorted((e["a"], e["b"])))
            k = (k, e["oneway"])
            if k in seen:
                continue
            seen.add(k)
            uniq.append(e)
        self.edges = uniq

    def adjacency(self, vehicle_only=True):
        adj = collections.defaultdict(list)  # node -> [(edge idx, neighbour)]
        for i, e in enumerate(self.edges):
            if vehicle_only and e["kind"] == "Path":
                continue
            adj[e["a"]].append((i, e["b"]))
            if not e["oneway"]:
                adj[e["b"]].append((i, e["a"]))
        return adj


def seg_intersect(a, b, c, d):
    r = (b[0] - a[0], b[1] - a[1])
    s = (d[0] - c[0], d[1] - c[1])
    den = r[0] * s[1] - r[1] * s[0]
    if abs(den) < 1e-9:
        return None
    qp = (c[0] - a[0], c[1] - a[1])
    t = (qp[0] * s[1] - qp[1] * s[0]) / den
    u = (qp[0] * r[1] - qp[1] * r[0]) / den
    if 0 <= t <= 1 and 0 <= u <= 1:
        return t, u, (a[0] + r[0] * t, a[1] + r[1] * t)
    return None


def seg_seg_dist(a, b, c, d):
    if seg_intersect(a, b, c, d):
        return 0.0
    return min(math.dist(a, seg_closest(a, c, d)[1]),
               math.dist(b, seg_closest(b, c, d)[1]),
               math.dist(c, seg_closest(c, a, b)[1]),
               math.dist(d, seg_closest(d, a, b)[1]))


# ----------------------------------------------------------------------------- build the city
net = Net()
STEP = 55.0


def smooth(ctrl, step=STEP):
    return [(p[0], p[1]) for p in catmull(ctrl, step)]


def overpass_z(centres, half=300.0, h=7.0):
    def f(p, z):
        best = 0.0
        for c in centres:
            d = math.dist(p, c)
            if d < half:
                best = max(best, h * smoothstep(0, 1, 1 - d / half))
        return z + best
    return f


def curve_cross(pa, pb):
    for i in range(len(pa) - 1):
        for j in range(len(pb) - 1):
            h = seg_intersect(pa[i], pa[i + 1], pb[j], pb[j + 1])
            if h:
                return h[2]
    return None


# ---- RING ROAD ("Stoney"-inspired), half-size 3600, corner radius 500
H, CR = 3600.0, 500.0
ring = []
def arc(cx, cy, r, a0, a1, n=10):
    return [(cx + r * math.cos(math.radians(a0 + (a1 - a0) * k / n)), cy + r * math.sin(math.radians(a0 + (a1 - a0) * k / n))) for k in range(n + 1)]
ring += [(-H + CR, -H), (H - CR, -H)]
ring += arc(H - CR, -H + CR, CR, -90, 0)
ring += [(H, H - CR)]
ring += arc(H - CR, H - CR, CR, 0, 90)
ring += [(-H + CR, H)]
ring += arc(-H + CR, H - CR, CR, 90, 180)
ring += [(-H, -H + CR)]
ring += arc(-H + CR, -H + CR, CR, 180, 270)
ring = resample(ring, 90)
ring.append(ring[0])
RING = ring
net.add(ring, "Highway", "Stoney Ring Road")

# ---- PRAIRIE TRAIL (Deerfoot-inspired N-S freeway) with overpasses
prairie = smooth([(1500, -3600), (1520, -2600), (1430, -1700), (1500, -1100), (1560, -300),
                  (1480, 600), (1520, 1500), (1450, 2400), (1520, 3000), (1500, 3600)], 50)
# Southbridge Road (E-W arterial across the Beltline/industrial) and Glen Trail (E-W expressway)
southbridge = smooth([R(780, 900), (1100, 880), (1900, 870), (2600, 870), (3600, 880)])
glen = smooth([(-3600, 1850), (-2500, 1950), (-1800, 2000), (-800, 1850), (0, 1900), (900, 1800),
               (1500, 1930), (2400, 2000), (3600, 2100)], STEP)
X_pg = curve_cross(prairie, glen)
X_ps = curve_cross(prairie, southbridge)
assert X_pg and X_ps, "Prairie must cross Glen and Southbridge"
net.add(prairie, "Highway", "Prairie Trail", zfn=overpass_z([X_pg, X_ps]))
# Prairie z-profile only applies to Prairie itself, so Glen/Southbridge stay at ground level
net.add(glen, "Expressway", "Glen Trail")
net.add(southbridge, "Arterial", "Southbridge Road")

# ---- diamond interchange ramps at Prairie x Glen (one-way, ground level)
def point_along(poly, c, dist_m, sign):
    """Point on polyline `poly` approximately dist_m along from the point nearest c (sign +/-1 by y)."""
    best = None
    for p in poly:
        if sign * (p[1] - c[1]) > 0 and abs(abs(p[1] - c[1]) - dist_m) < 30:
            if best is None or abs(abs(p[1] - c[1]) - dist_m) < abs(abs(best[1] - c[1]) - dist_m):
                best = p
    return best

pn = point_along(prairie, X_pg, 560, -1)  # north of interchange
ps = point_along(prairie, X_pg, 560, +1)  # south of interchange
assert pn and ps
TE = (X_pg[0] + 190, X_pg[1] - 15)  # east terminal on Glen
TW = (X_pg[0] - 190, X_pg[1] + 15)  # west terminal on Glen
TE = nearest_on(glen, TE)
TW = nearest_on(glen, TW)
def ramp(p0, p1, bulge, name):
    mid = ((p0[0] + p1[0]) / 2 + bulge[0], (p0[1] + p1[1]) / 2 + bulge[1])
    pts = [(p[0], p[1]) for p in catmull([p0, mid, p1], 25)]
    net.add(pts, "Ramp", name, oneway=True)
ramp(ps, TE, (45, 0), "Prairie Trail NB Off-Ramp")
ramp(TE, pn, (45, 0), "Prairie Trail NB On-Ramp")
ramp(pn, TW, (-45, 0), "Prairie Trail SB Off-Ramp")
ramp(TW, ps, (-45, 0), "Prairie Trail SB On-Ramp")

# ---- CHINOOK TRAIL (Crowchild-inspired N-S expressway)
chinook = smooth([(-1850, -3600), (-1750, -2500), (-1850, -1500), (-1800, -700), (-1750, 200),
                  (-1850, 1100), (-1800, 2000), (-1700, 2900), (-1750, 3600)])
net.add(chinook, "Expressway", "Chinook Trail")

# ---- TRANS-CANADA WEST (Highway 1) to the foothills overlook, plus east stub and rural stubs
net.add(smooth([(-3600, -300), (-3900, -250), (-4150, -100), (-4350, 50), (-4480, 250)], 60), "Highway", "Trans-Canada West")
net.add(smooth([(3600, -200), (4000, -150), (4450, -120)], 60), "Highway", "Trans-Canada East")
net.add(smooth([(400, 3600), (350, 3950), (300, 4400)], 60), "Collector", "Range Road 22")

# ---- MACLEOD TRAIL (arterial south from downtown)
macleod = smooth([R(300, 300), (330, 800), (450, 1500), (520, 2400), (420, 3000), (400, 3600)])
net.add(macleod, "Arterial", "Macleod Trail")

# ---- CENTRE STREET (N-S arterial through downtown, over the river, to both ring edges)
cs_north_bridge_pt = None
centre = smooth([(-250, -3600), (-260, -2600), (-280, -1700), R(-60, -1050), R(-60, -900)], 55)
net.add(centre, "Arterial", "Centre Street Bridge")
centre_s = smooth([R(-60, -900), R(-60, 300), (-90, 800), (-110, 1500), (-100, 2400), (-130, 3000), (-120, 3600)], 55)
net.add(centre_s, "Arterial", "Centre Street")

# ---- RIVERSIDE DRIVE (Memorial-inspired, north bank, split by Prairie so it never crosses it)
north_bank = offset_poly(RIVER, -(70 + 215))
riv_w = [p[:2] for p in north_bank if -1950 < p[0] < 1180]
net.add(riv_w, "Arterial", "Riverside Drive")

# ---- DOWNTOWN + BELTLINE GRID (rotated, irregular spacing, alternating one-ways)
us = [-660 + 120 * i for i in range(13)]  # -660 .. 780
rows_dt = [-900, -780, -650, -520, -380, -240, -100, 40, 180, 300]
rows_bl = [400, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1300, 1400]
BRIDGE_US = (-300, 420)
for u in us:
    if u == -60:
        continue  # Centre Street
    v1 = 1400
    kind = "Collector"
    net.add([R(u, -900), R(u, v1)], kind, "%d St SW" % ((u + 660) // 120 + 1))
    if u in BRIDGE_US:
        a = R(u, -900)
        tgt = nearest_on([p[:2] for p in north_bank], (a[0], a[1] - 700))
        net.add([a, (tgt[0], tgt[1])], "Collector", "%d St Bridge" % ((u + 660) // 120 + 1))
for idx, v in enumerate(rows_dt + rows_bl):
    main = v in (-380, 40, 700)
    kind = "Arterial" if main else "Local"
    oneway = (not main) and (idx % 2 == 1) and (v < 300 or v > 500)
    pts = [R(us[0], v), R(us[-1], v)]
    if oneway and (idx // 2) % 2 == 0:
        pts = pts[::-1]
    net.add(pts, kind, "%d Ave SW" % (idx + 1), oneway=oneway)
# Bow Trail: diagonal arterial from the west into the downtown corner (non-grid geometry)
net.add(smooth([(-1800, -560), (-1300, -640), (-900, -760), R(-660, -780)]), "Arterial", "Bow Trail")
# a second diagonal: Bridgeland Road, NE to downtown through the river bend
net.add(smooth([R(780, -380), (1000, -250), (1120, 300), (1100, 880)]), "Arterial", "Edmonton Link")

# ---- KENSINGTON-STYLE NORTH BANK GRID
kn_rows = {}
for i, y in enumerate((-1650, -1800, -1950)):
    kn_rows[y] = [(-900, y), (760, y - 25)]
    net.add(kn_rows[y], "Local", "%d Ave NW" % (i + 1))
for x in range(-900, 760, 150):
    y0 = y_at(riv_w, x)
    top = nearest_on(kn_rows[-1950], (x, -1960))
    net.add([(x, y0), top], "Local", "N-%d St NW" % ((x + 900) // 150 + 1))
net.add(smooth([(-900, -1650), (-1500, -1700), (-1850, -1720)]), "Collector", "Kensington Road")

# ---- RIVERWALK pedestrian paths (both banks) + footbridge
for sgn, nm in ((-1, "North Riverwalk"), (1, "South Riverwalk")):
    path = [p[:2] for p in offset_poly(RIVER, sgn * (80 + 85)) if -2600 < p[0] < 3000]
    net.add(path, "Path", nm)
fb = nearest_on(RIVER, (-650, -1100))
net.add([(fb[0] - 15, fb[1] + 190), (fb[0] - 15, fb[1] - 190)], "Path", "Peace Footbridge")

# ---- AIRPORT / OUTER COMMERCIAL (north-east)
airport_trail = smooth([nearest_on(prairie, (1500, -3000)), (2300, -3060), (3100, -2950), (3600, -2900)])
net.add(airport_trail, "Expressway", "Airport Trail")
ap_rows = {y: [(1750, y), (3600, y + 20)] for y in (-2650, -2300, -1950)}
for y, pts in ap_rows.items():
    net.add(pts, "Industrial", "Cargo Road %d" % (abs(y) // 100))
for x in (1950, 2350, 2750, 3150):
    top = nearest_on(airport_trail, (x, -3000))
    bot = nearest_on(ap_rows[-1950], (x, -1950))
    net.add([top, bot], "Industrial", "Aviation Way %d" % ((x - 1950) // 400 + 1))
net.add([nearest_on(airport_trail, (2350, -3050)), (2350, -3480), (3150, -3480), nearest_on(airport_trail, (3150, -3000))], "Service", "Terminal Loop")

# ---- INDUSTRIAL (east/south-east)
ind_rows = {y: [(1850, y), (3600, y + 15)] for y in (250, 560, 1180, 1490, 1800)}
for y, pts in ind_rows.items():
    net.add(pts, "Industrial", "Freight Rd %d" % (y // 100))
for x in (2000, 2280, 2560, 2840, 3120, 3400):
    top = nearest_on(ind_rows[250], (x, 250))
    bot = nearest_on(glen, (x, 2000))
    net.add([top, bot], "Industrial", "Industrial Way %d" % ((x - 2000) // 280 + 1))
net.add([(2420, 560), (2420, 700), (2700, 720)], "Service", "Yard Access A")
net.add([(2980, 1180), (2980, 1060), (3250, 1040)], "Service", "Yard Access B")
net.add([(2150, 1490), (2150, 1600), (2420, 1620)], "Service", "Yard Access C")

# ---- SUBURBS (curvilinear collectors + cul-de-sacs)
lakeside = smooth([(440, 2480), (200, 2560), (-300, 2700), (-800, 2650), (-1300, 2850), (-1706, 2910)], 50)
net.add(lakeside, "Arterial", "Lakeside Boulevard")
westgate = smooth([(-1790, 500), (-2300, 520), (-2800, 650), (-3300, 620), (-3600, 560)], 50)
net.add(westgate, "Arterial", "Foothill Gate")
crescent = smooth([(-300, 2700), (-420, 3100), (-700, 3200), (-980, 2900), (-900, 2660)], 40)
net.add(crescent, "Collector", "Crescent Drive")
loop_w = smooth([(-2300, 520), (-2450, 100), (-2900, 120), (-3050, 400), (-2850, 650)], 40)
net.add(loop_w, "Collector", "Ridgeview Way")
loop_w2 = smooth([(-2250, 530), (-2300, 950), (-2700, 1150), (-3100, 1000), (-3300, 620)], 40)
net.add(loop_w2, "Collector", "Silverado Drive")
lakeside_east = smooth([(440, 2480), (900, 2300), (1180, 2380), (1400, 2420)], 50)
net.add(lakeside_east, "Collector", "Southpointe Link")


def branches(collector_pts, spacing, length, name, skip=0, both=True, offset=0.0, kind="Local"):
    P = resample(collector_pts, 5.0)
    cum = [0.0]
    for i in range(1, len(P)):
        cum.append(cum[-1] + math.dist(P[i - 1], P[i]))
    s = spacing * 0.5 + offset
    count = 0
    n = 0
    while s < cum[-1] - spacing * 0.5:
        i = min(range(len(cum)), key=lambda k: abs(cum[k] - s))
        a, b = P[max(0, i - 2)], P[min(len(P) - 1, i + 2)]
        dx, dy = b[0] - a[0], b[1] - a[1]
        L = math.hypot(dx, dy)
        tx, ty = dx / L, dy / L
        for sgn in ((1, -1) if both else (1,)):
            nx, ny = -ty * sgn, tx * sgn
            ln = length * random.uniform(0.75, 1.2)
            p0 = P[i]
            E = (p0[0] + nx * ln, p0[1] + ny * ln)
            Cc = (E[0] + nx * 22, E[1] + ny * 22)
            a0 = math.atan2(E[1] - Cc[1], E[0] - Cc[0])
            ringpts = [(Cc[0] + 22 * math.cos(a0 + 2 * math.pi * k / 8), Cc[1] + 22 * math.sin(a0 + 2 * math.pi * k / 8)) for k in range(1, 9)]
            mid = (p0[0] + nx * ln * 0.5 + tx * random.uniform(-10, 10), p0[1] + ny * ln * 0.5 + ty * random.uniform(-10, 10))
            pts = [p0, mid, E] + ringpts
            check = [p0, mid, E] + ringpts
            bad = False
            for q in check:
                rd, rw = river_info(*q)
                if rd < rw + 150 or abs(q[0]) > 3350 or abs(q[1]) > 3350:
                    bad = True
            if not bad and not net.conflicts(check[1:], 30.0):
                net.add(pts, kind, "%s Cr %d" % (name, n + 1))
                n += 1
        s += spacing
    return n


nb = 0
nb += branches(lakeside, 105, 190, "Lakeside")
nb += branches(crescent, 100, 150, "Crescent", both=False)
nb += branches(westgate, 105, 200, "Foothill")
nb += branches(loop_w, 100, 150, "Ridgeview", both=False)
nb += branches(loop_w2, 100, 150, "Silverado", both=False)
nb += branches(lakeside_east, 100, 170, "Southpointe")
print("suburb branch streets:", nb)

# ---- FOOTHILL ROUTE: a small loop road off Trans-Canada West
net.add(smooth([(-3900, -250), (-4000, 500), (-4250, 900), (-4150, 1300)], 60), "Collector", "Elbow Valley Road")

net.planarize()

# ----------------------------------------------------------------------------- annotate nodes
deg = collections.defaultdict(list)
for i, e in enumerate(net.edges):
    if e["kind"] != "Path":
        deg[e["a"]].append(i)
        deg[e["b"]].append(i)
SIGNAL_KINDS = {"Arterial", "Expressway", "Collector", "Industrial"}
signal = set()
for n, es in deg.items():
    kinds = [net.edges[i]["kind"] for i in es]
    if len(es) >= 3 and sum(1 for k in kinds if k in SIGNAL_KINDS) >= 2 and not any(k == "Highway" for k in kinds):
        # keep ring/highway joins signal-free; ramp terminals are always signalised
        signal.add(n)
    if len(es) >= 3 and any(k == "Ramp" for k in kinds) and not any(k == "Highway" for k in kinds):
        signal.add(n)

# ----------------------------------------------------------------------------- locations
def snap_edge(x, y, vehicle=True):
    best = (1e18, None, None, None)
    for i, e in enumerate(net.edges):
        if vehicle and e["kind"] in ("Path", "Highway", "Ramp"):
            continue
        a, b = net.nodes[e["a"]], net.nodes[e["b"]]
        t, c = seg_closest((x, y), a, b)
        d = math.dist((x, y), c)
        if d < best[0]:
            best = (d, i, t, c)
    return best


def road_half_width(e):
    lanes = KINDS[e["kind"]][0]
    if e["kind"] == "Path":
        return 2.5
    return (lanes * 3.5 if e["oneway"] else lanes * 7.0) / 2


LOCS = []
def loc(id, name, kind, district, anchor, mode="road", radius=18, desc="", reward=0, tags="", side=1):
    x, y = anchor
    if mode == "free":
        px, py = x, y
    else:
        d, ei, t, c = snap_edge(x, y)
        e = net.edges[ei]
        a, b = net.nodes[e["a"]], net.nodes[e["b"]]
        dx, dy = b[0] - a[0], b[1] - a[1]
        L = math.hypot(dx, dy)
        if mode == "road":
            px, py = c
        else:  # side: beside the road, on the footpath/plaza
            off = road_half_width(e) + 7.0
            px, py = c[0] + (-dy / L) * off * side, c[1] + (dx / L) * off * side
    LOCS.append(dict(Id=id, DisplayName=name, Kind=kind, District=district, X=round(px, 1), Y=round(py, 1),
                     Radius=radius, Description=desc, DiscoverReward=reward, Tags=tags))

# downtown
loc("needle", "Skyline Needle", "Landmark", "Downtown", R(160, -250), "free", 60, "Observation tower and the heart of the skyline.", 150)
loc("calder", "Calder Tower Lobby", "Waypoint", "Downtown", R(-180, -380), "road", 14, "Pickup bay")
loc("law", "Riverfront Law Offices", "Waypoint", "Downtown", R(300, -780), "road", 12, "Loading zone")
loc("hotel", "Foothills Grand Hotel", "Waypoint", "Downtown", R(180, -100), "road", 12, "Valet bay")
loc("police_hq", "FRPS Central Station", "Police", "Downtown", R(-420, -240), "side", 20, "Foothills Regional Police Service HQ")
loc("conv_dt", "Chinook Corner Store", "Shop", "Downtown", R(60, -240), "side", 12, "Snacks, coffee and first aid.")
loc("dome", "Saddle Dome Arena", "Landmark", "Downtown", R(540, 200), "free", 70, "Home of the Stampeders hockey club.", 100)
loc("courier_hub", "Metro Courier Hub", "Giver", "Downtown", R(-300, 40), "side", 12, "Courier gigs: pick a parcel, beat the clock.", tags="gig")
# beltline
loc("diner", "Last Spike Diner", "Giver", "Beltline", R(-300, 520), "side", 12, "Marcy Delorme holds court in the corner booth.")
loc("garage", "Bow Valley Auto Works", "Garage", "Beltline", R(60, 700), "side", 16, "Repairs, paint and performance parts.")
loc("loft", "Beltline Lofts", "Property", "Beltline", R(-420, 800), "side", 12, "A downtown loft with a view of the skyline.")
loc("bakery", "Prairie Rye Bakery", "Waypoint", "Beltline", R(420, 500), "road", 12, "Pickup counter")
loc("tut_walk", "Walk Here", "Waypoint", "Beltline", R(-330, 548), "free", 7, "Tutorial marker")
loc("tut_car", "Loaner Car", "Waypoint", "Beltline", R(-240, 600), "road", 8, "Tutorial car spawn")
loc("hospital", "Bow Valley General Hospital", "Hospital", "Beltline", R(660, 1300), "side", 18, "Emergency")
loc("start", "Hostel Arrival Point", "Waypoint", "Beltline", R(-360, 520), "road", 8, "New game spawn")
loc("dealer", "Macleod Motor Mile", "Shop", "Beltline", (430, 1600), "side", 16, "Dealerships: new and used vehicles.")
loc("stampede_park", "Stampede Grounds", "Landmark", "Beltline", R(780, 400), "free", 60, "Fairgrounds, midway and rodeo arena.", 100)
# industrial
loc("whitaker", "Whitaker Freight Co.", "Giver", "Industrial", (2280, 560), "side", 14, "Owen Whitaker runs a clean, honest freight business.")
loc("yard_a", "Vehicle Yard A", "Waypoint", "Industrial", (2840, 250), "road", 16, "Impound and salvage yard")
loc("yard_b", "Vehicle Yard B", "Waypoint", "Industrial", (3120, 1180), "road", 16, "Auction lot")
loc("yard_c", "Vehicle Yard C", "Waypoint", "Industrial", (2560, 1800), "road", 16, "Trucking compound")
loc("redline", "Redline Hauling", "Waypoint", "Industrial", (3120, 560), "side", 14, "Dante Kowalczyk's depot.")
loc("chop", "Dunbar Auto Wreckers", "Waypoint", "Industrial", (2000, 1500), "road", 14, "Salvage yard that asks no questions.")
loc("depot", "Eastlake Freight Depot", "Property", "Industrial", (2560, 560), "side", 14, "A small transport business you can own.")
loc("safehouse", "Warehouse 9", "Waypoint", "Industrial", (2840, 1490), "road", 14, "Quiet loading dock")
loc("conv_ind", "Truckers' Fuel & Go", "Shop", "Industrial", (2000, 800), "side", 12, "Fuel, coffee and snacks for the road.")
# airport / commercial
loc("cargo", "Airport Cargo Depot", "Waypoint", "Airport", (2750, -3000), "road", 16, "Cargo handling bay")
loc("rental", "Prairie Vehicle Rental", "Landmark", "Airport", (2350, -2300), "side", 30, "Rental fleet lot.", 100)
loc("terminal", "Calgary Intl. Terminal (fictional)", "Landmark", "Airport", (2750, -3400), "free", 60, "Terminal approach", 120)
# suburbs
loc("plaza", "Southpointe Plaza", "Shop", "Suburb", (330, 2540), "side", 14, "Local shopping plaza with a big parking lot.")
loc("school", "Crescent Heights School", "Landmark", "Suburb", (-560, 2780), "side", 30, "Neighbourhood school and playground.", 80)
loc("westpark", "Ridgeview Community Park", "Landmark", "Suburb", (-2700, 400), "side", 30, "Community park and rink.", 80)
# river / parks / overlook
rv = nearest_on([p[:2] for p in offset_poly(RIVER, 165)], (0, -1000))
loc("riverwalk", "Bow Riverwalk Lookout", "Landmark", "Riverwalk", rv, "free", 25, "The skyline at its best.", 150)
ri = nearest_on([p[:2] for p in offset_poly(RIVER, -165)], (-350, -1400))
loc("island", "Prince's Isle Gardens", "Landmark", "Riverwalk", ri, "free", 40, "Riverside gardens and picnic lawns.", 100)
loc("overlook", "Foothills Overlook", "Overlook", "City Edge", (-4480, 250), "free", 40, "The Rockies on a clear day.", 250)
loc("east_gate", "East City Limit", "Landmark", "City Edge", (4450, -120), "free", 30, "The prairie begins.", 100)
# gig waypoints
GIGS = [("g_bl1", R(240, 1000), "Beltline"), ("g_dt1", R(-420, -520), "Downtown"), ("g_dt2", R(420, -380), "Downtown"),
        ("g_kn1", (-300, -1650), "Kensington"), ("g_in1", (2280, 1180), "Industrial"), ("g_in2", (3120, 250), "Industrial"),
        ("g_su1", (-400, 2640), "Suburb"), ("g_su2", (-2500, 520), "Suburb"), ("g_ap1", (2350, -2300), "Airport"),
        ("g_ap2", (2750, -2650), "Airport"), ("g_bl2", R(-540, 1200), "Beltline")]
for gid, anchor, dist_ in GIGS:
    loc(gid, "Gig stop (%s)" % dist_, "Waypoint", dist_, anchor, "road", 14, "Courier stop", tags="gig")
# mission checkpoints
def prairie_pt(y):
    return min(prairie, key=lambda p: abs(p[1] - y))
for i, y in enumerate((-700, 100, 900, 1500, 2400, 3000)):
    p = prairie_pt(y)
    loc("cp_hwy%d" % (i + 1), "Highway checkpoint %d" % (i + 1), "Waypoint", "Highway", p, "free", 24)
loc("hwy_start", "Prairie Trail On-Ramp", "Waypoint", "Highway", prairie_pt(-1700), "free", 20)
race = [(2000, 560), (3400, 560), (3400, 1490), (2000, 1490)]
for i, p in enumerate(race):
    loc("cp_race%d" % (i + 1), "Race checkpoint %d" % (i + 1), "Waypoint", "Industrial", p, "road", 20)
loc("convoy_end", "Convoy Destination", "Waypoint", "Industrial", (2000, 250), "road", 18)
loc("meet_overlook", "Bow River Meet", "Waypoint", "Riverwalk", nearest_on(riv_w, (-450, -1400)), "free", 20, "Inspector Calloway's meeting spot")

# ----------------------------------------------------------------------------- write CSVs
def write_csv(name, header, rows):
    with open(os.path.join(DATA, name), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)

os.makedirs(DATA, exist_ok=True)
write_csv("RoadNodes.csv", ["Name", "X", "Y", "Z", "Signal"],
          [["n%d" % i, round(n[0], 1), round(n[1], 1), round(n[2], 2), "True" if i in signal else "False"] for i, n in enumerate(net.nodes)])
write_csv("RoadEdges.csv", ["Name", "A", "B", "Kind", "OneWay", "Bridge", "Road"],
          [["e%d" % i, "n%d" % e["a"], "n%d" % e["b"], e["kind"], "True" if e["oneway"] else "False",
            "True" if e["bridge"] else "False", e["name"]] for i, e in enumerate(net.edges)])
write_csv("River.csv", ["Name", "X", "Y", "HalfWidth"], [["r%d" % i, round(p[0], 1), round(p[1], 1), round(p[2], 1)] for i, p in enumerate(RIVER)])
write_csv("Locations.csv", ["Name", "DisplayName", "Kind", "District", "X", "Y", "Radius", "Description", "DiscoverReward", "Tags"],
          [[l["Id"], l["DisplayName"], l["Kind"], l["District"], l["X"], l["Y"], l["Radius"], l["Description"], l["DiscoverReward"], l["Tags"]] for l in LOCS])

# ----------------------------------------------------------------------------- validation
def validate():
    ok = True
    print("nodes %d  edges %d  signals %d  locations %d" % (len(net.nodes), len(net.edges), len(signal), len(LOCS)))
    kinds = collections.Counter(e["kind"] for e in net.edges)
    print("edge kinds:", dict(kinds))
    # grade
    worst = 0.0
    for e in net.edges:
        a, b = net.nodes[e["a"]], net.nodes[e["b"]]
        L = math.dist(a[:2], b[:2])
        g = abs(a[2] - b[2]) / L
        if g > worst:
            worst, we = g, e
    print("max road grade: %.1f%%" % (worst * 100))
    if worst > 0.14:
        print("  !! grade too steep"); ok = False
    # out-of-bounds
    oob = [i for i, n in enumerate(net.nodes) if abs(n[0]) > 4600 or abs(n[1]) > 4600]
    print("nodes outside +-4600 m:", len(oob))
    # edge length stats
    longest = max(math.dist(net.nodes[e["a"]][:2], net.nodes[e["b"]][:2]) for e in net.edges)
    print("longest edge: %.0f m" % longest)
    # directed state graph with the C++ router's turn rule
    def heading(e, forward):
        a, b = net.nodes[e["a"]], net.nodes[e["b"]]
        if not forward:
            a, b = b, a
        return math.atan2(b[1] - a[1], b[0] - a[0])
    states = []
    for i, e in enumerate(net.edges):
        if e["kind"] == "Path":
            continue
        states.append((i, True))
        if not e["oneway"]:
            states.append((i, False))
    by_from = collections.defaultdict(list)
    for (i, f) in states:
        e = net.edges[i]
        by_from[e["a"] if f else e["b"]].append((i, f))
    def succ(s):
        i, f = s
        e = net.edges[i]
        n = e["b"] if f else e["a"]
        h = heading(e, f)
        out = []
        for (j, g) in by_from[n]:
            if j == i:
                continue
            d = abs((heading(net.edges[j], g) - h + math.pi) % (2 * math.pi) - math.pi)
            if d <= math.radians(115):
                out.append((j, g))
        if not out and not e["oneway"]:
            out.append((i, not f))  # dead end: U-turn (mirrors CADRoadNetwork::GetSuccessors)
        return out
    # strongly connected components (Kosaraju) over states
    adj = {s: succ(s) for s in states}
    radj = collections.defaultdict(list)
    for s, ts in adj.items():
        for t in ts:
            radj[t].append(s)
    seen, order = set(), []
    for s0 in states:
        if s0 in seen:
            continue
        stack = [(s0, iter(adj[s0]))]
        seen.add(s0)
        while stack:
            s, it = stack[-1]
            for t in it:
                if t not in seen:
                    seen.add(t)
                    stack.append((t, iter(adj[t])))
                    break
            else:
                order.append(s)
                stack.pop()
    comp = {}
    cid = 0
    for s0 in reversed(order):
        if s0 in comp:
            continue
        st = [s0]
        comp[s0] = cid
        while st:
            s = st.pop()
            for t in radj[s]:
                if t not in comp:
                    comp[t] = cid
                    st.append(t)
        cid += 1
    sizes = collections.Counter(comp.values())
    big, bigsz = sizes.most_common(1)[0]
    print("drivable directed edges: %d, largest strongly-connected set: %d (%.1f%%)" % (len(states), bigsz, 100 * bigsz / len(states)))
    stuck = [s for s in states if comp[s] != big]
    stuck_edges = collections.Counter(net.edges[i]["name"] for (i, f) in stuck)
    if stuck:
        print("  directed edges outside main component: %d  e.g. %s" % (len(stuck), stuck_edges.most_common(6)))
    # name -> main-component membership for roads that matter
    for nm in ("Prairie Trail", "Glen Trail", "Chinook Trail", "Stoney Ring Road", "Macleod Trail", "Trans-Canada West",
               "Airport Trail", "Southbridge Road", "Centre Street", "Riverside Drive"):
        es = [(i, f) for (i, f) in states if net.edges[i]["name"] == nm]
        inside = sum(1 for s in es if comp[s] == big)
        print("   %-20s %4d/%4d in main component" % (nm, inside, len(es)))
        if es and inside < len(es) * 0.98:
            ok = False
    # every location reachable
    node_main = set()
    for (i, f) in states:
        if comp[(i, f)] == big:
            node_main.add(net.edges[i]["a"]); node_main.add(net.edges[i]["b"])
    def near_main(x, y):
        return min(math.dist((x, y), net.nodes[n][:2]) for n in node_main)
    for l in LOCS:
        d = near_main(l["X"], l["Y"])
        if d > 120 and l["Kind"] != "Landmark":
            print("  !! location %s is %.0f m from the drivable network" % (l["Id"], d)); ok = False
    # bridge sanity
    nb = sum(1 for e in net.edges if e["bridge"])
    print("bridge edges:", nb)
    # dead-end highways
    de = collections.Counter()
    for n, es in deg.items():
        if len(es) == 1 and net.edges[es[0]]["kind"] in ("Highway", "Expressway"):
            de[net.edges[es[0]]["name"]] += 1
    print("highway dead ends (intended: map-edge stubs):", dict(de))
    return ok


def check_missions():
    ok = True
    ids = {l["Id"] for l in LOCS}
    for fn in ("MissionStages.csv",):
        p = os.path.join(DATA, fn)
        if not os.path.exists(p):
            return ok
        with open(p, newline="") as f:
            for row in csv.DictReader(f):
                for col in ("Location", "Locations"):
                    v = (row.get(col) or "").strip()
                    for part in [x for x in v.split(";") if x]:
                        if part not in ids:
                            print("  !! MissionStages references unknown location '%s' (mission %s)" % (part, row.get("MissionId"))); ok = False
    return ok


def preview():
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.collections import LineCollection
    fig, ax = plt.subplots(figsize=(14, 14), dpi=110)
    ax.set_facecolor("#e9efe3")
    ax.plot([p[0] for p in RIVER], [p[1] for p in RIVER], color="#6aa7d8", lw=6, solid_capstyle="round", zorder=1)
    style = {"Highway": ("#d1483a", 2.6), "Expressway": ("#e08b2c", 2.0), "Arterial": ("#444", 1.5), "Collector": ("#666", 1.0),
             "Local": ("#999", 0.6), "Ramp": ("#b06ad8", 1.5), "Industrial": ("#7b6a4a", 1.0), "Service": ("#bbb", 0.6), "Path": ("#2c9a4b", 0.9)}
    for kind, (col, lw) in style.items():
        segs = [[net.nodes[e["a"]][:2], net.nodes[e["b"]][:2]] for e in net.edges if e["kind"] == kind]
        ax.add_collection(LineCollection(segs, colors=col, linewidths=lw, zorder=2))
    segs = [[net.nodes[e["a"]][:2], net.nodes[e["b"]][:2]] for e in net.edges if e["bridge"]]
    ax.add_collection(LineCollection(segs, colors="#1d4f91", linewidths=3, zorder=3))
    sx = [net.nodes[n][0] for n in signal]; sy = [net.nodes[n][1] for n in signal]
    ax.scatter(sx, sy, s=6, c="#ffcc00", zorder=4, edgecolors="k", linewidths=0.2)
    colmap = {"Giver": "#d62728", "Shop": "#1f77b4", "Garage": "#ff7f0e", "Property": "#2ca02c", "Landmark": "#9467bd",
              "Police": "#08306b", "Hospital": "#e377c2", "Overlook": "#17becf", "Waypoint": "#bbbbbb"}
    for l in LOCS:
        ax.scatter([l["X"]], [l["Y"]], s=34 if l["Kind"] != "Waypoint" else 8, c=colmap.get(l["Kind"], "k"), zorder=5, edgecolors="k", linewidths=0.4)
        if l["Kind"] not in ("Waypoint",):
            ax.annotate(l["DisplayName"], (l["X"], l["Y"]), fontsize=5.5, xytext=(3, 3), textcoords="offset points", zorder=6)
    ax.plot([-H, H, H, -H, -H], [-H, -H, H, H, -H], ls=":", color="k", lw=0.5)
    ax.set_xlim(-4700, 4700); ax.set_ylim(4700, -4700)  # +Y south (down), matches in-game map
    ax.set_aspect("equal"); ax.set_title("Calgary After Dark - generated road network (north up, metres)")
    fig.savefig(PREVIEW)
    print("preview written to", os.path.relpath(PREVIEW))


if __name__ == "__main__":
    good = validate() and check_missions()
    if "--preview" in sys.argv:
        preview()
    print("VALIDATION:", "PASS" if good else "FAIL")
    sys.exit(0 if good else 1)
