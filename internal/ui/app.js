(() => {
  "use strict";

  const title = document.querySelector("#title");
  const search = document.querySelector("#search");
  const tree = document.querySelector("#tree");
  const preview = document.querySelector("#preview");
  const previewPath = document.querySelector("#preview-path");
  const emptyState = document.querySelector("#empty-state");
  const watchBanner = document.querySelector("#watch-banner");

  const expandedPaths = new Set([""]);
  let currentPath = "";
  let debounceTimer;
  let listingAbort = null;
  let listingRequestId = 0;

  function previewURL(path) {
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    return `/apps/${encoded}?t=${Date.now()}`;
  }

  function beginListingRequest() {
    if (listingAbort) listingAbort.abort();
    listingAbort = new AbortController();
    listingRequestId += 1;
    return { signal: listingAbort.signal, requestId: listingRequestId };
  }

  function isStaleListingRequest(requestId) {
    return requestId !== listingRequestId;
  }

  function openFile(path) {
    currentPath = path;
    previewPath.textContent = path;
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
    previewPath.textContent = "Select a file to preview";
    markSelection();
  }

  function markSelection() {
    tree.querySelectorAll(".tree-row.file").forEach((row) => {
      row.classList.toggle("selected", row.dataset.path === currentPath);
    });
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

  async function loadTree() {
    const { signal, requestId } = beginListingRequest();
    try {
      const response = await fetch("/api/tree", { signal });
      if (isStaleListingRequest(requestId)) return;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const root = await response.json();
      if (isStaleListingRequest(requestId)) return;
      const list = document.createElement("ul");
      list.className = "tree-list";
      for (const node of root?.children || []) {
        list.append(makeNode(node));
      }
      tree.replaceChildren(list);
      if (!list.children.length) showMessage("No HTML files found.");
    } catch (error) {
      if (error.name === "AbortError") return;
      console.error("Failed to load tree", error);
      showMessage("Could not load files.");
    }
  }

  async function loadSearch(query) {
    const { signal, requestId } = beginListingRequest();
    try {
      const response = await fetch(
        `/api/search?q=${encodeURIComponent(query)}`,
        { signal },
      );
      if (isStaleListingRequest(requestId)) return;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (isStaleListingRequest(requestId)) return;
      const list = document.createElement("ul");
      list.className = "tree-list search-results";
      for (const path of payload.results || []) {
        list.append(makeNode({
          name: path,
          path,
          type: "file",
          children: [],
        }));
      }
      tree.replaceChildren(list);
      if (!list.children.length) showMessage("No matching files.");
    } catch (error) {
      if (error.name === "AbortError") return;
      console.error("Search failed", error);
      showMessage("Search unavailable.");
    }
  }

  function refreshListing() {
    const query = search.value.trim();
    return query ? loadSearch(query) : loadTree();
  }

  async function loadMeta() {
    try {
      const response = await fetch("/api/meta");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const meta = await response.json();
      title.textContent = meta.name || "mino";
      document.title = `${meta.name || "mino"} · mino`;
      watchBanner.hidden = Boolean(meta.watchEnabled);
    } catch (error) {
      console.error("Failed to load metadata", error);
    }
  }

  search.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(refreshListing, 150);
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
      refreshListing();
      if (event.path !== currentPath) return;
      if (kind === "changed") preview.src = previewURL(currentPath);
      if (kind === "removed") clearPreview();
    });
  }

  loadMeta();
  loadTree();
})();
