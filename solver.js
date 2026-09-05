const network = {
  "Dept": { 1: "Armo", 2: "Infi", 3: "Drag" },
  "Drag": { 1: "Supp", 2: "Dept", 3: "Infi" },
  "Armo": { 1: "Supp", 2: "Tank", 3: "Dept" },
  "Supp": { 1: "Drag", 2: "Armo", 3: "Tank" },
  "Infi": { 1: "Dept", 2: "Tank", 3: "Drag" },
  "Tank": { 1: "Infi", 2: "Supp", 3: "Armo" }
};

const keys = ["Dept", "Drag", "Armo", "Supp", "Infi", "Tank"];
const roomBit = { "Dept": 1, "Drag": 2, "Armo": 4, "Supp": 8, "Infi": 16, "Tank": 32 };
const roomNames = ["Dept", "Drag", "Armo", "Supp", "Infi", "Tank"];
const roomTemplates = [
  { key: "Dept", label: "デパート" },
  { key: "Drag", label: "ドラゴンコマンド" },
  { key: "Armo", label: "武器庫" },
  { key: "Supp", label: "補給所" },
  { key: "Infi", label: "診療所" },
  { key: "Tank", label: "戦車工場" }
];

const selectedVals = { Dept: null, Drag: null, Armo: null, Supp: null, Infi: null, Tank: null };
let lastStates = { green: null, password: null, notGreens: new Set() };

const ROOM_STATUS_TYPES = Object.freeze({
  GREEN: "green",
  NOT_GREEN: "notgreen",
  PASSWORD: "password"
});

const shareState = {
  roomId: null,
  db: null,
  roomRef: null,
  stateRef: null,
  membersRef: null,
  memberId: null,
  hasRealtimeSync: false,
  isApplyingRemote: false
};

const precomputedPaths = new Map();

function sanitizeRoomId(rawValue) {
  const roomId = String(rawValue || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 20);

  return roomId;
}

function readRoomIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const candidate = params.get("room");
  return candidate ? sanitizeRoomId(candidate) : "";
}

function closeMenuPanel() {
  const menuPanel = document.getElementById("menuPanel");
  const menuToggleBtn = document.getElementById("menuToggleBtn");
  if (!menuPanel) return;

  menuPanel.classList.remove("open");
  menuPanel.setAttribute("aria-hidden", "true");
  document.body.classList.remove("menu-open");
  if (menuToggleBtn) {
    menuToggleBtn.setAttribute("aria-expanded", "false");
  }
  setAreaTitleEditorVisible(false);
}

function setMenuOpen(isOpen) {
  const menuPanel = document.getElementById("menuPanel");
  const menuToggleBtn = document.getElementById("menuToggleBtn");
  if (!menuPanel) return;

  menuPanel.classList.toggle("open", isOpen);
  menuPanel.setAttribute("aria-hidden", String(!isOpen));
  document.body.classList.toggle("menu-open", isOpen);
  if (menuToggleBtn) {
    menuToggleBtn.setAttribute("aria-expanded", String(isOpen));
  }

  if (!isOpen) {
    setAreaTitleEditorVisible(false);
  }
}

function detachRoomSubscriptions() {
  if (shareState.stateRef) shareState.stateRef.off("value");
  if (shareState.membersRef) shareState.membersRef.off("value");
  if (shareState.roomRef) shareState.roomRef.off("value");

  shareState.roomRef = null;
  shareState.stateRef = null;
  shareState.membersRef = null;
}

const ROOM_TITLE_KEY = "gorodKroviRoomTitles";
const DEFAULT_ROOM_TITLES = {
  Dept: "デパート",
  Drag: "ドラゴンコマンド",
  Armo: "武器庫",
  Supp: "補給所",
  Infi: "診療所",
  Tank: "戦車工場"
};

function readCookie(name) {
  const cookieString = document.cookie || "";
  const match = cookieString.split("; ").find((entry) => entry.startsWith(`${name}=`));
  if (!match) return "";
  return decodeURIComponent(match.split("=").slice(1).join("="));
}

