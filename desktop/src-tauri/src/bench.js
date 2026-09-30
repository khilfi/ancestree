// Spike S5: how smoothly this system's web view draws the 2,000-person sample.
// Added to the page only when AncesTree starts with ANCESTREE_BENCH=1, and only acts on
// /sample. It pans and zooms as a mouse would, times every frame, and sends the results
// to the engine, which keeps them in the app's data folder as bench.json.
(() => {
  if (location.pathname !== "/sample") return;
  // What went wrong on the page, if the sample never shows: kept from the very start.
  const problems = [];
  window.addEventListener("error", (event) => problems.push(String(event.message)));
  window.addEventListener("unhandledrejection", (event) => problems.push(String(event.reason)));
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
  const drawn = () => document.querySelectorAll(".react-flow__node").length;

  // Runs `step` once a frame for `ms`, and sums up the time between frames.
  async function frames(ms, step) {
    const gaps = [];
    let last = await frame();
    const end = last + ms;
    for (let i = 0; ; i++) {
      step(i);
      const now = await frame();
      gaps.push(now - last);
      last = now;
      if (now >= end) break;
    }
    gaps.sort((a, b) => a - b);
    const at = (q) => gaps[Math.min(gaps.length - 1, Math.floor(q * gaps.length))];
    return {
      frames: gaps.length,
      median_ms: +at(0.5).toFixed(1),
      p95_ms: +at(0.95).toFixed(1),
      worst_ms: +gaps[gaps.length - 1].toFixed(1),
      drawn: drawn(),
    };
  }

  async function run() {
    const result = {
      userAgent: navigator.userAgent,
      width: innerWidth,
      height: innerHeight,
      pixelRatio: devicePixelRatio,
    };
    for (let waited = 0; drawn() < 100; waited += 100) {
      if (waited > 120000) throw new Error("the sample never appeared");
      await sleep(100);
    }
    result.open_ms = Math.round(performance.now());
    await sleep(1500);
    const pane = document.querySelector(".react-flow__pane");
    const box = pane.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const mouse = (type, px, py, buttons) =>
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: px,
        clientY: py,
        button: 0,
        buttons,
      });
    const pan = async () => {
      pane.dispatchEvent(mouse("mousedown", x, y, 1));
      const timing = await frames(3000, (i) => {
        const angle = i / 15;
        const px = x + 150 * Math.cos(angle) - 150;
        document.dispatchEvent(mouse("mousemove", px, y + 150 * Math.sin(angle), 1));
      });
      document.dispatchEvent(mouse("mouseup", x, y, 0));
      return timing;
    };
    const wheel = (i) =>
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: x,
        clientY: y,
        deltaMode: 0,
        deltaY: Math.floor(i / 30) % 2 ? 40 : -40,
      });

    result.pan = await pan();
    result.zoom = await frames(3000, (i) => pane.dispatchEvent(wheel(i)));
    document.querySelector('button[aria-label="Fit View"]')?.click();
    await sleep(2000);
    result.pan_fit = await pan();
    const unfold = [...document.querySelectorAll("button[aria-label]")].find((button) =>
      button.getAttribute("aria-label").startsWith("A family this big opens folded"),
    );
    if (unfold) {
      unfold.click();
      await sleep(2000);
      document.querySelector('button[aria-label="Fit View"]')?.click();
      await sleep(2000);
      result.pan_everyone = await pan();
    }
    return result;
  }

  window.addEventListener("load", () => {
    run()
      .catch((error) => ({
        error: String(error),
        userAgent: navigator.userAgent,
        size: [innerWidth, innerHeight],
        visibility: document.visibilityState,
        drawn: drawn(),
        page: (document.body?.innerText ?? "").slice(0, 400),
        problems: problems.slice(0, 10),
      }))
      .then((result) =>
        fetch("/api/desktop/bench", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(result),
        }),
      );
  });
})();
