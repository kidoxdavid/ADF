#!/usr/bin/env python3
"""
Calgary After Dark - gameplay data tables.

Single source of truth for Vehicles / Upgrades / Items / Shops / Properties / Missions /
MissionStages. Writes the CSVs in Content/Data that the game imports into UDataTables at
runtime (and that can also be imported by hand in the editor using the row structs in
Source/CalgaryAfterDark/CADTypes.h). Column names MUST match the C++ struct property names.

Stage types:  Dialogue GoTo DriveTo EnterVehicle FindVehicle Checkpoints Choice Evade Ram Race
              Escape OpenMap Complete
Dialogue:     lines separated by '|'; optional 'Speaker::text' prefix per line.
Choice:       ChoiceA/B/C = 'Label' or 'Label|requirement' (e.g. rep_business>=8, cash>=250)
Effects:      cash+N cash-N rep_public+N rep_business+N rep_underworld+N heat+N wanted=N
              flag:name grant:vehicleId time=HH.H  (';' separated)
"""
import csv, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "Content", "Data")


def write(name, rows):
    cols = list(rows[0].keys())
    with open(os.path.join(DATA, name), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        w.writerows(rows)


# --------------------------------------------------------------------------- vehicles
def veh(id, name, cat, price, mass, accel, top, brake, steer, grip, susp, res, off, L, W, H, color, tw, dealer, rep):
    return {"Name": id, "DisplayName": name, "Category": cat, "Price": price, "MassKg": mass, "AccelMps2": accel,
            "TopSpeedKph": top, "BrakeMps2": brake, "MaxSteerDeg": steer, "Grip": grip, "SuspensionHz": susp,
            "CollisionResistance": res, "OffRoad": off, "LengthM": L, "WidthM": W, "HeightM": H, "Color": color,
            "TrafficWeight": tw, "Dealer": "True" if dealer else "False", "RepairPerPoint": rep}

VEHICLES = [
    veh("kestrel", "Kestrel C1", "Compact", 4500, 1150, 5.5, 165, 9.5, 35, 1.00, 1.9, 0.8, 0.2, 3.9, 1.70, 1.45, "#5B8DB8", 30, True, 25),
    veh("maple", "Maple LX", "Sedan", 9000, 1450, 5.2, 185, 9.5, 32, 1.05, 1.7, 1.0, 0.2, 4.7, 1.82, 1.43, "#A7A9AC", 28, True, 35),
    veh("foothill", "Foothill X", "SUV", 14000, 1950, 4.6, 175, 9.0, 31, 1.00, 1.6, 1.2, 0.7, 4.8, 1.95, 1.75, "#3F4B3C", 18, True, 50),
    veh("ranchhand", "Ranchhand 150", "Pickup", 16000, 2250, 4.4, 170, 8.8, 30, 0.95, 1.5, 1.3, 0.8, 5.4, 2.00, 1.85, "#8C2F2B", 14, True, 55),
    veh("courier", "Courier V", "Van", 11000, 2100, 3.9, 150, 8.5, 30, 0.95, 1.5, 1.2, 0.3, 5.2, 2.00, 2.10, "#E8E8E8", 8, True, 45),
    veh("haul7", "Haul 7", "Truck", 22000, 6500, 2.8, 125, 7.5, 25, 0.90, 1.3, 1.6, 0.4, 7.8, 2.50, 3.00, "#C9A227", 6, True, 90),
    veh("stampede", "Stampede RS", "PerfSedan", 28000, 1600, 8.0, 235, 12.0, 34, 1.20, 2.0, 1.0, 0.1, 4.8, 1.85, 1.38, "#B0221F", 4, True, 70),
    veh("chinook_gt", "Chinook GT", "Sports", 45000, 1380, 9.2, 265, 13.0, 36, 1.30, 2.2, 0.9, 0.05, 4.4, 1.90, 1.20, "#F2B134", 2, True, 100),
    veh("patrol", "FRPS Interceptor", "Police", 0, 1750, 7.2, 215, 11.5, 34, 1.15, 1.9, 1.1, 0.2, 4.9, 1.90, 1.45, "#F4F4F4", 0, False, 0),
]

# --------------------------------------------------------------------------- upgrades
UPGRADES = []
def upg(cat, lvl, price, name, bonus):
    UPGRADES.append({"Name": "%s_%d" % (cat.lower(), lvl), "DisplayName": name, "Category": cat, "Level": lvl, "Price": price, "Bonus": bonus})
for l, (p, b) in enumerate([(1200, .08), (3000, .17), (6500, .27)], 1):
    upg("Engine", l, p, ["Stage 1 Tune", "Stage 2 Turbo", "Stage 3 Race Build"][l - 1], b)
for l, (p, b) in enumerate([(600, .10), (1500, .22), (3200, .35)], 1):
    upg("Brakes", l, p, ["Sport Pads", "Slotted Rotors", "Big Brake Kit"][l - 1], b)
for l, (p, b) in enumerate([(800, .06), (2000, .13), (4500, .20)], 1):
    upg("Handling", l, p, ["Sport Springs", "Coilovers", "Full Suspension + Sway Bars"][l - 1], b)
for l, (p, b) in enumerate([(400, .02), (900, .04), (1800, .06)], 1):
    upg("Wheels", l, p, ["Steel Sport Rims", "Alloy Multi-Spoke", "Forged Deep-Dish"][l - 1], b)

ITEMS = [
    {"Name": "coffee", "DisplayName": "Chinook Coffee", "Price": 4, "Effect": "stamina+100", "Description": "Double-double. Refills stamina."},
    {"Name": "bar", "DisplayName": "Prairie Granola Bar", "Price": 3, "Effect": "health+15", "Description": "Chewy and honest."},
    {"Name": "firstaid", "DisplayName": "First Aid Kit", "Price": 25, "Effect": "health+50", "Description": "Patches you up."},
]

SHOPS = [
    {"Name": "conv_dt", "DisplayName": "Chinook Corner Store", "Type": "Convenience", "Location": "conv_dt", "Stock": "coffee;bar;firstaid"},
    {"Name": "conv_ind", "DisplayName": "Truckers' Fuel & Go", "Type": "Convenience", "Location": "conv_ind", "Stock": "coffee;bar;firstaid"},
    {"Name": "plaza", "DisplayName": "Southpointe Plaza Market", "Type": "Convenience", "Location": "plaza", "Stock": "coffee;bar;firstaid"},
    {"Name": "dealer", "DisplayName": "Macleod Motor Mile", "Type": "Dealership", "Location": "dealer",
     "Stock": "kestrel;maple;foothill;ranchhand;courier;haul7;stampede;chinook_gt"},
]

PROPERTIES = [
    {"Name": "loft", "DisplayName": "Beltline Loft", "Location": "loft", "Price": 18000, "IncomePerDay": 0, "VehicleSlots": 2,
     "SavePoint": "True", "Description": "A bright loft near the nightlife. Save point and two vehicle slots."},
    {"Name": "depot", "DisplayName": "Eastlake Freight Depot", "Location": "depot", "Price": 60000, "IncomePerDay": 600, "VehicleSlots": 4,
     "SavePoint": "True", "Description": "A small transport business. Earns $600 per in-game day, plus a save point and storage."},
]

# --------------------------------------------------------------------------- missions
MISSIONS = []
STAGES = []

def mission(id, title, giver, cat, brief, prereq="", minrep="", night=False, cash=0, pub=0, biz=0, under=0, vehicle="",
            bonus_per_sec=0, optional="", repeatable=False):
    MISSIONS.append({"Name": id, "Title": title, "Giver": giver, "Category": cat, "Brief": brief, "Prereq": prereq,
                     "MinRep": minrep, "Night": "True" if night else "False", "RewardCash": cash, "RewardPublic": pub,
                     "RewardBusiness": biz, "RewardUnderworld": under, "RewardVehicle": vehicle,
                     "TimeBonusPerSec": bonus_per_sec, "Optional": optional, "Repeatable": "True" if repeatable else "False"})
    mission.cur, mission.idx = id, 0

def stage(type_, text="", loc="", radius=0, time=0, speaker="", dialogue="", param="", veh="", cp=True, enter="",
          a="", b="", c="", ja=-1, jb=-1, jc=-1, ea="", eb="", ec=""):
    i = mission.idx
    STAGES.append({"Name": "%s_%d" % (mission.cur, i), "MissionId": mission.cur, "Index": i, "Type": type_, "Text": text,
                   "Location": loc, "Radius": radius, "TimeLimit": time, "Speaker": speaker, "Dialogue": dialogue,
                   "Param": param, "VehicleId": veh, "ChoiceA": a, "ChoiceB": b, "ChoiceC": c, "JumpA": ja, "JumpB": jb,
                   "JumpC": jc, "EffectA": ea, "EffectB": eb, "EffectC": ec, "OnEnter": enter,
                   "Checkpoint": "True" if cp else "False"})
    mission.idx += 1

# ---- Mission 1 ---------------------------------------------------------------
mission("m1_welcome", "Welcome to Calgary", "diner", "Legit",
        "Marcy Delorme needs a trustworthy driver for a simple first-day job: pick up a bakery order and deliver it downtown.",
        cash=450, pub=5, vehicle="kestrel", optional="NoDamage:100")
stage("Dialogue", loc="diner", dialogue=(
    "Marcy::You're the new one. Rowan, right? The hostel clerk says you walked in off the Greyhound with one bag and a map you didn't need.|"
    "Rowan::The map's for appearances. I'm good with roads.|"
    "Marcy::Good. In Calgary the road is the whole religion. Chinook arch overhead, Prairie Trail underneath, and everyone late for something.|"
    "Marcy::First-day job, nothing spicy. Walk over to the curb marker, there's a loaner Kestrel waiting for you."))
stage("GoTo", "Walk to the marker. WASD to move, hold Shift to sprint, Space to jump.", loc="tut_walk", radius=6)
stage("EnterVehicle", "Get into the loaner Kestrel. Press E next to the car.", loc="tut_car", veh="kestrel")
stage("DriveTo", "Pick up the order at Prairie Rye Bakery. Stop inside the marker.", loc="bakery", radius=12, param="stop")
stage("Dialogue", loc="bakery", dialogue=(
    "Baker::Marcy's friend? Two dozen rye loaves and the cinnamon buns. Hot, so don't take the long way.|"
    "Rowan::Where's it going?|Baker::Foothills Grand Hotel. Their valet bay. Press M and drop a waypoint if you've forgotten the way."))
stage("OpenMap", "Press M to open the city map. Left-click anywhere to set a waypoint, right-click to clear it.")
stage("DriveTo", "Deliver the bread to the Foothills Grand Hotel valet bay.", loc="hotel", radius=12, param="stop")
stage("Dialogue", loc="hotel", dialogue=(
    "Valet::Right on time, and still warm. You must be Marcy's find.|"
    "Marcy::(radio) Told you. Keep the Kestrel for now, Rowan. Come see me at the diner when you're ready for more."))
stage("Complete", ea="cash+0")

# ---- Mission 2 ---------------------------------------------------------------
mission("m2_delivery", "Downtown Delivery", "diner", "Legit",
        "A signed contract has to cross downtown before the law office loading dock closes. Traffic and tight parking are the real enemy.",
        prereq="m1_welcome", cash=700, pub=3, biz=2, bonus_per_sec=4, optional="NoDamage:150;NoWanted:100")
stage("Dialogue", loc="diner", dialogue=(
    "Marcy::Calder Tower has a contract that can't be late. The law office across downtown closes its loading dock 150 seconds after you collect it.|"
    "Rowan::Downtown at rush hour?|"
    "Marcy::Welcome to the job. Lights are your friend and parked delivery vans are not. Park inside the marker, and fully stop."))
stage("DriveTo", "Pick up the sealed contract at Calder Tower. Stop inside the marker.", loc="calder", radius=12, param="stop")
stage("DriveTo", "Deliver the contract to Riverfront Law Offices before the dock closes.", loc="law", radius=12, time=150, param="stop")
stage("Dialogue", loc="law", dialogue=(
    "Clerk::Signed, sealed, and with eleven seconds to spare in my head. Thank you.|"
    "Marcy::(radio) That's a clean run. People notice clean runs."))
stage("Complete", ea="cash+0")

# ---- Mission 3 ---------------------------------------------------------------
mission("m3_missing", "The Missing Vehicle", "whitaker", "Mixed",
        "Owen Whitaker lost a pickup from his yard. Search the industrial vehicle yards, then decide what to do with what you find.",
        prereq="m1_welcome", cash=0, optional="NoWanted:150")
stage("Dialogue", loc="whitaker", dialogue=(
    "Owen::Thanks for coming out. My father started this company with one truck and a handshake. Tuesday night a Ranchhand pickup vanished from our lot.|"
    "Owen::The police have a form for it. I have forty deliveries a week and one fewer truck.|"
    "Rowan::You think it's in an industrial yard.|"
    "Owen::Three yards take things in without asking much. Check Yard A, B and C. If you find it, drive it out."))
stage("FindVehicle", "Search the vehicle yards for Whitaker's missing Ranchhand pickup.", loc="yard_a;yard_b;yard_c", radius=25, veh="ranchhand")
stage("Dialogue", dialogue=(
    "Hector::You found it. My cousin parked it here for safekeeping. Look, I can pretend I never saw you, or we can discuss a finder's fee.|"
    "Rowan::(thinking) Whitaker would pay for honesty. Dunbar Wreckers pays for silence. Hector wants a cut either way."))
stage("Choice", "What do you do with the truck?",
      a="Drive it back to Owen Whitaker|", b="Sell it to Dunbar Wreckers, no questions asked|",
      c="Pay Hector $250 to forget the whole thing|cash>=250", ja=4, jb=7, jc=4, ea="rep_business+3", eb="rep_underworld+4", ec="cash-250;rep_business+2")
stage("DriveTo", "Return the pickup to Whitaker Freight Co.", loc="whitaker", radius=14, param="stop;mv")
stage("Dialogue", loc="whitaker", dialogue=(
    "Owen::That's my truck. I won't ask how, because you look like someone who'll tell me the honest version later.|"
    "Owen::Take this. And Rowan, my door is open."))
stage("Complete", ea="cash+800;rep_business+8;rep_public+3")
stage("DriveTo", "Deliver the pickup to Dunbar Auto Wreckers.", loc="chop", radius=14, param="stop;mv", enter="heat+1")
stage("Dialogue", loc="chop", dialogue=(
    "Wrecker::Nice truck. It will be forty parts by Friday. No paperwork, no names. That's the whole deal.|"
    "Wrecker::Fourteen hundred. Cash. Smile, you're on nobody's camera."))
stage("Complete", ea="cash+1400;rep_underworld+10;flag:sold_truck")

# ---- Mission 4 ---------------------------------------------------------------
mission("m4_highway", "Highway Pressure", "diner", "Mixed",
        "Prove yourself on Prairie Trail: six checkpoints against the clock, through live traffic, in a borrowed Stampede RS.",
        prereq="m2_delivery", bonus_per_sec=8, cash=900, pub=4, optional="NoDamage:250;NoWanted:150")
stage("Dialogue", loc="diner", dialogue=(
    "Marcy::Dante's drivers run Prairie Trail like it's their driveway. I need to know you can keep up. Not impress them. Keep up.|"
    "Marcy::There's a Stampede RS out front. Borrowed, so bring it back in one piece. Six checkpoints down the highway, 200 seconds.|"
    "Rowan::Traffic?|Marcy::Lots. That's the point."))
stage("EnterVehicle", "Get into the Stampede RS.", veh="stampede")
stage("DriveTo", "Drive to the Prairie Trail on-ramp.", loc="hwy_start", radius=25)
stage("Checkpoints", "Hit all six highway checkpoints. Merge cleanly and watch the traffic.",
      loc="cp_hwy1;cp_hwy2;cp_hwy3;cp_hwy4;cp_hwy5;cp_hwy6", radius=28, time=200, param="traffic+")
stage("Dialogue", dialogue=("Marcy::(radio) Not bad. Smooth through the Southbridge overpass. Bring the car back to Bow Valley Auto Works, the garage guys will check it over.",))
stage("DriveTo", "Return the Stampede RS to Bow Valley Auto Works.", loc="garage", radius=18, param="stop;mv")
stage("Complete", ea="cash+0")

# ---- Mission 5 ---------------------------------------------------------------
mission("m5_rival", "The Rival Contract", "whitaker", "Mixed",
        "Redline Hauling is undercutting Whitaker Freight on a big contract. Negotiate, out-drive Dante Kowalczyk, or wreck his convoy.",
        prereq="m3_missing", optional="NoWanted:200")
stage("Dialogue", loc="whitaker", dialogue=(
    "Owen::Dante Kowalczyk wants the Foothills Brewery pallet contract. He's quoting under cost, which means he's not hauling beer, he's hauling something else.|"
    "Owen::Go see him at Redline Hauling. Talk if you can. I won't tell you how to handle him."))
stage("DriveTo", "Meet Dante at Redline Hauling.", loc="redline", radius=15, param="stop")
stage("Dialogue", loc="redline", dialogue=(
    "Dante::Rowan. Marcy's driver, Whitaker's errand-runner. You'd be surprised how small this city is when it's thirty below.|"
    "Dante::The contract is a lane, and I'm already driving in it. You can pull over, or we can find out who the lane belongs to.|"
    "Dante::Pick your weather."))
stage("Choice", "How do you answer Dante?",
      a="Negotiate a split|rep_business>=8", b="Challenge him to a race for the contract|", c="Wreck his convoy truck|",
      ja=4, jb=6, jc=9)
stage("Dialogue", dialogue=(
    "Dante::You carry Owen's name like a coat that fits. Fine. Half the lane, and we both stop pretending.|"
    "Dante::Tell Whitaker the pallets split down the middle. And Rowan. Come see me if you ever outgrow his hours."))
stage("Complete", ea="cash+900;rep_business+10;flag:rival_split")
stage("Race", "Beat Dante's Stampede through all four checkpoints in the industrial district.",
      loc="cp_race1;cp_race2;cp_race3;cp_race4;redline", radius=26, time=180, param="speed:0.93", veh="stampede")
stage("Dialogue", dialogue=("Dante::(leaning on his hood) A clean line through Freight Road 14. All right, the contract is yours. This time.",))
stage("Complete", ea="cash+1500;rep_underworld+5;rep_public+3;flag:rival_beaten_race")
stage("Ram", "Wreck Dante's convoy truck before it reaches its drop-off.", loc="redline;convoy_end", radius=16, time=150, veh="haul7")
stage("Dialogue", dialogue=("Marcy::(radio) That was loud. Dante's people are already talking about you. Keep your head down for a day or two.",))
stage("Complete", ea="cash+1800;rep_underworld+12;heat+1;flag:rival_wrecked")

# ---- Mission 6 ---------------------------------------------------------------
mission("m6_afterdark", "After Dark", "diner", "Mixed",
        "One package, three buyers, and a long night. Collect it, lose Dante's crew and the police, then decide who gets it.",
        prereq="m4_highway;m5_rival", night=True, optional="NoDamage:300")
stage("Dialogue", loc="diner", enter="time=21.5", dialogue=(
    "Marcy::It's dark enough now. Here's the shape of it: a sealed package at the Airport Cargo Depot. Dante wants it, the police want to know who has it, and I want you alive.|"
    "Rowan::That's a long list of wants.|"
    "Marcy::That's every job in this city after dark. Go. Don't stop until you hear from me."))
stage("DriveTo", "Collect the package at the Airport Cargo Depot.", loc="cargo", radius=16, param="stop")
stage("Dialogue", loc="cargo", dialogue=(
    "Handler::It's yours. Three cars just rolled into the lot, Redline plates, and I don't think they're here for coffee.|"
    "Handler::Back gate. Go."))
stage("Escape", "Lose Dante's crew and reach Warehouse 9.", loc="safehouse", radius=18, time=260, param="n:3;veh:stampede")
stage("Dialogue", dialogue=("Marcy::(radio) Scanner says FRPS got a tip. Inspector Calloway's units are converging on you. You're about to be very popular.",), enter="wanted=3")
stage("Evade", "Lose the police. Break line of sight and stay hidden until the search ends.", param="3")
stage("GoTo", "The Inspector wants to meet at the Bow River. Walk or drive to the meeting point.", loc="meet_overlook", radius=22)
stage("Dialogue", loc="meet_overlook", dialogue=(
    "Calloway::Rowan Vale. I'm Inspector Calloway. I've watched you for three weeks. You've been careful, which means you've been paid to be.|"
    "Dante::(stepping out of the dark) Inspector. You always did choose the better view. Rowan, that package is a lane. Hand it over and the lane's yours.|"
    "Marcy::(radio, quiet) Whatever you pick, pick it fast."))
stage("Choice", "Who gets the package?",
      a="Hand it to Inspector Calloway|", b="Sell it to Dante for $8,000|", c="Throw it into the Bow River|", ja=9, jb=11, jc=13)
stage("Dialogue", dialogue=("Calloway::That's not a favour, it's a start. People who help me eventually get to leave the game.|Calloway::Go home, Rowan. Sleep.",))
stage("Complete", ea="cash+2000;rep_public+15;rep_business+5;flag:ending_law")
stage("Dialogue", dialogue=("Dante::Smart. The city is a river, Rowan. You can be the current or you can be the bridge.|Dante::Eight thousand. And my number.",))
stage("Complete", ea="cash+8000;rep_underworld+20;heat+1;flag:ending_underworld")
stage("Dialogue", dialogue=("Marcy::(radio) You... threw it in the Bow? Rowan. That's the most Calgary thing I've ever heard.|Marcy::Nobody gets it. Nobody wins. Come by the diner. First round's on me.",))
stage("Complete", ea="cash+3500;rep_public+5;rep_underworld+5;flag:ending_independent")


# --------------------------------------------------------------------------- validation
def validate():
    ok = True
    ids = {m["Name"] for m in MISSIONS}
    for m in MISSIONS:
        for p in [x for x in m["Prereq"].split(";") if x]:
            if p not in ids:
                print("!! %s prereq %s unknown" % (m["Name"], p)); ok = False
    for m in MISSIONS:
        ss = [s for s in STAGES if s["MissionId"] == m["Name"]]
        n = len(ss)
        if ss[-1]["Type"] != "Complete":
            print("!! %s last stage is not Complete" % m["Name"]); ok = False
        # every stage must reach a Complete without falling off the end
        reach = set()
        def walk(i):
            if i in reach or i >= n:
                return
            reach.add(i)
            s = ss[i]
            if s["Type"] == "Complete":
                return
            if s["Type"] == "Choice":
                for j in (s["JumpA"], s["JumpB"], s["JumpC"]):
                    if j >= 0:
                        walk(j)
            else:
                walk(i + 1)
        walk(0)
        dead = [i for i in range(n) if i not in reach]
        if dead:
            print("!! %s unreachable stages: %s" % (m["Name"], dead)); ok = False
        for s in ss:
            if s["Type"] == "Choice":
                for k in "ABC":
                    if s["Choice" + k] and not (0 <= s["Jump" + k] < n):
                        print("!! %s choice %s bad jump" % (m["Name"], k)); ok = False
        print("  %-14s %2d stages, giver=%s" % (m["Name"], n, m["Giver"]))
    return ok


if __name__ == "__main__":
    os.makedirs(DATA, exist_ok=True)
    write("Vehicles.csv", VEHICLES)
    write("Upgrades.csv", UPGRADES)
    write("Items.csv", ITEMS)
    write("Shops.csv", SHOPS)
    write("Properties.csv", PROPERTIES)
    write("Missions.csv", MISSIONS)
    write("MissionStages.csv", STAGES)
    good = validate()
    print("TABLES:", "PASS" if good else "FAIL")
    sys.exit(0 if good else 1)