function getAreaTitleMap() {
  const cookieValue = readCookie(ROOM_TITLE_KEY);
  const storageValue = localStorage.getItem(ROOM_TITLE_KEY);
  const raw = cookieValue || storageValue || JSON.stringify(DEFAULT_ROOM_TITLES);

  try {
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_ROOM_TITLES, ...parsed };
  } catch (error) {
    return { ...DEFAULT_ROOM_TITLES };
  }
}

function setAreaTitleMap(map) {
  const json = JSON.stringify(map);
  document.cookie = `${ROOM_TITLE_KEY}=${encodeURIComponent(json)}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
  localStorage.setItem(ROOM_TITLE_KEY, json);
}

function resetAreaTitleMap() {
  document.cookie = `${ROOM_TITLE_KEY}=; path=/; max-age=0; SameSite=Lax`;
  localStorage.removeItem(ROOM_TITLE_KEY);
  return { ...DEFAULT_ROOM_TITLES };
}

function getAreaShortLabel(title) {
  const text = String(title || "").trim();
  return text.slice(0, 2) || "デパ";
}

function renderRoomGrid() {
  const container = document.getElementById("roomGrid");
  if (!container) return;

  const titles = getAreaTitleMap();
  container.innerHTML = roomTemplates.map(({ key, label }) => {
    const title = titles[key] || label;
    return `
      <div class="room-card" data-room="${key}">
        <div class="room-header">
          <span class="room-title">${title}</span>
          <div class="status-toggle">
            <button type="button" class="status-btn" data-room="${key}" data-type="green">G</button>
            <button type="button" class="status-btn" data-room="${key}" data-type="notgreen">B</button>
            <button type="button" class="status-btn" data-room="${key}" data-type="password">P</button>
          </div>
        </div>
        <div class="valves-container">
          <div class="btn-group" data-room="${key}">
            <button type="button" class="dial-btn" data-val="1">1</button>
            <button type="button" class="dial-btn" data-val="2">2</button>
            <button type="button" class="dial-btn" data-val="3">3</button>
          </div>
          <div class="prob-display" id="pr_${key}">1:33 2:33 3:33</div>
        </div>
      </div>
    `;
  }).join("");

  document.querySelectorAll(".btn-group").forEach(group => {
    const room = group.dataset.room;
    group.querySelectorAll(".dial-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        const clickedVal = Number(e.target.dataset.val);
        const isSameSelection = selectedVals[room] === clickedVal;

        group.querySelectorAll(".dial-btn").forEach(b => b.classList.remove("active"));

        if (isSameSelection) {
          selectedVals[room] = null;
        } else {
          selectedVals[room] = clickedVal;
          e.target.classList.add("active");
        }

        calculate();
        syncCurrentState();
      });
    });
  });

  document.querySelectorAll(".status-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      handleStateToggle(e.target);
      calculate();
      syncCurrentState();
    });
  });
}

function applyRoomTitleLabels() {
  const titles = getAreaTitleMap();
  keys.forEach((roomKey) => {
    const defaultLabel = DEFAULT_ROOM_TITLES[roomKey] || roomKey;
    const label = titles[roomKey] || defaultLabel;
    const node = document.querySelector(`.room-card[data-room="${roomKey}"] .room-title`);
    if (node) node.textContent = label;
    const input = document.getElementById(`title_${roomKey}`);
    if (input) {
      const isDefault = String(titles[roomKey] || "").trim() === "" || String(label || "") === String(defaultLabel || "");
      input.value = isDefault ? "" : label;
      input.placeholder = defaultLabel;
    }

    const resultsHeader = document.getElementById(`resultsHeader_${roomKey}`);
    if (resultsHeader) {
      resultsHeader.textContent = getAreaShortLabel(label);
    }
  });
}

function updateShareStatus(message, isError = false) {
  const statusNode = document.getElementById("shareStatus");
  if (!statusNode) return;
  statusNode.textContent = message;
  statusNode.style.color = isError ? "#ff8a8a" : "#93c5fd";
}

function getStatusButton(room, type) {
  if (!room || !type) return null;
  return document.querySelector(`.status-btn[data-room="${room}"][data-type="${type}"]`);
}

function syncToggleButtonsFromState() {
  document.querySelectorAll(".status-btn").forEach((btn) => {
    const room = btn.dataset.room;
    const type = btn.dataset.type;
    const isActive =
      (type === ROOM_STATUS_TYPES.GREEN && lastStates.green === room) ||
      (type === ROOM_STATUS_TYPES.PASSWORD && lastStates.password === room) ||
      (type === ROOM_STATUS_TYPES.NOT_GREEN && lastStates.notGreens.has(room));
    btn.classList.toggle("active", isActive);
  });
}

function clearStatusButtonState(room, type) {
  const button = getStatusButton(room, type);
  if (button) {
    button.classList.remove("active");
  }
}

function applySelectedValuesToButtons() {
  Object.entries(selectedVals).forEach(([room, value]) => {
    const group = document.querySelector(`.btn-group[data-room="${room}"]`);
    if (!group) return;
    group.querySelectorAll(".dial-btn").forEach(btn => {
      const isActive = Number(btn.dataset.val) === Number(value);
      btn.classList.toggle("active", isActive);
    });
  });
}

function syncCurrentState() {
  if (!shareState.hasRealtimeSync || !shareState.stateRef || shareState.isApplyingRemote) {
    return;
  }

  const payload = {
    selectedVals: { ...selectedVals },
    green: lastStates.green,
    password: lastStates.password,
    notGreens: Array.from(lastStates.notGreens),
    updatedAt: Date.now(),
    version: 1
  };

  shareState.stateRef.set(payload).catch((error) => {
    const firebaseConfig = window.GOROD_KROVI_FIREBASE_CONFIG || window.FIREBASE_CONFIG || {};
    const databaseUrl = firebaseConfig.databaseURL || "(未設定)";
    const refPath = shareState.stateRef ? shareState.stateRef.toString() : "(未設定)";

    console.error("Firebase write failed:", error);
    console.error("databaseURL:", databaseUrl);
    console.error("ref:", refPath);
    updateShareStatus(`共有の更新に失敗しました: ${error.message || error.code}`, true);
  });
}

function applyRemoteState(payload) {
  if (!payload || !payload.selectedVals) return;

  shareState.isApplyingRemote = true;
  Object.assign(selectedVals, payload.selectedVals);
  lastStates = {
    green: payload.green || null,
    password: payload.password || null,
    notGreens: new Set(Array.isArray(payload.notGreens) ? payload.notGreens : [])
  };

  applySelectedValuesToButtons();
  syncToggleButtonsFromState();
  calculate();
  shareState.isApplyingRemote = false;
}

function makeMemberId() {
  const key = "gorodKroviMemberId";
  const existing = sessionStorage.getItem(key);
  if (existing) return existing;

  const id = (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function")
    ? globalThis.crypto.randomUUID()
    : `member-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  sessionStorage.setItem(key, id);
  return id;
}

