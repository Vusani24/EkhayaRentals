(function () {
  if (!["http:", "https:"].includes(window.location.protocol)) {
    return;
  }

  const TOKEN_KEY = "alexandra-admin-token";
  const viewMap = {
    pending: ["rooms", "pending"],
    approved: ["rooms", "approved"],
    taken: ["rooms", "taken"],
    declined: ["rooms", "declined"],
    removed: ["rooms", "removed"],
    "review-pending": ["reviews", "pending"],
    "review-approved": ["reviews", "approved"],
    "review-declined": ["reviews", "declined"],
    "report-pending": ["reports", "pending"],
    "report-approved": ["reports", "approved"],
    "report-declined": ["reports", "declined"]
  };

  const storageMap = {
    "alexandra-room-pending": ["rooms", "pending"],
    "alexandra-room-approved": ["rooms", "approved"],
    "alexandra-room-taken": ["rooms", "taken"],
    "alexandra-room-declined": ["rooms", "declined"],
    "alexandra-room-removed": ["rooms", "removed"],
    "alexandra-review-pending": ["reviews", "pending"],
    "alexandra-review-approved": ["reviews", "approved"],
    "alexandra-review-declined": ["reviews", "declined"],
    "alexandra-report-pending": ["reports", "pending"],
    "alexandra-report-approved": ["reports", "approved"],
    "alexandra-report-declined": ["reports", "declined"]
  };

  function token() {
    return sessionStorage.getItem(TOKEN_KEY) || "";
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      headers: {
        "Content-Type": "application/json",
        ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
        ...(options.headers || {})
      },
      ...options
    });
    if (!response.ok) throw new Error((await response.json()).error || "Request failed");
    return response.json();
  }

  function syncLocalStorage(db) {
    Object.entries(storageMap).forEach(([key, [section, status]]) => {
      localStorage.setItem(key, JSON.stringify(db[section][status] || []));
    });
    localStorage.setItem("alexandra-room-drive-folder", db.settings.driveFolder || "");
  }

  async function refreshAdmin() {
    const db = await api("/api/admin/data");
    syncLocalStorage(db);
    loadDriveLink();
    renderRooms();
    renderDashboard();
  }

  async function adminAction(payload, message) {
    await api("/api/admin/action", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    await refreshAdmin();
    if (message) showNotice(message);
  }

  document.querySelector("#loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    try {
      const data = await api("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({ password: document.querySelector("#adminPassword").value })
      });
      sessionStorage.setItem(TOKEN_KEY, data.token);
      sessionStorage.setItem(SESSION_KEY, "yes");
      document.querySelector("#loginError").classList.remove("is-visible");
      renderAuth();
      await refreshAdmin();
    } catch (error) {
      document.querySelector("#loginError").classList.add("is-visible");
    }
  }, true);

  document.querySelector("#logoutButton").addEventListener("click", (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(SESSION_KEY);
    renderAuth();
  }, true);

  roomList.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const [section, from] = viewMap[state.view];
    const id = button.dataset.id;
    const action = button.dataset.action;

    if (action === "approve") return adminAction({ action: "move", section, from, to: "approved", id }, "Post approved and now visible on the public site.");
    if (action === "decline") return adminAction({ action: "move", section, from, to: "declined", id }, "Post declined.");
    if (action === "taken") {
      const room = getList(APPROVED_KEY).find((item) => item.id === id);
      if (room) openTakenForm(room);
      return;
    }
    if (action === "remove") return adminAction({ action: "move", section, from, to: "removed", id }, "Room removed from the public site.");
    if (action === "approve-review") return adminAction({ action: "move", section, from, to: "approved", id }, "Review approved and now visible on the public site.");
    if (action === "decline-review") return adminAction({ action: "move", section, from, to: "declined", id }, "Review declined.");
    if (action === "approve-report") return adminAction({ action: "move", section, from, to: "approved", id }, "Scam report approved.");
    if (action === "decline-report") return adminAction({ action: "move", section, from, to: "declined", id }, "Scam report declined.");
    if (action === "delete") return adminAction({ action: "delete", section, from, id }, "Post deleted.");
    if (action === "repost") return adminAction({ action: "repost", section, from, id }, "Room copied back to Pending for review.");
    if (action === "remove-image") return adminAction({ action: "remove-image", section, from, id, index: button.dataset.index }, "Picture removed from this room post.");
    if (action === "remove-video") return adminAction({ action: "remove-video", section, from, id }, "Video removed from this room post.");
    if (action === "recheck-review") {
      state.view = "review-pending";
      setActiveTab();
      return adminAction({ action: "move", section, from, to: "pending", id }, "Review moved back to Pending.");
    }
    if (action === "recheck-report") {
      state.view = "report-pending";
      setActiveTab();
      return adminAction({ action: "move", section, from, to: "pending", id }, "Report moved back to Scam Reports.");
    }
  }, true);

  document.querySelector("#saveDrive").addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    await api("/api/admin/drive", {
      method: "POST",
      body: JSON.stringify({ driveFolder: driveFolder.value.trim() })
    });
    await refreshAdmin();
    showNotice("Google Drive folder link saved in the database.");
  }, true);

  takenForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    const room = getList(APPROVED_KEY).find((item) => item.id === takenRoomId.value);
    if (!room) return showNotice("Could not find the approved room to mark as taken.");
    const takenDetails = takenDetailsFromForm(room);
    await api("/api/admin/action", {
      method: "POST",
      body: JSON.stringify({ action: "mark-taken", id: room.id, takenDetails })
    });
    await refreshAdmin();
    const takenRoom = getList(TAKEN_KEY).find((item) => item.id === room.id);
    state.view = "taken";
    setActiveTab();
    setReceiptSectionReady(false);
    takenRoomLabel.textContent = "Select an approved room and click Mark As Taken. This section will then unlock so you can fill in landlord, tenant, payment, service fee, and moving-in details before downloading the receipt.";
    takenForm.reset();
    if (takenRoom) downloadReceipt(takenRoom);
    showNotice("Room marked as taken. Receipt opened for PDF saving and total service fees updated.");
  }, true);

  if (token()) {
    sessionStorage.setItem(SESSION_KEY, "yes");
    refreshAdmin().catch(() => {
      sessionStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(SESSION_KEY);
      renderAuth();
    });
  }
})();
