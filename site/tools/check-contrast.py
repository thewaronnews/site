#!/usr/bin/env python3
"""WCAG 2.2 contrast check for the Atlas palette (content/site.css tokens).

Text pairs need 4.5:1 (AA, normal text); UI boundaries and map tiles that
carry meaning need 3:1 (WCAG 1.4.11). Run: python3 tools/check-contrast.py
Exit status 1 when any pair fails.
"""
import sys

def lum(h):
    h = h.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    f = lambda c: c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)

def ratio(a, b):
    la, lb = sorted((lum(a), lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)

LIGHT = dict(bg="#F2F5F8", surface="#FFFFFF", ink="#0E1A2B", ink2="#475569", muted="#56657A",
             line="#D5DCE5", lineStrong="#7B8BA0", accent="#B93A0A", accentBg="#FBEDE6",
             t0="#E3E8EE", on="#536C88", onInk="#FFFFFF", offInk="#56657A", well="#F7F9FB",
             chip="#E3E8EE", focalBg="#FBEDE6", t1="#BFCBD8", t2="#8DA2B9", t4="#243B5A", onT4="#FFFFFF")
DARK = dict(bg="#0B1320", surface="#121D2D", ink="#E8EDF3", ink2="#A9B6C6", muted="#96A5B8",
            line="#243247", lineStrong="#667A93", accent="#F2895A", accentBg="#3A1E14",
            t0="#1C2A3D", on="#8DA2B9", onInk="#0B1320", offInk="#96A5B8", well="#0F1927",
            chip="#1C2A3D", focalBg="#3A1E14", t1="#2C3D55", t2="#4B6282", t4="#BFCBD8", onT4="#0B1320")

TEXT = [("ink", "bg"), ("ink", "surface"), ("ink", "well"), ("ink2", "bg"), ("ink2", "surface"), ("ink2", "well"),
        ("ink2", "chip"), ("muted", "surface"), ("muted", "bg"), ("accent", "surface"), ("accent", "bg"),
        ("accent", "accentBg"), ("ink", "accentBg"), ("ink", "chip"), ("onInk", "on"), ("offInk", "t0"),
        ("surface", "ink"), ("bg", "ink"), ("ink", "t0"), ("ink", "t1"), ("ink", "t2"), ("onT4", "t4")]
UI = [("lineStrong", "surface"), ("lineStrong", "bg"), ("on", "surface"), ("accent", "surface"), ("on", "t0")]
FOOTER = [("#E2E8F0", "#0E1A2B"), ("#CBD5E1", "#0E1A2B"), ("#FFFFFF", "#0E1A2B")]
FOOTER_DARK = [("#E2E8F0", "#060B14"), ("#CBD5E1", "#060B14")]

fails = 0
for name, pal in (("light", LIGHT), ("dark", DARK)):
    print(f"== {name} theme ==")
    for fg, bg in TEXT:
        r = ratio(pal[fg], pal[bg]); ok = r >= 4.5; fails += not ok
        print(f"  text {fg:10} {pal[fg]} on {bg:9} {pal[bg]}: {r:5.2f} {'PASS' if ok else 'FAIL'}")
    for fg, bg in UI:
        r = ratio(pal[fg], pal[bg]); ok = r >= 3.0; fails += not ok
        print(f"  ui   {fg:10} {pal[fg]} on {bg:9} {pal[bg]}: {r:5.2f} {'PASS' if ok else 'FAIL'} (3:1)")
for label, pairs in (("footer light", FOOTER), ("footer dark", FOOTER_DARK)):
    for fg, bg in pairs:
        r = ratio(fg, bg); ok = r >= 4.5; fails += not ok
        print(f"  {label}: {fg} on {bg}: {r:5.2f} {'PASS' if ok else 'FAIL'}")
print("failures:", fails)
sys.exit(1 if fails else 0)