function resetStateToDefault({ sync = true } = {}) {
  keys.forEach(k => {
    selectedVals[k] = null;
  });
  lastStates = { green: null, password: null, notGreens: new Set() };
  applySelectedValuesToButtons();
  syncToggleButtonsFromState();
  calculate();
  if (sync) {
    syncCurrentState();
  }
}

function syncRoomCreatedAt(roomRef, roomId) {
  if (!roomRef || !roomId) return;

  roomRef.once("value").then((snapshot) => {
    const roomData = snapshot.val() || {};
    const existingCreatedAt = Number(roomData.createdAt || 0);

    if (!existingCreatedAt) {
      roomRef.child("createdAt").set(Date.now());
    }
  }).catch(() => {});
}

function cleanupRoomIfEmpty() {
  if (!shareState.roomRef || !shareState.membersRef) return;

  shareState.membersRef.once("value", (snapshot) => {
    const members = snapshot.val() || {};
    if (Object.keys(members).length === 0) {
      shareState.roomRef.child("state").remove().catch(() => {});
      shareState.roomRef.child("members").remove().catch(() => {});
      shareState.roomRef.child("createdAt").remove().catch(() => {});
      shareState.roomRef.remove().catch(() => {});
    }
  });
}

function setupRoomPresence(roomId) {
  if (!shareState.db || !shareState.roomRef || !shareState.stateRef || !shareState.membersRef) {
    return;
  }

  const roomRef = shareState.roomRef;
  const membersRef = shareState.membersRef;
  const memberId = makeMemberId();
  shareState.memberId = memberId;

  syncRoomCreatedAt(roomRef, roomId);

  membersRef.once("value").then((snapshot) => {
    const members = snapshot.val() || {};
    const isFirstMember = Object.keys(members).length === 0;
    const myMemberRef = membersRef.child(memberId);

    myMemberRef.set({ joinedAt: Date.now() }).then(() => {
      if (isFirstMember) {
        resetStateToDefault({ sync: true });
      }
    });

    myMemberRef.onDisconnect().remove();
  });

  membersRef.on("value", (snapshot) => {
    const members = snapshot.val() || {};
    if (Object.keys(members).length === 0) {
      cleanupRoomIfEmpty();
    }
  });

  bindPageCloseCleanup();

  shareState.stateRef.once("value").then((snapshot) => {
    if (!snapshot.exists()) {
      syncCurrentState();
    }
  });
}

