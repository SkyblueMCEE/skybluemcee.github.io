(() => {
  "use strict";

  /* Content lives in each tutorial page; this file only drives the workspace. */

  const workspace = document.querySelector("[data-tutorial-workspace]");
  const resizer = document.querySelector("[data-tutorial-resizer]");
  const fullscreenButton = document.querySelector("[data-tutorial-fullscreen]");
  const nativeFullscreenButton = document.querySelector("[data-tutorial-native-fullscreen]");
  if (!workspace || !resizer) return;

  const MIN = 30;
  const MAX = 70;
  const DEFAULT = 46;
  const STORAGE_KEY = "skyblue_tutorial_split_v1";
  let split = DEFAULT;

  try {
    const saved = Number.parseFloat(localStorage.getItem(STORAGE_KEY));
    if (Number.isFinite(saved)) split = Math.min(MAX, Math.max(MIN, saved));
  } catch (_) {
    // Storage is optional; resizing still works without it.
  }

  function setSplit(value, save = true) {
    split = Math.min(MAX, Math.max(MIN, value));
    workspace.style.setProperty("--tutorial-left", `${split}%`);
    resizer.setAttribute("aria-valuenow", String(Math.round(split)));
    if (save) {
      try { localStorage.setItem(STORAGE_KEY, split.toFixed(2)); } catch (_) { /* Optional. */ }
    }
  }

  function splitFromPointer(clientX) {
    const rect = workspace.getBoundingClientRect();
    return ((clientX - rect.left) / rect.width) * 100;
  }

  resizer.addEventListener("pointerdown", (event) => {
    if (window.matchMedia("(max-width: 47.999rem)").matches) return;
    event.preventDefault();
    resizer.setPointerCapture(event.pointerId);
    resizer.classList.add("is-dragging");
    document.body.classList.add("sky-resizing");
    setSplit(splitFromPointer(event.clientX), false);
  });

  resizer.addEventListener("pointermove", (event) => {
    if (!resizer.hasPointerCapture(event.pointerId)) return;
    setSplit(splitFromPointer(event.clientX), false);
  });

  function finishDrag(event) {
    if (!resizer.hasPointerCapture(event.pointerId)) return;
    resizer.releasePointerCapture(event.pointerId);
    resizer.classList.remove("is-dragging");
    document.body.classList.remove("sky-resizing");
    setSplit(split, true);
  }

  resizer.addEventListener("pointerup", finishDrag);
  resizer.addEventListener("pointercancel", finishDrag);
  resizer.addEventListener("dblclick", () => setSplit(DEFAULT));
  resizer.addEventListener("keydown", (event) => {
    const amount = event.shiftKey ? 5 : 2;
    if (event.key === "ArrowLeft") setSplit(split - amount);
    else if (event.key === "ArrowRight") setSplit(split + amount);
    else if (event.key === "Home") setSplit(MIN);
    else if (event.key === "End") setSplit(MAX);
    else return;
    event.preventDefault();
  });

  function viewMode() {
    if (document.fullscreenElement === workspace) return "native";
    if (workspace.classList.contains("is-pseudo-fullscreen")) return "browser";
    return "inline";
  }

  function updateViewControls() {
    if (!fullscreenButton) return;
    const mode = viewMode();
    const active = mode !== "inline";
    workspace.dataset.viewMode = mode;
    fullscreenButton.setAttribute("aria-pressed", String(active));
    fullscreenButton.setAttribute("aria-label", active ? "Minimize tutorial workspace back into page" : "Expand tutorial workspace to fill browser");
    if (nativeFullscreenButton) {
      const nativeActive = mode === "native";
      const nativeLabel = nativeActive ? "Return to browser-sized view" : "Enter F11-style fullscreen";
      nativeFullscreenButton.hidden = mode === "inline" || typeof workspace.requestFullscreen !== "function";
      nativeFullscreenButton.setAttribute("aria-pressed", String(nativeActive));
      nativeFullscreenButton.setAttribute("aria-label", nativeLabel);
      nativeFullscreenButton.title = nativeLabel;
    }
  }

  function enterBrowserView() {
    workspace.classList.add("is-pseudo-fullscreen");
    document.body.classList.add("sky-tutorial-pseudo-fullscreen");
    updateViewControls();
  }

  function exitBrowserView() {
    workspace.classList.remove("is-pseudo-fullscreen");
    document.body.classList.remove("sky-tutorial-pseudo-fullscreen");
    updateViewControls();
  }

  if (fullscreenButton) {
    fullscreenButton.addEventListener("click", async () => {
      if (document.fullscreenElement === workspace) {
        workspace.classList.remove("is-pseudo-fullscreen");
        document.body.classList.remove("sky-tutorial-pseudo-fullscreen");
        await document.exitFullscreen();
        return;
      }
      if (workspace.classList.contains("is-pseudo-fullscreen")) {
        exitBrowserView();
        return;
      }
      enterBrowserView();
    });
    if (nativeFullscreenButton) {
      nativeFullscreenButton.addEventListener("click", async () => {
        if (document.fullscreenElement === workspace) {
          await document.exitFullscreen();
          return;
        }
        if (!workspace.requestFullscreen) return;
        try {
          await workspace.requestFullscreen();
        } catch (_) { /* Browser view remains available. */ }
      });
    }
    document.addEventListener("fullscreenchange", updateViewControls);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !document.fullscreenElement && workspace.classList.contains("is-pseudo-fullscreen")) exitBrowserView();
    });
  }

  setSplit(split, false);
  updateViewControls();
})();
