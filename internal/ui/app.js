(() => {
  "use strict";

  const title = document.querySelector("#title");
  const commandCenter = document.querySelector("#command-center");
  const quickOpen = document.querySelector("#quick-open");
  const quickOpenInput = document.querySelector("#quick-open-input");
  const quickOpenList = document.querySelector("#quick-open-list");
  const quickOpenBackdrop = document.querySelector("#quick-open-backdrop");
  const tree = document.querySelector("#tree");
  const preview = document.querySelector("#preview");
  const breadcrumb = document.querySelector("#breadcrumb");
  const activityFiles = document.querySelector("#activity-files");
  const sidebar = document.querySelector("#sidebar");
  const sidebarCollapse = document.querySelector("#sidebar-collapse");
  const emptyState = document.querySelector("#empty-state");
  const watchBanner = document.querySelector("#watch-banner");

  const expandedPaths = new Set([""]);
  let currentPath = "";
  let listingAbort = null;
  let listingRequestId = 0;
  let lastTree = null;
  let fileIndex = [];
  let recents = [];
  let pickerOpen = false;
  let activeIndex = -1;
  let pickerRows = [];

  function previewURL(path) {
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    return `/apps/${encoded}?t=${Date.now()}`;
  }

  function invalidateListingRequest() {
    if (listingAbort) {
      listingAbort.abort();
      listingAbort = null;
    }
    listingRequestId += 1;
  }

  function beginListingRequest() {
    invalidateListingRequest();
    listingAbort = new AbortController();
    return { signal: listingAbort.signal, requestId: listingRequestId };
  }

  function isStaleListingRequest(requestId) {
    return requestId !== listingRequestId;
  }

  function setSidebarCollapsed(collapsed) {
    document.body.classList.toggle("sidebar-collapsed", collapsed);
    activityFiles.setAttribute("aria-expanded", String(!collapsed));
    activityFiles.classList.toggle("active", !collapsed);
    sidebar.inert = collapsed;
    if (collapsed && sidebar.contains(document.activeElement)) {
      activityFiles.focus();
    }
  }

  function toggleSidebar() {
    setSidebarCollapsed(!document.body.classList.contains("sidebar-collapsed"));
  }

  function setBreadcrumb(path) {
    if (!path) {
      breadcrumb.textContent = "No file selected";
      breadcrumb.dataset.empty = "true";
      return;
    }
    const text = document.createElement("span");
    text.textContent = path.split("/").join(" / ");
    breadcrumb.replaceChildren(icon(fileIconName(path)), text);
    breadcrumb.dataset.empty = "false";
  }

  function rememberOpen(path) {
    recents = [path, ...recents.filter((item) => item !== path)].slice(0, 10);
  }

  function forgetPath(path) {
    recents = recents.filter((item) => item !== path);
  }

  function openFile(path) {
    rememberOpen(path);
    currentPath = path;
    setBreadcrumb(path);
    preview.src = previewURL(path);
    preview.hidden = false;
    emptyState.hidden = true;
    markSelection();
  }

  function clearPreview() {
    currentPath = "";
    preview.removeAttribute("src");
    preview.hidden = true;
    emptyState.hidden = false;
    setBreadcrumb("");
    markSelection();
  }

  function markSelection() {
    tree.querySelectorAll(".tree-row.file").forEach((row) => {
      row.classList.toggle("selected", row.dataset.path === currentPath);
    });
  }

  function flattenFiles(node, out) {
    if (!node) return out;
    if (node.type === "file" && node.path) out.push(node.path);
    for (const child of node.children || []) flattenFiles(child, out);
    return out;
  }

  function ancestorPaths(path) {
    const parts = path.split("/");
    const ancestors = [""];
    for (let i = 0; i < parts.length - 1; i += 1) {
      ancestors.push(parts.slice(0, i + 1).join("/"));
    }
    return ancestors;
  }

  function basename(path) {
    const slash = path.lastIndexOf("/");
    return slash < 0 ? path : path.slice(slash + 1);
  }

  const SVG_NS = "http://www.w3.org/2000/svg";
  const FILE_PATH = "M3.5 1.5h6.25L13 4.75V14.5H3.5z";
  const ICON_PATHS = {
    folder: "M1.5 3h5l1.25 1.5H14.5v8.5H1.5z",
    "folder-open": "M1.5 3.5h4.75l1 1.25H14v1.5H2.25zm.25 3.75L3.25 14h10.25l1.75-6.75z",
    file: FILE_PATH,
    "file-html": FILE_PATH + "M6.7 6.15 4.55 8.5 6.7 10.85 5.75 11.6 3.15 8.5 5.75 5.4zM9.3 6.15 10.25 5.4 12.85 8.5 10.25 11.6 9.3 10.85 11.45 8.5z",
    "file-md": FILE_PATH + "M4.7 12.35V5.7h1.5l1.55 3.25 1.55-3.25h1.5v6.65H9.55V8.45L8.15 11.25h-.8L5.95 8.45v3.9z",
    search: "M7 2.25a4.75 4.75 0 1 1 0 9.5 4.75 4.75 0 0 1 0-9.5zm0 1.5a3.25 3.25 0 1 0 0 6.5 3.25 3.25 0 0 0 0-6.5zM10.2 10.2l3.3 3.3-.95.95-3.3-3.3z",
    explorer: "M3 2h7.5v1.5H4.5v8.5H3zm2.5 2.5h7.5V15h-7.5z",
    collapse: "M2 2.5h1.75v11H2zm9.5.75L6 8l5.5 4.75z",
    empty: FILE_PATH,
  };
  const ICON_FILLS = {
    folder: "#dcb67a",
    "folder-open": "#dcb67a",
    file: "#6e6e6e",
    "file-html": "#e36e6e",
    "file-md": "#519aba",
  };

  function icon(name, options) {
    const d = ICON_PATHS[name];
    if (!d) return null;
    const size = options && options.size ? options.size : 16;
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("class", `icon icon-${name}`);
    svg.setAttribute("fill", ICON_FILLS[name] || "currentColor");
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    path.setAttribute("fill-rule", "evenodd");
    svg.append(path);
    return svg;
  }

  function fileIconName(path) {
    const base = basename(path).toLowerCase();
    const dot = base.lastIndexOf(".");
    const ext = dot < 0 ? "" : base.slice(dot);
    if (ext === ".md") return "file-md";
    if (ext === ".html" || ext === ".htm") return "file-html";
    return "file";
  }

  function fillIcons(root) {
    const scope = root || document;
    scope.querySelectorAll("[data-icon]").forEach((slot) => {
      const size = Number(slot.dataset.iconSize) || 16;
      const node = icon(slot.dataset.icon, { size });
      if (node) slot.replaceChildren(node);
    });
  }

  function parentDir(path) {
    const slash = path.lastIndexOf("/");
    return slash < 0 ? "" : path.slice(0, slash + 1);
  }

  function makeRow(node) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `tree-row ${node.type}`;
    row.dataset.path = node.path;
    row.title = node.path || node.name;

    const label = document.createElement("span");
    label.className = "label";
    label.textContent = node.name;

    if (node.type === "file") {
      const gutter = document.createElement("span");
      gutter.className = "chevron";
      gutter.setAttribute("aria-hidden", "true");
      row.append(gutter, icon(fileIconName(node.path)), label);
      row.classList.toggle("selected", node.path === currentPath);
      row.addEventListener("click", () => openFile(node.path));
      return row;
    }

    const chevron = document.createElement("span");
    chevron.className = "chevron";
    chevron.setAttribute("aria-hidden", "true");
    chevron.textContent = "▶";
    row.append(chevron, icon("folder"), icon("folder-open"), label);

    const children = document.createElement("ul");
    children.className = "tree-list";
    for (const child of node.children || []) {
      children.append(makeNode(child));
    }

    const expanded = expandedPaths.has(node.path);
    row.classList.toggle("expanded", expanded);
    row.setAttribute("aria-expanded", String(expanded));
    children.hidden = !expanded;
    row.addEventListener("click", () => {
      const willExpand = children.hidden;
      children.hidden = !willExpand;
      row.classList.toggle("expanded", willExpand);
      row.setAttribute("aria-expanded", String(willExpand));
      if (willExpand) expandedPaths.add(node.path);
      else expandedPaths.delete(node.path);
    });

    const wrapper = document.createElement("li");
    wrapper.append(row, children);
    return wrapper;
  }

  function makeNode(node) {
    if (node.type === "dir") return makeRow(node);
    const item = document.createElement("li");
    item.append(makeRow(node));
    return item;
  }

  function showMessage(message) {
    tree.replaceChildren();
    const status = document.createElement("p");
    status.className = "muted";
    status.textContent = message;
    tree.append(status);
  }

  function renderTreeFromCache() {
    if (!lastTree) {
      loadTree();
      return;
    }
    const list = document.createElement("ul");
    list.className = "tree-list";
    for (const node of lastTree.children || []) {
      list.append(makeNode(node));
    }
    tree.replaceChildren(list);
    if (!list.children.length) showMessage("No HTML or Markdown files found.");
    markSelection();
  }

  async function loadTree() {
    const { signal, requestId } = beginListingRequest();
    try {
      const response = await fetch("/api/tree", { signal });
      if (isStaleListingRequest(requestId)) return;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const root = await response.json();
      if (isStaleListingRequest(requestId)) return;
      lastTree = root;
      fileIndex = flattenFiles(root, []);
      recents = recents.filter((path) => fileIndex.includes(path));
      renderTreeFromCache();
      if (pickerOpen) renderPicker();
    } catch (error) {
      if (error.name === "AbortError") return;
      console.error("Failed to load tree", error);
      showMessage("Could not load files.");
    }
  }

  async function loadMeta() {
    try {
      const response = await fetch("/api/meta");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const meta = await response.json();
      const name = meta.name || "mino";
      title.textContent = name;
      const label = commandCenter.querySelector(".command-center-label");
      if (label) label.textContent = name;
      commandCenter.title = name;
      document.title = `${name} · mino`;
      watchBanner.hidden = Boolean(meta.watchEnabled);
    } catch (error) {
      console.error("Failed to load metadata", error);
    }
  }

  function appendHighlighted(container, text, matches, offset) {
    const local = new Set();
    for (const index of matches) {
      if (index >= offset && index < offset + text.length) local.add(index - offset);
    }
    let i = 0;
    while (i < text.length) {
      if (local.has(i)) {
        let j = i + 1;
        while (j < text.length && local.has(j)) j += 1;
        const mark = document.createElement("mark");
        mark.textContent = text.slice(i, j);
        container.append(mark);
        i = j;
      } else {
        let j = i + 1;
        while (j < text.length && !local.has(j)) j += 1;
        container.append(text.slice(i, j));
        i = j;
      }
    }
  }

  function setPickerOpen(open, deferBackdrop) {
    if (open) {
      pickerOpen = true;
      quickOpen.hidden = false;
      quickOpenBackdrop.hidden = false;
      commandCenter.setAttribute("aria-expanded", "true");
      quickOpenInput.setAttribute("aria-expanded", "true");
      return;
    }
    pickerOpen = false;
    quickOpen.hidden = true;
    if (!deferBackdrop) quickOpenBackdrop.hidden = true;
    commandCenter.setAttribute("aria-expanded", "false");
    quickOpenInput.setAttribute("aria-expanded", "false");
    quickOpenInput.value = "";
    quickOpenInput.removeAttribute("aria-activedescendant");
    activeIndex = -1;
    pickerRows = [];
    quickOpenList.replaceChildren();
    quickOpenInput.blur();
  }

  function showPickerMessage(message) {
    const status = document.createElement("li");
    status.className = "quick-open-empty";
    status.setAttribute("role", "presentation");
    status.textContent = message;
    quickOpenList.replaceChildren(status);
    pickerRows = [];
    activeIndex = -1;
    quickOpenInput.removeAttribute("aria-activedescendant");
  }

  function markPickerActive() {
    const items = quickOpenList.querySelectorAll(".quick-open-item");
    items.forEach((item, index) => {
      const isActive = index === activeIndex;
      item.classList.toggle("active", isActive);
      item.setAttribute("aria-selected", String(isActive));
      if (isActive) {
        quickOpenInput.setAttribute("aria-activedescendant", item.id);
        item.scrollIntoView({ block: "nearest" });
      }
    });
  }

  function renderPicker() {
    const query = quickOpenInput.value.trim();
    const previousPath = pickerRows[activeIndex]?.path;
    if (!query) {
      if (!recents.length) {
        showPickerMessage("Type to search files");
        return;
      }
      pickerRows = recents.map((path) => ({ path, score: 0, matches: [] }));
    } else {
      pickerRows = globalThis.MinoFuzzy.filter(query, fileIndex, recents);
      if (!pickerRows.length) {
        showPickerMessage("No matching files.");
        return;
      }
    }

    quickOpenList.replaceChildren();
    pickerRows.forEach((row, index) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.id = `quick-open-${index}`;
      button.className = "quick-open-item";
      button.setAttribute("role", "option");
      button.tabIndex = -1;
      button.dataset.path = row.path;

      const typeIcon = icon(fileIconName(row.path));
      typeIcon.classList.add("quick-open-icon");

      const name = document.createElement("span");
      name.className = "quick-open-name";
      const base = basename(row.path);
      const baseOffset = row.path.length - base.length;
      appendHighlighted(name, base, row.matches, baseOffset);

      button.append(typeIcon, name);
      const parent = parentDir(row.path);
      if (parent) {
        const dir = document.createElement("span");
        dir.className = "quick-open-dir";
        appendHighlighted(dir, parent, row.matches, 0);
        button.append(dir);
      }
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("pointerenter", () => {
        activeIndex = index;
        markPickerActive();
      });
      button.addEventListener("click", () => acceptPath(row.path));
      item.append(button);
      quickOpenList.append(item);
    });

    const restored = previousPath
      ? pickerRows.findIndex((row) => row.path === previousPath)
      : -1;
    activeIndex = restored >= 0 ? restored : 0;
    markPickerActive();
  }

  function moveActive(delta) {
    if (!pickerRows.length) return;
    const next = activeIndex + delta;
    if (next < 0 || next >= pickerRows.length) return;
    activeIndex = next;
    markPickerActive();
  }

  function acceptPath(path) {
    if (!fileIndex.includes(path)) {
      forgetPath(path);
      renderPicker();
      return;
    }
    for (const ancestor of ancestorPaths(path)) expandedPaths.add(ancestor);
    openFile(path);
    renderTreeFromCache();
    setPickerOpen(false);
    preview.focus();
  }

  function acceptActive() {
    if (activeIndex < 0 || activeIndex >= pickerRows.length) return;
    acceptPath(pickerRows[activeIndex].path);
  }

  function isQuickOpenHotkey(event) {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return false;
    const key = event.key;
    return key === "e" || key === "E" || key === "p" || key === "P";
  }

  function onQuickOpenHotkey(event) {
    if (isQuickOpenHotkey(event)) {
      event.preventDefault();
      setPickerOpen(true);
      renderPicker();
      quickOpenInput.focus();
      quickOpenInput.select();
      return;
    }
    if (!pickerOpen) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setPickerOpen(false);
      commandCenter.focus();
    }
  }

  function bindPreviewHotkeys() {
    try {
      const doc = preview.contentDocument;
      if (!doc) return;
      doc.addEventListener("keydown", onQuickOpenHotkey, true);
    } catch (_error) {
      // Same-origin read can fail; skip silently.
    }
  }

  activityFiles.addEventListener("click", toggleSidebar);
  sidebarCollapse.addEventListener("click", () => setSidebarCollapsed(true));

  commandCenter.addEventListener("click", () => {
    setPickerOpen(true);
    renderPicker();
    quickOpenInput.focus();
  });

  quickOpenInput.addEventListener("input", () => {
    if (!pickerOpen) return;
    pickerRows = [];
    activeIndex = 0;
    renderPicker();
  });
  quickOpenInput.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      if (!pickerRows.length) return;
      event.preventDefault();
      moveActive(1);
    } else if (event.key === "ArrowUp") {
      if (!pickerRows.length) return;
      event.preventDefault();
      moveActive(-1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      acceptActive();
    }
  });

  document.addEventListener("keydown", onQuickOpenHotkey, true);
  preview.addEventListener("load", bindPreviewHotkeys);

  function hideBackdrop(event) {
    if (event && quickOpenBackdrop.hasPointerCapture(event.pointerId)) {
      quickOpenBackdrop.releasePointerCapture(event.pointerId);
    }
    quickOpenBackdrop.hidden = true;
  }

  quickOpenBackdrop.addEventListener("pointerdown", (event) => {
    if (!pickerOpen) return;
    event.stopPropagation();
    quickOpenBackdrop.setPointerCapture(event.pointerId);
    setPickerOpen(false, true);
  });
  quickOpenBackdrop.addEventListener("pointerup", hideBackdrop);
  quickOpenBackdrop.addEventListener("pointercancel", hideBackdrop);
  quickOpenBackdrop.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    hideBackdrop();
  });
  document.addEventListener("pointerdown", (event) => {
    if (!pickerOpen) return;
    if (quickOpen.contains(event.target) || commandCenter.contains(event.target)) return;
    if (event.target === quickOpenBackdrop) return;
    setPickerOpen(false);
  });
  document.addEventListener("focusin", (event) => {
    if (!pickerOpen) return;
    if (quickOpen.contains(event.target) || commandCenter.contains(event.target)) return;
    setPickerOpen(false);
  });

  const events = new EventSource("/api/events");
  for (const kind of ["added", "removed", "changed"]) {
    events.addEventListener(kind, (message) => {
      let event;
      try {
        event = JSON.parse(message.data);
      } catch (error) {
        console.error("Invalid live reload event", error);
        return;
      }
      if (kind === "removed") forgetPath(event.path);
      loadTree();
      if (event.path !== currentPath) return;
      if (kind === "changed") preview.src = previewURL(currentPath);
      if (kind === "removed") clearPreview();
    });
  }

  fillIcons();
  setSidebarCollapsed(false);
  loadMeta();
  loadTree();
})();