async function removeCurrentMember() {
  if (!shareState.memberId || !shareState.membersRef || !shareState.roomRef) return;

  const myMemberRef = shareState.membersRef.child(shareState.memberId);

  try {
    await myMemberRef.remove();
    const snapshot = await shareState.membersRef.once("value");
    const members = snapshot.val() || {};

    if (Object.keys(members).length === 0) {
      await shareState.roomRef.child("state").remove();
      await shareState.roomRef.remove();
    }
  } catch (error) {
    console.warn("removeCurrentMember failed:", error);
  }
}

function bindPageCloseCleanup() {
  const cleanup = () => {
    removeCurrentMember();
  };

  window.addEventListener("beforeunload", cleanup, { passive: true });
  window.addEventListener("pagehide", cleanup, { passive: true });
}

function initializeRealtimeSync() {
  const firebaseConfig = window.GOROD_KROVI_FIREBASE_CONFIG || window.FIREBASE_CONFIG || null;

  if (!firebaseConfig || !window.firebase) {
    shareState.hasRealtimeSync = false;
    shareState.db = null;
    shareState.roomRef = null;
    shareState.stateRef = null;
    shareState.membersRef = null;
    shareState.memberId = null;
    updateShareStatus("ローカルモード: サーバーの設定が未設定です");
    return;
  }

  try {
    if (!window.firebase.apps || !window.firebase.apps.length) {
      window.firebase.initializeApp(firebaseConfig);
    }
    shareState.db = window.firebase.database();
    shareState.hasRealtimeSync = true;
  } catch (error) {
    console.error("Firebase initialization failed:", error);
    shareState.hasRealtimeSync = false;
    updateShareStatus("共有の初期化に失敗しました", true);
    return;
  }

  const roomId = shareState.roomId || readRoomIdFromUrl();
  shareState.roomId = roomId;

  detachRoomSubscriptions();

  if (!roomId) {
    shareState.memberId = null;
    updateShareStatus("ローカルモード: ルームIDが未設定");
    return;
  }

  const roomRef = shareState.db.ref(`gorodKroviRooms/${roomId}`);
  const stateRef = roomRef.child("state");
  const membersRef = roomRef.child("members");

  shareState.roomRef = roomRef;
  shareState.stateRef = stateRef;
  shareState.membersRef = membersRef;

  stateRef.on("value", (snapshot) => {
    const data = snapshot.val();
    if (!data) {
      return;
    }
    applyRemoteState(data);
  });

  updateShareStatus(`共有中: ${roomId}`);
  setupRoomPresence(roomId);
}

function leaveCurrentRoom() {
  if (shareState.memberId && shareState.membersRef) {
    removeCurrentMember();
  }

  detachRoomSubscriptions();

  shareState.roomId = "";
  shareState.memberId = null;

  const roomInput = document.getElementById("roomIdInput");
  if (roomInput) roomInput.value = "";

  const url = new URL(window.location.href);
  url.searchParams.delete("room");
  window.history.replaceState({}, "", url.toString());

  updateShareStatus("ローカルモード: ルームIDが未設定");
}

