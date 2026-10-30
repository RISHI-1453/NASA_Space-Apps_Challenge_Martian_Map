"""Record the Martian Map guided tour: drive the real app in Chrome, burn captions in, cut out
loading waits, and encode a 1080p H.264 MP4.

    python record.py warm     # one pass to fill the server's and browser's tile caches
    python record.py record   # the real take -> frontend/media/martian-map-tour.mp4 (+ tour-poster.jpg)

Needs the app running on localhost:8002, Chrome installed, and pip install playwright imageio-ffmpeg.
"""
import asyncio
import base64
import shutil
import subprocess
import sys
import time
from pathlib import Path

import imageio_ffmpeg
from playwright.async_api import async_playwright

HERE = Path(__file__).parent
URL = "http://localhost:8002/?intro=0"
W, H, FPS = 1920, 1080, 30
FRAMES, PROFILE = HERE / "frames", HERE / "profile"
MEDIA = HERE.parent.parent / "frontend" / "media"  # where the app serves the tour from
OUT, POSTER = MEDIA / "martian-map-tour.mp4", MEDIA / "tour-poster.jpg"
TOTAL = 18  # numbered steps in the tour


class Recorder:
    """Screencast frames from Chrome, kept only while 'on'; each on..off stretch is a segment."""

    def __init__(self, cdp, keep):
        self.cdp, self.keep, self.on, self.last, self.n = cdp, keep, False, None, 0
        self.segments = []

    async def start(self):
        self.cdp.on("Page.screencastFrame", self._frame)
        await self.cdp.send("Page.startScreencast", {"format": "jpeg", "quality": 86, "maxWidth": W, "maxHeight": H, "everyNthFrame": 2})

    def _frame(self, p):
        asyncio.ensure_future(self.cdp.send("Page.screencastFrameAck", {"sessionId": p["sessionId"]}))
        self.last = base64.b64decode(p["data"])
        if self.on:
            self._save(time.monotonic(), self.last)

    def _save(self, t, data):
        if not self.keep:
            return
        f = FRAMES / f"{self.n:06d}.jpg"
        self.n += 1
        f.write_bytes(data)
        self.segments[-1].append((t, f))

    def resume(self):
        if self.on:
            return
        self.on = True
        self.segments.append([])
        if self.last:
            self._save(time.monotonic(), self.last)  # the screen as it is now, even if nothing moves

    def pause(self):
        if self.on:
            self.on = False
            self.segments[-1].append((time.monotonic(), None))


def encode(segments):
    ff = imageio_ffmpeg.get_ffmpeg_exe()
    cmd = [ff, "-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", str(FPS), "-c:v", "mjpeg", "-i", "-",
           "-vf", f"scale={W}:{H}:flags=lanczos,format=yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", "27",
           "-profile:v", "high", "-tune", "animation", "-movflags", "+faststart", str(OUT)]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    total = 0
    for seg in segments:
        frames = [f for f in seg if f[1] is not None]
        if not frames:
            continue
        end = seg[-1][0] if seg[-1][1] is None else frames[-1][0]
        t, k, cur_path, cur = frames[0][0], 0, None, b""
        while t < end:
            while k + 1 < len(frames) and frames[k + 1][0] <= t:
                k += 1
            if frames[k][1] != cur_path:
                cur_path, cur = frames[k][1], frames[k][1].read_bytes()
            proc.stdin.write(cur)
            total += 1
            t += 1 / FPS
    proc.stdin.close()
    proc.wait()
    print(f"encoded {total} frames = {total / FPS:.1f} s -> {OUT} ({OUT.stat().st_size / 1e6:.1f} MB)")
    subprocess.run([ff, "-y", "-loglevel", "error", "-ss", "4", "-i", str(OUT), "-frames:v", "1", "-q:v", "3", str(POSTER)])


