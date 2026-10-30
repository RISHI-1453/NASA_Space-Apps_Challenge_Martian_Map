// The guided-tour video: a 4-minute walkthrough of every feature with captions burned in.
// It pops up once the intro has finished (unless the viewer ticked "don't show again"), and the
// ▶ Tour button in the header opens it any time. Close it with ✕, Skip, Esc or a click outside.
const Tour = (() => {
  const NEVER = "martianmap.tour.never";
  let back = null;

  function open() {
    if (back) return;
    back = document.createElement("div");
    back.className = "tour-back";
    back.innerHTML = `
      <div class="tour-card" role="dialog" aria-modal="true" aria-label="Guided tour of Martian Map">
        <div class="tour-head">
          <div><div class="tour-k">Guided tour · about 4 minutes</div><b>Everything Martian Map can do</b></div>
          <button type="button" class="tour-x" aria-label="Close the tour">✕</button>
        </div>
        <video class="tour-video" src="media/martian-map-tour.mp4" poster="media/tour-poster.jpg" controls playsinline preload="auto" muted></video>
        <div class="tour-foot">
          <label><input type="checkbox" class="tour-never"> Don't show this after the intro again</label>
          <button type="button" class="tour-skip">Skip — go to the map</button>
        </div>
      </div>`;
    document.body.appendChild(back);
    const never = back.querySelector(".tour-never");
    try { never.checked = localStorage.getItem(NEVER) === "1"; } catch {}
    never.onchange = () => { try { never.checked ? localStorage.setItem(NEVER, "1") : localStorage.removeItem(NEVER); } catch {} };
    back.querySelector(".tour-x").onclick = close;
    back.querySelector(".tour-skip").onclick = close;
    back.onclick = (e) => { if (e.target === back) close(); };
    document.addEventListener("keydown", onKey);
    const v = back.querySelector(".tour-video");
    v.play().catch(() => {}); // the video has no sound track, so it may start by itself; if not, press play
    back.querySelector(".tour-x").focus({ preventScroll: true });
  }
  function close() {
    if (!back) return;
    back.querySelector(".tour-video").pause();
    back.remove();
    back = null;
    document.removeEventListener("keydown", onKey);
  }
  function onKey(e) { if (e.key === "Escape") close(); }

  // after the intro: offer it unless the viewer said not to
  function offer() {
    try { if (localStorage.getItem(NEVER) === "1") return; } catch {}
    open();
  }

  document.getElementById("open-tour")?.addEventListener("click", open);
  return { open, close, offer };
})();