function setRoomId(nextRoomId) {
  const normalized = sanitizeRoomId(nextRoomId);

  if (!normalized) {
    leaveCurrentRoom();
    return;
  }

  shareState.roomId = normalized;

  if (shareState.memberId && shareState.membersRef) {
    removeCurrentMember();
  }

  const roomInput = document.getElementById("roomIdInput");
  if (roomInput) roomInput.value = normalized;

  const url = new URL(window.location.href);
  url.searchParams.set("room", normalized);
  window.history.replaceState({}, "", url.toString());

  if (shareState.stateRef) shareState.stateRef.off("value");
  if (shareState.membersRef) shareState.membersRef.off("value");
  if (shareState.roomRef) shareState.roomRef.off("value");

  initializeRealtimeSync();
}

function initPrecomputedPaths() {
  for (let sIdx = 0; sIdx < 6; sIdx++) {
    for (let eIdx = 0; eIdx < 6; eIdx++) {
      if (sIdx === eIdx) continue;
      const start = roomNames[sIdx];
      const end = roomNames[eIdx];
      const cacheKey = `${start}_${end}`;

      let foundPaths = [];
      const netStart = network[start];

      for (let d = 1; d <= 3; d++) {
        const firstNext = netStart[d];
        const initialMask = roomBit[start] | roomBit[firstNext];

        let stack = [{
          curr: firstNext,
          mask: initialMask,
          path: [{ room: start, dial: d, next: firstNext }]
        }];

        while (stack.length > 0) {
          const state = stack.pop();

          if (state.mask === 63) {
            if (state.curr === end) {
              foundPaths.push(state.path);
            }
            continue;
          }

          const netCurr = network[state.curr];
          for (let dial = 1; dial <= 3; dial++) {
            const nxt = netCurr[dial];
            const nextBit = roomBit[nxt];

            if ((state.mask & nextBit) === 0) {
              if (nxt === end && state.mask !== (63 ^ nextBit)) continue;

              stack.push({
                curr: nxt,
                mask: state.mask | nextBit,
                path: [...state.path, { room: state.curr, dial: dial, next: nxt }]
              });
            }
          }
        }
      }
      precomputedPaths.set(cacheKey, foundPaths);
    }
  }
}

function findHamiltonianPaths(start, end) {
  return precomputedPaths.get(`${start}_${end}`) || [];
}