class Tour:
    def __init__(self, page, rec):
        self.page, self.rec, self.step = page, rec, 0
        self.cx, self.cy = W * 0.6, H * 0.6

    async def js(self, expr, arg=None):
        return await self.page.evaluate(expr, arg)

    async def hold(self, s):
        await asyncio.sleep(s)

    async def wait_js(self, expr, timeout=40, cut=False):
        if cut:
            self.rec.pause()
        t0 = time.monotonic()
        while time.monotonic() - t0 < timeout:
            try:
                if await self.js(expr):
                    break
            except Exception:
                pass
            await asyncio.sleep(0.3)
        else:
            print("  (timed out waiting for", expr[:70], ")")
        if cut:
            await asyncio.sleep(0.4)
            self.rec.resume()

    async def cap(self, section, title, text, same=False, **pos):
        self.step += 0 if same else 1
        await self.js("([s, t, x, p]) => WT.caption(s, t, x, p)", [f"Step {self.step} of {TOTAL} · {section}", title, text, pos])
        print(f"[{self.step}] {title}")

    async def box(self, sel, text=None):
        return await self.js("""([sel, text]) => {
          const els = [...document.querySelectorAll(sel)].filter((e) => { const r = e.getBoundingClientRect();
            return r.width && r.height && (!text || e.textContent.includes(text)); });
          if (!els.length) return null;
          const r = els[0].getBoundingClientRect();
          return { x: r.left, y: r.top, w: r.width, h: r.height };
        }""", [sel, text])

    async def ring(self, sel=None, text=None):
        b = await self.box(sel, text) if sel else None
        await self.js("(b) => WT.ring(b)", b)

    async def move(self, x, y, wait=0.85):
        self.cx, self.cy = x, y
        await self.js("([x, y]) => WT.cursor(x, y)", [x, y])
        await self.page.mouse.move(x, y, steps=8)
        await asyncio.sleep(wait)

    async def click_xy(self, x, y):
        await self.move(x, y)
        await self.js("([x, y]) => WT.ripple(x, y)", [x, y])
        await self.page.mouse.click(x, y)
        await asyncio.sleep(0.35)

    async def click(self, sel, text=None, dx=0.5, dy=0.5):
        b, t0 = None, time.monotonic()
        while not b and time.monotonic() - t0 < 6:  # it may be mid re-render: give it a moment
            b = await self.box(sel, text)
            if not b:
                await asyncio.sleep(0.3)
        if not b:
            print("  (missing", sel, text, ")")
            return
        await self.click_xy(b["x"] + b["w"] * dx, b["y"] + b["h"] * dy)

    async def drag(self, x0, y0, x1, y1, dur=2.0, steps=40):
        await self.move(x0, y0, 0.5)
        await self.page.mouse.down()
        for i in range(1, steps + 1):
            x, y = x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps
            await self.page.mouse.move(x, y)
            await self.js("([x, y]) => WT.cursor(x, y)", [x, y])
            await asyncio.sleep(dur / steps)
        await self.page.mouse.up()
        self.cx, self.cy = x1, y1

    async def show(self, sel, block="start"):
        await self.js("([s, b]) => document.querySelector(s)?.scrollIntoView({ block: b, behavior: 'smooth' })", [sel, block])
        await asyncio.sleep(1.0)

    async def at(self, lat, lon):
        return await self.js("""([la, lo]) => { const p = map.latLngToContainerPoint([la, lo]), r = map.getContainer().getBoundingClientRect();
          return [r.left + p.x, r.top + p.y]; }""", [lat, lon])

    async def route_point(self, frac, side_m=0):
        """A point frac of the way along the planned outbound walk, optionally side_m metres off it
        (to the right of the direction of travel)."""
        return await self.js("""([f, side]) => { const n = waypoints.length - 1, S = lastProfile.samples.filter((s) => s.leg < n);
          const i = Math.round(f * (S.length - 1)), s = S[i], a = S[Math.max(0, i - 3)], b = S[Math.min(S.length - 1, i + 3)];
          const k = Math.cos(s.lat * Math.PI / 180), dn = b.lat - a.lat, de = (b.lon - a.lon) * k, len = Math.hypot(dn, de) || 1;
          const deg = side / 59160;  // metres -> degrees of arc on Mars
          return [s.lat - (de / len) * deg, s.lon + (dn / len) * deg / k]; }""", [frac, side_m])


