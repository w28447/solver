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

const selectedVals = { Dept: 1, Drag: 1, Armo: 1, Supp: 1, Infi: 1, Tank: 1 };
let lastStates = { green: null, password: null, notGreens: new Set() };

const shareState = {
  roomId: null,
  db: null,
  roomRef: null,
  stateRef: null,
  membersRef: null,
  memberId: null,
  roomCreatedAt: null,
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

  return roomId || "party-001";
}

function readRoomIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const candidate = params.get("room");
  return candidate ? sanitizeRoomId(candidate) : "";
}

function updateShareStatus(message, isError = false) {
  const statusNode = document.getElementById("shareStatus");
  if (!statusNode) return;
  statusNode.textContent = message;
  statusNode.style.color = isError ? "#ff8a8a" : "#93c5fd";
}

function syncToggleButtonsFromState() {
  document.querySelectorAll(".st-btn").forEach(btn => {
    const room = btn.dataset.room;
    const type = btn.dataset.type;
    const isActive =
      (type === "green" && lastStates.green === room) ||
      (type === "password" && lastStates.password === room) ||
      (type === "notgreen" && lastStates.notGreens.has(room));
    btn.classList.toggle("active", isActive);
  });
}

function applySelectedValuesToButtons() {
  Object.entries(selectedVals).forEach(([room, value]) => {
    const group = document.querySelector(`.btn-group[data-room="${room}"]`);
    if (!group) return;
    group.querySelectorAll(".v-btn").forEach(btn => {
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
    selectedVals[k] = 1;
  });
  lastStates = { green: null, password: null, notGreens: new Set() };
  applySelectedValuesToButtons();
  syncToggleButtonsFromState();
  calculate();
  if (sync) {
    syncCurrentState();
  }
}

function getStoredRoomCreatedAt(roomId) {
  const key = `gorodKroviCreatedAt:${roomId}`;
  const value = Number(sessionStorage.getItem(key) || "0");
  return Number.isFinite(value) ? value : 0;
}

function setStoredRoomCreatedAt(roomId, createdAt) {
  if (!createdAt) return;
  sessionStorage.setItem(`gorodKroviCreatedAt:${roomId}`, String(createdAt));
}

function syncRoomCreatedAt(roomRef, roomId) {
  if (!roomRef || !roomId) return;

  roomRef.once("value").then((snapshot) => {
    const roomData = snapshot.val() || {};
    const existingCreatedAt = Number(roomData.createdAt || 0);

    if (!existingCreatedAt) {
      const createdAt = Date.now();
      roomRef.child("createdAt").set(createdAt);
      shareState.roomCreatedAt = createdAt;
      setStoredRoomCreatedAt(roomId, createdAt);
      return;
    }

    shareState.roomCreatedAt = existingCreatedAt;
    setStoredRoomCreatedAt(roomId, existingCreatedAt);
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
    updateShareStatus("ローカルモード: Firebaseの設定が未設定です");
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

  if (shareState.stateRef) shareState.stateRef.off("value");
  if (shareState.membersRef) shareState.membersRef.off("value");
  if (shareState.roomRef) shareState.roomRef.off("value");

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

function setRoomId(nextRoomId) {
  const normalized = sanitizeRoomId(nextRoomId);
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
      const url = new URL(window.location.href);
      const activeRoom = (roomInput && roomInput.value) ? roomInput.value : readRoomIdFromUrl();
      url.searchParams.set("room", sanitizeRoomId(activeRoom));
      try {
        await navigator.clipboard.writeText(url.toString());
        updateShareStatus("URLをコピーしました");
      } catch (error) {
        updateShareStatus("URLのコピーに失敗しました", true);
      }
    });
  }

  document.querySelectorAll(".btn-group").forEach(group => {
    const room = group.dataset.room;
    group.querySelectorAll(".v-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        group.querySelectorAll(".v-btn").forEach(b => b.classList.remove("active"));
        e.target.classList.add("active");

        selectedVals[room] = Number(e.target.dataset.val);
        calculate();
        syncCurrentState();
      });
    });
  });

  document.querySelectorAll(".st-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      handleStateToggle(e.target);
      calculate();
      syncCurrentState();
    });
  });

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
    if (type === "green") lastStates.green = null;
    if (type === "password") lastStates.password = null;
    if (type === "notgreen") lastStates.notGreens.delete(room);
  } else {
    if (type === "green") {
      if (lastStates.green) {
        const prevGreen = document.querySelector(`.st-btn[data-room="${lastStates.green}"][data-type="green"]`);
        if (prevGreen) prevGreen.classList.remove("active");
      }
      lastStates.green = room;
      lastStates.notGreens.delete(room);
      const notGreenButton = document.querySelector(`.st-btn[data-room="${room}"][data-type="notgreen"]`);
      if (notGreenButton) notGreenButton.classList.remove("active");
      if (lastStates.password === room) {
        lastStates.password = null;
        const passwordButton = document.querySelector(`.st-btn[data-room="${room}"][data-type="password"]`);
        if (passwordButton) passwordButton.classList.remove("active");
      }
    } else if (type === "password") {
      if (lastStates.password) {
        const prevPassword = document.querySelector(`.st-btn[data-room="${lastStates.password}"][data-type="password"]`);
        if (prevPassword) prevPassword.classList.remove("active");
      }
      lastStates.password = room;
      lastStates.notGreens.delete(room);
      const notGreenButton = document.querySelector(`.st-btn[data-room="${room}"][data-type="notgreen"]`);
      if (notGreenButton) notGreenButton.classList.remove("active");
      if (lastStates.green === room) {
        lastStates.green = null;
        const greenButton = document.querySelector(`.st-btn[data-room="${room}"][data-type="green"]`);
        if (greenButton) greenButton.classList.remove("active");
      }
    } else if (type === "notgreen") {
      lastStates.notGreens.add(room);
      if (lastStates.green === room) {
        lastStates.green = null;
        const greenButton = document.querySelector(`.st-btn[data-room="${room}"][data-type="green"]`);
        if (greenButton) greenButton.classList.remove("active");
      }
      if (lastStates.password === room) {
        lastStates.password = null;
        const passwordButton = document.querySelector(`.st-btn[data-room="${room}"][data-type="password"]`);
        if (passwordButton) passwordButton.classList.remove("active");
      }
    }
    target.classList.add("active");
  }
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
  keys.forEach(k => {
    selectedVals[k] = 1;
  });
  applySelectedValuesToButtons();
  document.querySelectorAll(".st-btn").forEach(btn => btn.classList.remove("active"));
  lastStates = { green: null, password: null, notGreens: new Set() };
  calculate();
  syncCurrentState();
}
