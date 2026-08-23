(() => {
  "use strict";

  const title = document.querySelector("#title");
  const commandCenter = document.querySelector("#command-center");
  const quickOpen = document.querySelector("#quick-open");
  const quickOpenInput = document.querySelector("#quick-open-input");
  const quickOpenList = document.querySelector("#quick-open-list");
  const quickOpenFooter = document.querySelector("#quick-open-footer");
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
    breadcrumb.textContent = path.split("/").join(" / ");
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

    const indicator = document.createElement("span");
    indicator.className = node.type === "dir" ? "chevron" : "file-icon";
    indicator.setAttribute("aria-hidden", "true");
    indicator.textContent = node.type === "dir" ? "▶" : "◇";

    const label = document.createElement("span");
    label.className = "label";
    label.textContent = node.name;
    row.append(indicator, label);

    if (node.type === "file") {
      row.classList.toggle("selected", node.path === currentPath);
      row.addEventListener("click", () => openFile(node.path));
      return row;
    }

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
    if (!list.children.length) showMessage("No HTML files found.");
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
      commandCenter.textContent = name;
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

  function fileChipClass(path) {
    const base = basename(path).toLowerCase();
    if (base.endsWith(".md")) return "quick-open-chip md";
    if (base.endsWith(".html") || base.endsWith(".htm")) return "quick-open-chip html";
    return "quick-open-chip";
  }

  function setPickerOpen(open) {
    if (open) {
      pickerOpen = true;
      quickOpen.hidden = false;
      commandCenter.setAttribute("aria-expanded", "true");
      quickOpenInput.setAttribute("aria-expanded", "true");
      return;
    }
    pickerOpen = false;
    quickOpen.hidden = true;
    commandCenter.setAttribute("aria-expanded", "false");
    quickOpenInput.setAttribute("aria-expanded", "false");
    quickOpenInput.value = "";
    quickOpenInput.removeAttribute("aria-activedescendant");
    quickOpenFooter.hidden = true;
    activeIndex = -1;
    pickerRows = [];
    quickOpenList.replaceChildren();
    const restoreFocus = document.activeElement === quickOpenInput;
    quickOpenInput.blur();
    if (restoreFocus) commandCenter.focus();
  }

  function showPickerMessage(message) {
    const status = document.createElement("li");
    status.className = "quick-open-empty";
    status.setAttribute("role", "presentation");
    status.textContent = message;
    quickOpenList.replaceChildren(status);
    quickOpenFooter.hidden = true;
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
    const showingRecents = !query;
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
      button.dataset.path = row.path;

      const chip = document.createElement("span");
      chip.className = fileChipClass(row.path);
      chip.setAttribute("aria-hidden", "true");

      const name = document.createElement("span");
      name.className = "quick-open-name";
      const base = basename(row.path);
      const baseOffset = row.path.length - base.length;
      appendHighlighted(name, base, row.matches, baseOffset);

      button.append(chip, name);
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

    quickOpenFooter.textContent = "recently opened";
    quickOpenFooter.hidden = !showingRecents;
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
    if (!isQuickOpenHotkey(event)) return;
    event.preventDefault();
    setPickerOpen(true);
    renderPicker();
    quickOpenInput.focus();
    quickOpenInput.select();
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
    if (!pickerOpen) setPickerOpen(true);
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
    } else if (event.key === "Escape") {
      event.preventDefault();
      setPickerOpen(false);
    }
  });

  document.addEventListener("keydown", onQuickOpenHotkey, true);
  preview.addEventListener("load", bindPreviewHotkeys);

  document.addEventListener("pointerdown", (event) => {
    if (!pickerOpen) return;
    if (quickOpen.contains(event.target) || commandCenter.contains(event.target)) return;
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

  setSidebarCollapsed(false);
  loadMeta();
  loadTree();
})();