async def tour(t: Tour):
    p = t.page
    # ---------- title ----------
    await t.js("""() => WT.card(`<div class="planet"></div><div class="k">Code Huzzlers · NASA Space Apps 2026</div>
      <h1>Martian <span>Map</span></h1><p>A guided tour: plan a Marswalk, check it against the suits, the Sun and the science, then walk it.</p>`)""")
    t.rec.resume()
    await t.hold(5)
    await t.js("() => WT.hideCard()")
    await t.hold(1.2)

    # ---------- 1. the map ----------
    await t.cap("The map", "Anywhere on Mars", "The whole planet from NASA's orbiters. Scroll to zoom, drag to move — "
                "every one of the 2,052 IAU place names can be searched.")
    await t.hold(2.5)
    await t.js("() => map.flyTo([19.6, 75.8], 6, { duration: 4.5 })")
    await t.move(W * 0.4, H * 0.45, 0.3)
    await t.hold(5.2)

    # ---------- 2. layers ----------
    await t.cap("Map layers", "Layers from many missions, in one panel",
                "Base maps, science data, close-up imagery — each with a short note. "
                "Here: the USGS geologic map and the minerals that formed in water (CRISM, OMEGA, THEMIS).", left=60, bottom=34)
    await t.click(".lp-toggle")
    await t.ring(".lp-panel")
    await t.hold(1.5)
    await t.click(".lp-row", "Geologic map")
    await t.hold(1.6)
    await t.click(".lp-row", "Water-formed minerals")
    await t.hold(1.4)
    await t.ring(".lp-legend:not([hidden])")
    await t.hold(2.4)
    await t.click(".lp-x")
    await t.ring()
    await t.hold(3.2)

    # ---------- 3. missions ----------
    await t.click('.panel-tabs [data-tab="missions"]')
    await t.cap("Science EVAs", "Start from a science goal",
                "Five ready-made Marswalks where NASA's rovers and orbiters have looked hardest — "
                "each with stations, tasks, kit and work time. First: the boxwork of Mount Sharp, Curiosity's 2025 discovery.")
    await t.ring(".mission")
    await t.hold(2.5)
    await t.click(".mission .mi-more summary")
    await t.hold(3.5)
    await t.ring(".mi-plan")
    await t.hold(1.0)
    await t.click(".mi-plan")
    await t.ring()

    # ---------- 4. the plan ----------
    await t.wait_js("document.querySelector('#summary .verdict') && document.querySelector('#along details')", 30)
    await t.show("#summary")
    await t.cap("The plan", "Every walk is checked before you go",
                "The route steers around ground steeper than 15° on 20 m terrain. Both suits' oxygen, power, "
                "cooling water and CO₂ scrubber are checked, plus daylight and space weather.")
    await t.ring("#summary .big")
    await t.hold(2.4)
    await t.ring("#summary .res")
    await t.hold(3.2)
    await t.ring("#summary .verdict")
    await t.hold(2.4)
    await t.ring("#summary .tools")
    await t.hold(2.0)

    # ---------- 5. directions ----------
    await t.show("#directions .task", "center")
    await t.cap("Directions", "Turn-by-turn, with the science",
                "Each station shows its task and kit. Set the work time at any stop — it counts against every supply. "
                "With rover support, any leg can be driven instead of walked.")
    await t.ring("#directions .task")
    await t.hold(3.0)
    await t.ring("#directions .work")
    await t.hold(2.0)
    await t.ring("#directions .leg-mode")
    await t.hold(2.4)

    # ---------- 6. research ----------
    await t.show("#summary details.sci.fold", "start")
    await t.cap("Research check", "Backed by 58 sources",
                "Effort compared with Apollo, radiation dose, time to shelter, the walk-back limit — "
                "and the rock units and minerals the route crosses, with one-click science stops.")
    await t.click("#summary details.sci.fold > summary")
    await t.ring("#summary details.sci.fold")
    await t.hold(3.6)
    await t.wait_js("document.querySelector('#along details')", 25, cut=True)  # it reloads if the panel re-renders
    await t.click("#along details > summary")
    await t.ring("#along details")
    await t.hold(3.2)

    # ---------- 7. profile ----------
    await t.show("#profile-wrap", "center")
    await t.cap("Elevation profile", "Every metre of climb, coloured by slope",
                "Stops are marked; move along the chart and the matching spot lights up on the map.")
    await t.ring("#profile")
    b = await t.box("#profile")
    if b:
        await t.move(b["x"] + 30, b["y"] + b["h"] * 0.5, 0.6)
        for i in range(1, 31):
            x = b["x"] + 30 + (b["w"] - 60) * i / 30
            await t.page.mouse.move(x, b["y"] + b["h"] * 0.5)
            await t.js("([x, y]) => WT.cursor(x, y)", [x, b["y"] + b["h"] * 0.5])
            await asyncio.sleep(0.12)
    await t.hold(1.5)
    await t.ring()

    # ---------- 8. crew ----------
    await t.click('.panel-tabs [data-tab="me"]')
    await t.cap("Crew & suits", "A buddy pair, two suits",
                "Enter real gauge readings any time. Every check uses whichever suit has less of each supply, "
                "because the pair walks home together. Choose rover support here too.")
    await t.click("#suit-edit > summary")
    await t.show("#ev2-set", "center")
    await t.ring("#suit-form fieldset", "EVA team")
    await t.hold(2.8)
    await t.ring("#ev2-set")
    await t.hold(3.0)

    # ---------- 9. conditions ----------
    await t.click('.panel-tabs [data-tab="conditions"]')
    await t.cap("Conditions", "Space weather, seen from Mars",
                "Live solar data from NASA DONKI and NOAA, worked out for Mars' side of the Sun into a GO / CAUTION / NO-GO — "
                "plus what orbiters found under your feet.")
    await t.show("#spacewx", "start")
    await t.ring("#spacewx")
    await t.hold(4.0)
    await t.show("#whats-here", "start")
    await t.ring("#whats-here")
    await t.hold(3.4)

    # ---------- 10. landmarks ----------
    await t.click('.panel-tabs [data-tab="sites"]')
    await t.cap("Landmarks", "45 landmarks of Mars",
                "Volcanoes, canyons, craters, ice caps and every landing site — fly there, get directions, "
                "see it in 3D or make a 3D-printed model.")
    await t.show("#lm-q", "start")
    await t.click("#lm-q")
    await p.keyboard.type("volcano", delay=110)
    await t.ring("#lm-list")
    await t.hold(3.2)
    await t.js("() => { const q = document.getElementById('lm-q'); q.value = ''; q.dispatchEvent(new Event('input')); }")

    # ---------- 11. sources ----------
    await t.click('.panel-tabs [data-tab="science"]')
    await t.cap("Sources", "Every number has a source",
                "Each figure in the app links to the paper or dataset it comes from — gathered with a SciSpace literature search.")
    await t.ring("#science-lib .ref")
    await t.hold(3.6)
    await t.ring()

    # ---------- 12. live guidance ----------
    await t.click('.panel-tabs [data-tab="route"]')
    await t.show("#summary", "start")
    await t.click("#nav-start")
    await t.hold(1.2)
    await t.cap("Live guidance", "Out on the walk",
                "Mars has no GPS: report each position fix from your suit or rover by tapping the map. "
                "The guidance tracks progress, the next turn, supplies and hazards ahead.", bottom=300)
    for frac in (0.2, 0.42):
        await t.click("#nav-tap")
        la, lo = await t.route_point(frac)
        x, y = await t.at(la, lo)
        await t.click_xy(x, y)
        await t.hold(2.2)
    await t.ring(".nav-top")
    await t.hold(2.4)
    await t.ring(".nav-bottom")
    await t.hold(2.6)
    await t.ring()
    await t.cap("Live guidance", "Off route? It points the way back",
                "A fix more than about 40 m from the path turns the card red, with the compass heading back to the route.", same=True, bottom=300)
    await t.click("#nav-tap")
    la, lo = await t.route_point(0.48, side_m=150)
    x, y = await t.at(la, lo)
    await t.click_xy(x, y)
    await t.ring(".nav-top")
    await t.hold(3.6)
    await t.ring()

    # ---------- 13. visor ----------
    await t.cap("Visor HUD", "The helmet-visor display",
                "Full screen: a compass tape pointing to the next station, suit gauges, EVA clock, "
                "radiation dose so far, space weather and the light-time to Earth.", bottom=150)
    await t.hold(0.6)
    await t.click("#nav-visor")
    await t.hold(2.0)
    await t.click('[data-v="tap"]')
    la, lo = await t.route_point(0.55)
    x, y = await t.at(la, lo)
    await t.click_xy(x, y)
    await t.hold(1.6)
    await t.ring(".v-tape")
    await t.hold(2.2)
    await t.ring(".v-left")
    await t.hold(2.4)
    await t.ring(".v-right")
    await t.hold(2.6)
    await t.ring(".v-dock")
    await t.hold(2.0)
    await t.ring()
    await t.click('[data-v="end"]')
    await t.hold(0.8)

    # ---------- 14. ground view ----------
    await t.js("() => GroundView.at(18.49744, 77.30513, 'Cheyava Falls · Jezero crater')")
    await t.wait_js("""(() => { const im = [...document.querySelectorAll('#gv .gv-strip img')];
        return im.length > 20 && im.filter((i) => i.complete && i.naturalWidth).length > 12; })()""", 60, cut=True)
    await t.cap("Ground view", "See it through the rovers' eyes",
                "Near Perseverance's or Curiosity's tracks, their Navcam photos are laid out around 360° "
                "by where the camera pointed. Drag to look around.")
    await t.hold(1.5)
    b = await t.box("#gv .gv-strip-wrap")
    if b:
        await t.drag(b["x"] + b["w"] * 0.75, b["y"] + b["h"] * 0.45, b["x"] + b["w"] * 0.25, b["y"] + b["h"] * 0.45, 3.2)
        await t.hold(1.2)
        await t.drag(b["x"] + b["w"] * 0.3, b["y"] + b["h"] * 0.45, b["x"] + b["w"] * 0.7, b["y"] + b["h"] * 0.45, 2.6)
    await t.hold(2.0)
    await t.click("#gv .gv-close")

    # ---------- 15. 3D globe ----------
    t.rec.pause()
    await t.js("() => Globe.open({ lat: 18.47, lon: 77.40, name: 'Jezero crater', alt: 9500 })")
    await t.wait_js("Globe.viewer && Globe.viewer.scene.globe.tilesLoaded && !document.querySelector('.gl-veil:not([hidden])')", 80)
    await t.hold(1.5)
    t.rec.resume()
    await t.cap("3D", "Mars in 3D, in its true colours",
                "Streaming 20 m terrain with HiRISE and CTX detail, coloured with Viking's view of the same ground. "
                "Perseverance's real path is drawn on it.")
    await t.ring(".gl-imagery")
    await t.hold(2.6)
    await t.ring()
    await t.click('[data-exag="2"]')
    await t.hold(2.0)
    await t.click('[data-nav="orbit"]')
    await t.hold(6.5)
    await t.click('[data-nav="orbit"]')
    await t.click(".gl-close")

    # ---------- 16. walk in 3D ----------
    await t.show("#summary", "start")
    await t.click("#walk-3d")
    await t.wait_js("Globe.viewer && Globe.viewer.scene.globe.tilesLoaded && !document.querySelector('.gl-veil:not([hidden])')", 80, cut=True)
    await t.cap("Walk it in 3D", "Rehearse the walk before you go",
                "A chase camera follows the planned route with distance, elevation and slope. "
                "Drag to look around while it plays.")
    await t.hold(3.5)
    await t.drag(W * 0.62, H * 0.5, W * 0.38, H * 0.46, 2.4)
    await t.hold(4.0)
    await t.click(".gl-close")

    # ---------- 17. 3D print ----------
    await t.show("#summary", "start")
    await t.click("#print-model")
    await t.wait_js("(document.querySelector('.pm-stats')?.textContent || '').includes('mm')", 60, cut=True)
    await t.cap("3D print", "A model the crew can hold",
                "A 3D-printable relief model of the walk with the route raised — like the relief models "
                "Apollo crews trained with. Download it as an STL.")
    await t.ring(".pm-view")
    b = await t.box(".pm-view")
    if b:
        await t.drag(b["x"] + b["w"] * 0.3, b["y"] + b["h"] * 0.5, b["x"] + b["w"] * 0.7, b["y"] + b["h"] * 0.42, 2.6)
    await t.ring(".pm-stats")
    await t.hold(3.0)
    await t.ring()
    await t.click(".pm-x")

    # ---------- 18. cuff checklist ----------
    await t.click("#cuff")
    await t.wait_js("document.querySelector('.cl-sheet image')", 60, cut=True)
    await t.cap("Cuff checklist", "Everything on one page, Apollo-style",
                "A shaded-relief traverse map, every station with times and supplies, and the turn-back rule — ready to print.", bottom=34)
    await t.hold(3.0)
    await t.js("() => document.querySelector('.cl-back').scrollTo({ top: 640, behavior: 'smooth' })")
    await t.hold(4.0)
    await t.click(".cl-sheet [data-close]")
    await t.js("() => WT.hideCaption()")

    # ---------- end ----------
    await t.js("""() => WT.card(`<div class="planet"></div><div class="k">Martian Map</div><h1>Plan it. Walk it. <span>Do the science.</span></h1>
      <p>Built for the first crews on Mars, from NASA's mission data.</p><div class="f">Code Huzzlers · NASA Space Apps Challenge 2026 · watch this tour again from the header</div>`)""")
    await t.hold(5.5)
    t.rec.pause()