document.addEventListener("DOMContentLoaded", () => {
  initPrecomputedPaths();

  const roomInput = document.getElementById("roomIdInput");
  const joinRoomBtn = document.getElementById("joinRoomBtn");
  const copyRoomBtn = document.getElementById("copyRoomBtn");
  const leaveRoomBtn = document.getElementById("leaveRoomBtn");
  const menuToggleBtn = document.getElementById("menuToggleBtn");
  const menuCloseBtn = document.getElementById("menuCloseBtn");
  const menuPanel = document.getElementById("menuPanel");
  const areaTitleEditor = document.getElementById("areaTitleEditor");
  const areaTitleActions = document.getElementById("areaTitleActions");
  const showAreaTitleEditorBtn = document.getElementById("showAreaTitleEditorBtn");
  const saveRoomTitleBtn = document.getElementById("saveRoomTitleBtn");
  const resetRoomTitleBtn = document.getElementById("resetRoomTitleBtn");

  function setAreaTitleEditorVisible(isVisible) {
    if (areaTitleEditor) areaTitleEditor.classList.toggle("hidden", !isVisible);
    if (areaTitleActions) areaTitleActions.classList.toggle("hidden", !isVisible);
    if (showAreaTitleEditorBtn) {
      showAreaTitleEditorBtn.hidden = isVisible;
    }
  }

  renderRoomGrid();
  setAreaTitleEditorVisible(false);
  applyRoomTitleLabels();
  document.querySelectorAll(".dial-btn").forEach((btn) => btn.classList.remove("active"));

  if (roomInput) {
    roomInput.value = readRoomIdFromUrl();
    roomInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        setRoomId(roomInput.value);
      }
    });
  }

  if (joinRoomBtn) {
    joinRoomBtn.addEventListener("click", () => setRoomId(roomInput ? roomInput.value : readRoomIdFromUrl()));
  }

  if (copyRoomBtn) {
    copyRoomBtn.addEventListener("click", async () => {
      const activeRoom = (roomInput && roomInput.value) ? sanitizeRoomId(roomInput.value) : readRoomIdFromUrl();
      if (!activeRoom) {
        updateShareStatus("ローカルモード: ルームIDが未設定", true);
        return;
      }

      const url = new URL(window.location.href);
      url.searchParams.set("room", activeRoom);
      try {
        await navigator.clipboard.writeText(url.toString());
        updateShareStatus("URLをコピーしました");
      } catch (error) {
        updateShareStatus("URLのコピーに失敗しました", true);
      }
    });
  }

  if (leaveRoomBtn) {
    leaveRoomBtn.addEventListener("click", () => {
      leaveCurrentRoom();
    });
  }

  if (menuToggleBtn) {
    menuToggleBtn.addEventListener("click", () => {
      const isOpen = !menuPanel || !menuPanel.classList.contains("open");
      setMenuOpen(isOpen);
    });
  }

  if (menuCloseBtn) {
    menuCloseBtn.addEventListener("click", () => {
      setMenuOpen(false);
    });
  }

  if (menuPanel) {
    menuPanel.addEventListener("click", (event) => {
      if (event.target === menuPanel) {
        setMenuOpen(false);
      }
    });
  }

  if (showAreaTitleEditorBtn) {
    showAreaTitleEditorBtn.addEventListener("click", () => {
      setAreaTitleEditorVisible(true);
    });
  }

  if (saveRoomTitleBtn) {
    saveRoomTitleBtn.addEventListener("click", () => {
      const nextTitles = {};
      keys.forEach((roomKey) => {
        const input = document.getElementById(`title_${roomKey}`);
        nextTitles[roomKey] = (input && input.value.trim()) || DEFAULT_ROOM_TITLES[roomKey];
      });

      setAreaTitleMap(nextTitles);
      applyRoomTitleLabels();
      setAreaTitleEditorVisible(false);
      setMenuOpen(false);
      updateShareStatus("エリア名を保存しました");
    });
  }

  if (resetRoomTitleBtn) {
    resetRoomTitleBtn.addEventListener("click", () => {
      const defaultTitles = resetAreaTitleMap();
      keys.forEach((roomKey) => {
        const input = document.getElementById(`title_${roomKey}`);
        if (input) {
          input.value = "";
          input.placeholder = defaultTitles[roomKey];
        }
      });
      applyRoomTitleLabels();
      setAreaTitleEditorVisible(false);
      setMenuOpen(false);
      updateShareStatus("エリア名を初期値に戻しました");
    });
  }

  document.getElementById("resetBtn").addEventListener("click", reset);

  shareState.roomId = readRoomIdFromUrl();
  if (roomInput) roomInput.value = shareState.roomId;

  initializeRealtimeSync();
  updateLiveProbabilities();
  calculate();
});

