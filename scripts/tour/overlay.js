// Recording overlay for the Martian Map tour: captions, a highlight ring, a visible cursor with
// click ripples, and full-screen title cards. Injected into the page only while recording.
(() => {
  if (window.WT) return;
  const css = `
  #wt-cap{position:fixed;left:50%;transform:translateX(-50%);bottom:34px;z-index:2147483000;width:max-content;max-width:min(1060px,78vw);
    background:rgba(12,9,8,.88);border:1px solid rgba(226,115,63,.5);border-left:6px solid #e2733f;border-radius:14px;padding:16px 26px 18px;
    color:#f4efe9;font:400 21px/1.45 Inter,system-ui,sans-serif;box-shadow:0 14px 44px rgba(0,0,0,.6);opacity:0;transition:opacity .45s;pointer-events:none}
  #wt-cap.show{opacity:1}
  #wt-cap .s{font:600 13px/1 Inter,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#f08a52;margin-bottom:9px}
  #wt-cap .t{font:600 30px/1.2 Inter,sans-serif;margin-bottom:6px;letter-spacing:-.01em}
  #wt-cap .x{color:#e6ddd6}
  #wt-ring{position:fixed;z-index:2147482999;border:3px solid #ffb347;border-radius:12px;pointer-events:none;opacity:0;
    box-shadow:0 0 0 5px rgba(255,179,71,.22),0 0 30px rgba(255,179,71,.65);transition:left .55s cubic-bezier(.2,.8,.2,1),top .55s cubic-bezier(.2,.8,.2,1),width .55s,height .55s,opacity .35s}
  #wt-ring.show{opacity:1}
  #wt-cur{position:fixed;z-index:2147483001;left:-60px;top:-60px;width:34px;height:34px;pointer-events:none;
    transition:left .75s cubic-bezier(.3,.7,.15,1),top .75s cubic-bezier(.3,.7,.15,1);filter:drop-shadow(0 3px 4px rgba(0,0,0,.75))}
  .wt-rip{position:fixed;z-index:2147483000;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;border:3px solid #ffb347;pointer-events:none;animation:wtrip .65s ease-out forwards}
  @keyframes wtrip{to{transform:scale(3.6);opacity:0}}
  #wt-card{position:fixed;inset:0;z-index:2147483002;display:grid;place-content:center;justify-items:center;text-align:center;padding:40px;
    background:radial-gradient(ellipse 80% 70% at 50% 62%,#7a3519 0%,#3a170b 42%,#0b0706 100%);color:#f4efe9;opacity:0;transition:opacity .9s;pointer-events:none}
  #wt-card.show{opacity:1}
  #wt-card .k{font:600 17px Inter,sans-serif;letter-spacing:.34em;text-transform:uppercase;color:#f08a52}
  #wt-card h1{font:300 104px/1.02 Fraunces,Georgia,serif;margin:22px 0 18px;letter-spacing:-.01em}
  #wt-card h1 span{color:#e2733f}
  #wt-card p{font:400 26px/1.5 Inter,sans-serif;color:#dccfc6;margin:0;max-width:1100px}
  #wt-card .f{margin-top:34px;font:500 17px Inter,sans-serif;color:#b9aaa0;letter-spacing:.06em}
  #wt-card .planet{width:180px;height:180px;border-radius:50%;margin-bottom:8px;
    background:radial-gradient(circle at 35% 32%,#f2a36b 0%,#c4572a 38%,#7a2c12 70%,#2c0f06 100%);box-shadow:0 0 60px rgba(226,115,63,.45),inset -22px -18px 40px rgba(0,0,0,.55)}
  `;
  const st = document.createElement("style");
  st.textContent = css;
  document.head.appendChild(st);
  const mk = (id, html = "") => { const d = document.createElement("div"); d.id = id; d.innerHTML = html; document.body.appendChild(d); return d; };
  const cap = mk("wt-cap"), ring = mk("wt-ring"), card = mk("wt-card");
  const cur = mk("wt-cur", `<svg viewBox="0 0 24 24" width="34" height="34"><path d="M4 2 L4 20 L9 15.5 L12.5 22.5 L15.6 21 L12.2 14.2 L19 14 Z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>`);
  window.WT = {
    caption(step, title, text, pos = {}) {
      cap.classList.remove("show");
      setTimeout(() => {
        cap.innerHTML = `${step ? `<div class="s">${step}</div>` : ""}<div class="t">${title}</div><div class="x">${text}</div>`;
        cap.style.top = pos.top != null ? `${pos.top}px` : "auto";
        cap.style.bottom = pos.top != null ? "auto" : `${pos.bottom ?? 34}px`;
        cap.style.left = pos.left != null ? `${pos.left}px` : "50%";
        cap.style.transform = pos.left != null ? "none" : "translateX(-50%)";
        cap.classList.add("show");
      }, 260);
    },
    hideCaption() { cap.classList.remove("show"); },
    ring(r) {
      if (!r) { ring.classList.remove("show"); return; }
      const p = 8;
      Object.assign(ring.style, { left: `${r.x - p}px`, top: `${r.y - p}px`, width: `${r.w + 2 * p}px`, height: `${r.h + 2 * p}px` });
      ring.classList.add("show");
    },
    cursor(x, y) { cur.style.left = `${x - 5}px`; cur.style.top = `${y - 3}px`; },
    ripple(x, y) { const d = document.createElement("div"); d.className = "wt-rip"; d.style.left = `${x}px`; d.style.top = `${y}px`; document.body.appendChild(d); setTimeout(() => d.remove(), 700); },
    card(html) { card.innerHTML = html; card.classList.add("show"); },
    hideCard() { card.classList.remove("show"); },
  };
})();
