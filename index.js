(() => {
  "use strict";

  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  // The document to preload on page load. Set to null to start empty.
  const DEFAULT_PDF_URL = "/assets/thesis.pdf";

  // ---------- Elements ----------
  const viewer = document.getElementById("viewer");
  const emptyState = document.getElementById("emptyState");
  const dropzone = document.getElementById("dropzone");
  const stageWrap = document.getElementById("stageWrap");
  const pageStage = document.getElementById("pageStage");
  const canvas = document.getElementById("pdfCanvas");
  const ctx = canvas.getContext("2d");
  const loadingState = document.getElementById("loadingState");
  const loadingText = document.getElementById("loadingText");

  const fileInput = document.getElementById("fileInput");
  const openBtn = document.getElementById("openBtn");
  const emptyOpenBtn = document.getElementById("emptyOpenBtn");

  const navGroup = document.getElementById("navGroup");
  const zoomGroup = document.getElementById("zoomGroup");
  const prevBtn = document.getElementById("prevBtn");
  const nextBtn = document.getElementById("nextBtn");
  const pageInput = document.getElementById("pageInput");
  const pageCount = document.getElementById("pageCount");

  const zoomOutBtn = document.getElementById("zoomOutBtn");
  const zoomInBtn = document.getElementById("zoomInBtn");
  const zoomLevel = document.getElementById("zoomLevel");
  const fitWidthBtn = document.getElementById("fitWidthBtn");

  const toast = document.getElementById("toast");

  // ---------- State ----------
  const state = {
    pdf: null,
    pageNum: 1,
    numPages: 0,
    scale: 1,
    baseWidth: 0, // unscaled width of the current page at scale 1
    renderTask: null,
    fitMode: true, // true until the user manually zooms
  };

  const MIN_SCALE = 0.25;
  const MAX_SCALE = 4;
  const SCALE_STEP = 0.15;

  // ---------- Helpers ----------
  let toastTimer = null;
  function showToast(msg, isError = false) {
    toast.textContent = msg;
    toast.hidden = false;
    toast.classList.toggle("error", isError);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.hidden = true;
    }, 3200);
  }

  function setLoading(isLoading, text) {
    loadingState.hidden = !isLoading;

    if (text) {
      loadingText.textContent = text;
    }
  }

  function availableWidth() {
    // viewer padding is 24px each side at the wrap level; leave a little margin
    return viewer.clientWidth - 48;
  }

  // ---------- Document loading ----------
  // Shared by "open a local file", "drag and drop", and "preload from a URL" —
  // all three just need to hand this a pdf.js loading task.
  async function openDocument(
    loadingTask,
    { loadingMessage = "Opening document\u2026", errorMessage } = {},
  ) {
    emptyState.hidden = true;
    stageWrap.hidden = true;
    setLoading(true, loadingMessage);

    try {
      const pdf = await loadingTask.promise;

      state.pdf = pdf;
      state.numPages = pdf.numPages;
      state.pageNum = 1;
      state.fitMode = true;

      pageCount.textContent = String(pdf.numPages);
      pageInput.value = "1";
      navGroup.hidden = false;
      zoomGroup.hidden = false;

      await renderPage(1);
      stageWrap.hidden = false;
      return true;
    } catch (err) {
      console.error(err);
      showToast(
        errorMessage ||
          "Couldn\u2019t open that PDF. It may be corrupted or encrypted.",
        true,
      );
      state.pdf = null;
      emptyState.hidden = false;
      navGroup.hidden = true;
      zoomGroup.hidden = true;
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function loadFile(file) {
    if (!file) return;
    if (
      file.type !== "application/pdf" &&
      !file.name.toLowerCase().endsWith(".pdf")
    ) {
      showToast("That file doesn\u2019t look like a PDF.", true);
      return;
    }
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    await openDocument(loadingTask);
  }

  async function loadFromUrl(url, opts = {}) {
    const loadingTask = pdfjsLib.getDocument(url);
    return openDocument(loadingTask, opts);
  }

  // ---------- Rendering ----------
  async function renderPage(num) {
    if (!state.pdf) return;
    num = Math.min(Math.max(1, num), state.numPages);
    state.pageNum = num;
    pageInput.value = String(num);

    const page = await state.pdf.getPage(num);
    const unscaledViewport = page.getViewport({ scale: 1 });
    state.baseWidth = unscaledViewport.width;

    if (state.fitMode) {
      const w = availableWidth();
      state.scale = Math.min(
        Math.max(w / state.baseWidth, MIN_SCALE),
        MAX_SCALE,
      );
    }

    const viewport = page.getViewport({ scale: state.scale });
    const outputScale = window.devicePixelRatio || 1;

    canvas.width = Math.floor(viewport.width * outputScale);
    canvas.height = Math.floor(viewport.height * outputScale);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;

    const transform =
      outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;

    if (state.renderTask) {
      try {
        state.renderTask.cancel();
      } catch (e) {
        /* no-op */
      }
    }

    const renderContext = { canvasContext: ctx, viewport, transform };
    state.renderTask = page.render(renderContext);

    try {
      await state.renderTask.promise;
    } catch (err) {
      if (err && err.name === "RenderingCancelledException") return;
      console.error(err);
    }

    updateZoomLabel();
    updateNavButtons();
  }

  function updateZoomLabel() {
    zoomLevel.textContent = `${Math.round(state.scale * 100)}%`;
  }

  function updateNavButtons() {
    prevBtn.disabled = state.pageNum <= 1;
    nextBtn.disabled = state.pageNum >= state.numPages;
  }

  // ---------- Navigation ----------
  function goToPage(num) {
    if (!state.pdf) return;
    renderPage(num);
  }

  prevBtn.addEventListener("click", () => goToPage(state.pageNum - 1));
  nextBtn.addEventListener("click", () => goToPage(state.pageNum + 1));

  pageInput.addEventListener("change", () => {
    const val = parseInt(pageInput.value, 10);
    if (Number.isFinite(val)) {
      goToPage(val);
    } else {
      pageInput.value = String(state.pageNum);
    }
  });

  pageInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") pageInput.blur();
  });

  // ---------- Zoom ----------
  function setScale(newScale) {
    state.fitMode = false;
    state.scale = Math.min(Math.max(newScale, MIN_SCALE), MAX_SCALE);
    renderPage(state.pageNum);
  }

  zoomInBtn.addEventListener("click", () => setScale(state.scale + SCALE_STEP));
  zoomOutBtn.addEventListener("click", () =>
    setScale(state.scale - SCALE_STEP),
  );

  fitWidthBtn.addEventListener("click", () => {
    state.fitMode = true;
    renderPage(state.pageNum);
  });

  // ---------- File open UI ----------
  function pickFile() {
    fileInput.click();
  }
  openBtn.addEventListener("click", pickFile);
  emptyOpenBtn.addEventListener("click", pickFile);

  fileInput.addEventListener("change", () => {
    const file = fileInput.files && fileInput.files[0];
    loadFile(file);
    fileInput.value = "";
  });

  // ---------- Drag & drop ----------
  ["dragenter", "dragover"].forEach((evt) => {
    document.addEventListener(evt, (e) => {
      e.preventDefault();
      if (emptyState.hidden) return;
      dropzone.classList.add("drag-over");
    });
  });

  ["dragleave", "drop"].forEach((evt) => {
    document.addEventListener(evt, (e) => {
      if (evt === "drop") e.preventDefault();
      dropzone.classList.remove("drag-over");
    });
  });

  document.addEventListener("drop", (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    loadFile(file);
  });

  // ---------- Keyboard shortcuts ----------
  document.addEventListener("keydown", (e) => {
    if (!state.pdf) return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === "INPUT") return;

    if (e.key === "ArrowRight" || e.key === "PageDown") {
      e.preventDefault();
      goToPage(state.pageNum + 1);
    } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
      e.preventDefault();
      goToPage(state.pageNum - 1);
    } else if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      setScale(state.scale + SCALE_STEP);
    } else if (e.key === "-" || e.key === "_") {
      e.preventDefault();
      setScale(state.scale - SCALE_STEP);
    } else if (e.key.toLowerCase() === "f") {
      e.preventDefault();
      state.fitMode = true;
      renderPage(state.pageNum);
    }
  });

  // ---------- Resize ----------
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    if (!state.pdf || !state.fitMode) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => renderPage(state.pageNum), 120);
  });

  // ---------- Preload the bundled document ----------
  if (DEFAULT_PDF_URL) {
    loadFromUrl(DEFAULT_PDF_URL, {
      loadingMessage: "Opening thesis\u2026",
      errorMessage:
        "Couldn\u2019t load the bundled PDF \u2014 open one manually instead.",
    });
  }
})();