function handleStateToggle(target) {
  const room = target.dataset.room;
  const type = target.dataset.type;
  const isActive = target.classList.contains("active");

  if (isActive) {
    target.classList.remove("active");
    if (type === ROOM_STATUS_TYPES.GREEN) lastStates.green = null;
    if (type === ROOM_STATUS_TYPES.PASSWORD) lastStates.password = null;
    if (type === ROOM_STATUS_TYPES.NOT_GREEN) lastStates.notGreens.delete(room);
    return;
  }

  if (type === ROOM_STATUS_TYPES.GREEN) {
    if (lastStates.green) clearStatusButtonState(lastStates.green, ROOM_STATUS_TYPES.GREEN);
    lastStates.green = room;
    lastStates.notGreens.delete(room);
    clearStatusButtonState(room, ROOM_STATUS_TYPES.NOT_GREEN);
    if (lastStates.password === room) {
      lastStates.password = null;
      clearStatusButtonState(room, ROOM_STATUS_TYPES.PASSWORD);
    }
  } else if (type === ROOM_STATUS_TYPES.PASSWORD) {
    if (lastStates.password) clearStatusButtonState(lastStates.password, ROOM_STATUS_TYPES.PASSWORD);
    lastStates.password = room;
    lastStates.notGreens.delete(room);
    clearStatusButtonState(room, ROOM_STATUS_TYPES.NOT_GREEN);
    if (lastStates.green === room) {
      lastStates.green = null;
      clearStatusButtonState(room, ROOM_STATUS_TYPES.GREEN);
    }
  } else if (type === ROOM_STATUS_TYPES.NOT_GREEN) {
    lastStates.notGreens.add(room);
    if (lastStates.green === room) {
      lastStates.green = null;
      clearStatusButtonState(room, ROOM_STATUS_TYPES.GREEN);
    }
    if (lastStates.password === room) {
      lastStates.password = null;
      clearStatusButtonState(room, ROOM_STATUS_TYPES.PASSWORD);
    }
  }

  target.classList.add("active");
}

function updateLiveProbabilities() {
  const start = lastStates.green;
  const end = lastStates.password;

  const activeStarts = start ? [start] : keys.filter(k => !lastStates.notGreens.has(k));
  const activeEnds = end ? [end] : keys;

  const freqs = {};
  keys.forEach(k => freqs[k] = { 1: 0, 2: 0, 3: 0, total: 0 });

  activeStarts.forEach(s => {
    activeEnds.forEach(e => {
      if (s === e) return;
      const paths = findHamiltonianPaths(s, e);
      for (let i = 0; i < paths.length; i++) {
        const path = paths[i];
        for (let j = 0; j < path.length; j++) {
          const step = path[j];
          freqs[step.room][step.dial]++;
          freqs[step.room].total++;
        }
        freqs[e].total++;
      }
    });
  });

  keys.forEach(k => {
    const f = freqs[k], t = f.total;
    const p1 = t ? Math.round((f[1] / t) * 100) : 33;
    const p2 = t ? Math.round((f[2] / t) * 100) : 33;
    const p3 = t ? Math.max(0, 100 - p1 - p2) : 34;
    const displayNode = document.getElementById(`pr_${k}`);
    if (displayNode) {
      displayNode.innerText = `1:${p1} 2:${p2} 3:${p3}`;
    }
  });
}

function calculate() {
  updateLiveProbabilities();
  const start = lastStates.green;
  const end = lastStates.password;
  const panel = document.getElementById("resPanel");
  if (!start || !end || start === end) {
    panel.style.display = "none";
    return;
  }

  const allPaths = findHamiltonianPaths(start, end);
  const body = document.getElementById("resBody");

  if (allPaths.length === 0) {
    panel.style.display = "none";
    return;
  }

  const fragment = document.createDocumentFragment();

  for (let i = 0; i < allPaths.length; i++) {
    const path = allPaths[i];
    const sol = {};

    for (let j = 0; j < path.length; j++) {
      sol[path[j].room] = path[j].dial;
    }
    sol[end] = "P";

    const tr = document.createElement("tr");

    for (let k = 0; k < keys.length; k++) {
      const roomKey = keys[k];
      const td = document.createElement("td");
      const span = document.createElement("span");
      span.className = "num-span";

      const val = sol[roomKey];
      if (val === "P") {
        span.innerText = "P";
        span.classList.add("pink-p");
      } else if (val === selectedVals[roomKey]) {
        span.innerText = val;
        span.classList.add("no-change");
      } else {
        span.innerText = val;
        span.classList.add("change-required");
      }

      td.appendChild(span);
      tr.appendChild(td);
    }

    fragment.appendChild(tr);
  }

  body.innerHTML = "";
  body.appendChild(fragment);
  panel.style.display = "block";
}

function reset() {
  keys.forEach((roomKey) => {
    selectedVals[roomKey] = null;
  });
  applySelectedValuesToButtons();
  document.querySelectorAll(".status-btn").forEach((btn) => btn.classList.remove("active"));
  lastStates = { green: null, password: null, notGreens: new Set() };
  calculate();
  syncCurrentState();
}