async def main(mode):
    keep = mode == "record"
    if keep:
        shutil.rmtree(FRAMES, ignore_errors=True)
        FRAMES.mkdir(parents=True)
    async with async_playwright() as pw:
        ctx = await pw.chromium.launch_persistent_context(
            str(PROFILE), channel="chrome", headless=True, viewport={"width": W, "height": H}, device_scale_factor=1,
            args=["--use-angle=d3d11", "--ignore-gpu-blocklist", "--disable-background-timer-throttling",
                  "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"])
        page = ctx.pages[0] if ctx.pages else await ctx.new_page()
        await page.goto(URL)
        await page.evaluate("() => localStorage.clear()")
        await page.goto(URL)
        await page.wait_for_function("() => typeof Missions !== 'undefined' && typeof map !== 'undefined' && document.querySelectorAll('.mission').length > 0", timeout=60000)
        await page.add_script_tag(path=str(HERE / "overlay.js"))
        await page.evaluate("() => { map.setView([5, 40], 2, { animate: false }); showTab('route'); }")
        await asyncio.sleep(3 if keep else 1)
        cdp = await ctx.new_cdp_session(page)
        rec = Recorder(cdp, keep)
        await rec.start()
        await tour(Tour(page, rec))
        await cdp.send("Page.stopScreencast")
        await ctx.close()
    if keep:
        print("segments:", len(rec.segments), "frames:", rec.n)
        encode(rec.segments)


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else "record"))
