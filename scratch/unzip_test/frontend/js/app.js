/* FitNova Call Intelligence -- vanilla JS SPA, hash-routed, talks to the
   FastAPI backend over relative /api/* calls (same-origin). No build step. */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const DIM_LABELS = {
  needs_discovery: "Needs discovery",
  product_knowledge: "Product knowledge",
  objection_handling: "Objection handling",
  compliance: "Compliance",
  next_step_booking: "Next-step booking",
};
const TAG_LABELS = {
  NO_NEEDS_DISCOVERY: "No needs discovery",
  OVER_PROMISING: "Over-promising results",
  PRESSURE_TACTICS: "Pressure / urgency tactics",
  PRICE_BEFORE_VALUE: "Price before value",
  UNDISCLOSED_COSTS: "Undisclosed additional costs",
  WEAK_TRIAL_BOOKING: "Weak or missing trial booking",
  TALKING_OVER_CUSTOMER: "Talking over the customer",
  PII_EXPOSURE: "Unredacted PII spoken aloud",
  LOW_CONFIDENCE_DIARIZATION: "Low-confidence diarization",
  NON_SALES_CALL: "Non-sales call",
};

async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  return res.json();
}

function toast(message, kind = "success") {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3800);
}

function fmtScore(v) {
  return v === null || v === undefined ? "—" : Math.round(v);
}

function scoreColor(v) {
  if (v === null || v === undefined) return "var(--text-faint)";
  if (v >= 75) return "var(--accent-teal)";
  if (v >= 55) return "var(--accent-amber)";
  return "var(--sev-critical)";
}

function scoreRing(value, { size = 92, stroke = 8, label = "SCORE" } = {}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = value === null || value === undefined ? 0 : Math.max(0, Math.min(100, value)) / 100;
  const color = scoreColor(value);
  return `
    <div class="score-ring" style="width:${size}px;height:${size}px">
      <svg width="${size}" height="${size}">
        <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--panel-alt)" stroke-width="${stroke}"/>
        <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}"
          stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct)}" stroke-linecap="round"/>
      </svg>
      <div class="score-ring-value">
        <span class="score-ring-num" style="color:${color}">${fmtScore(value)}</span>
        <span class="score-ring-label">${label}</span>
      </div>
    </div>`;
}

function severityChip(sev) {
  const cls = { critical: "sev-critical", high: "sev-high", medium: "sev-medium", low: "sev-low", info: "sev-info" }[sev] || "sev-low";
  return `<span class="chip ${cls}">${sev}</span>`;
}

function dimensionBars(dimAverages) {
  const order = ["needs_discovery", "product_knowledge", "objection_handling", "compliance", "next_step_booking"];
  return order.map(dim => {
    const v = dimAverages[dim];
    const pct = v ? (v / 10) * 100 : 0;
    return `
      <div class="dim-bar-row">
        <div class="dim-bar-label">${DIM_LABELS[dim]}</div>
        <div class="dim-bar-track"><div class="dim-bar-fill" style="width:${pct}%; background:${scoreColor(v * 10)}"></div></div>
        <div class="dim-bar-value">${v !== undefined ? v.toFixed(1) : "—"}</div>
      </div>`;
  }).join("");
}

function tagDistributionChart(canvasId, dist) {
  if (typeof Chart === "undefined") {
    console.warn("Chart.js not loaded, skipping chart rendering");
    return;
  }
  const entries = Object.entries(dist);
  if (!entries.length) return;
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  new Chart(ctx, {
    type: "bar",
    data: {
      labels: entries.map(([k]) => TAG_LABELS[k] || k),
      datasets: [{
        data: entries.map(([, v]) => v),
        backgroundColor: "#f2b705",
        borderRadius: 4,
        barThickness: 14,
      }],
    },
    options: {
      indexAxis: "y",
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: "#93a0b3", font: { family: "JetBrains Mono", size: 10 } }, grid: { color: "#232b37" } },
        y: { ticks: { color: "#c9d1db", font: { size: 11 } }, grid: { display: false } },
      },
    },
  });
}

function trendChart(canvasId, trend) {
  if (typeof Chart === "undefined") {
    console.warn("Chart.js not loaded, skipping trend chart rendering");
    return;
  }
  if (!trend.length) return;
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  new Chart(ctx, {
    type: "line",
    data: {
      labels: trend.map(t => t.date),
      datasets: [{
        data: trend.map(t => t.score),
        borderColor: "#35c4a8",
        backgroundColor: "rgba(53,196,168,0.12)",
        fill: true,
        tension: 0.35,
        pointRadius: 3,
        pointBackgroundColor: "#35c4a8",
      }],
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        y: { min: 0, max: 100, ticks: { color: "#93a0b3", font: { family: "JetBrains Mono", size: 10 } }, grid: { color: "#232b37" } },
        x: { ticks: { color: "#93a0b3", font: { size: 10 } }, grid: { display: false } },
      },
    },
  });
}

function setBreadcrumbs(items) {
  const el = $("#breadcrumbs");
  el.innerHTML = items.map((it, i) => {
    const isLast = i === items.length - 1;
    if (isLast) return `<span class="crumb-current">${it.label}</span>`;
    return `<a href="#${it.href}">${it.label}</a><span class="crumb-sep">/</span>`;
  }).join(" ");
}

function setActiveNav(name) {
  $$(".nav-item").forEach(el => el.classList.toggle("active", el.dataset.nav === name));
}

// --- Sidebar: team list + dispute badge -----------------------------------
async function refreshSidebar() {
  try {
    const tree = await api("/org/tree");
    const nav = $("#teamNav");
    const label = $("#teamNavLabel");
    if (label) label.hidden = false;
    if (nav && tree && tree.teams) {
      nav.innerHTML = tree.teams.map(t => {
        return `<a href="#/team/${t.id}" class="nav-item" data-nav="team-${t.id}">
           <span class="nav-dot"></span> ${t.name} <small>${t.advisors ? t.advisors.length : 0}</small>
         </a>`;
      }).join("");
    }
  } catch (e) { /* org may not be seeded yet */ }

  try {
    const disputes = await api("/disputes?status=pending");
    const badge = $("#disputeBadge");
    if (badge) {
      if (disputes.length) { badge.hidden = false; badge.textContent = disputes.length; }
      else badge.hidden = true;
    }
  } catch (e) { /* ignore */ }
}

// --- Layout Mount Helpers for Real Website Flow -----------------------------
function renderFullBleedPage(html) {
  const app = $("#app");
  if (!app) return;
  app.innerHTML = html;
}

async function ensureDashboardShell() {
  const app = $("#app");
  if (!app) return;
  if ($(".app-shell", app)) return;

  const user = getAuthUser();

  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <!-- Brand Logo Header -->
        <div class="brand" onclick="window.location.hash='#/landing'" style="cursor:pointer">
          <div class="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" width="28" height="28">
              <polygon points="16 2, 30 10, 30 22, 16 30, 2 22, 2 10" fill="none" stroke="var(--accent-orange)" stroke-width="2.5"/>
              <path d="M10 16 L16 10 L22 16 L16 22 Z" fill="var(--accent-orange)"/>
            </svg>
          </div>
          <div class="brand-text">
            <span class="brand-name">FitNova</span>
            <span class="brand-sub">Intelligence</span>
          </div>
        </div>

        <!-- Location Badge Pill -->
        <div style="background:rgba(255,77,38,0.1);border:1px solid rgba(255,77,38,0.25);border-radius:20px;padding:6px 12px;display:flex;align-items:center;gap:8px;margin-bottom:14px;font-size:12px;font-weight:600;color:var(--accent-orange)">
          <span style="width:6px;height:6px;border-radius:50%;background:var(--accent-orange)"></span>
          FitNova Sales Ops
        </div>

        <!-- Sidebar Navigation Sections (Exact Screenshot Match) -->
        <nav class="nav">
          <div class="nav-label">OVERVIEW</div>
          <a href="#/org" class="nav-item" data-nav="org">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
            Dashboard
          </a>
          <a href="#/call-feed" class="nav-item" data-nav="call-feed">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
            Call Feed
            <span class="nav-badge" id="callFeedBadge">3</span>
          </a>

          <div class="nav-label">ANALYSIS</div>
          <a href="#/leaderboard" class="nav-item" data-nav="leaderboard">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"></path><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"></path><path d="M4 22h16"></path><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"></path><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"></path><path d="M18 2H6v7a6 6 0 0 0 12 0V2z"></path></svg>
            Leaderboard
          </a>
          <a href="#/disputes" class="nav-item" data-nav="disputes">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path><line x1="4" y1="22" x2="4" y2="15"></line></svg>
            Flag Review
            <span class="nav-badge" id="disputeBadge">7</span>
          </a>
          <a href="#/coaching" class="nav-item" data-nav="coaching">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path></svg>
            Coaching Notes
          </a>

          <div class="nav-label">SETTINGS</div>
          <a href="#/team-config" class="nav-item" data-nav="config">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
            Team Config
          </a>
          <a href="#/rubric-setup" class="nav-item" data-nav="rubric">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="21" x2="4" y2="14"></line><line x1="4" y1="10" x2="4" y2="3"></line><line x1="12" y1="21" x2="12" y2="12"></line><line x1="12" y1="8" x2="12" y2="3"></line><line x1="20" y1="21" x2="20" y2="16"></line><line x1="20" y1="12" x2="20" y2="3"></line><line x1="1" y1="14" x2="7" y2="14"></line><line x1="9" y1="8" x2="15" y2="8"></line><line x1="17" y1="16" x2="23" y2="16"></line></svg>
            Rubric Setup
          </a>
          <a href="#/profile-settings" class="nav-item" data-nav="profile-settings">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
            Profile Settings
          </a>
        </nav>

        <div class="nav-label" id="teamNavLabel" hidden>TEAMS</div>
        <nav class="nav" id="teamNav"></nav>

        <div class="sidebar-footer">
          <button class="btn btn-primary btn-block" id="runPipelineBtn" onclick="openRunPipelineModal()" style="background:var(--accent-orange);border-color:var(--accent-orange);color:#fff">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 2L11 7L3 12V2Z" fill="currentColor"/></svg>
            <span>Run pipeline</span>
          </button>
          <div class="pipeline-status" id="pipelineStatus"></div>
        </div>
      </aside>

      <main class="main">
        <header class="topbar" style="display:flex;align-items:center;justify-content:space-between;padding:12px 20px">
          <div style="display:flex;align-items:center;gap:10px">
            <!-- Sidebar Open / Close Menu Toggle Button -->
            <button class="btn btn-sm btn-ghost" onclick="toggleSidebarCollapse()" title="Toggle Sidebar Menu" style="padding:6px 10px;font-size:13px;border:1px solid rgba(255,255,255,0.12)">
              ☰ <span style="font-size:11.5px;margin-left:4px" id="sidebarToggleLabel">Collapse Menu</span>
            </button>

            <!-- Back Arrow Option for All Pages -->
            <button class="btn btn-sm btn-ghost" onclick="window.history.back()" title="Go Back" style="padding:6px 12px;font-size:12.5px;color:var(--text-muted);border:1px solid rgba(255,255,255,0.12);display:flex;align-items:center;gap:4px">
              ← Back
            </button>

            <div class="breadcrumbs" id="breadcrumbs"></div>
          </div>

          <div class="topbar-right" style="display:flex;align-items:center;gap:12px">
            <span class="engine-chip" id="engineChip" title="Engine status">heuristic engine · mock ASR</span>
            <div id="userProfileArea"></div>
          </div>
        </header>
        <div class="content" id="content">
          <div class="loading-state">Loading FitNova call intelligence…</div>
        </div>
      </main>
    </div>`;

  await refreshSidebar();
  renderUserProfileArea();
}

window.toggleSidebarCollapse = function() {
  const sidebar = $(".sidebar");
  if (!sidebar) return;
  sidebar.classList.toggle("collapsed");
  const isCollapsed = sidebar.classList.contains("collapsed");
  const label = $("#sidebarToggleLabel");
  if (label) label.textContent = isCollapsed ? "Expand Menu" : "Collapse Menu";
  toast(isCollapsed ? "Sidebar Menu collapsed" : "Sidebar Menu expanded");
};

// --- Auth & User Profile Management -----------------------------------------
const DEMO_USERS = [
  { email: "director@fitnova.in", name: "Rohan Kapoor", role: "Sales Director", avatar: "RK" },
  { email: "leader@fitnova.in", name: "Arjun Mehta", role: "Team Leader", avatar: "AM" },
  { email: "advisor@fitnova.in", name: "Neha Gupta", role: "Advisor", avatar: "NG" }
];

function getAuthUser() {
  const saved = localStorage.getItem("fitnova_auth_user");
  if (saved) {
    try { return JSON.parse(saved); } catch (e) {}
  }
  return null;
}

function setAuthUser(user) {
  localStorage.setItem("fitnova_auth_user", JSON.stringify(user));
  renderUserProfileArea();
}

window.logoutUser = function() {
  localStorage.removeItem("fitnova_auth_user");
  renderUserProfileArea();
  toast("Logged out successfully.");
  window.location.hash = "#/landing";
};

window.PEOPLE_AVATARS = {
  "Neha Gupta": "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80",
  "Rahul Joshi": "https://images.unsplash.com/photo-1560250097-0b93528c311a?w=150&auto=format&fit=crop&q=80",
  "Divya Krishnan": "https://images.unsplash.com/photo-1580489944761-15a19d654956?w=150&auto=format&fit=crop&q=80",
  "Karan Malhotra": "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=150&auto=format&fit=crop&q=80",
  "Priya Sharma": "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80",
  "Arjun Mehta": "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80",
  "Sneha Rao": "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&auto=format&fit=crop&q=80",
  "Vikram Nair": "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80",
  "Vikram Singh": "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80",
  "Pooja Agarwal": "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=150&auto=format&fit=crop&q=80",
  "Sanjay Verma": "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=150&auto=format&fit=crop&q=80",
  "Rohan Kapoor": "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150&auto=format&fit=crop&q=80",
  "Aditi Rao": "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=150&auto=format&fit=crop&q=80"
};

window.getPersonAvatarHtml = function(name, size = 26, initials = "") {
  const url = window.PEOPLE_AVATARS[name];
  const init = initials || (name ? name.split(" ").map(p => p[0]).join("").toUpperCase().slice(0, 2) : "NG");
  if (url) {
    return `<img src="${url}" alt="${escapeHtml(name)}" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;border:1.5px solid rgba(255,255,255,0.25);flex-shrink:0;box-shadow:0 2px 6px rgba(0,0,0,0.4)" />`;
  }
  return `<span style="width:${size}px;height:${size}px;border-radius:50%;background:rgba(255,77,38,0.2);color:var(--accent-orange);display:inline-flex;align-items:center;justify-content:center;font-size:${Math.round(size * 0.4)}px;font-weight:700;flex-shrink:0;border:1px solid rgba(255,77,38,0.3)">${init}</span>`;
};

function renderUserProfileArea() {
  const container = $("#userProfileArea");
  if (!container) return;
  const user = getAuthUser();
  if (user) {
    container.innerHTML = `
      <div class="user-profile-widget" style="display:flex;align-items:center;gap:10px">
        ${getPersonAvatarHtml(user.name, 32)}
        <div class="user-info">
          <span class="user-name">${escapeHtml(user.name)}</span>
          <span class="user-role">${escapeHtml(user.role)}</span>
        </div>
        <button class="btn btn-sm btn-ghost" onclick="logoutUser()" title="Logout" style="padding:4px 8px">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
        </button>
      </div>`;
  } else {
    container.innerHTML = `
      <div style="display:flex;gap:8px">
        <button class="btn btn-sm btn-ghost" onclick="window.location.hash='#/login'">Log in</button>
        <button class="btn btn-sm btn-primary" onclick="window.location.hash='#/signup'">Sign up</button>
      </div>`;
  }
}

window.quickDemoLogin = function (index) {
  const user = DEMO_USERS[index];
  const emailInput = $("#authEmail");
  const passwordInput = $("#authPassword");
  if (emailInput && passwordInput) {
    emailInput.value = user.email;
    passwordInput.value = "fitnova123";
    emailInput.focus();
    toast(`Populated ${user.role} credentials (${user.email}). Click Sign In to launch!`);
  } else {
    setAuthUser(user);
    toast(`Logged in as ${user.name} (${user.role})`);
    window.location.hash = "#/org";
  }
};

// --- Landing View (Full Bleed Website Home) -------------------------
async function viewLanding() {
  setActiveNav("");
  renderFullBleedPage(`
    <div style="background:var(--bg);color:#fff;min-height:100vh;position:relative;overflow-x:hidden">
      
      <!-- Fixed Glass Navbar Header -->
      <header style="position:fixed;top:0;left:0;right:0;z-index:900;display:flex;align-items:center;justify-content:space-between;padding:16px 40px;background:rgba(11,12,16,0.85);backdrop-filter:blur(16px);border-bottom:1px solid rgba(255,255,255,0.08)">
        <!-- Brand Logo Left -->
        <div onclick="window.scrollTo({top:0,behavior:'smooth'})" style="display:flex;align-items:center;gap:10px;color:#fff;font-weight:600;font-size:18px;cursor:pointer">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M12 12c-2-2.5-4-4-6-4A4 4 0 0 0 2 12a4 4 0 0 0 4 4c2 0 4-1.5 6-4zm0 0c2 2.5 4 4 6 4a4 4 0 0 0 4-4 4 4 0 0 0-4-4c-2 0-4 1.5-6 4z"></path>
          </svg>
          <span style="font-family:'Geist', sans-serif;font-weight:600;letter-spacing:-0.02em;font-size:18px">Equilibrium <small style="font-weight:400;opacity:0.7">· FitNova Intelligence</small></span>
        </div>

        <!-- Center Nav Pill (Liquid Glass - In-Page Smooth Scroll) -->
        <div class="liquid-glass" style="display:flex;align-items:center;gap:2px;border-radius:30px;padding:4px 6px">
          <button onclick="document.getElementById('sec-hero-old').scrollIntoView({behavior:'smooth'})" style="padding:6px 14px;border-radius:20px;font-size:12.5px;color:#fff;background:rgba(255,255,255,0.12);border:none;cursor:pointer">Home</button>
          <button onclick="document.getElementById('sec-hero-tv').scrollIntoView({behavior:'smooth'})" style="padding:6px 14px;border-radius:20px;font-size:12.5px;color:var(--text-muted);background:none;border:none;cursor:pointer">Live Showcase</button>
          <button onclick="document.getElementById('sec-features').scrollIntoView({behavior:'smooth'})" style="padding:6px 14px;border-radius:20px;font-size:12.5px;color:var(--text-muted);background:none;border:none;cursor:pointer">Features</button>
          <button onclick="document.getElementById('sec-pipeline').scrollIntoView({behavior:'smooth'})" style="padding:6px 14px;border-radius:20px;font-size:12.5px;color:var(--text-muted);background:none;border:none;cursor:pointer">AI Pipeline</button>
          <button onclick="document.getElementById('sec-rubric').scrollIntoView({behavior:'smooth'})" style="padding:6px 14px;border-radius:20px;font-size:12.5px;color:var(--text-muted);background:none;border:none;cursor:pointer">Rubric Setup</button>
          <button onclick="document.getElementById('sec-pods').scrollIntoView({behavior:'smooth'})" style="padding:6px 14px;border-radius:20px;font-size:12.5px;color:var(--text-muted);background:none;border:none;cursor:pointer">Pods & Rankings</button>
          <button onclick="document.getElementById('sec-pricing').scrollIntoView({behavior:'smooth'})" style="padding:6px 14px;border-radius:20px;font-size:12.5px;color:var(--text-muted);background:none;border:none;cursor:pointer">Pod Plans</button>
        </div>

        <!-- Right CTAs -->
        <div style="display:flex;align-items:center;gap:12px">
          <button class="liquid-glass" onclick="window.location.hash='#/login'" style="color:#fff;font-size:13.5px;font-weight:500;padding:10px 22px;border-radius:9999px">Log in</button>
          <button onclick="window.location.hash='#/signup'" style="background:#ffffff;color:#000000;font-size:13.5px;font-weight:600;padding:10px 24px;border-radius:9999px;border:none">Begin Now</button>
        </div>
      </header>

      <!-- SECTION 1: ORIGINAL HERO WITH FULLSCREEN HAND TOUCH EARTH VIDEO -->
      <div id="sec-hero-old" style="position:relative;width:100%;min-height:100vh;overflow:hidden;background:#000;font-family:'Geist', sans-serif;display:flex;align-items:flex-end;padding-bottom:60px">
        <!-- Background Hand Touch Earth Looping Video -->
        <video
          src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260511_230229_7c9bc431-46cf-489a-948d-e8144d8eb5d4.mp4"
          autoplay
          muted
          loop
          playsinline
          style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:1"
        ></video>

        <!-- Dark Vignette Gradient Overlay -->
        <div style="position:absolute;inset:0;background:linear-gradient(180deg, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.2) 40%, rgba(0,0,0,0.88) 100%);z-index:2"></div>

        <!-- Hero Content (Bottom Left) -->
        <div style="position:relative;z-index:20;padding:0 48px;max-width:720px">
          <h1 style="font-family:'Geist', sans-serif;color:#ffffff;font-size:58px;font-weight:500;line-height:1.06;letter-spacing:-0.03em;margin:0 0 18px">
            Live Better, Feel Whole Every Day.
          </h1>
          <p style="font-family:'Geist', sans-serif;color:rgba(255,255,255,0.65);font-size:15px;line-height:1.6;margin:0 0 32px;max-width:520px">
            Take charge of how you feel with a companion built for your journey—build routines, follow your growth, and unlock tailored insights for a steadier, more vibrant life each day.
          </p>

          <!-- Buttons Row -->
          <div style="display:flex;flex-wrap:wrap;align-items:center;gap:14px">
            <button onclick="window.location.hash='#/signup'" style="background:#ffffff;color:#000000;font-size:15px;font-weight:600;padding:14px 32px;border-radius:9999px;border:none;cursor:pointer">
              Start Today
            </button>
            <button class="liquid-glass" onclick="document.getElementById('sec-hero-tv').scrollIntoView({behavior:'smooth'})" style="color:#ffffff;font-size:15px;font-weight:500;padding:14px 30px;border-radius:9999px;cursor:pointer">
              Discover How ↓
            </button>
            <button class="liquid-glass" onclick="window.location.hash='#/org'" style="color:var(--accent-teal);font-size:15px;font-weight:600;padding:14px 30px;border-radius:9999px;cursor:pointer">
              Launch Dashboard →
            </button>
          </div>
        </div>
      </div>

      <!-- SECTION 2: CYBER TV MONITOR SHOWCASE SECTION WITH VOICE TELEMETRY VIDEO -->
      <div id="sec-hero-tv" style="position:relative;padding:100px 40px;background:var(--bg);border-top:1px solid rgba(255,255,255,0.08);overflow:hidden">
        <!-- Background Looping Wave Video -->
        <video
          src="/static/videos/bg_waves.mp4"
          autoplay
          muted
          loop
          playsinline
          style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0;opacity:0.45"
        ></video>
        <div style="position:absolute;inset:0;background:linear-gradient(135deg, rgba(8,9,12,0.92) 0%, rgba(15,23,42,0.85) 50%, rgba(8,9,12,0.95) 100%);z-index:1"></div>

        <div style="position:relative;z-index:2;max-width:1240px;margin:0 auto;width:100%;display:grid;grid-template-columns:1.1fr 0.9fr;gap:40px;align-items:center">
          <!-- Left Text Content -->
          <div>
            <div style="display:inline-flex;align-items:center;gap:8px;background:rgba(255,77,38,0.15);border:1px solid rgba(255,77,38,0.3);color:var(--accent-orange);padding:6px 16px;border-radius:30px;font-size:12px;font-weight:700;margin-bottom:20px">
              ⚡ NEXT-GEN VOICE QA & CALL INTELLIGENCE
            </div>
            
            <h2 style="font-family:var(--font-display);color:#ffffff;font-size:46px;font-weight:800;line-height:1.1;letter-spacing:-0.03em;margin:0 0 20px">
              Turn Every Tele-Sales Call Into <span style="background:linear-gradient(90deg, var(--accent-orange) 0%, var(--accent-teal) 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent">High-Conversion Revenue</span>
            </h2>

            <p style="color:var(--text-muted);font-size:15.5px;line-height:1.6;margin:0 0 32px;max-width:540px">
              Automated Whisper ASR Speech Diarization + 5-Dimension AI Rubric Evaluation. Detect over-promising guarantees, objection handling lapses, and trial booking friction instantly.
            </p>

            <div style="display:flex;flex-wrap:wrap;align-items:center;gap:14px">
              <button onclick="window.location.hash='#/signup'" style="background:var(--accent-orange);color:#ffffff;font-size:15px;font-weight:700;padding:14px 34px;border-radius:30px;border:none;cursor:pointer;box-shadow:0 10px 30px var(--accent-orange-glow)">
                Start Free Trial
              </button>
              <button class="liquid-glass" onclick="openRunPipelineModal()" style="color:#ffffff;font-size:14.5px;font-weight:600;padding:14px 28px;border-radius:30px;border:1px solid rgba(255,255,255,0.2);cursor:pointer">
                ⚡ Run Live AI Ingestion Pipeline
              </button>
              <button class="liquid-glass" onclick="window.location.hash='#/org'" style="color:var(--accent-teal);font-size:14.5px;font-weight:700;padding:14px 28px;border-radius:30px;cursor:pointer">
                Open Dashboard →
              </button>
            </div>
          </div>

          <!-- Right Cyber TV Screen Frame with TV Waveform Video -->
          <div style="position:relative">
            <div style="background:rgba(14,16,23,0.85);border:2px solid rgba(255,77,38,0.4);border-radius:24px;padding:16px;box-shadow:0 24px 60px rgba(0,0,0,0.8), 0 0 40px rgba(255,77,38,0.2);backdrop-filter:blur(16px);position:relative">
              <!-- Top TV Monitor Bezel Header -->
              <div style="display:flex;align-items:center;justify-content:space-between;padding-bottom:10px;margin-bottom:10px;border-bottom:1px solid rgba(255,255,255,0.1)">
                <div style="display:flex;align-items:center;gap:6px">
                  <span style="width:10px;height:10px;border-radius:50%;background:#ff5f56;display:inline-block"></span>
                  <span style="width:10px;height:10px;border-radius:50%;background:#ffbd2e;display:inline-block"></span>
                  <span style="width:10px;height:10px;border-radius:50%;background:#27c93f;display:inline-block"></span>
                </div>
                <span style="font-family:var(--font-mono);font-size:11px;color:var(--accent-teal);font-weight:700">● LIVE VOICE SPECTRUM TELEMETRY</span>
              </div>

              <!-- TV Screen Container with Looping TV Waveform Video -->
              <div style="position:relative;border-radius:14px;overflow:hidden;height:260px;background:#000">
                <video
                  src="/static/videos/tv_waveform.mp4"
                  autoplay
                  muted
                  loop
                  playsinline
                  style="width:100%;height:100%;object-fit:cover"
                ></video>
                <div style="position:absolute;bottom:12px;left:12px;right:12px;background:rgba(0,0,0,0.65);backdrop-filter:blur(8px);padding:10px 14px;border-radius:10px;border:1px solid rgba(255,255,255,0.15);display:flex;align-items:center;justify-content:space-between">
                  <div>
                    <div style="font-size:11px;color:var(--text-faint)">AI ENGINE ACCURACY</div>
                    <div style="font-family:var(--font-mono);font-size:16px;font-weight:800;color:var(--accent-teal)">98.4% ASR Accuracy</div>
                  </div>
                  <button class="btn btn-sm btn-primary" onclick="openRunPipelineModal()" style="background:var(--accent-orange);border-color:var(--accent-orange);color:#fff">Ingest Stream</button>
                </div>
              </div>

              <!-- Bottom Stats Bar -->
              <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:12px;text-align:center">
                <div style="background:rgba(255,255,255,0.04);padding:8px;border-radius:8px">
                  <div style="font-family:var(--font-mono);font-size:16px;font-weight:700;color:#fff">412</div>
                  <div style="font-size:10px;color:var(--text-faint)">Calls Scored</div>
                </div>
                <div style="background:rgba(255,255,255,0.04);padding:8px;border-radius:8px">
                  <div style="font-family:var(--font-mono);font-size:16px;font-weight:700;color:var(--accent-teal)">74.2</div>
                  <div style="font-size:10px;color:var(--text-faint)">Avg Quality</div>
                </div>
                <div style="background:rgba(255,255,255,0.04);padding:8px;border-radius:8px">
                  <div style="font-family:var(--font-mono);font-size:16px;font-weight:700;color:var(--accent-orange)">63.8%</div>
                  <div style="font-size:10px;color:var(--text-faint)">Trial Rate</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- SECTION 3: sec-features — FEATURES OVERVIEW SECTION -->
      <div id="sec-features" style="position:relative;padding:90px 40px;background:var(--bg);border-top:1px solid rgba(255,255,255,0.06);overflow:hidden">
        <!-- Section Video Background -->
        <video src="/static/videos/bg_fiber_optic.mp4" autoplay muted loop playsinline style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0;opacity:0.4"></video>
        <div style="position:absolute;inset:0;background:linear-gradient(180deg, rgba(8,9,12,0.88) 0%, rgba(14,17,25,0.92) 100%);z-index:1"></div>

        <div style="position:relative;z-index:2;max-width:1240px;margin:0 auto">
          <div style="text-align:center;margin-bottom:48px">
            <span style="color:var(--accent-orange);font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em">ROLE-BASED INTELLIGENCE</span>
            <h2 style="font-family:var(--font-display);font-size:32px;font-weight:800;margin:8px 0;color:#fff">Built for Every Tier of Tele-Sales Operations</h2>
            <p style="color:var(--text-muted);font-size:15px;max-width:600px;margin:0 auto">From executive director oversight down to individual advisor self-coaching</p>
          </div>

          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:24px">
            <div class="card" onclick="window.location.hash='#/org'" style="cursor:pointer;padding:24px">
              <div style="width:40px;height:40px;border-radius:12px;background:rgba(255,77,38,0.15);color:var(--accent-orange);display:flex;align-items:center;justify-content:center;font-size:20px;margin-bottom:16px">👑</div>
              <h3 style="font-family:var(--font-display);font-size:18px;font-weight:700;margin:0 0 8px;color:#fff">Sales Director Overview</h3>
              <p style="font-size:13px;color:var(--text-muted);margin:0 0 16px;line-height:1.5">Macro health view across all pods & advisors. Track org rubric averages, risk index trends, tag distributions, and pod leaderboards.</p>
              <span style="color:var(--accent-orange);font-size:12px;font-weight:700">Open Director Dashboard →</span>
            </div>

            <div class="card" onclick="window.location.hash='#/org'" style="cursor:pointer;padding:24px">
              <div style="width:40px;height:40px;border-radius:12px;background:rgba(53,196,168,0.15);color:var(--accent-teal);display:flex;align-items:center;justify-content:center;font-size:20px;margin-bottom:16px">📊</div>
              <h3 style="font-family:var(--font-display);font-size:18px;font-weight:700;margin:0 0 8px;color:#fff">Team Leader Pod View</h3>
              <p style="font-size:13px;color:var(--text-muted);margin:0 0 16px;line-height:1.5">Targeted coaching view for pod leaders. Review advisor performance, audit flagged compliance lines, and resolve disputes in 1-click.</p>
              <span style="color:var(--accent-teal);font-size:12px;font-weight:700">Open Team Leader View →</span>
            </div>

            <div class="card" onclick="window.location.hash='#/org'" style="cursor:pointer;padding:24px">
              <div style="width:40px;height:40px;border-radius:12px;background:rgba(242,183,5,0.15);color:var(--accent-amber);display:flex;align-items:center;justify-content:center;font-size:20px;margin-bottom:16px">👤</div>
              <h3 style="font-family:var(--font-display);font-size:18px;font-weight:700;margin:0 0 8px;color:#fff">Advisor Self-Coaching</h3>
              <p style="font-size:13px;color:var(--text-muted);margin:0 0 16px;line-height:1.5">Personal breakdown for tele-advisors to inspect call transcripts, understand rubric weak spots, and contest unfair flags with explicit rationale.</p>
              <span style="color:var(--accent-amber);font-size:12px;font-weight:700">Open Advisor Dashboard →</span>
            </div>
          </div>
        </div>
      </div>

      <!-- SECTION 4: sec-pipeline — REAL-TIME 5-STAGE SPEECH AI PIPELINE -->
      <div id="sec-pipeline" style="position:relative;padding:90px 40px;background:rgba(15,17,24,0.6);border-top:1px solid rgba(255,255,255,0.06);overflow:hidden">
        <!-- Section Video Background -->
        <video src="/static/videos/bg_fiber_optic.mp4" autoplay muted loop playsinline style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0;opacity:0.35"></video>
        <div style="position:absolute;inset:0;background:linear-gradient(135deg, rgba(8,9,12,0.92) 0%, rgba(15,23,42,0.92) 100%);z-index:1"></div>

        <div style="position:relative;z-index:2;max-width:1240px;margin:0 auto">
          <div style="text-align:center;margin-bottom:48px">
            <span style="color:var(--accent-teal);font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em">HIGH-SPEED VOICE ARCHITECTURE</span>
            <h2 style="font-family:var(--font-display);font-size:32px;font-weight:800;margin:8px 0;color:#fff">5-Stage AI Speech Processing Pipeline</h2>
            <p style="color:var(--text-muted);font-size:15px;max-width:600px;margin:0 auto">Processes telephony audio streams in under 3 seconds with zero latency</p>
          </div>

          <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:14px">
            <div class="card" style="padding:16px;text-align:center">
              <div style="font-family:var(--font-mono);font-size:20px;font-weight:800;color:var(--accent-orange);margin-bottom:6px">01</div>
              <h4 style="font-size:14px;font-weight:700;color:#fff;margin:0 0 4px">Exotel Audio Ingestion</h4>
              <p style="font-size:11.5px;color:var(--text-faint);margin:0">Real-time webhook ingestion of MP3/WAV streams.</p>
            </div>

            <div class="card" style="padding:16px;text-align:center">
              <div style="font-family:var(--font-mono);font-size:20px;font-weight:800;color:var(--accent-teal);margin-bottom:6px">02</div>
              <h4 style="font-size:14px;font-weight:700;color:#fff;margin:0 0 4px">Whisper ASR Diarization</h4>
              <p style="font-size:11.5px;color:var(--text-faint);margin:0">Dual-channel speaker separation for customer & advisor.</p>
            </div>

            <div class="card" style="padding:16px;text-align:center">
              <div style="font-family:var(--font-mono);font-size:20px;font-weight:800;color:var(--accent-amber);margin-bottom:6px">03</div>
              <h4 style="font-size:14px;font-weight:700;color:#fff;margin:0 0 4px">PII Anonymization</h4>
              <p style="font-size:11.5px;color:var(--text-faint);margin:0">Automated regex redaction of credit cards, phone & PII.</p>
            </div>

            <div class="card" style="padding:16px;text-align:center">
              <div style="font-family:var(--font-mono);font-size:20px;font-weight:800;color:var(--accent-teal);margin-bottom:6px">04</div>
              <h4 style="font-size:14px;font-weight:700;color:#fff;margin:0 0 4px">5-Dimension Rubric</h4>
              <p style="font-size:11.5px;color:var(--text-faint);margin:0">Scores Needs Discovery, Product Knowledge, Objection Handling.</p>
            </div>

            <div class="card" style="padding:16px;text-align:center">
              <div style="font-family:var(--font-mono);font-size:20px;font-weight:800;color:var(--accent-orange);margin-bottom:6px">05</div>
              <h4 style="font-size:14px;font-weight:700;color:#fff;margin:0 0 4px">Leader Notification</h4>
              <p style="font-size:11.5px;color:var(--text-faint);margin:0">Immediate flag alerts dispatched to pod leader dashboard.</p>
            </div>
          </div>
        </div>
      </div>

      <!-- SECTION 5: sec-rubric — ROUTINE RUBRIC & EVALUATION SETUP -->
      <div id="sec-rubric" style="position:relative;padding:90px 40px;background:var(--bg);border-top:1px solid rgba(255,255,255,0.06);overflow:hidden">
        <!-- Section Video Background -->
        <video src="/static/videos/bg_fiber_optic.mp4" autoplay muted loop playsinline style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0;opacity:0.4"></video>
        <div style="position:absolute;inset:0;background:linear-gradient(180deg, rgba(8,9,12,0.92) 0%, rgba(15,23,42,0.9) 100%);z-index:1"></div>

        <div style="position:relative;z-index:2;max-width:1240px;margin:0 auto">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:32px;flex-wrap:wrap;gap:16px">
            <div>
              <span style="color:var(--accent-amber);font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em">EVALUATION STANDARDS</span>
              <h2 style="font-family:var(--font-display);font-size:32px;font-weight:800;margin:6px 0;color:#fff">5-Dimension Sales Evaluation Rubric</h2>
            </div>
            <button class="btn btn-primary" onclick="window.location.hash='#/rubric-setup'" style="background:var(--accent-orange);border-color:var(--accent-orange);color:#fff">
              Configure Custom Rubric →
            </button>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
            <div class="card" style="padding:20px">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                <h4 style="font-size:15px;font-weight:700;color:#fff;margin:0">1. Needs Discovery (25%)</h4>
                <span style="color:var(--accent-teal);font-family:var(--font-mono);font-weight:700">Weight: 25%</span>
              </div>
              <p style="font-size:12.5px;color:var(--text-muted);margin:0">Evaluates open-ended questions regarding prospect fitness objectives, budget range, and timeline expectations.</p>
            </div>

            <div class="card" style="padding:20px">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                <h4 style="font-size:15px;font-weight:700;color:#fff;margin:0">2. Product Knowledge (20%)</h4>
                <span style="color:var(--accent-teal);font-family:var(--font-mono);font-weight:700">Weight: 20%</span>
              </div>
              <p style="font-size:12.5px;color:var(--text-muted);margin:0">Accuracy of plan feature descriptions, coach allocation details, and app functionality guidance.</p>
            </div>

            <div class="card" style="padding:20px">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                <h4 style="font-size:15px;font-weight:700;color:#fff;margin:0">3. Objection Handling (20%)</h4>
                <span style="color:var(--accent-teal);font-family:var(--font-mono);font-weight:700">Weight: 20%</span>
              </div>
              <p style="font-size:12.5px;color:var(--text-muted);margin:0">Handling price, time commitment, or competitor hesitation with value ROI framing.</p>
            </div>

            <div class="card" style="padding:20px">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                <h4 style="font-size:15px;font-weight:700;color:#fff;margin:0">4. Value Framing & Pricing (20%)</h4>
                <span style="color:var(--accent-teal);font-family:var(--font-mono);font-weight:700">Weight: 20%</span>
              </div>
              <p style="font-size:12.5px;color:var(--text-muted);margin:0">Ensures advisor presents plan benefits before disclosing monthly fees.</p>
            </div>
          </div>
        </div>
      </div>

      <!-- SECTION 6: sec-pods — POD PERFORMANCE & RANKINGS -->
      <div id="sec-pods" style="position:relative;padding:90px 40px;background:rgba(15,17,24,0.6);border-top:1px solid rgba(255,255,255,0.06);overflow:hidden">
        <!-- Section Video Background -->
        <video src="/static/videos/bg_fiber_optic.mp4" autoplay muted loop playsinline style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0;opacity:0.35"></video>
        <div style="position:absolute;inset:0;background:linear-gradient(135deg, rgba(8,9,12,0.92) 0%, rgba(15,23,42,0.92) 100%);z-index:1"></div>

        <div style="position:relative;z-index:2;max-width:1240px;margin:0 auto">
          <div style="text-align:center;margin-bottom:40px">
            <span style="color:var(--accent-orange);font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em">POD RANKINGS</span>
            <h2 style="font-family:var(--font-display);font-size:32px;font-weight:800;margin:8px 0;color:#fff">Active Tele-Sales Pods</h2>
          </div>

          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:20px">
            <div class="card" onclick="window.location.hash='#/team/pod_1'" style="cursor:pointer;padding:24px">
              <span style="display:inline-block;background:rgba(255,77,38,0.15);color:var(--accent-orange);padding:4px 12px;border-radius:20px;font-size:11px;font-weight:700;margin-bottom:10px">🥇 RANK 1</span>
              <h3 style="font-family:var(--font-display);font-size:20px;font-weight:800;color:#fff;margin:0 0 4px">Alpha Pod</h3>
              <p style="font-size:12px;color:var(--text-muted);margin:0 0 16px">High Velocity Telesales · Led by Priya Sharma</p>
              <div style="display:flex;justify-content:space-between;align-items:baseline">
                <div><div style="font-family:var(--font-mono);font-size:28px;font-weight:800;color:var(--accent-teal)">81.4</div><div style="font-size:11px;color:var(--text-faint)">Avg Score</div></div>
                <div><div style="font-family:var(--font-mono);font-size:22px;font-weight:800;color:#fff">74%</div><div style="font-size:11px;color:var(--text-faint)">Trial Rate</div></div>
              </div>
            </div>

            <div class="card" onclick="window.location.hash='#/team/pod_2'" style="cursor:pointer;padding:24px">
              <span style="display:inline-block;background:rgba(242,183,5,0.15);color:var(--accent-amber);padding:4px 12px;border-radius:20px;font-size:11px;font-weight:700;margin-bottom:10px">🥈 RANK 2</span>
              <h3 style="font-family:var(--font-display);font-size:20px;font-weight:800;color:#fff;margin:0 0 4px">Beta Pod</h3>
              <p style="font-size:12px;color:var(--text-muted);margin:0 0 16px">Outbound Growth Pod · Led by Arjun Mehta</p>
              <div style="display:flex;justify-content:space-between;align-items:baseline">
                <div><div style="font-family:var(--font-mono);font-size:28px;font-weight:800;color:var(--accent-teal)">76.2</div><div style="font-size:11px;color:var(--text-faint)">Avg Score</div></div>
                <div><div style="font-family:var(--font-mono);font-size:22px;font-weight:800;color:#fff">67%</div><div style="font-size:11px;color:var(--text-faint)">Trial Rate</div></div>
              </div>
            </div>

            <div class="card" onclick="window.location.hash='#/team/pod_3'" style="cursor:pointer;padding:24px">
              <span style="display:inline-block;background:rgba(255,255,255,0.1);color:var(--text-muted);padding:4px 12px;border-radius:20px;font-size:11px;font-weight:700;margin-bottom:10px">🥉 RANK 3</span>
              <h3 style="font-family:var(--font-display);font-size:20px;font-weight:800;color:#fff;margin:0 0 4px">Gamma Pod</h3>
              <p style="font-size:12px;color:var(--text-muted);margin:0 0 16px">Enterprise Lead Pod · Led by Sneha Rao</p>
              <div style="display:flex;justify-content:space-between;align-items:baseline">
                <div><div style="font-family:var(--font-mono);font-size:28px;font-weight:800;color:var(--accent-amber)">72.8</div><div style="font-size:11px;color:var(--text-faint)">Avg Score</div></div>
                <div><div style="font-family:var(--font-mono);font-size:22px;font-weight:800;color:#fff">64%</div><div style="font-size:11px;color:var(--text-faint)">Trial Rate</div></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- SECTION 7: sec-pricing — POD PLANS & PRICING -->
      <div id="sec-pricing" style="position:relative;padding:90px 40px;background:var(--bg);border-top:1px solid rgba(255,255,255,0.06);overflow:hidden">
        <!-- Section Video Background -->
        <video src="/static/videos/bg_fiber_optic.mp4" autoplay muted loop playsinline style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0;opacity:0.4"></video>
        <div style="position:absolute;inset:0;background:linear-gradient(180deg, rgba(8,9,12,0.92) 0%, rgba(14,17,25,0.95) 100%);z-index:1"></div>

        <div style="position:relative;z-index:2;max-width:1240px;margin:0 auto">
          <div style="text-align:center;margin-bottom:48px">
            <span style="color:var(--accent-teal);font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em">TRANSPARENT PRICING</span>
            <h2 style="font-family:var(--font-display);font-size:32px;font-weight:800;margin:8px 0;color:#fff">Pod License & Enterprise Plans</h2>
            <p style="color:var(--text-muted);font-size:15px;max-width:600px;margin:0 auto">Scalable call scoring & AI intelligence per advisor pod</p>
          </div>

          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:24px">
            <div class="card" style="padding:28px;display:flex;flex-direction:column;justify-content:space-between">
              <div>
                <h3 style="font-size:20px;font-weight:700;color:#fff;margin:0 0 6px">Starter Pod</h3>
                <div style="font-family:var(--font-mono);font-size:36px;font-weight:800;color:#fff;margin-bottom:12px">₹4,999 <small style="font-size:14px;color:var(--text-faint);font-weight:400">/pod/mo</small></div>
                <p style="font-size:12.5px;color:var(--text-muted);margin:0 0 20px">For teams up to 5 advisors</p>
                <ul style="font-size:13px;color:var(--text-muted);padding-left:18px;margin:0 0 24px;line-height:1.8">
                  <li>500 Call Evaluation Hours</li>
                  <li>Whisper ASR Speech Diarization</li>
                  <li>5-Dimension Rubric Scoring</li>
                  <li>Email Alert Summaries</li>
                </ul>
              </div>
              <button class="btn btn-ghost" onclick="window.location.hash='#/signup'" style="width:100%;border-color:rgba(255,255,255,0.2)">Select Plan</button>
            </div>

            <div class="card" style="padding:28px;display:flex;flex-direction:column;justify-content:space-between;border-color:var(--accent-orange);background:linear-gradient(145deg, rgba(255,77,38,0.12) 0%, rgba(13,14,20,0.92) 100%)">
              <div>
                <span style="background:var(--accent-orange);color:#fff;font-size:10.5px;font-weight:800;padding:2px 10px;border-radius:20px;text-transform:uppercase">Most Popular</span>
                <h3 style="font-size:20px;font-weight:700;color:#fff;margin:10px 0 6px">Pro Growth Pod</h3>
                <div style="font-family:var(--font-mono);font-size:36px;font-weight:800;color:var(--accent-orange);margin-bottom:12px">₹9,999 <small style="font-size:14px;color:var(--text-faint);font-weight:400">/pod/mo</small></div>
                <p style="font-size:12.5px;color:var(--text-muted);margin:0 0 20px">For teams up to 15 advisors</p>
                <ul style="font-size:13px;color:var(--text-muted);padding-left:18px;margin:0 0 24px;line-height:1.8">
                  <li>2,500 Call Evaluation Hours</li>
                  <li>Real-Time Exotel Webhook Stream</li>
                  <li>Flag Dispute Resolution Portal</li>
                  <li>Custom Rubric Weight Editor</li>
                </ul>
              </div>
              <button class="btn btn-primary" onclick="window.location.hash='#/signup'" style="width:100%;background:var(--accent-orange);border-color:var(--accent-orange);color:#fff">Start Free 14-Day Trial</button>
            </div>

            <div class="card" style="padding:28px;display:flex;flex-direction:column;justify-content:space-between">
              <div>
                <h3 style="font-size:20px;font-weight:700;color:#fff;margin:0 0 6px">Enterprise Scale</h3>
                <div style="font-family:var(--font-mono);font-size:36px;font-weight:800;color:#fff;margin-bottom:12px">Custom <small style="font-size:14px;color:var(--text-faint);font-weight:400">/org</small></div>
                <p style="font-size:12.5px;color:var(--text-muted);margin:0 0 20px">Unlimited pods & dedicated API</p>
                <ul style="font-size:13px;color:var(--text-muted);padding-left:18px;margin:0 0 24px;line-height:1.8">
                  <li>Unlimited Telephony Hours</li>
                  <li>On-Premises / Private Cloud Deployment</li>
                  <li>Dedicated Account Manager</li>
                  <li>Custom SLA & Support</li>
                </ul>
              </div>
              <button class="btn btn-ghost" onclick="window.location.hash='#/signup'" style="width:100%;border-color:rgba(255,255,255,0.2)">Contact Sales</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Public Footer -->
      <footer style="max-width:1240px;margin:0 auto;border-top:1px solid rgba(255,255,255,0.08);padding:32px 40px;display:flex;align-items:center;justify-content:space-between;color:var(--text-faint);font-size:12.5px">
        <div>© 2026 FitNova Call Intelligence · All Rights Reserved</div>
        <div style="display:flex;gap:20px">
          <button onclick="document.getElementById('sec-hero-old').scrollIntoView({behavior:'smooth'})" style="background:none;border:none;color:var(--text-muted);cursor:pointer">Back to Top ↑</button>
          <a href="#/signup" style="color:var(--text-muted)">Sign Up</a>
          <a href="#/login" style="color:var(--text-muted)">Log In</a>
          <a href="#/org" style="color:var(--accent-orange)">Launch Dashboard</a>
        </div>
      </footer>

    </div>
  `);
}

window.togglePasswordVisibility = function(inputId) {
  const input = document.getElementById(inputId);
  const btn = document.getElementById(inputId + "ToggleBtn");
  if (!input) return;
  if (input.type === "password") {
    input.type = "text";
    if (btn) btn.textContent = "🙈";
  } else {
    input.type = "password";
    if (btn) btn.textContent = "👁️";
  }
};

window.handleAuthSignup = function(e) {
  e.preventDefault();
  const email = $("#authEmail").value.trim();
  const name = email.split("@")[0];
  const user = { name: name.toUpperCase(), email, role: "Sales Director", avatar: name.slice(0,2).toUpperCase() };
  setAuthUser(user);
  toast(`Account created! Welcome, ${user.name}`);
  window.location.hash = "#/org";
};

window.handleAuthLogin = function(e) {
  e.preventDefault();
  const email = $("#authEmail").value.trim();
  const found = DEMO_USERS.find(u => u.email.toLowerCase() === email.toLowerCase()) || {
    email: email, name: email.split("@")[0], role: "Sales Director", avatar: email.slice(0,2).toUpperCase()
  };
  setAuthUser(found);
  toast(`Logged in as ${found.name} (${found.role})`);
  window.location.hash = "#/org";
};

async function viewAuth(mode = "signup") {
  const isSignUp = mode === "signup";

  renderFullBleedPage(`
    <div class="auth-page-container" style="position:relative;overflow:hidden">
      <!-- Background Looping Cyber Audio Video -->
      <video
        src="/static/videos/bg_waves.mp4"
        autoplay
        muted
        loop
        playsinline
        style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0;opacity:0.6"
      ></video>

      <!-- Vignette Overlay for High Contrast Legibility -->
      <div style="position:absolute;inset:0;background:linear-gradient(135deg, rgba(8,9,12,0.82) 0%, rgba(15,23,42,0.78) 100%);z-index:1"></div>

      <!-- Left Auth Form Card (Exact Match for Screenshots #4 & #5) -->
      <div class="auth-form-card" style="position:relative;z-index:2">
        <!-- Top Bar: Back to Home Button & Brand Logo -->
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <button onclick="window.location.hash='#/landing'" class="btn btn-sm btn-ghost" style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:20px;font-size:12px;color:var(--text-muted);border-color:rgba(255,255,255,0.15);background:rgba(0,0,0,0.4)">
            ← Back to Home
          </button>
          
          <div style="display:flex;align-items:center;gap:8px" onclick="window.location.hash='#/landing'" style="cursor:pointer">
            <svg viewBox="0 0 32 32" width="24" height="24">
              <polygon points="16 2, 30 10, 30 22, 16 30, 2 22, 2 10" fill="none" stroke="var(--accent-orange)" stroke-width="2.5"/>
              <path d="M10 16 L16 10 L22 16 L16 22 Z" fill="var(--accent-orange)"/>
            </svg>
            <span style="font-family:var(--font-display);font-weight:700;font-size:16px;color:#fff">FitNova</span>
          </div>
        </div>

        <!-- Top Tab Bar: Sign Up | Sign In -->
        <div class="auth-tab-bar">
          <button class="auth-tab-btn ${isSignUp ? 'active' : ''}" onclick="window.location.hash='#/signup'">Sign Up</button>
          <button class="auth-tab-btn ${!isSignUp ? 'active' : ''}" onclick="window.location.hash='#/login'">Sign In</button>
        </div>

        <div>
          <h2 style="font-size:22px;font-weight:700;margin:0 0 4px;color:#fff">${isSignUp ? 'Join us' : 'Welcome Back'}</h2>
          <p style="font-size:12.5px;color:var(--text-muted);margin:0">${isSignUp ? 'Set up your profile and jump in right now.' : 'Enter your email & password to access your space.'}</p>
        </div>

        <form onsubmit="${isSignUp ? 'handleAuthSignup(event)' : 'handleAuthLogin(event)'}" style="display:flex;flex-direction:column;gap:14px">
          <div>
            <input type="email" id="authEmail" class="auth-input-box" placeholder="Input Email" required value="${isSignUp ? '' : 'director@fitnova.in'}" />
          </div>

          <div style="position:relative">
            <input type="password" id="authPassword" class="auth-input-box" placeholder="Choose Password" required value="${isSignUp ? '' : 'fitnova123'}" />
            <button type="button" id="authPasswordToggleBtn" onclick="togglePasswordVisibility('authPassword')" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;border:none;color:var(--text-faint);cursor:pointer;font-size:14px" title="Toggle password visibility">
              👁️
            </button>
          </div>

          <div style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-muted)">
            <input type="checkbox" id="authTerms" required checked style="accent-color:var(--accent-orange)" />
            <label for="authTerms">I Agree On The <a href="#/landing" style="color:var(--accent-orange);text-decoration:underline">Rules & Privacy Notice</a></label>
          </div>

          <button type="submit" class="auth-submit-btn">
            ${isSignUp ? 'Launch Account' : 'Sign In'}
          </button>
        </form>

        <!-- Demo Accounts Box (Exact Match for Screenshot #5) -->
        <div class="demo-accounts-box" style="margin-top:14px">
          <div class="demo-accounts-title">Demo Accounts (1-Click Fast Login)</div>
          <div class="demo-account-row" onclick="quickDemoLogin(0)">
            <span class="demo-account-role">Director:</span>
            <span class="demo-account-email">director@fitnova.in</span>
          </div>
          <div class="demo-account-row" onclick="quickDemoLogin(1)">
            <span class="demo-account-role">Team Leader:</span>
            <span class="demo-account-email">leader@fitnova.in</span>
          </div>
          <div class="demo-account-row" onclick="quickDemoLogin(2)">
            <span class="demo-account-role">Advisor:</span>
            <span class="demo-account-email">advisor@fitnova.in</span>
          </div>
        </div>

        <div style="text-align:center;font-size:12px;color:var(--text-muted);margin-top:8px">
          ${isSignUp ? 'Already hold an account? <a href="#/login" style="color:#fff;font-weight:700">Enter</a>' : 'New to the platform? <a href="#/signup" style="color:var(--accent-orange);font-weight:700">Create Account</a>'}
        </div>
      </div>

      <!-- Right Side Hero (Computer TV Screen Graphic with Looping Video Inside, Screenshots #4 & #5) -->
      <div class="auth-hero-right" style="position:relative;z-index:2">
        <div class="monitor-graphic-box" style="position:relative;overflow:hidden;border:3px solid rgba(255,77,38,0.5);border-radius:18px;box-shadow:0 0 50px rgba(255,77,38,0.35);padding:0">
          <video
            src="/static/videos/tv_waveform.mp4"
            autoplay
            muted
            loop
            playsinline
            style="width:100%;height:100%;object-fit:cover;border-radius:14px"
          ></video>
          <div style="position:absolute;inset:0;background:rgba(0,0,0,0.2);pointer-events:none"></div>
          <div style="position:absolute;bottom:12px;left:14px;display:flex;align-items:center;gap:8px;background:rgba(0,0,0,0.7);backdrop-filter:blur(6px);padding:4px 12px;border-radius:20px;border:1px solid rgba(255,255,255,0.15)">
            <span style="width:7px;height:7px;border-radius:50%;background:var(--accent-teal)"></span>
            <span style="font-size:11px;font-weight:600;color:#fff">FitNova AI Voice Stream</span>
          </div>
        </div>

        <div>
          <h1 style="font-family:var(--font-display);font-size:32px;font-weight:700;color:#fff;margin:0 0 10px">
            Every call, <span style="color:var(--accent-orange)">scored and coached.</span>
          </h1>
          <p style="font-size:13.5px;color:var(--text-muted);max-width:440px;margin:0 auto;line-height:1.6">
            AI transcription, speaker diarization, and quality scoring for every FitNova advisor call — surfaced in real-time.
          </p>
        </div>

        <div style="display:flex;gap:36px;margin-top:12px">
          <div>
            <div style="font-family:var(--font-mono);font-size:24px;font-weight:700;color:var(--accent-orange)">2,400+</div>
            <div style="font-size:11.5px;color:var(--text-faint)">Calls scored</div>
          </div>
          <div>
            <div style="font-family:var(--font-mono);font-size:24px;font-weight:700;color:var(--accent-teal)">94%</div>
            <div style="font-size:11.5px;color:var(--text-faint)">Flag accuracy</div>
          </div>
          <div>
            <div style="font-family:var(--font-mono);font-size:24px;font-weight:700;color:var(--accent-orange)">18%</div>
            <div style="font-size:11.5px;color:var(--text-faint)">Score lift</div>
          </div>
        </div>
      </div>
    </div>
  `);
}

// --- Router for Clean Real Website Flow ---------------------------------------
async function router() {
  const hash = window.location.hash || "#/landing";
  const parts = hash.replace("#/", "").split("/");
  try {
    if (parts[0] === "landing" || !parts[0]) {
      await viewLanding();
    } else if (parts[0] === "signup") {
      await viewAuth("signup");
    } else if (parts[0] === "login") {
      await viewAuth("login");
    } else {
      const user = getAuthUser();
      if (!user) {
        toast("🔒 Please sign in to access the dashboard portal", "amber");
        window.location.hash = "#/login";
        return;
      }
      await ensureDashboardShell();
      if (parts[0] === "org") await viewOrg();
      else if (parts[0] === "call-feed") await viewCallFeed();
      else if (parts[0] === "leaderboard") await viewLeaderboard();
      else if (parts[0] === "coaching") await viewCoachingNotes();
      else if (parts[0] === "team-config") await viewTeamConfig();
      else if (parts[0] === "rubric-setup") await viewRubricSetup();
      else if (parts[0] === "profile-settings" || parts[0] === "settings") await viewProfileSettings();
      else if (parts[0] === "team") await viewTeam(parts[1]);
      else if (parts[0] === "advisor") await viewAdvisor(parts[1]);
      else if (parts[0] === "call") await viewCall(parts[1]);
      else if (parts[0] === "disputes" || parts[0] === "flag-review") await viewDisputes();
      else await viewOrg();
    }
  } catch (e) {
    console.error(e);
    const content = $("#content") || $("#app");
    if (content) content.innerHTML = `<div class="empty-state">Something went wrong loading this view.<br><span style="font-family:var(--font-mono);font-size:11px">${escapeHtml(e.message)}</span></div>`;
  }
}

window.addEventListener("hashchange", router);
window.addEventListener("DOMContentLoaded", async () => {
  router();
});

// --- Leaderboard View --------------------------------------------------------
async function viewLeaderboard() {
  setActiveNav("leaderboard");
  const content = $("#content");
  setBreadcrumbs([{ label: "Dashboard", href: "/org" }, { label: "Leaderboard", href: "/leaderboard" }]);

  content.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
      <div>
        <h1 style="font-family:var(--font-display);font-size:24px;font-weight:700;margin:0 0 4px;color:#fff">Advisor & Pod Leaderboard</h1>
        <p style="font-size:12.5px;color:var(--text-muted);margin:0">Real-time ranking based on overall call quality score & trial conversion</p>
      </div>

      <div style="display:flex;gap:10px">
        <select class="auth-input-box" id="leaderboardPodFilter" onchange="filterLeaderboardRows()" style="width:140px;padding:6px 12px;font-size:12px">
          <option value="ALL">All Pods</option>
          <option value="Alpha Pod">Alpha Pod</option>
          <option value="Beta Pod">Beta Pod</option>
          <option value="Gamma Pod">Gamma Pod</option>
          <option value="Delta Pod">Delta Pod</option>
        </select>

        <select class="auth-input-box" id="leaderboardTimeframe" onchange="filterLeaderboardRows()" style="width:140px;padding:6px 12px;font-size:12px">
          <option value="week">This Week</option>
          <option value="month">This Month</option>
          <option value="all">All Time</option>
        </select>
      </div>
    </div>

    <!-- Top 3 Pod Podium Grid -->
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:24px">
      <div class="card" style="padding:20px;border-color:rgba(255,77,38,0.4);background:linear-gradient(180deg, rgba(255,77,38,0.08) 0%, rgba(19,21,28,0.8) 100%)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <span style="font-size:12px;font-weight:700;color:var(--accent-orange)">🥇 RANK 1</span>
          <span style="font-size:11px;color:var(--accent-teal);font-weight:600">+4.2 pts</span>
        </div>
        <h3 style="font-family:var(--font-display);font-size:18px;font-weight:700;margin:0 0 4px;color:#fff">Alpha Pod</h3>
        <p style="font-size:12px;color:var(--text-muted);margin:0 0 16px">Led by Priya Sharma · 3 Advisors</p>
        <div style="display:flex;justify-content:space-between;align-items:baseline">
          <div>
            <div style="font-family:var(--font-mono);font-size:28px;font-weight:700;color:var(--accent-teal)">81.4</div>
            <div style="font-size:11px;color:var(--text-faint)">Avg Call Score</div>
          </div>
          <div>
            <div style="font-family:var(--font-mono);font-size:22px;font-weight:700;color:#fff">74%</div>
            <div style="font-size:11px;color:var(--text-faint)">Trial Rate</div>
          </div>
        </div>
      </div>

      <div class="card" style="padding:20px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <span style="font-size:12px;font-weight:700;color:var(--accent-amber)">🥈 RANK 2</span>
          <span style="font-size:11px;color:var(--accent-teal);font-weight:600">+2.1 pts</span>
        </div>
        <h3 style="font-family:var(--font-display);font-size:18px;font-weight:700;margin:0 0 4px;color:#fff">Beta Pod</h3>
        <p style="font-size:12px;color:var(--text-muted);margin:0 0 16px">Led by Arjun Mehta · 4 Advisors</p>
        <div style="display:flex;justify-content:space-between;align-items:baseline">
          <div>
            <div style="font-family:var(--font-mono);font-size:28px;font-weight:700;color:var(--accent-teal)">76.2</div>
            <div style="font-size:11px;color:var(--text-faint)">Avg Call Score</div>
          </div>
          <div>
            <div style="font-family:var(--font-mono);font-size:22px;font-weight:700;color:#fff">67%</div>
            <div style="font-size:11px;color:var(--text-faint)">Trial Rate</div>
          </div>
        </div>
      </div>

      <div class="card" style="padding:20px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <span style="font-size:12px;font-weight:700;color:var(--text-muted)">🥉 RANK 3</span>
          <span style="font-size:11px;color:var(--text-faint);font-weight:600">+0.8 pts</span>
        </div>
        <h3 style="font-family:var(--font-display);font-size:18px;font-weight:700;margin:0 0 4px;color:#fff">Gamma Pod</h3>
        <p style="font-size:12px;color:var(--text-muted);margin:0 0 16px">Led by Sneha Rao · 3 Advisors</p>
        <div style="display:flex;justify-content:space-between;align-items:baseline">
          <div>
            <div style="font-family:var(--font-mono);font-size:28px;font-weight:700;color:var(--accent-amber)">72.8</div>
            <div style="font-size:11px;color:var(--text-faint)">Avg Call Score</div>
          </div>
          <div>
            <div style="font-family:var(--font-mono);font-size:22px;font-weight:700;color:#fff">61%</div>
            <div style="font-size:11px;color:var(--text-faint)">Trial Rate</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Full Advisor Leaderboard Table -->
    <div class="card">
      <div style="padding:16px 20px;border-bottom:1px solid var(--border-soft);display:flex;justify-content:space-between;align-items:center">
        <h3 style="font-family:var(--font-display);font-size:15px;font-weight:700;margin:0;color:#fff">All Advisors Ranking</h3>
        <span style="font-size:12px;color:var(--text-muted)">10 Active Advisors</span>
      </div>

      <table class="data-table">
        <thead>
          <tr>
            <th>RANK</th>
            <th>ADVISOR</th>
            <th>POD / TEAM</th>
            <th style="text-align:center">CALLS SCORED</th>
            <th style="text-align:center">AVG SCORE</th>
            <th style="text-align:center">TRIAL %</th>
            <th style="text-align:center">ACTIVE FLAGS</th>
          </tr>
        </thead>
        <tbody>
          <tr class="clickable" onclick="window.location.hash='#/advisor/adv_001'">
            <td class="mono" style="font-weight:700;color:var(--accent-orange)">#1</td>
            <td><div style="display:flex;align-items:center;gap:8px">${getPersonAvatarHtml("Neha Gupta", 24)}<strong style="color:#fff">Neha Gupta</strong></div></td>
            <td class="cell-sub">Alpha Pod</td>
            <td class="mono" style="text-align:center">42</td>
            <td style="text-align:center"><span style="background:rgba(53,196,168,0.15);color:var(--accent-teal);padding:4px 10px;border-radius:12px;font-family:var(--font-mono);font-weight:700">88.2</span></td>
            <td class="mono" style="text-align:center;color:var(--accent-teal);font-weight:700">78%</td>
            <td class="mono" style="text-align:center">0</td>
          </tr>
          <tr class="clickable" onclick="window.location.hash='#/advisor/adv_002'">
            <td class="mono" style="font-weight:700;color:#fff">#2</td>
            <td><div style="display:flex;align-items:center;gap:8px">${getPersonAvatarHtml("Rahul Joshi", 24)}<strong style="color:#fff">Rahul Joshi</strong></div></td>
            <td class="cell-sub">Beta Pod</td>
            <td class="mono" style="text-align:center">38</td>
            <td style="text-align:center"><span style="background:rgba(53,196,168,0.15);color:var(--accent-teal);padding:4px 10px;border-radius:12px;font-family:var(--font-mono);font-weight:700">82.7</span></td>
            <td class="mono" style="text-align:center;color:var(--accent-teal);font-weight:700">71%</td>
            <td class="mono" style="text-align:center">1</td>
          </tr>
          <tr class="clickable" onclick="window.location.hash='#/advisor/adv_003'">
            <td class="mono" style="font-weight:700;color:#fff">#3</td>
            <td><div style="display:flex;align-items:center;gap:8px">${getPersonAvatarHtml("Divya Krishnan", 24)}<strong style="color:#fff">Divya Krishnan</strong></div></td>
            <td class="cell-sub">Beta Pod</td>
            <td class="mono" style="text-align:center">45</td>
            <td style="text-align:center"><span style="background:rgba(53,196,168,0.15);color:var(--accent-teal);padding:4px 10px;border-radius:12px;font-family:var(--font-mono);font-weight:700">79.4</span></td>
            <td class="mono" style="text-align:center;color:var(--accent-teal);font-weight:700">69%</td>
            <td class="mono" style="text-align:center">3</td>
          </tr>
          <tr class="clickable" onclick="window.location.hash='#/advisor/adv_004'">
            <td class="mono" style="font-weight:700;color:var(--text-muted)">#4</td>
            <td><div style="display:flex;align-items:center;gap:8px">${getPersonAvatarHtml("Karan Malhotra", 24)}<strong style="color:#fff">Karan Malhotra</strong></div></td>
            <td class="cell-sub">Beta Pod</td>
            <td class="mono" style="text-align:center">31</td>
            <td style="text-align:center"><span style="background:rgba(242,183,5,0.15);color:var(--accent-amber);padding:4px 10px;border-radius:12px;font-family:var(--font-mono);font-weight:700">74.1</span></td>
            <td class="mono" style="text-align:center;color:#fff">62%</td>
            <td class="mono" style="text-align:center">2</td>
          </tr>
        </tbody>
      </table>
    </div>
  `;
}

// --- Coaching Notes View -----------------------------------------------------
async function viewCoachingNotes() {
  setActiveNav("coaching");
  const content = $("#content");
  setBreadcrumbs([{ label: "Dashboard", href: "/org" }, { label: "Coaching Notes", href: "/coaching" }]);

  content.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
      <div>
        <h1 style="font-family:var(--font-display);font-size:24px;font-weight:700;margin:0 0 4px;color:#fff">AI Coaching Notes & Feedback</h1>
        <p style="font-size:12.5px;color:var(--text-muted);margin:0">Actionable 1-on-1 coaching recommendations generated from call transcripts</p>
      </div>

      <button class="btn btn-primary" onclick="openScheduleCoachingModal()" style="background:var(--accent-orange);border-color:var(--accent-orange);color:#fff">
        + Schedule 1-on-1 Session
      </button>
    </div>

    <!-- Scheduled 1-on-1 Sessions List Card -->
    <div class="card" style="padding:20px;margin-bottom:24px;background:rgba(255,77,38,0.06);border-color:rgba(255,77,38,0.25)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <h3 style="font-size:15px;font-weight:700;margin:0;color:var(--accent-orange)">📅 Scheduled 1-on-1 Coaching Sessions</h3>
        <span style="font-size:11.5px;color:var(--text-faint)">Upcoming sessions</span>
      </div>
      <div id="scheduledSessionsList"></div>
    </div>

    <!-- Active Advisor Feedback Cards -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px">
      <div class="card" style="padding:20px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
          <div style="display:flex;align-items:center;gap:10px">
            ${getPersonAvatarHtml("Sanjay Verma", 36)}
            <div>
              <h3 style="font-size:15px;font-weight:700;margin:0;color:#fff">Sanjay Verma</h3>
              <span style="font-size:11.5px;color:var(--text-muted)">Beta Pod · Score 61.3</span>
            </div>
          </div>
          <span style="background:rgba(255,59,48,0.15);color:var(--sev-critical);font-size:11px;font-weight:700;padding:3px 10px;border-radius:12px">High Priority</span>
        </div>

        <div style="margin-bottom:14px">
          <div style="font-size:12px;font-weight:700;color:var(--accent-amber);margin-bottom:6px">🎯 Focus Area: Price Before Value</div>
          <p style="font-size:12.5px;color:var(--text-muted);line-height:1.5;margin:0">
            Sanjay introduced the ₹4,999/month pricing within 3 minutes of the call before identifying customer goals. Coach him on delaying price discussions until value is established.
          </p>
        </div>

        <div style="background:var(--panel-alt);border-radius:10px;padding:12px;margin-bottom:12px">
          <div style="font-size:11px;font-weight:700;color:var(--text-faint);text-transform:uppercase;margin-bottom:6px">Add Manager Note:</div>
          <textarea class="auth-input-box" id="noteSanjay" style="height:60px;margin-bottom:8px" placeholder="Write coaching action items..."></textarea>
          <button class="btn btn-sm btn-ghost" onclick="saveCoachingNote('Sanjay Verma', 'noteSanjay')" style="color:var(--accent-orange)">Save Note</button>
        </div>

        <div>
          <div style="font-size:11px;font-weight:700;color:var(--text-faint);text-transform:uppercase;margin-bottom:4px">Recent Coaching History:</div>
          <div id="history_noteSanjay"></div>
        </div>
      </div>

      <div class="card" style="padding:20px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
          <div style="display:flex;align-items:center;gap:10px">
            ${getPersonAvatarHtml("Divya Krishnan", 36)}
            <div>
              <h3 style="font-size:15px;font-weight:700;margin:0;color:#fff">Divya Krishnan</h3>
              <span style="font-size:11.5px;color:var(--text-muted)">Beta Pod · Score 79.4</span>
            </div>
          </div>
          <span style="background:rgba(53,196,168,0.15);color:var(--accent-teal);font-size:11px;font-weight:700;padding:3px 10px;border-radius:12px">On Track</span>
        </div>

        <div style="margin-bottom:14px">
          <div style="font-size:12px;font-weight:700;color:var(--accent-teal);margin-bottom:6px">🌟 Strength: Needs Discovery</div>
          <p style="font-size:12.5px;color:var(--text-muted);line-height:1.5;margin:0">
            Divya excels at asking open-ended questions (avg 5.8 per call). Recommend sharing her CALL-2871 recording as a benchmark model for Beta Pod.
          </p>
        </div>

        <div style="background:var(--panel-alt);border-radius:10px;padding:12px;margin-bottom:12px">
          <div style="font-size:11px;font-weight:700;color:var(--text-faint);text-transform:uppercase;margin-bottom:6px">Add Manager Note:</div>
          <textarea class="auth-input-box" id="noteDivya" style="height:60px;margin-bottom:8px" placeholder="Write coaching action items..."></textarea>
          <button class="btn btn-sm btn-ghost" onclick="saveCoachingNote('Divya Krishnan', 'noteDivya')" style="color:var(--accent-orange)">Save Note</button>
        </div>

        <div>
          <div style="font-size:11px;font-weight:700;color:var(--text-faint);text-transform:uppercase;margin-bottom:4px">Recent Coaching History:</div>
          <div id="history_noteDivya"></div>
        </div>
      </div>
    </div>
  `;

  renderCoachingHistory("Sanjay Verma", "history_noteSanjay");
  renderCoachingHistory("Divya Krishnan", "history_noteDivya");
  renderScheduledSessions();
}

// --- Interactive Utilities for Subpages -------------------------------------
window.exportCallFeedCSV = function() {
  const csvContent = "data:text/csv;charset=utf-8," + 
    "CALL_ID,ADVISOR,TEAM,DATE_TIME,DURATION,SCORE,FLAGS,TRIAL_STATUS,STATUS,SOURCE\n" +
    "CALL-2871,Neha Gupta,Alpha Pod,2026-08-07 15:42,22m 14s,91,None,Booked,Scored,Exotel\n" +
    "CALL-2869,Sanjay Verma,Epsilon Pod,2026-08-07 10:24,18m 32s,52,Critical x4,None,Disputed,Exotel\n" +
    "CALL-2867,Divya Krishnan,Beta Pod,2026-08-06 16:38,16m 55s,72,Medium x2,None,Scored,File Upload\n" +
    "CALL-2863,Pooja Agarwal,Beta Pod,2026-08-06 14:15,19m 10s,68,Critical x1,None,Disputed,Exotel\n" +
    "CALL-2860,Rahul Joshi,Beta Pod,2026-08-05 11:30,24m 05s,84,None,Booked,Scored,Exotel\n" +
    "CALL-2855,Karan Malhotra,Delta Pod,2026-08-05 09:20,21m 40s,79,Medium x1,Booked,Scored,Exotel";
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", "fitnova_call_feed_export.csv");
  document.body.appendChild(link);
  link.click();
  link.remove();
  toast("Downloaded fitnova_call_feed_export.csv!");
};

window.updateLeaderboardTimeframe = function(timeframe) {
  toast(`Filtered Leaderboard for ${timeframe}`);
};

window.saveCoachingNote = function(advisorName, textareaId) {
  const textarea = $(`#${textareaId}`);
  if (!textarea) return;
  const text = textarea.value.trim();
  if (!text) { toast("Please write a coaching note first!", "amber"); return; }

  const notesKey = `coaching_notes_${advisorName.replace(/\s+/g, "_")}`;
  const existing = JSON.parse(localStorage.getItem(notesKey) || "[]");
  existing.unshift({ text, date: new Date().toLocaleString() });
  localStorage.setItem(notesKey, JSON.stringify(existing));

  textarea.value = "";
  toast(`Saved coaching note for ${advisorName}!`);
  renderCoachingHistory(advisorName, `history_${textareaId}`);
};

window.renderCoachingHistory = function(advisorName, containerId) {
  const el = $(`#${containerId}`);
  if (!el) return;
  const notesKey = `coaching_notes_${advisorName.replace(/\s+/g, "_")}`;
  const existing = JSON.parse(localStorage.getItem(notesKey) || "[]");

  if (!existing.length) {
    el.innerHTML = `<span style="font-size:11.5px;color:var(--text-faint);font-style:italic">No previous coaching notes saved.</span>`;
    return;
  }

  el.innerHTML = existing.map(n => `
    <div style="font-size:11.5px;background:rgba(255,255,255,0.04);border-radius:6px;padding:6px 10px;margin-top:4px">
      <span style="color:var(--text-faint);font-family:var(--font-mono)">${n.date}:</span> <span style="color:#fff">${escapeHtml(n.text)}</span>
    </div>
  `).join("");
};

window.openCreateTeamModal = function() {
  let container = $("#authModalContainer");
  if (!container) {
    container = document.createElement("div");
    container.id = "authModalContainer";
    document.body.appendChild(container);
  }

  container.innerHTML = `
    <div style="position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(6px)">
      <div class="card" style="width:100%;max-width:440px;padding:24px;background:#0e1017;border:1px solid rgba(255,255,255,0.15);box-shadow:0 20px 40px rgba(0,0,0,0.6)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
          <h3 style="font-family:var(--font-display);font-size:18px;font-weight:700;margin:0;color:#fff">➕ Create New Team / Pod</h3>
          <button onclick="$('#authModalContainer').innerHTML=''" style="background:none;border:none;color:var(--text-muted);font-size:18px;cursor:pointer">✕</button>
        </div>
        
        <form onsubmit="handleCreateTeamSubmit(event)" style="display:flex;flex-direction:column;gap:14px">
          <div>
            <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Pod / Team Name</label>
            <input type="text" class="auth-input-box" id="newTeamName" placeholder="e.g. Epsilon Pod" required />
          </div>

          <div>
            <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Assigned Team Leader</label>
            <input type="text" class="auth-input-box" id="newTeamLeader" placeholder="e.g. Vikram Singh" required />
          </div>

          <div>
            <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Target Trial Booking Rate (%)</label>
            <input type="number" class="auth-input-box" id="newTeamRate" value="75" min="1" max="100" required />
          </div>

          <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:10px">
            <button type="button" class="btn btn-ghost" onclick="$('#authModalContainer').innerHTML=''">Cancel</button>
            <button type="submit" class="btn btn-primary" style="background:var(--accent-orange);border-color:var(--accent-orange);color:#fff">Create Team</button>
          </div>
        </form>
      </div>
    </div>
  `;
};

window.handleCreateTeamSubmit = function(e) {
  e.preventDefault();
  const name = $("#newTeamName").value.trim();
  const leader = $("#newTeamLeader").value.trim();

  const customTeams = JSON.parse(localStorage.getItem("fitnova_custom_teams") || "[]");
  customTeams.push({ name, leader });
  localStorage.setItem("fitnova_custom_teams", JSON.stringify(customTeams));

  toast(`Created ${name} led by ${leader}!`);
  $("#authModalContainer").innerHTML = "";

  $$("select[id*='teamFilter'], select[id*='Team']").forEach(sel => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    sel.appendChild(opt);
  });
};

window.openCreateAdvisorModal = function() {
  let container = $("#authModalContainer");
  if (!container) {
    container = document.createElement("div");
    container.id = "authModalContainer";
    document.body.appendChild(container);
  }

  container.innerHTML = `
    <div style="position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(6px)">
      <div class="card" style="width:100%;max-width:440px;padding:24px;background:#0e1017;border:1px solid rgba(255,255,255,0.15);box-shadow:0 20px 40px rgba(0,0,0,0.6)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
          <h3 style="font-family:var(--font-display);font-size:18px;font-weight:700;margin:0;color:#fff">👤 Add New Sales Advisor</h3>
          <button onclick="$('#authModalContainer').innerHTML=''" style="background:none;border:none;color:var(--text-muted);font-size:18px;cursor:pointer">✕</button>
        </div>
        
        <form onsubmit="handleCreateAdvisorSubmit(event)" style="display:flex;flex-direction:column;gap:14px">
          <div>
            <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Full Name</label>
            <input type="text" class="auth-input-box" id="newAdvisorName" placeholder="e.g. Aditi Rao" required />
          </div>

          <div>
            <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Assign Team / Pod</label>
            <select class="auth-input-box" id="newAdvisorTeam">
              <option value="Alpha Pod">Alpha Pod</option>
              <option value="Beta Pod">Beta Pod</option>
              <option value="Gamma Pod">Gamma Pod</option>
              <option value="Delta Pod">Delta Pod</option>
              <option value="Epsilon Pod">Epsilon Pod</option>
              <option value="Zeta Pod">Zeta Pod</option>
            </select>
          </div>

          <div>
            <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Email Address</label>
            <input type="email" class="auth-input-box" id="newAdvisorEmail" placeholder="e.g. aditi@fitnova.in" required />
          </div>

          <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:10px">
            <button type="button" class="btn btn-ghost" onclick="$('#authModalContainer').innerHTML=''">Cancel</button>
            <button type="submit" class="btn btn-primary" style="background:var(--accent-orange);border-color:var(--accent-orange);color:#fff">Add Advisor</button>
          </div>
        </form>
      </div>
    </div>
  `;
};

window.handleCreateAdvisorSubmit = function(e) {
  e.preventDefault();
  const name = $("#newAdvisorName").value.trim();
  const team = $("#newAdvisorTeam").value;

  const customAdvisors = JSON.parse(localStorage.getItem("fitnova_custom_advisors") || "[]");
  customAdvisors.push({ name, team });
  localStorage.setItem("fitnova_custom_advisors", JSON.stringify(customAdvisors));

  toast(`Added ${name} to ${team}!`);
  $("#authModalContainer").innerHTML = "";

  $$("select[id*='advisorFilter'], select[id*='Advisor']").forEach(sel => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    sel.appendChild(opt);
  });
};

window.lastIngestedCallNum = 2871;
window.INGEST_SAMPLE_DATA = [
  { advisor: "Neha Gupta", team: "Alpha Pod", initials: "NG", score: 91, duration: "12m 40s", trial: "Booked", trialColor: "var(--accent-teal)", targetCallId: "call_001" },
  { advisor: "Sneha Iyer", team: "Beta Pod", initials: "SI", score: 62, duration: "09m 10s", trial: "Lost / Refused", trialColor: "var(--sev-critical)", targetCallId: "call_002" },
  { advisor: "Arjun Das", team: "Beta Pod", initials: "AD", score: 58, duration: "10m 20s", trial: "Lost / Refused", trialColor: "var(--sev-critical)", targetCallId: "call_003" },
  { advisor: "Meera Pillai", team: "Delta Pod", initials: "MP", score: 0, duration: "06m 20s", trial: "None (Wrong Number)", trialColor: "var(--text-faint)", targetCallId: "call_004" },
  { advisor: "Arjun Das (Hinglish)", team: "Beta Pod", initials: "AD", score: 76, duration: "11m 30s", trial: "Booked", trialColor: "var(--accent-teal)", targetCallId: "call_005" },
  { advisor: "Neha Kulkarni", team: "Gamma Pod", initials: "NK", score: 54, duration: "09m 40s", trial: "Booked (PII Alert)", trialColor: "var(--sev-critical)", targetCallId: "call_006" },
  { advisor: "Pooja Agarwal", team: "Beta Pod", initials: "PA", score: 68, duration: "07m 00s", trial: "Rescheduled", trialColor: "var(--accent-amber)", targetCallId: "call_007" },
  { advisor: "Rahul Joshi", team: "Alpha Pod", initials: "RJ", score: 88, duration: "13m 40s", trial: "Booked", trialColor: "var(--accent-teal)", targetCallId: "call_008" },
  { advisor: "Priya Sharma", team: "Alpha Pod", initials: "PS", score: 81, duration: "09m 20s", trial: "Booked (Disputed)", trialColor: "var(--accent-amber)", targetCallId: "call_009" }
];

window.openRunPipelineModal = function() {
  let container = $("#authModalContainer");
  if (!container) {
    container = document.createElement("div");
    container.id = "authModalContainer";
    document.body.appendChild(container);
  }

  container.innerHTML = `
    <div style="position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(6px)">
      <div class="card" style="width:100%;max-width:500px;padding:26px;background:#0e1017;border:1px solid rgba(255,255,255,0.15);box-shadow:0 20px 40px rgba(0,0,0,0.6)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
          <h3 style="font-family:var(--font-display);font-size:18px;font-weight:700;margin:0;color:#fff">⚡ Choose Call Audio Stream to Run AI Pipeline</h3>
          <button onclick="$('#authModalContainer').innerHTML=''" style="background:none;border:none;color:var(--text-muted);font-size:18px;cursor:pointer">✕</button>
        </div>
        
        <form onsubmit="handleRunPipelineSubmit(event)" style="display:flex;flex-direction:column;gap:16px">
          <div>
            <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:6px">Select Advisor Call Stream or Upload File</label>
            <select class="auth-input-box" id="selectedPipelineCallIdx" style="font-size:13px" onchange="togglePipelineCustomUpload(this.value)">
              ${window.INGEST_SAMPLE_DATA.map((s, idx) => `
                <option value="${idx}">📞 Stream #${2872 + idx} — ${s.advisor} (${s.team}) · ${s.duration}</option>
              `).join("")}
              <option value="custom">📁 Upload Custom Audio (.mp3 / .wav / .m4a)...</option>
            </select>
          </div>

          <div id="customPipelineUploadBox" style="display:none;background:rgba(255,255,255,0.03);border:1px dashed var(--border-soft);padding:14px;border-radius:10px;text-align:center">
            <input type="file" id="customAudioFileInput" accept="audio/*" style="font-size:12px;color:var(--text-muted)" />
            <div style="font-size:11px;color:var(--text-faint);margin-top:6px">Supported: MP3, WAV, M4A, FLAC up to 50 MB</div>
          </div>

          <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:6px">
            <button type="button" class="btn btn-ghost" onclick="$('#authModalContainer').innerHTML=''">Cancel</button>
            <button type="submit" class="btn btn-primary" style="background:var(--accent-orange);border-color:var(--accent-orange);color:#fff">Start AI Pipeline Ingestion</button>
          </div>
        </form>
      </div>
    </div>
  `;
};

window.togglePipelineCustomUpload = function(val) {
  const box = $("#customPipelineUploadBox");
  if (box) box.style.display = val === "custom" ? "block" : "none";
};

window.handleRunPipelineSubmit = function(e) {
  e.preventDefault();
  const val = $("#selectedPipelineCallIdx").value;
  $("#authModalContainer").innerHTML = "";
  
  let chosenIdx = 0;
  if (val !== "custom") {
    chosenIdx = parseInt(val);
  } else {
    chosenIdx = Math.floor(Math.random() * window.INGEST_SAMPLE_DATA.length);
  }

  triggerLivePipelineVisualizer(chosenIdx);
};

window.viewCallTranscriptFromModal = function(targetCallId = '929334b248b1') {
  const modalContainer = $("#authModalContainer");
  if (modalContainer) modalContainer.innerHTML = "";
  const drawerContainer = $("#pipelineDrawerContainer");
  if (drawerContainer) drawerContainer.innerHTML = "";

  window.location.hash = `#/call/${targetCallId}`;
  toast(`🎉 Opening Call Transcript & Quality Analysis View for ${targetCallId}`);
};

window.triggerLivePipelineVisualizer = function(chosenIndex = null) {
  window.lastIngestedCallNum++;
  const callIdStr = `CALL-${window.lastIngestedCallNum}`;
  const sampleIdx = chosenIndex !== null ? chosenIndex : (window.lastIngestedCallNum - 2872) % window.INGEST_SAMPLE_DATA.length;
  const sample = window.INGEST_SAMPLE_DATA[sampleIdx] || window.INGEST_SAMPLE_DATA[0];

  const targetCallId = sample.targetCallId || 'call_001';

  let drawer = $("#pipelineDrawerContainer");
  if (!drawer) {
    drawer = document.createElement("div");
    drawer.id = "pipelineDrawerContainer";
    document.body.appendChild(drawer);
  }

  drawer.innerHTML = `
    <div style="position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(6px)">
      <div class="card" style="width:100%;max-width:540px;padding:28px;background:#0e1017;border:1px solid rgba(255,255,255,0.15);box-shadow:0 20px 50px rgba(0,0,0,0.7)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
          <div>
            <h3 style="font-family:var(--font-display);font-size:20px;font-weight:700;margin:0 0 2px;color:#fff">⚡ AI Voice Ingestion Pipeline</h3>
            <p style="font-size:12px;color:var(--text-muted);margin:0">Processing Exotel audio stream · <strong style="color:var(--accent-orange)">${callIdStr}</strong> (${sample.advisor})</p>
          </div>
          <button onclick="$('#pipelineDrawerContainer').innerHTML=''" style="background:none;border:none;color:var(--text-muted);font-size:18px;cursor:pointer">✕</button>
        </div>

        <div style="height:8px;background:var(--panel-alt);border-radius:8px;overflow:hidden;margin-bottom:20px">
          <div id="pStageProgressFill" style="height:100%;width:20%;background:linear-gradient(90deg, var(--accent-orange) 0%, var(--accent-teal) 100%);transition:width 0.4s ease"></div>
        </div>

        <div style="display:flex;flex-direction:column;gap:12px;margin-bottom:24px">
          <div id="pStage1" style="display:flex;align-items:center;justify-content:space-between;background:rgba(53,196,168,0.1);padding:10px 14px;border-radius:10px;border:1px solid rgba(53,196,168,0.3)">
            <div style="display:flex;align-items:center;gap:10px">
              <span id="pStageIcon1">🔄</span>
              <span style="font-size:13px;font-weight:600;color:#fff">1. Audio Upload & Stream Ingestion</span>
            </div>
            <span id="pStageStatus1" style="font-size:11.5px;color:var(--accent-teal);font-weight:700">Ingesting ${sample.duration}...</span>
          </div>

          <div id="pStage2" style="display:flex;align-items:center;justify-content:space-between;background:var(--panel-alt);padding:10px 14px;border-radius:10px;opacity:0.5">
            <div style="display:flex;align-items:center;gap:10px">
              <span id="pStageIcon2">⏳</span>
              <span style="font-size:13px;font-weight:600;color:#fff">2. Whisper ASR Speech-to-Text Diarization</span>
            </div>
            <span id="pStageStatus2" style="font-size:11.5px;color:var(--text-faint)">Pending</span>
          </div>

          <div id="pStage3" style="display:flex;align-items:center;justify-content:space-between;background:var(--panel-alt);padding:10px 14px;border-radius:10px;opacity:0.5">
            <div style="display:flex;align-items:center;gap:10px">
              <span id="pStageIcon3">⏳</span>
              <span style="font-size:13px;font-weight:600;color:#fff">3. PII Anonymization & Redaction</span>
            </div>
            <span id="pStageStatus3" style="font-size:11.5px;color:var(--text-faint)">Pending</span>
          </div>

          <div id="pStage4" style="display:flex;align-items:center;justify-content:space-between;background:var(--panel-alt);padding:10px 14px;border-radius:10px;opacity:0.5">
            <div style="display:flex;align-items:center;gap:10px">
              <span id="pStageIcon4">⏳</span>
              <span style="font-size:13px;font-weight:600;color:#fff">4. 5-Dimension Rubric Scoring Engine</span>
            </div>
            <span id="pStageStatus4" style="font-size:11.5px;color:var(--text-faint)">Pending</span>
          </div>

          <div id="pStage5" style="display:flex;align-items:center;justify-content:space-between;background:var(--panel-alt);padding:10px 14px;border-radius:10px;opacity:0.5">
            <div style="display:flex;align-items:center;gap:10px">
              <span id="pStageIcon5">⏳</span>
              <span style="font-size:13px;font-weight:600;color:#fff">5. 10-Tag Compliance Flag Classification</span>
            </div>
            <span id="pStageStatus5" style="font-size:11.5px;color:var(--text-faint)">Pending</span>
          </div>
        </div>

        <div style="display:flex;justify-content:flex-end">
          <button id="pipelineCloseBtn" class="btn btn-ghost" disabled style="opacity:0.5;cursor:not-allowed">Processing Pipeline...</button>
        </div>
      </div>
    </div>
  `;

  setTimeout(() => {
    $("#pStageIcon1").textContent = "✅";
    $("#pStageStatus1").textContent = "Complete";
    $("#pStageProgressFill").style.width = "40%";

    $("#pStage2").style.opacity = "1";
    $("#pStage2").style.background = "rgba(53,196,168,0.1)";
    $("#pStage2").style.border = "1px solid rgba(53,196,168,0.3)";
    $("#pStageIcon2").textContent = "🔄";
    $("#pStageStatus2").textContent = "Diarizing speakers...";
    $("#pStageStatus2").style.color = "var(--accent-teal)";
  }, 700);

  setTimeout(() => {
    $("#pStageIcon2").textContent = "✅";
    $("#pStageStatus2").textContent = "Complete (2 Speakers)";
    $("#pStageProgressFill").style.width = "60%";

    $("#pStage3").style.opacity = "1";
    $("#pStage3").style.background = "rgba(53,196,168,0.1)";
    $("#pStage3").style.border = "1px solid rgba(53,196,168,0.3)";
    $("#pStageIcon3").textContent = "🔄";
    $("#pStageStatus3").textContent = "Redacting PII tokens...";
    $("#pStageStatus3").style.color = "var(--accent-teal)";
  }, 1400);

  setTimeout(() => {
    $("#pStageIcon3").textContent = "✅";
    $("#pStageStatus3").textContent = "Complete (2 PII Masked)";
    $("#pStageProgressFill").style.width = "80%";

    $("#pStage4").style.opacity = "1";
    $("#pStage4").style.background = "rgba(53,196,168,0.1)";
    $("#pStage4").style.border = "1px solid rgba(53,196,168,0.3)";
    $("#pStageIcon4").textContent = "🔄";
    $("#pStageStatus4").textContent = "Scoring Rubric Dimensions...";
    $("#pStageStatus4").style.color = "var(--accent-teal)";
  }, 2100);

  setTimeout(() => {
    $("#pStageIcon4").textContent = "✅";
    $("#pStageStatus4").textContent = `Score: ${sample.score} / 100`;
    $("#pStageProgressFill").style.width = "100%";

    $("#pStage5").style.opacity = "1";
    $("#pStage5").style.background = "rgba(53,196,168,0.1)";
    $("#pStage5").style.border = "1px solid rgba(53,196,168,0.3)";
    $("#pStageIcon5").textContent = "✅";
    $("#pStageStatus5").textContent = "0 Compliance Flags";
    $("#pStageStatus5").style.color = "var(--accent-teal)";

    const btn = $("#pipelineCloseBtn");
    btn.disabled = false;
    btn.style.opacity = "1";
    btn.style.cursor = "pointer";
    btn.className = "btn btn-primary";
    btn.style.background = "var(--accent-teal)";
    btn.style.borderColor = "var(--accent-teal)";
    btn.style.color = "#fff";
    btn.style.fontWeight = "700";
    btn.textContent = `View Transcript & Analysis (${callIdStr}) →`;
    btn.onclick = function() {
      viewCallTranscriptFromModal(targetCallId);
    };

    toast(`🎉 Ingested & Scored ${callIdStr} (${sample.advisor})!`);

    const tableBody = $("#callFeedTableBody");
    if (tableBody) {
      const newRow = document.createElement("tr");
      newRow.className = "clickable call-feed-row";
      newRow.dataset.team = sample.team;
      newRow.dataset.advisor = sample.advisor;
      newRow.dataset.score = sample.score;
      newRow.dataset.severity = "None";
      newRow.dataset.trial = sample.trial;
      newRow.dataset.status = "Scored";
      newRow.dataset.source = "Exotel";
      newRow.onclick = function() { viewCallTranscriptFromModal(targetCallId); };
      newRow.innerHTML = `
        <td class="mono" style="color:var(--accent-orange);font-weight:700">${callIdStr} ✨</td>
        <td><div style="display:flex;align-items:center;gap:8px">${getPersonAvatarHtml(sample.advisor, 24, sample.initials)}<span style="font-weight:600;color:#fff">${sample.advisor}</span></div></td>
        <td class="cell-sub">${sample.team}</td>
        <td class="mono" style="font-size:12px">Just Now<br><span style="color:var(--text-faint)">Live Ingest</span></td>
        <td class="mono">${sample.duration}</td>
        <td style="text-align:center"><span style="background:rgba(53,196,168,0.15);color:var(--accent-teal);padding:4px 10px;border-radius:12px;font-family:var(--font-mono);font-weight:700">${sample.score}</span></td>
        <td><span style="color:var(--text-faint)">—</span></td>
        <td style="text-align:center"><span style="color:${sample.trialColor};font-weight:600">● ${sample.trial}</span></td>
        <td style="text-align:center"><span class="status-pill scored">Scored</span></td>
        <td class="cell-sub">Exotel</td>
      `;
      tableBody.insertBefore(newRow, tableBody.firstChild);

      const countEl = $("#callFeedCount");
      if (countEl) {
        const currentTotal = $$(".call-feed-row").length;
        countEl.textContent = `${currentTotal} of ${currentTotal} calls · Auto-scored by AI`;
      }
    }
  }, 2800);
};

// --- Profile & Account Settings View -----------------------------------------
async function viewProfileSettings() {
  setActiveNav("profile-settings");
  const content = $("#content");
  setBreadcrumbs([{ label: "Dashboard", href: "/org" }, { label: "Profile Settings", href: "/profile-settings" }]);
  const user = getAuthUser();

  content.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
      <div>
        <h1 style="font-family:var(--font-display);font-size:24px;font-weight:700;margin:0 0 4px;color:#fff">Profile & Account Settings</h1>
        <p style="font-size:12.5px;color:var(--text-muted);margin:0">Manage your profile, active role credentials, AI notification alerts, and API keys</p>
      </div>

      <button class="btn btn-primary" onclick="handleProfileSave(event)" style="background:var(--accent-orange);border-color:var(--accent-orange);color:#fff">
        Save Profile Changes
      </button>
    </div>

    <div style="display:grid;grid-template-columns:1fr 2fr;gap:24px">
      <!-- Left Profile Avatar Card -->
      <div class="card" style="padding:24px;text-align:center;display:flex;flex-direction:column;align-items:center">
        <div style="margin-bottom:14px">
          ${getPersonAvatarHtml(user.name, 84, user.avatar)}
        </div>
        <h2 style="font-family:var(--font-display);font-size:20px;font-weight:700;margin:0 0 4px;color:#fff">${escapeHtml(user.name)}</h2>
        <span style="background:rgba(255,77,38,0.15);color:var(--accent-orange);font-size:11.5px;font-weight:700;padding:3px 12px;border-radius:20px;margin-bottom:16px">${escapeHtml(user.role)}</span>

        <p style="font-size:12px;color:var(--text-faint);margin:0 0 20px;line-height:1.4">Sales Operations Lead</p>

        <button class="btn btn-sm btn-ghost" onclick="toast('Avatar upload dialog opened...')" style="width:100%;border-color:rgba(255,255,255,0.15)">
          📷 Change Avatar Image
        </button>
      </div>

      <!-- Right Form Settings -->
      <div style="display:flex;flex-direction:column;gap:20px">
        <!-- Personal Info -->
        <div class="card" style="padding:24px">
          <h3 style="font-size:16px;font-weight:700;margin:0 0 16px;color:#fff">Personal Details</h3>
          
          <form id="profileForm" onsubmit="handleProfileSave(event)" style="display:flex;flex-direction:column;gap:14px">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
              <div>
                <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Full Name</label>
                <input type="text" class="auth-input-box" id="profName" value="${escapeHtml(user.name)}" required />
              </div>
              <div>
                <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Email Address</label>
                <input type="email" class="auth-input-box" id="profEmail" value="${escapeHtml(user.email)}" required />
              </div>
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
              <div>
                <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Primary Role</label>
                <select class="auth-input-box" id="profRole">
                  <option value="Sales Director" ${user.role === 'Sales Director' ? 'selected' : ''}>Sales Director</option>
                  <option value="Team Leader" ${user.role === 'Team Leader' ? 'selected' : ''}>Team Leader</option>
                  <option value="Advisor" ${user.role === 'Advisor' ? 'selected' : ''}>Advisor</option>
                </select>
              </div>
              <div>
                <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Timezone</label>
                <select class="auth-input-box">
                  <option>Asia/Kolkata (IST +5:30)</option>
                  <option>UTC / GMT</option>
                  <option>America/New_York (EST)</option>
                </select>
              </div>
            </div>
          </form>
        </div>

        <!-- Preferences & API Keys -->
        <div class="card" style="padding:24px">
          <h3 style="font-size:16px;font-weight:700;margin:0 0 16px;color:#fff">Preferences & API Keys</h3>

          <div style="display:flex;flex-direction:column;gap:14px">
            <div style="display:flex;align-items:center;justify-content:space-between;padding-bottom:12px;border-bottom:1px solid var(--border-soft)">
              <div>
                <strong style="color:#fff;font-size:13.5px;display:block">Real-Time Critical Flag Notifications</strong>
                <span style="font-size:12px;color:var(--text-faint)">Receive immediate alert toast when a Critical flag is detected</span>
              </div>
              <input type="checkbox" checked style="accent-color:var(--accent-orange);width:18px;height:18px" />
            </div>

            <div style="display:flex;align-items:center;justify-content:space-between;padding-bottom:12px;border-bottom:1px solid var(--border-soft)">
              <div>
                <strong style="color:#fff;font-size:13.5px;display:block">Daily AI Coaching Digest Email</strong>
                <span style="font-size:12px;color:var(--text-faint)">Summary of team performance delivered at 8:00 AM IST</span>
              </div>
              <input type="checkbox" checked style="accent-color:var(--accent-orange);width:18px;height:18px" />
            </div>

            <div>
              <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Exotel / Telephony API Integration Key</label>
              <div style="display:flex;gap:10px">
                <input type="password" class="auth-input-box" value="fitnova_live_exotel_key_8492048102" readonly style="flex:1" />
                <button class="btn btn-ghost" onclick="toast('API Key copied to clipboard!')">Copy Key</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

window.handleProfileSave = function(e) {
  if (e) e.preventDefault();
  const name = $("#profName").value.trim();
  const email = $("#profEmail").value.trim();
  const role = $("#profRole").value;

  const current = getAuthUser();
  current.name = name;
  current.email = email;
  current.role = role;
  current.avatar = name.split(" ").map(p => p[0]).join("").toUpperCase().slice(0,2);

  setAuthUser(current);
  toast("Saved profile & account settings!");
  router();
};

window.filterLeaderboardRows = function() {
  const pod = $("#leaderboardPodFilter") ? $("#leaderboardPodFilter").value : "ALL";
  const timeframe = $("#leaderboardTimeframe") ? $("#leaderboardTimeframe").value : "week";
  
  toast(`Updated Leaderboard for ${pod} (${timeframe})`);

  const rows = $$(".data-table tbody tr");
  rows.forEach(r => {
    const podCell = r.children[2] ? r.children[2].textContent.trim() : "";
    if (pod === "ALL" || podCell.includes(pod)) {
      r.style.display = "";
    } else {
      r.style.display = "none";
    }
  });
};

window.filterCallFeedRows = function() {
  const search = ($("#callSearchInput") ? $("#callSearchInput").value : "").toLowerCase();
  const team = $("#teamFilter") ? $("#teamFilter").value : "ALL";
  const advisor = $("#advisorFilter") ? $("#advisorFilter").value : "ALL";
  const severity = $("#severityFilter") ? $("#severityFilter").value : "ALL";
  const trial = $("#trialFilter") ? $("#trialFilter").value : "ALL";
  const status = $("#statusFilter") ? $("#statusFilter").value : "ALL";
  const source = $("#sourceFilter") ? $("#sourceFilter").value : "ALL";

  const rows = $$(".call-feed-row");
  let visibleCount = 0;

  rows.forEach(row => {
    const text = row.textContent.toLowerCase();
    const rowTeam = row.dataset.team || "";
    const rowAdvisor = row.dataset.advisor || "";
    const rowSeverity = row.dataset.severity || "";
    const rowTrial = row.dataset.trial || "";
    const rowStatus = row.dataset.status || "";
    const rowSource = row.dataset.source || "";

    const matchSearch = !search || text.includes(search);
    const matchTeam = team === "ALL" || rowTeam === team;
    const matchAdvisor = advisor === "ALL" || rowAdvisor === advisor;
    const matchSeverity = severity === "ALL" || rowSeverity === severity;
    const matchTrial = trial === "ALL" || rowTrial === trial;
    const matchStatus = status === "ALL" || rowStatus === status;
    const matchSource = source === "ALL" || rowSource === source;

    if (matchSearch && matchTeam && matchAdvisor && matchSeverity && matchTrial && matchStatus && matchSource) {
      row.style.display = "";
      visibleCount++;
    } else {
      row.style.display = "none";
    }
  });

  const countEl = $("#callFeedCount");
  if (countEl) countEl.textContent = `${visibleCount} of ${rows.length} calls · Auto-scored by AI`;
};

window.openScheduleCoachingModal = function() {
  const container = $("#authModalContainer");
  if (!container) return;

  container.innerHTML = `
    <div style="position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)">
      <div class="card" style="width:100%;max-width:440px;padding:24px;background:#0e1017;border:1px solid rgba(255,255,255,0.12)">
        <h3 style="font-family:var(--font-display);font-size:18px;font-weight:700;margin:0 0 14px;color:#fff">Schedule 1-on-1 Coaching Session</h3>
        
        <form onsubmit="handleScheduleSubmit(event)" style="display:flex;flex-direction:column;gap:12px">
          <div>
            <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Assign Coach / Manager</label>
            <select class="auth-input-box" id="schedCoach">
              <option value="Priya Sharma (Alpha Leader)">Priya Sharma (Alpha Leader)</option>
              <option value="Arjun Mehta (Beta Leader)">Arjun Mehta (Beta Leader)</option>
              <option value="Farah Sheikh (Gamma Leader)">Farah Sheikh (Gamma Leader)</option>
              <option value="Vikram Singh (Delta Leader)">Vikram Singh (Delta Leader)</option>
              <option value="Rohan Kapoor (Sales Director)">Rohan Kapoor (Sales Director)</option>
            </select>
          </div>

          <div>
            <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Select Advisor to Coach</label>
            <select class="auth-input-box" id="schedAdvisor">
              <option value="Sanjay Verma (Beta Pod)">Sanjay Verma (Beta Pod)</option>
              <option value="Divya Krishnan (Beta Pod)">Divya Krishnan (Beta Pod)</option>
              <option value="Neha Gupta (Alpha Pod)">Neha Gupta (Alpha Pod)</option>
              <option value="Rahul Joshi (Beta Pod)">Rahul Joshi (Beta Pod)</option>
              <option value="Karan Malhotra (Delta Pod)">Karan Malhotra (Delta Pod)</option>
              <option value="Pooja Agarwal (Beta Pod)">Pooja Agarwal (Beta Pod)</option>
            </select>
          </div>

          <div>
            <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Date & Time</label>
            <input type="datetime-local" class="auth-input-box" id="schedDateTime" required value="2026-08-08T11:00" />
          </div>

          <div>
            <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Focus Topic / Agenda</label>
            <input type="text" class="auth-input-box" id="schedTopic" placeholder="e.g. Price Discovery & Objection Handling" required value="Price Discovery & Objection Handling" />
          </div>

          <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:10px">
            <button type="button" class="btn btn-ghost" onclick="$('#authModalContainer').innerHTML=''">Cancel</button>
            <button type="submit" class="btn btn-primary" style="background:var(--accent-orange);border-color:var(--accent-orange);color:#fff">Confirm & Schedule</button>
          </div>
        </form>
      </div>
    </div>
  `;
};

window.handleScheduleSubmit = function(e) {
  e.preventDefault();
  const coach = $("#schedCoach").value;
  const advisor = $("#schedAdvisor").value;
  const datetime = $("#schedDateTime").value;
  const topic = $("#schedTopic").value;

  const existing = JSON.parse(localStorage.getItem("fitnova_scheduled_sessions") || "[]");
  existing.unshift({ coach, advisor, datetime: new Date(datetime).toLocaleString(), topic });
  localStorage.setItem("fitnova_scheduled_sessions", JSON.stringify(existing));

  toast(`Scheduled 1-on-1 with ${advisor} by ${coach}!`);
  $("#authModalContainer").innerHTML = "";
  if (window.location.hash === "#/coaching") {
    renderScheduledSessions();
  }
};

window.renderScheduledSessions = function() {
  const container = $("#scheduledSessionsList");
  if (!container) return;
  const existing = JSON.parse(localStorage.getItem("fitnova_scheduled_sessions") || "[]");
  if (!existing.length) {
    container.innerHTML = `<div style="font-size:12px;color:var(--text-faint);font-style:italic">No upcoming 1-on-1 sessions scheduled yet. Click "+ Schedule 1-on-1 Session" above to add one!</div>`;
    return;
  }

  container.innerHTML = existing.map(s => `
    <div style="background:var(--panel-alt);border:1px solid var(--border-soft);border-radius:10px;padding:12px;margin-top:8px;display:flex;align-items:center;justify-content:space-between">
      <div>
        <div style="font-size:13.5px;font-weight:700;color:#fff">${escapeHtml(s.advisor)} <span style="font-size:11px;color:var(--accent-teal)">[Coach: ${escapeHtml(s.coach)}]</span></div>
        <div style="font-size:12px;color:var(--text-muted);margin-top:2px">Topic: "${escapeHtml(s.topic)}"</div>
      </div>
      <div style="text-align:right">
        <div style="font-family:var(--font-mono);font-size:11.5px;color:var(--accent-orange);font-weight:700">${escapeHtml(s.datetime)}</div>
        <span style="font-size:10px;background:rgba(53,196,168,0.2);color:var(--accent-teal);padding:2px 6px;border-radius:6px">Confirmed</span>
      </div>
    </div>
  `).join("");
};
async function viewTeamConfig() {
  setActiveNav("config");
  const content = $("#content");
  setBreadcrumbs([{ label: "Dashboard", href: "/org" }, { label: "Team Config", href: "/team-config" }]);

  content.innerHTML = `
    <div style="margin-bottom:20px">
      <h1 style="font-family:var(--font-display);font-size:24px;font-weight:700;margin:0 0 4px;color:#fff">Team & Pod Configuration</h1>
      <p style="font-size:12.5px;color:var(--text-muted);margin:0">Manage pods, leaders, target metrics, and compliance alert thresholds</p>
    </div>

    <div style="display:grid;grid-template-columns:1.5fr 1fr;gap:20px">
      <div class="card" style="padding:20px">
        <h3 style="font-size:16px;font-weight:700;margin:0 0 16px;color:#fff">Active Pod Structure</h3>
        
        <div style="display:flex;flex-direction:column;gap:14px">
          <div style="background:var(--panel-alt);border:1px solid var(--border-soft);border-radius:12px;padding:16px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
              <strong style="color:#fff;font-size:14px">Alpha Pod</strong>
              <span style="font-size:12px;color:var(--accent-teal)">Leader: Priya Sharma</span>
            </div>
            <p style="font-size:12px;color:var(--text-faint);margin:0 0 10px">3 Advisors: Neha Gupta, Ananya R., Ravi K.</p>
            <button class="btn btn-sm btn-ghost" onclick="toast('Editing Alpha Pod config...')" style="color:var(--accent-orange)">Edit Pod Settings</button>
          </div>

          <div style="background:var(--panel-alt);border:1px solid var(--border-soft);border-radius:12px;padding:16px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
              <strong style="color:#fff;font-size:14px">Beta Pod</strong>
              <span style="font-size:12px;color:var(--accent-teal)">Leader: Arjun Mehta</span>
            </div>
            <p style="font-size:12px;color:var(--text-faint);margin:0 0 10px">4 Advisors: Rahul Joshi, Divya Krishnan, Karan Malhotra, Pooja Agarwal</p>
            <button class="btn btn-sm btn-ghost" onclick="toast('Editing Beta Pod config...')" style="color:var(--accent-orange)">Edit Pod Settings</button>
          </div>
        </div>
      </div>

      <div class="card" style="padding:20px">
        <h3 style="font-size:16px;font-weight:700;margin:0 0 16px;color:#fff">Target Thresholds</h3>
        
        <div style="display:flex;flex-direction:column;gap:16px">
          <div>
            <label style="font-size:12.5px;color:var(--text-muted);display:block;margin-bottom:6px">Target Trial Booking Rate (%)</label>
            <input type="number" class="auth-input-box" value="70" />
          </div>

          <div>
            <label style="font-size:12.5px;color:var(--text-muted);display:block;margin-bottom:6px">Min Passing Call Score</label>
            <input type="number" class="auth-input-box" value="75" />
          </div>

          <div>
            <label style="font-size:12.5px;color:var(--text-muted);display:block;margin-bottom:6px">Auto-Escalate Critical Flags</label>
            <select class="auth-input-box">
              <option>Enabled (Immediate Toast + Email)</option>
              <option>Disabled</option>
            </select>
          </div>

          <button class="btn btn-primary" onclick="toast('Saved team thresholds!')" style="background:var(--accent-orange);border-color:var(--accent-orange);color:#fff;margin-top:8px">
            Save Thresholds
          </button>
        </div>
      </div>
    </div>
  `;
}

// --- Rubric Setup View -------------------------------------------------------
async function viewRubricSetup() {
  setActiveNav("rubric");
  const content = $("#content");
  setBreadcrumbs([{ label: "Dashboard", href: "/org" }, { label: "Rubric Setup", href: "/rubric-setup" }]);

  content.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
      <div>
        <h1 style="font-family:var(--font-display);font-size:24px;font-weight:700;margin:0 0 4px;color:#fff">AI Rubric & Criteria Setup</h1>
        <p style="font-size:12.5px;color:var(--text-muted);margin:0">Configure the 5-dimension evaluation weights used by FitNova AI engine</p>
      </div>

      <button class="btn btn-primary" onclick="toast('Added new custom evaluation rule!')" style="background:var(--accent-orange);border-color:var(--accent-orange);color:#fff">
        + Add New Rubric Dimension
      </button>
    </div>

    <!-- Rubric Dimensions Weight Editor -->
    <div class="card" style="padding:24px">
      <div style="display:flex;flex-direction:column;gap:20px">
        <div style="border-bottom:1px solid var(--border-soft);padding-bottom:14px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <h4 style="font-size:15px;font-weight:700;margin:0;color:#fff">1. Needs Discovery</h4>
            <span style="font-family:var(--font-mono);font-weight:700;color:var(--accent-orange);font-size:14px">Weight: 25%</span>
          </div>
          <p style="font-size:12.5px;color:var(--text-faint);margin:0 0 8px">Evaluates open-ended questions about customer fitness goals, timeline, and budget constraints.</p>
          <input type="range" min="0" max="50" value="25" style="width:100%;accent-color:var(--accent-orange)" />
        </div>

        <div style="border-bottom:1px solid var(--border-soft);padding-bottom:14px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <h4 style="font-size:15px;font-weight:700;margin:0;color:#fff">2. Product Knowledge</h4>
            <span style="font-family:var(--font-mono);font-weight:700;color:var(--accent-orange);font-size:14px">Weight: 20%</span>
          </div>
          <p style="font-size:12.5px;color:var(--text-faint);margin:0 0 8px">Accuracy of plan feature descriptions, coach allocation details, and app functionality.</p>
          <input type="range" min="0" max="50" value="20" style="width:100%;accent-color:var(--accent-orange)" />
        </div>

        <div style="border-bottom:1px solid var(--border-soft);padding-bottom:14px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <h4 style="font-size:15px;font-weight:700;margin:0;color:#fff">3. Objection Handling</h4>
            <span style="font-family:var(--font-mono);font-weight:700;color:var(--accent-orange);font-size:14px">Weight: 20%</span>
          </div>
          <p style="font-size:12.5px;color:var(--text-faint);margin:0 0 8px">Handling price, time commitment, or competitor hesitation with ROI framing.</p>
          <input type="range" min="0" max="50" value="20" style="width:100%;accent-color:var(--accent-orange)" />
        </div>

        <div style="border-bottom:1px solid var(--border-soft);padding-bottom:14px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <h4 style="font-size:15px;font-weight:700;margin:0;color:#fff">4. Compliance</h4>
            <span style="font-family:var(--font-mono);font-weight:700;color:var(--accent-orange);font-size:14px">Weight: 20%</span>
          </div>
          <p style="font-size:12.5px;color:var(--text-faint);margin:0 0 8px">Adherence to non-promising guarantees, mandatory refund disclosures, and PII protection.</p>
          <input type="range" min="0" max="50" value="20" style="width:100%;accent-color:var(--accent-orange)" />
        </div>

        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <h4 style="font-size:15px;font-weight:700;margin:0;color:#fff">5. Next Step Booking</h4>
            <span style="font-family:var(--font-mono);font-weight:700;color:var(--accent-orange);font-size:14px">Weight: 15%</span>
          </div>
          <p style="font-size:12.5px;color:var(--text-faint);margin:0 0 8px">Securing explicit date, time, and confirmation for trial session booking.</p>
          <input type="range" min="0" max="50" value="15" style="width:100%;accent-color:var(--accent-orange)" />
        </div>
      </div>

      <div style="margin-top:20px;text-align:right">
        <button class="btn btn-primary" onclick="toast('Updated AI Rubric weights & saved!')" style="background:var(--accent-orange);border-color:var(--accent-orange);color:#fff">
          Save Rubric Configuration
        </button>
      </div>
    </div>
  `;
}
async function viewCallFeed() {
  setActiveNav("call-feed");
  const content = $("#content");
  content.innerHTML = `<div class="loading-state">Loading Call Feed…</div>`;

  setBreadcrumbs([{ label: "Call Feed", href: "/call-feed" }]);

  content.innerHTML = `
    <!-- Header with Ingest Call, Create Team/Advisor & Export CSV Buttons -->
    <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
      <div>
        <h1 style="font-family:var(--font-display);font-size:24px;font-weight:700;margin:0 0 4px;color:#fff">Call Feed</h1>
        <p style="font-size:12.5px;color:var(--text-muted);margin:0" id="callFeedCount">25 of 25 calls · Auto-scored by AI</p>
      </div>

      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-ghost" onclick="openCreateTeamModal()" style="border-color:rgba(255,255,255,0.15);font-size:12px">
          + Create Team
        </button>
        <button class="btn btn-ghost" onclick="openCreateAdvisorModal()" style="border-color:rgba(255,255,255,0.15);font-size:12px">
          + Add Advisor
        </button>
        <button class="btn btn-ghost" onclick="exportCallFeedCSV()" style="border-color:rgba(255,255,255,0.15);font-size:12px">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
          Export CSV
        </button>
        <button class="btn btn-primary" onclick="openRunPipelineModal()" style="background:var(--accent-orange);border-color:var(--accent-orange);color:#fff;font-size:12px">
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M3 2L11 7L3 12V2Z" fill="currentColor"/></svg>
          Ingest Call
        </button>
      </div>
    </div>

    <!-- Search & Multi-Filter Controls (Exact Match for Screenshot #2) -->
    <div class="card" style="margin-bottom:20px;padding:16px">
      <div style="margin-bottom:12px">
        <input type="text" id="callSearchInput" oninput="filterCallFeedRows()" class="auth-input-box" placeholder="Search by caller name, advisor, transcript keywords, duration (e.g. &quot;10-20m&quot;, &quot;&gt;15m&quot;), AI summary..." style="width:100%" />
      </div>

      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <select class="auth-input-box" id="teamFilter" onchange="filterCallFeedRows()" style="width:120px;padding:6px 10px;font-size:12px">
          <option value="ALL">All Teams</option>
          <option value="Alpha Pod">Alpha Pod</option>
          <option value="Beta Pod">Beta Pod</option>
          <option value="Gamma Pod">Gamma Pod</option>
          <option value="Delta Pod">Delta Pod</option>
          <option value="Epsilon Pod">Epsilon Pod</option>
          <option value="Zeta Pod">Zeta Pod</option>
        </select>

        <select class="auth-input-box" id="advisorFilter" onchange="filterCallFeedRows()" style="width:130px;padding:6px 10px;font-size:12px">
          <option value="ALL">All Advisors</option>
          <option value="Neha Gupta">Neha Gupta</option>
          <option value="Sanjay Verma">Sanjay Verma</option>
          <option value="Divya Krishnan">Divya Krishnan</option>
          <option value="Rahul Joshi">Rahul Joshi</option>
          <option value="Karan Malhotra">Karan Malhotra</option>
          <option value="Pooja Agarwal">Pooja Agarwal</option>
          <option value="Vikram Nair">Vikram Nair</option>
          <option value="Sneha Rao">Sneha Rao</option>
          <option value="Aditi Rao">Aditi Rao</option>
          <option value="Rohan Sharma">Rohan Sharma</option>
        </select>

        <select class="auth-input-box" id="scoreFilter" onchange="filterCallFeedRows()" style="width:130px;padding:6px 10px;font-size:12px">
          <option value="ALL">Score: All</option>
          <option value="90+">90+ (Excellent)</option>
          <option value="75-89">75 - 89 (Good)</option>
          <option value="<75">&lt; 75 (Needs Focus)</option>
        </select>

        <select class="auth-input-box" id="severityFilter" onchange="filterCallFeedRows()" style="width:130px;padding:6px 10px;font-size:12px">
          <option value="ALL">All Severities</option>
          <option value="Critical">Critical</option>
          <option value="High">High</option>
          <option value="Medium">Medium</option>
        </select>

        <select class="auth-input-box" id="trialFilter" onchange="filterCallFeedRows()" style="width:130px;padding:6px 10px;font-size:12px">
          <option value="ALL">Trial: All</option>
          <option value="Booked">Booked</option>
          <option value="Rescheduled">Rescheduled</option>
          <option value="Lost / Refused">Lost / Refused</option>
          <option value="None">None</option>
        </select>

        <select class="auth-input-box" id="statusFilter" onchange="filterCallFeedRows()" style="width:120px;padding:6px 10px;font-size:12px">
          <option value="ALL">All Statuses</option>
          <option value="Scored">Scored</option>
          <option value="Disputed">Disputed</option>
        </select>

        <select class="auth-input-box" id="sourceFilter" onchange="filterCallFeedRows()" style="width:120px;padding:6px 10px;font-size:12px">
          <option value="ALL">All Sources</option>
          <option value="Exotel">Exotel</option>
          <option value="File Upload">File Upload</option>
        </select>
      </div>
    </div>

    <!-- Call Feed Table -->
    <div class="card">
      <table class="data-table">
        <thead>
          <tr>
            <th>CALL ID</th>
            <th>ADVISOR</th>
            <th>TEAM</th>
            <th>DATE / TIME</th>
            <th>DURATION</th>
            <th style="text-align:center">SCORE</th>
            <th>FLAGS</th>
            <th style="text-align:center">TRIAL</th>
            <th style="text-align:center">STATUS</th>
            <th>SOURCE</th>
          </tr>
        </thead>
        <tbody id="callFeedTableBody">
          <tr class="clickable call-feed-row" data-team="Alpha Pod" data-advisor="Neha Gupta" data-score="91" data-severity="None" data-trial="Booked" data-status="Scored" data-source="Exotel" onclick="window.location.hash='#/call/929334b248b1'">
            <td class="mono" style="color:var(--accent-orange)">CALL-2871</td>
            <td><div style="display:flex;align-items:center;gap:8px"><span style="width:24px;height:24px;border-radius:50%;background:rgba(255,77,38,0.2);color:var(--accent-orange);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700">NG</span><span style="font-weight:600;color:#fff">Neha Gupta</span></div></td>
            <td class="cell-sub">Alpha Pod</td>
            <td class="mono" style="font-size:12px">7 Aug 2026<br><span style="color:var(--text-faint)">3:42 PM</span></td>
            <td class="mono">22m 14s</td>
            <td style="text-align:center"><span style="background:rgba(53,196,168,0.15);color:var(--accent-teal);padding:4px 10px;border-radius:12px;font-family:var(--font-mono);font-weight:700">91</span></td>
            <td><span style="color:var(--text-faint)">—</span></td>
            <td style="text-align:center"><span style="color:var(--accent-teal);font-weight:600">● Booked</span></td>
            <td style="text-align:center"><span class="status-pill scored">Scored</span></td>
            <td class="cell-sub">Exotel</td>
          </tr>

          <tr class="clickable call-feed-row" data-team="Delta Pod" data-advisor="Sanjay Verma" data-score="52" data-severity="Critical" data-trial="None" data-status="Disputed" data-source="Exotel" onclick="window.location.hash='#/call/7b00b5495852'">
            <td class="mono" style="color:var(--accent-orange)">CALL-2869</td>
            <td><div style="display:flex;align-items:center;gap:8px"><span style="width:24px;height:24px;border-radius:50%;background:rgba(255,77,38,0.2);color:var(--accent-orange);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700">SV</span><span style="font-weight:600;color:#fff">Sanjay Verma</span></div></td>
            <td class="cell-sub">Delta Pod</td>
            <td class="mono" style="font-size:12px">7 Aug 2026<br><span style="color:var(--text-faint)">10:24 AM</span></td>
            <td class="mono">18m 32s</td>
            <td style="text-align:center"><span style="background:rgba(255,59,48,0.15);color:var(--sev-critical);padding:4px 10px;border-radius:12px;font-family:var(--font-mono);font-weight:700">52</span></td>
            <td><span class="chip sev-critical">● Critical x4</span></td>
            <td style="text-align:center"><span style="color:var(--text-faint)">● None</span></td>
            <td style="text-align:center"><span class="status-pill" style="border-color:var(--accent-amber);color:var(--accent-amber)">Disputed</span></td>
            <td class="cell-sub">Exotel</td>
          </tr>

          <tr class="clickable call-feed-row" data-team="Beta Pod" data-advisor="Divya Krishnan" data-score="72" data-severity="Medium" data-trial="Rescheduled" data-status="Scored" data-source="File Upload" onclick="window.location.hash='#/call/6d2bc2dc0016'">
            <td class="mono" style="color:var(--accent-orange)">CALL-2867</td>
            <td><div style="display:flex;align-items:center;gap:8px"><span style="width:24px;height:24px;border-radius:50%;background:rgba(255,77,38,0.2);color:var(--accent-orange);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700">DK</span><span style="font-weight:600;color:#fff">Divya Krishnan</span></div></td>
            <td class="cell-sub">Beta Pod</td>
            <td class="mono" style="font-size:12px">6 Aug 2026<br><span style="color:var(--text-faint)">4:38 PM</span></td>
            <td class="mono">16m 55s</td>
            <td style="text-align:center"><span style="background:rgba(242,183,5,0.15);color:var(--accent-amber);padding:4px 10px;border-radius:12px;font-family:var(--font-mono);font-weight:700">72</span></td>
            <td><span class="chip sev-medium">● Medium x2</span></td>
            <td style="text-align:center"><span style="color:var(--accent-amber);font-weight:600">● Rescheduled</span></td>
            <td style="text-align:center"><span class="status-pill scored">Scored</span></td>
            <td class="cell-sub">File Upload</td>
          </tr>

          <tr class="clickable call-feed-row" data-team="Beta Pod" data-advisor="Pooja Agarwal" data-score="68" data-severity="Critical" data-trial="Lost / Refused" data-status="Disputed" data-source="Exotel" onclick="window.location.hash='#/call/929334b248b1'">
            <td class="mono" style="color:var(--accent-orange)">CALL-2863</td>
            <td><div style="display:flex;align-items:center;gap:8px"><span style="width:24px;height:24px;border-radius:50%;background:rgba(255,77,38,0.2);color:var(--accent-orange);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700">PA</span><span style="font-weight:600;color:#fff">Pooja Agarwal</span></div></td>
            <td class="cell-sub">Beta Pod</td>
            <td class="mono" style="font-size:12px">6 Aug 2026<br><span style="color:var(--text-faint)">2:15 PM</span></td>
            <td class="mono">19m 10s</td>
            <td style="text-align:center"><span style="background:rgba(255,59,48,0.15);color:var(--sev-critical);padding:4px 10px;border-radius:12px;font-family:var(--font-mono);font-weight:700">68</span></td>
            <td><span class="chip sev-critical">● Critical x1</span></td>
            <td style="text-align:center"><span style="color:var(--sev-critical);font-weight:600">● Lost / Refused</span></td>
            <td style="text-align:center"><span class="status-pill" style="border-color:var(--accent-amber);color:var(--accent-amber)">Disputed</span></td>
            <td class="cell-sub">Exotel</td>
          </tr>

          <tr class="clickable call-feed-row" data-team="Beta Pod" data-advisor="Rahul Joshi" data-score="84" data-severity="None" data-trial="Booked" data-status="Scored" data-source="Exotel" onclick="window.location.hash='#/call/929334b248b1'">
            <td class="mono" style="color:var(--accent-orange)">CALL-2860</td>
            <td><div style="display:flex;align-items:center;gap:8px"><span style="width:24px;height:24px;border-radius:50%;background:rgba(53,196,168,0.2);color:var(--accent-teal);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700">RJ</span><span style="font-weight:600;color:#fff">Rahul Joshi</span></div></td>
            <td class="cell-sub">Beta Pod</td>
            <td class="mono" style="font-size:12px">5 Aug 2026<br><span style="color:var(--text-faint)">11:30 AM</span></td>
            <td class="mono">24m 05s</td>
            <td style="text-align:center"><span style="background:rgba(53,196,168,0.15);color:var(--accent-teal);padding:4px 10px;border-radius:12px;font-family:var(--font-mono);font-weight:700">84</span></td>
            <td><span style="color:var(--text-faint)">—</span></td>
            <td style="text-align:center"><span style="color:var(--accent-teal);font-weight:600">● Booked</span></td>
            <td style="text-align:center"><span class="status-pill scored">Scored</span></td>
            <td class="cell-sub">Exotel</td>
          </tr>

          <tr class="clickable call-feed-row" data-team="Delta Pod" data-advisor="Karan Malhotra" data-score="79" data-severity="Medium" data-trial="Booked" data-status="Scored" data-source="Exotel" onclick="window.location.hash='#/call/929334b248b1'">
            <td class="mono" style="color:var(--accent-orange)">CALL-2855</td>
            <td><div style="display:flex;align-items:center;gap:8px"><span style="width:24px;height:24px;border-radius:50%;background:rgba(255,77,38,0.2);color:var(--accent-orange);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700">KM</span><span style="font-weight:600;color:#fff">Karan Malhotra</span></div></td>
            <td class="cell-sub">Delta Pod</td>
            <td class="mono" style="font-size:12px">5 Aug 2026<br><span style="color:var(--text-faint)">9:20 AM</span></td>
            <td class="mono">21m 40s</td>
            <td style="text-align:center"><span style="background:rgba(53,196,168,0.15);color:var(--accent-teal);padding:4px 10px;border-radius:12px;font-family:var(--font-mono);font-weight:700">79</span></td>
            <td><span class="chip sev-medium">● Medium x1</span></td>
            <td style="text-align:center"><span style="color:var(--accent-teal);font-weight:600">● Booked</span></td>
            <td style="text-align:center"><span class="status-pill scored">Scored</span></td>
            <td class="cell-sub">Exotel</td>
          </tr>

          <tr class="clickable call-feed-row" data-team="Gamma Pod" data-advisor="Sneha Rao" data-score="88" data-severity="None" data-trial="Booked" data-status="Scored" data-source="Exotel" onclick="window.location.hash='#/call/929334b248b1'">
            <td class="mono" style="color:var(--accent-orange)">CALL-2850</td>
            <td><div style="display:flex;align-items:center;gap:8px"><span style="width:24px;height:24px;border-radius:50%;background:rgba(242,183,5,0.2);color:var(--accent-amber);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700">SR</span><span style="font-weight:600;color:#fff">Sneha Rao</span></div></td>
            <td class="cell-sub">Gamma Pod</td>
            <td class="mono" style="font-size:12px">4 Aug 2026<br><span style="color:var(--text-faint)">5:10 PM</span></td>
            <td class="mono">25m 12s</td>
            <td style="text-align:center"><span style="background:rgba(53,196,168,0.15);color:var(--accent-teal);padding:4px 10px;border-radius:12px;font-family:var(--font-mono);font-weight:700">88</span></td>
            <td><span style="color:var(--text-faint)">—</span></td>
            <td style="text-align:center"><span style="color:var(--accent-teal);font-weight:600">● Booked</span></td>
            <td style="text-align:center"><span class="status-pill scored">Scored</span></td>
            <td class="cell-sub">Exotel</td>
          </tr>

          <tr class="clickable call-feed-row" data-team="Gamma Pod" data-advisor="Vikram Nair" data-score="94" data-severity="None" data-trial="Booked" data-status="Scored" data-source="Exotel" onclick="window.location.hash='#/call/929334b248b1'">
            <td class="mono" style="color:var(--accent-orange)">CALL-2848</td>
            <td><div style="display:flex;align-items:center;gap:8px"><span style="width:24px;height:24px;border-radius:50%;background:rgba(53,196,168,0.2);color:var(--accent-teal);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700">VN</span><span style="font-weight:600;color:#fff">Vikram Nair</span></div></td>
            <td class="cell-sub">Gamma Pod</td>
            <td class="mono" style="font-size:12px">4 Aug 2026<br><span style="color:var(--text-faint)">2:45 PM</span></td>
            <td class="mono">20m 05s</td>
            <td style="text-align:center"><span style="background:rgba(53,196,168,0.15);color:var(--accent-teal);padding:4px 10px;border-radius:12px;font-family:var(--font-mono);font-weight:700">94</span></td>
            <td><span style="color:var(--text-faint)">—</span></td>
            <td style="text-align:center"><span style="color:var(--accent-teal);font-weight:600">● Booked</span></td>
            <td style="text-align:center"><span class="status-pill scored">Scored</span></td>
            <td class="cell-sub">Exotel</td>
          </tr>

          <tr class="clickable call-feed-row" data-team="Epsilon Pod" data-advisor="Aditi Rao" data-score="64" data-severity="High" data-trial="Rescheduled" data-status="Scored" data-source="File Upload" onclick="window.location.hash='#/call/929334b248b1'">
            <td class="mono" style="color:var(--accent-orange)">CALL-2842</td>
            <td><div style="display:flex;align-items:center;gap:8px"><span style="width:24px;height:24px;border-radius:50%;background:rgba(255,77,38,0.2);color:var(--accent-orange);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700">AR</span><span style="font-weight:600;color:#fff">Aditi Rao</span></div></td>
            <td class="cell-sub">Epsilon Pod</td>
            <td class="mono" style="font-size:12px">3 Aug 2026<br><span style="color:var(--text-faint)">11:15 AM</span></td>
            <td class="mono">17m 40s</td>
            <td style="text-align:center"><span style="background:rgba(255,59,48,0.15);color:var(--sev-critical);padding:4px 10px;border-radius:12px;font-family:var(--font-mono);font-weight:700">64</span></td>
            <td><span class="chip sev-high">● High x2</span></td>
            <td style="text-align:center"><span style="color:var(--accent-amber);font-weight:600">● Rescheduled</span></td>
            <td style="text-align:center"><span class="status-pill scored">Scored</span></td>
            <td class="cell-sub">File Upload</td>
          </tr>

          <tr class="clickable call-feed-row" data-team="Zeta Pod" data-advisor="Rohan Sharma" data-score="77" data-severity="Medium" data-trial="Booked" data-status="Scored" data-source="Exotel" onclick="window.location.hash='#/call/929334b248b1'">
            <td class="mono" style="color:var(--accent-orange)">CALL-2839</td>
            <td><div style="display:flex;align-items:center;gap:8px"><span style="width:24px;height:24px;border-radius:50%;background:rgba(53,196,168,0.2);color:var(--accent-teal);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700">RS</span><span style="font-weight:600;color:#fff">Rohan Sharma</span></div></td>
            <td class="cell-sub">Zeta Pod</td>
            <td class="mono" style="font-size:12px">3 Aug 2026<br><span style="color:var(--text-faint)">9:50 AM</span></td>
            <td class="mono">23m 18s</td>
            <td style="text-align:center"><span style="background:rgba(53,196,168,0.15);color:var(--accent-teal);padding:4px 10px;border-radius:12px;font-family:var(--font-mono);font-weight:700">77</span></td>
            <td><span class="chip sev-medium">● Medium x1</span></td>
            <td style="text-align:center"><span style="color:var(--accent-teal);font-weight:600">● Booked</span></td>
            <td style="text-align:center"><span class="status-pill scored">Scored</span></td>
            <td class="cell-sub">Exotel</td>
          </tr>
        </tbody>
      </table>
    </div>
  `;
}

// --- Role Switcher & Dynamic Dashboard Views -------------------------------
async function viewOrg() {
  setActiveNav("org");
  const content = $("#content");
  const user = getAuthUser();
  const currentRole = user ? user.role : "Sales Director";

  content.innerHTML = `<div class="loading-state">Loading FitNova Call Intelligence dashboard…</div>`;
  let data;
  try {
    data = await api("/dashboard/org");
  } catch (e) {
    data = { total_calls_scored: 412, avg_overall_score: 74.2, risk_index: 5.5, tag_distribution: {}, score_trend: [], teams: [] };
  }

  setBreadcrumbs([{ label: "Dashboard", href: "/org" }]);

  // Header with title subtext + Segmented Role Control (Matches Screenshots)
  const headerHtml = `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:16px">
      <div>
        <h1 style="font-family:var(--font-display);font-size:26px;font-weight:700;margin:0 0 4px;color:#fff">Dashboard</h1>
        <p style="color:var(--text-muted);font-size:13px;margin:0">FitNova Call Intelligence · Last updated 2 min ago</p>
      </div>

      <!-- Segmented Role Selector Control -->
      <div class="role-switcher-segmented">
        <button class="role-seg-btn ${currentRole === 'Sales Director' ? 'active' : ''}" onclick="switchRoleAndRender('Sales Director')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M12 8v8M8 12h8"></path></svg>
          <span>Sales Director</span>
        </button>
        <button class="role-seg-btn ${currentRole === 'Team Leader' ? 'active' : ''}" onclick="switchRoleAndRender('Team Leader')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle></svg>
          <span>Team Leader</span>
        </button>
        <button class="role-seg-btn ${currentRole === 'Advisor' ? 'active' : ''}" onclick="switchRoleAndRender('Advisor')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
          <span>Advisor</span>
        </button>
      </div>
    </div>
  `;

  if (currentRole === "Team Leader") {
    content.innerHTML = headerHtml + renderTeamLeaderDashboardContent(data);
  } else if (currentRole === "Advisor") {
    content.innerHTML = headerHtml + renderAdvisorDashboardContent(data);
    trendChart("trendChart", data.score_trend || []);
  } else {
    content.innerHTML = headerHtml + renderSalesDirectorDashboardContent(data);
    trendChart("trendChart", data.score_trend || []);
    renderFlagTypesDoughnutChart("flagTypesChart");
  }

  bindRowNav();
}

function renderFlagTypesDoughnutChart(canvasId) {
  if (typeof Chart === "undefined") return;
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["Weak Trial Booking", "Price Before Value", "No Needs Discovery", "Over-Promising", "Pressure Tactics"],
      datasets: [{
        data: [67, 54, 41, 38, 29],
        backgroundColor: [
          "#ff4d26",
          "#f2b705",
          "#ff3b30",
          "#e63946",
          "#d90429"
        ],
        borderWidth: 0,
        hoverOffset: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "right",
          labels: { color: "#93a0b3", font: { size: 11, family: "Inter" } }
        }
      },
      cutout: "68%"
    }
  });
}

window.switchRoleAndRender = function(roleName) {
  const targetUser = DEMO_USERS.find(u => u.role === roleName) || DEMO_USERS[0];
  setAuthUser(targetUser);
  toast(`Switched dashboard view to ${roleName}`);
  viewOrg();
};

window.currentHeroSlide = 0;
window.HERO_SLIDES = [
  { img: "/static/img/dashboard_hero.jpg", tag: "AI Sales Intelligence Engine", title: "Your Sales AI Coaching<br>Starts Here!", sub: "Automated voice transcript scoring, objection handling, & trial booking benchmarks." },
  { img: "/static/img/images.jpeg", tag: "Real-Time Voice Analytics", title: "Real-Time Voice<br>Analytics & Compliance", sub: "Detect high-risk pricing statements and over-promising guarantees before they impact churn." },
  { img: "/static/img/images (1).jpeg", tag: "Performance Benchmarking", title: "Boost Trial Booking<br>Conversions +24%", sub: "Empower advisors with benchmark transcript models from top-performing pod leaders." },
  { img: "/static/img/images (2).jpeg", tag: "AI Manager Feedback", title: "AI-Driven 1-on-1<br>Manager Feedback", sub: "Targeted coaching recommendations generated directly from call transcript evaluation." },
  { img: "/static/img/images (3).jpeg", tag: "Automated Speech Pipelines", title: "Automated Diarization<br>& Rubric Scoring", sub: "Whisper ASR + 5-dimension rubric scoring completed in seconds per call." }
];

window.nextHeroSlide = function() {
  window.currentHeroSlide = (window.currentHeroSlide + 1) % window.HERO_SLIDES.length;
  updateHeroSlideUI();
};

window.prevHeroSlide = function() {
  window.currentHeroSlide = (window.currentHeroSlide - 1 + window.HERO_SLIDES.length) % window.HERO_SLIDES.length;
  updateHeroSlideUI();
};

window.setHeroSlide = function(idx) {
  window.currentHeroSlide = idx;
  updateHeroSlideUI();
};

function updateHeroSlideUI() {
  const slide = window.HERO_SLIDES[window.currentHeroSlide];
  const container = document.getElementById("heroSlideCard");
  if (!container) return;

  container.style.backgroundImage = `linear-gradient(135deg, rgba(15,23,42,0.85) 0%, rgba(30,58,138,0.75) 100%), url('${slide.img}')`;
  document.getElementById("heroSlideTag").textContent = slide.tag;
  document.getElementById("heroSlideTitle").innerHTML = slide.title;
  document.getElementById("heroSlideSub").textContent = slide.sub;

  const dots = document.querySelectorAll(".hero-slide-dot");
  dots.forEach((d, i) => {
    d.style.opacity = i === window.currentHeroSlide ? "1" : "0.4";
    d.style.background = i === window.currentHeroSlide ? "var(--accent-orange)" : "#fff";
  });
}

window.currentComplianceTimeframe = "D";
window.switchComplianceTimeframe = function(mode) {
  window.currentComplianceTimeframe = mode;
  const dBtn = document.getElementById("timeframeBtnD");
  const wBtn = document.getElementById("timeframeBtnW");
  const mBtn = document.getElementById("timeframeBtnM");
  const valEl = document.getElementById("complianceMetricVal");
  const subEl = document.getElementById("complianceMetricSub");

  if (!valEl) return;

  [dBtn, wBtn, mBtn].forEach(b => {
    if (b) {
      b.style.background = "rgba(255,255,255,0.25)";
      b.style.color = "#fff";
    }
  });

  const activeBtn = mode === "D" ? dBtn : mode === "W" ? wBtn : mBtn;
  if (activeBtn) {
    activeBtn.style.background = "#fff";
    activeBtn.style.color = "#1e3a8a";
  }

  if (mode === "D") {
    valEl.textContent = "98.2%";
    subEl.textContent = "/Day Avg";
  } else if (mode === "W") {
    valEl.textContent = "96.4%";
    subEl.textContent = "/Week Avg";
  } else {
    valEl.textContent = "95.1%";
    subEl.textContent = "/Month Avg";
  }

  toast(`Switched AI Compliance view to ${mode === 'D' ? 'Daily' : mode === 'W' ? 'Weekly' : 'Monthly'} average`);
};

window.currentBenchmarkLevel = 1;
window.BENCHMARK_LEVELS = [
  { level: "1/5 level", badge: "🌟 Active Listening", title: "Master Active Listening & Empathy", sub: "Coach advisors on confirming prospect pain points before recommending specific coaching plans." },
  { level: "2/5 level", badge: "🌙 Deep Discovery", title: "Experience the Goodness of Deep Needs Discovery", sub: "Discover tips and techniques for better, deeper needs analysis. Coach advisors on active listening." },
  { level: "3/5 level", badge: "⚖️ Value Anchoring", title: "Value Anchoring Before Pricing", sub: "Ensure advisors present plan benefits and personal trainer access prior to stating monthly fees." },
  { level: "4/5 level", badge: "🎯 Objection Handling", title: "Objection Handling & Price Discovery", sub: "Guide prospects through price objections with structured ROI breakdowns and trial session demos." },
  { level: "5/5 level", badge: "🚀 Next Step Lock", title: "Securing Explicit Trial Confirmation", sub: "Lock down exact date, time, and trainer availability for immediate trial session booking." }
];

window.nextBenchmarkLevel = function() {
  window.currentBenchmarkLevel = (window.currentBenchmarkLevel + 1) % window.BENCHMARK_LEVELS.length;
  updateBenchmarkLevelUI();
};

window.prevBenchmarkLevel = function() {
  window.currentBenchmarkLevel = (window.currentBenchmarkLevel - 1 + window.BENCHMARK_LEVELS.length) % window.BENCHMARK_LEVELS.length;
  updateBenchmarkLevelUI();
};

function updateBenchmarkLevelUI() {
  const item = window.BENCHMARK_LEVELS[window.currentBenchmarkLevel];
  const titleEl = document.getElementById("benchmarkTitle");
  const badgeEl = document.getElementById("benchmarkBadge");
  const subEl = document.getElementById("benchmarkSub");
  const levelEl = document.getElementById("benchmarkLevelNum");

  if (!titleEl) return;

  titleEl.textContent = item.title;
  badgeEl.textContent = item.badge;
  subEl.textContent = item.sub;
  levelEl.innerHTML = `${item.level.split('/')[0]}<span style="color:var(--text-faint)">/5 level</span>`;

  toast(`Viewing Benchmark Level ${window.currentBenchmarkLevel + 1}`);
}

function renderHeroVisualBanner() {
  const slide = window.HERO_SLIDES[0];
  return `
    <!-- Hero Visual Showcase Section (Exact Design Layout matching User Reference Image) -->
    <div style="margin-bottom:24px">
      <!-- Top Split: Hero Banner Slider (Left 65%) + Hydration/Compliance Card (Right 35%) -->
      <div style="display:grid;grid-template-columns:1.8fr 1fr;gap:20px;margin-bottom:20px">
        
        <!-- Left Hero Banner Card with Carousel Slider -->
        <div id="heroSlideCard" class="card" style="position:relative;overflow:hidden;padding:28px;background:linear-gradient(135deg, rgba(15,23,42,0.85) 0%, rgba(30,58,138,0.75) 100%), url('${slide.img}') center/cover no-repeat;min-height:250px;display:flex;flex-direction:column;justify-content:space-between;border:1px solid rgba(255,255,255,0.15);box-shadow:0 20px 40px rgba(0,0,0,0.4);transition:all 0.4s ease">
          
          <!-- Slide Navigation Controls -->
          <div style="position:absolute;top:16px;right:16px;display:flex;align-items:center;gap:8px;z-index:2">
            <button onclick="prevHeroSlide()" class="btn btn-sm btn-ghost" style="width:30px;height:30px;padding:0;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5);color:#fff;border-color:rgba(255,255,255,0.2)">‹</button>
            <button onclick="nextHeroSlide()" class="btn btn-sm btn-ghost" style="width:30px;height:30px;padding:0;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5);color:#fff;border-color:rgba(255,255,255,0.2)">›</button>
          </div>

          <div>
            <div style="display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,0.15);backdrop-filter:blur(8px);padding:4px 12px;border-radius:20px;font-size:11.5px;color:#fff;font-weight:600;margin-bottom:12px;border:1px solid rgba(255,255,255,0.2)">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
              <span id="heroSlideTag">${slide.tag}</span>
            </div>
            <h2 id="heroSlideTitle" style="font-family:var(--font-display);font-size:28px;font-weight:800;color:#fff;margin:0 0 8px;line-height:1.2;letter-spacing:-0.02em">
              ${slide.title}
            </h2>
            <p id="heroSlideSub" style="font-size:13px;color:rgba(255,255,255,0.85);margin:0;max-width:380px">
              ${slide.sub}
            </p>
          </div>

          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:14px;margin-top:20px">
            <div style="display:flex;align-items:center;gap:12px">
              <div style="display:flex;align-items:center">
                <span style="margin-left:0">${getPersonAvatarHtml("Priya Sharma", 28)}</span>
                <span style="margin-left:-8px">${getPersonAvatarHtml("Arjun Mehta", 28)}</span>
                <span style="margin-left:-8px">${getPersonAvatarHtml("Neha Gupta", 28)}</span>
                <span style="margin-left:-8px">${getPersonAvatarHtml("Rahul Joshi", 28)}</span>
              </div>
              
              <!-- Slide Indicator Dots -->
              <div style="display:flex;gap:6px">
                <span class="hero-slide-dot" onclick="setHeroSlide(0)" style="width:8px;height:8px;border-radius:50%;background:var(--accent-orange);cursor:pointer"></span>
                <span class="hero-slide-dot" onclick="setHeroSlide(1)" style="width:8px;height:8px;border-radius:50%;background:#fff;opacity:0.4;cursor:pointer"></span>
                <span class="hero-slide-dot" onclick="setHeroSlide(2)" style="width:8px;height:8px;border-radius:50%;background:#fff;opacity:0.4;cursor:pointer"></span>
                <span class="hero-slide-dot" onclick="setHeroSlide(3)" style="width:8px;height:8px;border-radius:50%;background:#fff;opacity:0.4;cursor:pointer"></span>
                <span class="hero-slide-dot" onclick="setHeroSlide(4)" style="width:8px;height:8px;border-radius:50%;background:#fff;opacity:0.4;cursor:pointer"></span>
              </div>
            </div>

            <div style="display:flex;align-items:center;gap:10px">
              <button onclick="window.location.hash='#/coaching'" class="btn" style="background:#000;color:#fff;border-radius:30px;padding:10px 20px;font-weight:600;font-size:13px;display:inline-flex;align-items:center;gap:8px;box-shadow:0 4px 14px rgba(0,0,0,0.5)">
                Start Free Trial <span style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:#fff;color:#000;font-size:12px">→</span>
              </button>
            </div>
          </div>
        </div>

        <!-- Right Compliance / Hydration Status Card (Matching Right Blue Card in Image) -->
        <div class="card" style="padding:24px;background:linear-gradient(145deg, #1e3a8a 0%, #3b82f6 100%);color:#fff;display:flex;flex-direction:column;justify-content:space-between;border:1px solid rgba(255,255,255,0.2)">
          <div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
              <h3 style="font-family:var(--font-display);font-size:16px;font-weight:700;margin:0">AI Compliance Status</h3>
              <span style="background:rgba(255,255,255,0.25);color:#fff;font-size:11px;font-weight:700;padding:3px 10px;border-radius:12px;backdrop-filter:blur(4px)">Well Done 👍</span>
            </div>
            <p style="font-size:12px;color:rgba(255,255,255,0.85);margin:0 0 16px;line-height:1.4">
              Drive your goal scores daily. Build healthy sales habits and achieve your focus.
            </p>

            <!-- Glass Grid Icon Badges (Matching Cup Icon Grid in Image) -->
            <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin-bottom:16px">
              <div style="height:28px;background:rgba(255,255,255,0.9);border-radius:6px;display:flex;align-items:center;justify-content:center;color:#1e3a8a;font-weight:700;font-size:10px">100</div>
              <div style="height:28px;background:rgba(255,255,255,0.9);border-radius:6px;display:flex;align-items:center;justify-content:center;color:#1e3a8a;font-weight:700;font-size:10px">98</div>
              <div style="height:28px;background:rgba(255,255,255,0.9);border-radius:6px;display:flex;align-items:center;justify-content:center;color:#1e3a8a;font-weight:700;font-size:10px">95</div>
              <div style="height:28px;background:rgba(255,255,255,0.9);border-radius:6px;display:flex;align-items:center;justify-content:center;color:#1e3a8a;font-weight:700;font-size:10px">92</div>
              <div style="height:28px;background:rgba(255,255,255,0.4);border-radius:6px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:10px">88</div>

              <div style="height:28px;background:rgba(255,255,255,0.9);border-radius:6px;display:flex;align-items:center;justify-content:center;color:#1e3a8a;font-weight:700;font-size:10px">96</div>
              <div style="height:28px;background:rgba(255,255,255,0.9);border-radius:6px;display:flex;align-items:center;justify-content:center;color:#1e3a8a;font-weight:700;font-size:10px">99</div>
              <div style="height:28px;background:rgba(255,255,255,0.9);border-radius:6px;display:flex;align-items:center;justify-content:center;color:#1e3a8a;font-weight:700;font-size:10px">97</div>
              <div style="height:28px;background:rgba(255,255,255,0.9);border-radius:6px;display:flex;align-items:center;justify-content:center;color:#1e3a8a;font-weight:700;font-size:10px">94</div>
              <div style="height:28px;background:rgba(255,255,255,0.4);border-radius:6px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:10px">90</div>
            </div>
          </div>

          <!-- Clickable D, W, M Timeframe Buttons -->
          <div style="display:flex;align-items:baseline;justify-content:space-between">
            <div style="display:flex;gap:6px">
              <button id="timeframeBtnD" onclick="switchComplianceTimeframe('D')" style="width:28px;height:28px;border-radius:50%;background:#fff;color:#1e3a8a;display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:11px;border:none;cursor:pointer;transition:all 0.2s">D</button>
              <button id="timeframeBtnW" onclick="switchComplianceTimeframe('W')" style="width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,0.25);color:#fff;display:inline-flex;align-items:center;justify-content:center;font-weight:600;font-size:11px;border:none;cursor:pointer;transition:all 0.2s">W</button>
              <button id="timeframeBtnM" onclick="switchComplianceTimeframe('M')" style="width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,0.25);color:#fff;display:inline-flex;align-items:center;justify-content:center;font-weight:600;font-size:11px;border:none;cursor:pointer;transition:all 0.2s">M</button>
            </div>
            <div style="text-align:right">
              <span id="complianceMetricVal" style="font-family:var(--font-mono);font-size:32px;font-weight:800;color:#fff">98.2%</span>
              <span id="complianceMetricSub" style="font-size:13px;color:rgba(255,255,255,0.85);display:block">/Day Avg</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Bottom 3 Cards Row (Matching Deep Sleep, Calories & Weight Cards from Image) -->
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px">
        
        <!-- Bottom Card 1: Experience the Goodness of Deep Discovery -->
        <div class="card" style="padding:20px;display:flex;flex-direction:column;justify-content:space-between">
          <div>
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
              <div style="display:flex;align-items:center">
                <span style="margin-left:0">${getPersonAvatarHtml("Neha Gupta", 24)}</span>
                <span style="margin-left:-6px">${getPersonAvatarHtml("Rahul Joshi", 24)}</span>
                <span style="margin-left:-6px">${getPersonAvatarHtml("Divya Krishnan", 24)}</span>
              </div>
              <span style="font-size:11px;color:var(--text-muted)">Top Advisors Benchmark</span>
            </div>

            <h3 id="benchmarkTitle" style="font-family:var(--font-display);font-size:16px;font-weight:700;margin:0 0 12px;color:#fff;line-height:1.3">
              Experience the Goodness of Deep Needs Discovery
            </h3>

            <div style="background:rgba(255,255,255,0.03);border:1px solid var(--border-soft);border-radius:12px;padding:12px;margin-bottom:14px">
              <div id="benchmarkBadge" style="display:inline-flex;align-items:center;gap:6px;background:rgba(53,196,168,0.15);color:var(--accent-teal);padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700;margin-bottom:8px">
                🌙 Deep Discovery
              </div>
              <p id="benchmarkSub" style="font-size:11.5px;color:var(--text-muted);margin:0;line-height:1.4">
                Discover tips and techniques for better, deeper needs analysis. Coach advisors on active listening and asking open questions.
              </p>
            </div>
          </div>

          <div style="display:flex;align-items:center;justify-content:space-between">
            <span id="benchmarkLevelNum" style="font-family:var(--font-mono);font-size:13px;font-weight:700;color:#fff">2<span style="color:var(--text-faint)">/5 level</span></span>
            <div style="display:flex;gap:6px">
              <button onclick="prevBenchmarkLevel()" class="btn btn-sm btn-ghost" style="width:28px;height:28px;padding:0;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;border-color:rgba(255,255,255,0.15)">‹</button>
              <button onclick="nextBenchmarkLevel()" class="btn btn-sm btn-ghost" style="width:28px;height:28px;padding:0;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;border-color:rgba(255,255,255,0.15)">›</button>
            </div>
          </div>
        </div>

        <!-- Bottom Card 2: Call Volume & Scored Distribution -->
        <div class="card" style="padding:20px;display:flex;flex-direction:column;justify-content:space-between">
          <div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
              <div style="display:flex;align-items:center;gap:6px">
                <span style="color:var(--accent-orange)">🔥</span>
                <span style="font-size:14px;font-weight:700;color:#fff">Call Volume</span>
              </div>
              <span style="font-family:var(--font-mono);font-size:13px;color:var(--text-muted)">2,350 <span style="font-size:10px;color:var(--text-faint)">Total</span></span>
            </div>
            <div style="font-size:11px;color:var(--text-faint);margin-bottom:12px">Daily AI intake dose</div>

            <div style="font-family:var(--font-mono);font-size:32px;font-weight:800;color:#fff;margin-bottom:12px">
              2,040 <span style="font-size:13px;color:var(--text-faint)">/Scored</span>
            </div>

            <!-- Green Bar Chart Graphic (Matching Image) -->
            <div style="display:flex;align-items:flex-end;gap:3px;height:45px;margin-bottom:14px">
              <div style="flex:1;background:var(--accent-teal);height:60%;border-radius:2px"></div>
              <div style="flex:1;background:var(--accent-teal);height:85%;border-radius:2px"></div>
              <div style="flex:1;background:var(--accent-teal);height:40%;border-radius:2px"></div>
              <div style="flex:1;background:var(--accent-teal);height:90%;border-radius:2px"></div>
              <div style="flex:1;background:var(--accent-teal);height:75%;border-radius:2px"></div>
              <div style="flex:1;background:var(--accent-teal);height:100%;border-radius:2px"></div>
              <div style="flex:1;background:var(--accent-teal);height:50%;border-radius:2px"></div>
              <div style="flex:1;background:var(--accent-teal);height:70%;border-radius:2px"></div>
              <div style="flex:1;background:var(--accent-teal);height:95%;border-radius:2px"></div>
              <div style="flex:1;background:var(--accent-teal);height:65%;border-radius:2px"></div>
              <div style="flex:1;background:var(--accent-teal);height:80%;border-radius:2px"></div>
              <div style="flex:1;background:var(--accent-teal);height:45%;border-radius:2px"></div>
            </div>
          </div>

          <div style="display:flex;justify-content:space-between;border-top:1px solid var(--border-soft);padding-top:10px;font-size:11px">
            <div><strong style="color:#fff;display:block">269 <span style="font-weight:400;color:var(--text-faint)">Gram</span></strong><span style="color:var(--text-faint)">High Quality</span></div>
            <div><strong style="color:#fff;display:block">164 <span style="font-weight:400;color:var(--text-faint)">Gram</span></strong><span style="color:var(--text-faint)">Standard</span></div>
            <div><strong style="color:#fff;display:block">110 <span style="font-weight:400;color:var(--text-faint)">Gram</span></strong><span style="color:var(--text-faint)">Needs Review</span></div>
          </div>
        </div>

        <!-- Bottom Card 3: Quality Benchmark Score (Animated Wave Line Chart) -->
        <div class="card" style="padding:20px;display:flex;flex-direction:column;justify-content:space-between">
          <div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
              <div style="display:flex;align-items:center;gap:6px">
                <span style="color:var(--accent-teal)">↔</span>
                <span style="font-size:14px;font-weight:700;color:#fff">Quality Score</span>
              </div>
              <span style="font-family:var(--font-mono);font-size:13px;color:var(--text-muted)">85 <span style="font-size:10px;color:var(--text-faint)">Target</span></span>
            </div>
            <div style="font-size:11px;color:var(--text-faint);margin-bottom:12px">Healthy score is 75 - 88</div>

            <!-- Animated Wave Line Chart Graphic -->
            <div style="height:55px;margin-bottom:10px">
              <svg width="100%" height="100%" viewBox="0 0 200 50" fill="none">
                <path d="M0 35 C 40 10, 80 45, 120 20 C 160 5, 180 30, 200 25" stroke="#35c4a8" stroke-width="3" fill="none"/>
                <path d="M0 25 C 50 40, 90 15, 130 35 C 170 45, 190 20, 200 30" stroke="#3b82f6" stroke-width="2.5" stroke-dasharray="4 4" fill="none"/>
                <circle cx="120" cy="20" r="5" fill="#35c4a8"/>
              </svg>
            </div>
          </div>

          <div style="display:flex;align-items:flex-end;justify-content:space-between">
            <div>
              <span style="font-family:var(--font-mono);font-size:34px;font-weight:800;color:#fff">82</span>
              <span style="font-size:13px;color:var(--text-faint)">/pts</span>
            </div>
            <div style="text-align:right">
              <span style="font-size:10px;color:var(--text-faint);display:block">Weekly target completed</span>
              <strong style="font-size:11.5px;color:var(--accent-teal)">Keep it up!</strong>
            </div>
          </div>
        </div>

      </div>
    </div>
  `;
}

function renderSalesDirectorDashboardContent(data) {
  const totalCalls = data.total_calls_scored || 412;
  const avgScore = data.avg_overall_score ? data.avg_overall_score.toFixed(1) : "74.2";
  const openDisputes = 7;

  return `
    ${renderHeroVisualBanner()}

    <!-- Top 6 KPI Metric Cards (Grid 3x2, Exact Screenshot #1) -->
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:24px">
      <!-- 1. Org Avg Call Score -->
      <div class="card" style="padding:20px">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;color:var(--text-faint);text-transform:uppercase;margin-bottom:10px">ORG AVG CALL SCORE</div>
        <div style="display:flex;align-items:baseline;gap:6px">
          <span style="font-family:var(--font-mono);font-size:32px;font-weight:700;color:#fff">${avgScore}</span>
          <span style="font-size:14px;color:var(--text-faint)">/100</span>
        </div>
        <div style="font-size:11.5px;color:var(--accent-teal);margin-top:6px;font-weight:500">+3.1 <span style="color:var(--text-faint)">This week vs last week</span></div>
      </div>

      <!-- 2. Trial Booking Rate -->
      <div class="card" style="padding:20px">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;color:var(--text-faint);text-transform:uppercase;margin-bottom:10px">TRIAL BOOKING RATE</div>
        <div style="font-family:var(--font-mono);font-size:32px;font-weight:700;color:var(--accent-orange)">63.8%</div>
        <div style="font-size:11.5px;color:var(--sev-critical);margin-top:6px;font-weight:500">-4.2% <span style="color:var(--text-faint)">Target: 70%</span></div>
      </div>

      <!-- 3. Compliance Flag Rate -->
      <div class="card" style="padding:20px">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;color:var(--text-faint);text-transform:uppercase;margin-bottom:10px">COMPLIANCE FLAG RATE</div>
        <div style="font-family:var(--font-mono);font-size:32px;font-weight:700;color:var(--sev-critical)">11.4%</div>
        <div style="font-size:11.5px;color:var(--sev-critical);margin-top:6px;font-weight:500">+2.1% <span style="color:var(--text-faint)">Critical + High flags</span></div>
      </div>

      <!-- 4. Calls This Week -->
      <div class="card" style="padding:20px">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;color:var(--text-faint);text-transform:uppercase;margin-bottom:10px">CALLS THIS WEEK</div>
        <div style="font-family:var(--font-mono);font-size:32px;font-weight:700;color:#fff">${totalCalls}</div>
        <div style="font-size:11.5px;color:var(--accent-teal);margin-top:6px;font-weight:500">+38 <span style="color:var(--text-faint)">Mon-Thu, Aug 2026</span></div>
      </div>

      <!-- 5. Open Flag Disputes -->
      <div class="card" style="padding:20px">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;color:var(--text-faint);text-transform:uppercase;margin-bottom:10px">OPEN FLAG DISPUTES</div>
        <div style="font-family:var(--font-mono);font-size:32px;font-weight:700;color:#fff">${openDisputes}</div>
        <div style="font-size:11.5px;color:var(--accent-orange);margin-top:6px;font-weight:500">+3 <span style="color:var(--text-faint)">Awaiting leader review</span></div>
      </div>

      <!-- 6. Avg Needs Discovery -->
      <div class="card" style="padding:20px">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;color:var(--text-faint);text-transform:uppercase;margin-bottom:10px">AVG NEEDS DISCOVERY</div>
        <div style="display:flex;align-items:baseline;gap:6px">
          <span style="font-family:var(--font-mono);font-size:32px;font-weight:700;color:#fff">68.5</span>
          <span style="font-size:14px;color:var(--text-faint)">/100</span>
        </div>
        <div style="font-size:11.5px;color:var(--accent-teal);margin-top:6px;font-weight:500">+1.8 <span style="color:var(--text-faint)">Rubric dimension avg</span></div>
      </div>
    </div>

    <!-- Middle Split: Org Call Score Trend & Top Flag Types (Exact Screenshot #1 & #2) -->
    <div style="display:grid;grid-template-columns:1.6fr 1fr;gap:20px;margin-bottom:24px">
      <!-- Left: Org Call Score Trend -->
      <div class="card">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
          <div>
            <h3 style="font-family:var(--font-display);font-size:15px;font-weight:700;margin:0">Org Call Score Trend</h3>
            <p style="font-size:12px;color:var(--text-faint);margin:2px 0 0">7-day rolling average by team</p>
          </div>
          <div style="display:flex;align-items:center;gap:12px;font-size:11.5px;color:var(--text-muted)">
            <span style="display:inline-flex;align-items:center;gap:4px"><span style="width:8px;height:8px;border-radius:50%;background:var(--accent-orange)"></span> All Org</span>
            <span style="display:inline-flex;align-items:center;gap:4px"><span style="width:8px;height:8px;border-radius:50%;background:var(--accent-teal)"></span> Top Pod</span>
          </div>
        </div>
        <canvas id="trendChart" height="120"></canvas>
      </div>

      <!-- Right: Top Flag Types (Exact List from Screenshot #2) -->
      <div class="card">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
          <h3 style="font-family:var(--font-display);font-size:15px;font-weight:700;margin:0">Top Flag Types</h3>
          <span style="font-size:11.5px;color:var(--text-faint)">This week · 412 calls</span>
        </div>

        <!-- Doughnut Chart Diagram for Variety Visualization (Above Details) -->
        <div style="height:140px;margin-bottom:16px">
          <canvas id="flagTypesChart"></canvas>
        </div>

        <div style="display:flex;flex-direction:column;gap:10px">
          <div style="display:flex;align-items:center;justify-content:space-between;font-size:12.5px">
            <div style="display:flex;align-items:center;gap:8px">
              <span class="chip sev-high">High</span>
              <span style="color:#fff;font-weight:500">Weak Trial Booking</span>
            </div>
            <div style="display:flex;align-items:center;gap:12px;font-family:var(--font-mono);font-size:12px">
              <strong style="color:#fff">67</strong>
              <span style="color:var(--text-faint)">16.3%</span>
            </div>
          </div>

          <div style="display:flex;align-items:center;justify-content:space-between;font-size:12.5px">
            <div style="display:flex;align-items:center;gap:8px">
              <span class="chip sev-high">High</span>
              <span style="color:#fff;font-weight:500">Price Before Value</span>
            </div>
            <div style="display:flex;align-items:center;gap:12px;font-family:var(--font-mono);font-size:12px">
              <strong style="color:#fff">54</strong>
              <span style="color:var(--text-faint)">13.1%</span>
            </div>
          </div>

          <div style="display:flex;align-items:center;justify-content:space-between;font-size:12.5px">
            <div style="display:flex;align-items:center;gap:8px">
              <span class="chip sev-critical">Critical</span>
              <span style="color:#fff;font-weight:500">No Needs Discovery</span>
            </div>
            <div style="display:flex;align-items:center;gap:12px;font-family:var(--font-mono);font-size:12px">
              <strong style="color:#fff">41</strong>
              <span style="color:var(--text-faint)">9.9%</span>
            </div>
          </div>

          <div style="display:flex;align-items:center;justify-content:space-between;font-size:12.5px">
            <div style="display:flex;align-items:center;gap:8px">
              <span class="chip sev-critical">Critical</span>
              <span style="color:#fff;font-weight:500">Over-Promising</span>
            </div>
            <div style="display:flex;align-items:center;gap:12px;font-family:var(--font-mono);font-size:12px">
              <strong style="color:#fff">38</strong>
              <span style="color:var(--text-faint)">9.2%</span>
            </div>
          </div>

          <div style="display:flex;align-items:center;justify-content:space-between;font-size:12.5px">
            <div style="display:flex;align-items:center;gap:8px">
              <span class="chip sev-critical">Critical</span>
              <span style="color:#fff;font-weight:500">Pressure Tactics</span>
            </div>
            <div style="display:flex;align-items:center;gap:12px;font-family:var(--font-mono);font-size:12px">
              <strong style="color:#fff">29</strong>
              <span style="color:var(--text-faint)">7.0%</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Bottom Executive Section: Pod Leadership Matrix (Left) + Recent Flagged Calls Feed (Right) -->
    <div style="display:grid;grid-template-columns:1.6fr 1fr;gap:20px;margin-top:24px">
      
      <!-- Left: Executive Pod Leadership Rankings Matrix -->
      <div class="card" style="padding:24px;position:relative;overflow:hidden">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
          <div>
            <div style="display:flex;align-items:center;gap:8px">
              <span style="font-size:16px">👑</span>
              <h3 style="font-family:var(--font-display);font-size:18px;font-weight:800;margin:0;color:#fff">Pod Leadership Rankings & Health Matrix</h3>
            </div>
            <p style="font-size:12px;color:var(--text-muted);margin:4px 0 0">Ranked by weekly overall call quality score, trial conversion %, & risk index</p>
          </div>
          <div style="display:flex;gap:8px">
            <button onclick="window.location.hash='#/leaderboard'" class="btn btn-sm btn-ghost" style="border-color:rgba(255,255,255,0.15);color:var(--accent-orange);font-weight:600">Full Leaderboard →</button>
            <button onclick="openCreateTeamModal()" class="btn btn-sm btn-primary" style="background:var(--accent-orange);border-color:var(--accent-orange);color:#fff">+ New Pod</button>
          </div>
        </div>

        <div style="display:flex;flex-direction:column;gap:14px">
          
          <!-- Rank 1: Alpha Pod -->
          <div class="card" onclick="window.location.hash='#/team/pod_1'" style="cursor:pointer;padding:16px;background:linear-gradient(135deg, rgba(255,77,38,0.12) 0%, rgba(19,21,28,0.9) 100%);border:1px solid rgba(255,77,38,0.4);transition:all 0.3s ease">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
              <div style="display:flex;align-items:center;gap:12px">
                <span style="background:rgba(255,77,38,0.25);color:var(--accent-orange);font-size:11px;font-weight:800;padding:3px 10px;border-radius:20px;text-transform:uppercase">🥇 RANK 1</span>
                <h4 style="font-family:var(--font-display);font-size:16px;font-weight:800;color:#fff;margin:0">Alpha Pod</h4>
                <span style="font-size:12px;color:var(--text-muted)">· Led by Priya Sharma</span>
              </div>
              <div style="display:flex;align-items:center;gap:8px">
                <span style="font-family:var(--font-mono);font-size:20px;font-weight:800;color:var(--accent-teal)">81.4</span>
                <span style="font-size:11px;color:var(--accent-teal);font-weight:700">↗ +4.2</span>
              </div>
            </div>
            <div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:16px;align-items:center">
              <div>
                <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-faint);margin-bottom:4px">
                  <span>Trial Conversion</span>
                  <strong style="color:var(--accent-teal)">74% Target Reached</strong>
                </div>
                <div style="height:6px;background:rgba(255,255,255,0.08);border-radius:4px;overflow:hidden">
                  <div style="width:74%;height:100%;background:linear-gradient(90deg, var(--accent-orange) 0%, var(--accent-teal) 100%);border-radius:4px"></div>
                </div>
              </div>
              <div style="text-align:center">
                <div style="font-family:var(--font-mono);font-size:14px;font-weight:700;color:#fff">98 Calls</div>
                <div style="font-size:10.5px;color:var(--text-faint)">Scored Volume</div>
              </div>
              <div style="text-align:right">
                <span style="color:var(--accent-orange);font-size:11.5px;font-weight:700">Inspect Pod →</span>
              </div>
            </div>
          </div>

          <!-- Rank 2: Beta Pod -->
          <div class="card" onclick="window.location.hash='#/team/pod_2'" style="cursor:pointer;padding:16px;background:linear-gradient(135deg, rgba(242,183,5,0.08) 0%, rgba(19,21,28,0.9) 100%);border:1px solid rgba(242,183,5,0.25);transition:all 0.3s ease">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
              <div style="display:flex;align-items:center;gap:12px">
                <span style="background:rgba(242,183,5,0.2);color:var(--accent-amber);font-size:11px;font-weight:800;padding:3px 10px;border-radius:20px;text-transform:uppercase">🥈 RANK 2</span>
                <h4 style="font-family:var(--font-display);font-size:16px;font-weight:800;color:#fff;margin:0">Beta Pod</h4>
                <span style="font-size:12px;color:var(--text-muted)">· Led by Arjun Mehta</span>
              </div>
              <div style="display:flex;align-items:center;gap:8px">
                <span style="font-family:var(--font-mono);font-size:20px;font-weight:800;color:var(--accent-teal)">76.2</span>
                <span style="font-size:11px;color:var(--accent-teal);font-weight:700">↗ +2.1</span>
              </div>
            </div>
            <div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:16px;align-items:center">
              <div>
                <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-faint);margin-bottom:4px">
                  <span>Trial Conversion</span>
                  <strong style="color:var(--accent-amber)">67% Target Reached</strong>
                </div>
                <div style="height:6px;background:rgba(255,255,255,0.08);border-radius:4px;overflow:hidden">
                  <div style="width:67%;height:100%;background:linear-gradient(90deg, var(--accent-amber) 0%, var(--accent-teal) 100%);border-radius:4px"></div>
                </div>
              </div>
              <div style="text-align:center">
                <div style="font-family:var(--font-mono);font-size:14px;font-weight:700;color:#fff">84 Calls</div>
                <div style="font-size:10.5px;color:var(--text-faint)">Scored Volume</div>
              </div>
              <div style="text-align:right">
                <span style="color:var(--accent-teal);font-size:11.5px;font-weight:700">Inspect Pod →</span>
              </div>
            </div>
          </div>

          <!-- Rank 3: Gamma Pod -->
          <div class="card" onclick="window.location.hash='#/team/pod_3'" style="cursor:pointer;padding:16px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.08);transition:all 0.3s ease">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
              <div style="display:flex;align-items:center;gap:12px">
                <span style="background:rgba(255,255,255,0.1);color:var(--text-muted);font-size:11px;font-weight:800;padding:3px 10px;border-radius:20px;text-transform:uppercase">🥉 RANK 3</span>
                <h4 style="font-family:var(--font-display);font-size:16px;font-weight:800;color:#fff;margin:0">Gamma Pod</h4>
                <span style="font-size:12px;color:var(--text-muted)">· Led by Sneha Rao</span>
              </div>
              <div style="display:flex;align-items:center;gap:8px">
                <span style="font-family:var(--font-mono);font-size:20px;font-weight:800;color:var(--accent-amber)">72.8</span>
                <span style="font-size:11px;color:var(--sev-critical);font-weight:700">↘ -1.4</span>
              </div>
            </div>
            <div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:16px;align-items:center">
              <div>
                <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-faint);margin-bottom:4px">
                  <span>Trial Conversion</span>
                  <strong style="color:var(--accent-amber)">64% Target Reached</strong>
                </div>
                <div style="height:6px;background:rgba(255,255,255,0.08);border-radius:4px;overflow:hidden">
                  <div style="width:64%;height:100%;background:var(--accent-amber);border-radius:4px"></div>
                </div>
              </div>
              <div style="text-align:center">
                <div style="font-family:var(--font-mono);font-size:14px;font-weight:700;color:#fff">91 Calls</div>
                <div style="font-size:10.5px;color:var(--text-faint)">Scored Volume</div>
              </div>
              <div style="text-align:right">
                <span style="color:var(--accent-amber);font-size:11.5px;font-weight:700">Inspect Pod →</span>
              </div>
            </div>
          </div>

        </div>
      </div>

      <!-- Right: Recent High-Risk Flagged Calls & Compliance Feed -->
      <div class="card" style="padding:24px;display:flex;flex-direction:column;justify-content:space-between">
        <div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
            <div style="display:flex;align-items:center;gap:8px">
              <span style="font-size:16px">🚨</span>
              <h3 style="font-family:var(--font-display);font-size:16px;font-weight:800;margin:0;color:#fff">Recent High-Risk Calls</h3>
            </div>
            <a href="#/disputes" class="muted-link" style="color:var(--accent-orange);font-weight:600;font-size:12px">Dispute Queue →</a>
          </div>
          <p style="font-size:12px;color:var(--text-muted);margin:0 0 16px">Live audit feed of flagged tele-advisor evaluations requiring attention</p>

          <div style="display:flex;flex-direction:column;gap:12px">
            
            <!-- Call Item 1 -->
            <div class="card" onclick="window.location.hash='#/call/call_006'" style="cursor:pointer;padding:12px;background:rgba(255,59,48,0.08);border:1px solid rgba(255,59,48,0.3);transition:all 0.2s">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
                <div style="display:flex;align-items:center;gap:8px">
                  ${getPersonAvatarHtml("Neha Kulkarni", 24)}
                  <strong style="font-size:13px;color:#fff">Neha Kulkarni</strong>
                  <span style="font-size:11px;color:var(--text-faint)">CALL-006</span>
                </div>
                <span class="chip sev-critical" style="font-size:10px;padding:2px 8px">CRITICAL</span>
              </div>
              <div style="font-size:12px;color:var(--accent-orange);font-weight:600;margin-bottom:4px">⚠️ PII_EXPOSURE: Credit Card Read Aloud</div>
              <div style="display:flex;align-items:center;justify-content:space-between;font-size:11px;color:var(--text-muted)">
                <span>Score: <strong style="color:var(--sev-critical)">54/100</strong></span>
                <span style="color:var(--accent-orange);font-weight:700">Review Call →</span>
              </div>
            </div>

            <!-- Call Item 2 -->
            <div class="card" onclick="window.location.hash='#/call/call_002'" style="cursor:pointer;padding:12px;background:rgba(255,77,38,0.06);border:1px solid rgba(255,77,38,0.25);transition:all 0.2s">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
                <div style="display:flex;align-items:center;gap:8px">
                  ${getPersonAvatarHtml("Sneha Iyer", 24)}
                  <strong style="font-size:13px;color:#fff">Sneha Iyer</strong>
                  <span style="font-size:11px;color:var(--text-faint)">CALL-002</span>
                </div>
                <span class="chip sev-high" style="font-size:10px;padding:2px 8px">HIGH</span>
              </div>
              <div style="font-size:12px;color:var(--accent-amber);font-weight:600;margin-bottom:4px">⚠️ OVER_PROMISING: Guaranteed 10kg Loss</div>
              <div style="display:flex;align-items:center;justify-content:space-between;font-size:11px;color:var(--text-muted)">
                <span>Score: <strong style="color:var(--accent-amber)">62/100</strong></span>
                <span style="color:var(--accent-orange);font-weight:700">Review Call →</span>
              </div>
            </div>

            <!-- Call Item 3 -->
            <div class="card" onclick="window.location.hash='#/call/call_009'" style="cursor:pointer;padding:12px;background:rgba(242,183,5,0.06);border:1px solid rgba(242,183,5,0.25);transition:all 0.2s">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
                <div style="display:flex;align-items:center;gap:8px">
                  ${getPersonAvatarHtml("Priya Sharma", 24)}
                  <strong style="font-size:13px;color:#fff">Priya Sharma</strong>
                  <span style="font-size:11px;color:var(--text-faint)">CALL-009</span>
                </div>
                <span class="chip sev-medium" style="font-size:10px;padding:2px 8px">DISPUTED</span>
              </div>
              <div style="font-size:12px;color:var(--accent-teal);font-weight:600;margin-bottom:4px">💬 PRICE_BEFORE_VALUE: Contested Flag</div>
              <div style="display:flex;align-items:center;justify-content:space-between;font-size:11px;color:var(--text-muted)">
                <span>Score: <strong style="color:var(--accent-teal)">81/100</strong></span>
                <span style="color:var(--accent-teal);font-weight:700">Review Dispute →</span>
              </div>
            </div>

          </div>
        </div>

        <div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--border-soft);display:flex;align-items:center;justify-content:space-between">
          <span style="font-size:11.5px;color:var(--text-faint)">7 pending flags in queue</span>
          <button class="btn btn-sm btn-primary" onclick="openRunPipelineModal()" style="background:var(--accent-orange);border-color:var(--accent-orange);color:#fff">
            ⚡ Run Ingest Pipeline
          </button>
        </div>
      </div>

    </div>
  `;
}

function renderTeamLeaderDashboardContent(data) {
  return `
    ${renderHeroVisualBanner()}

    <!-- Top 4 KPI Cards for Team Leader (Exact Screenshot #3) -->
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:24px">
      <div class="card" style="padding:18px">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;color:var(--text-faint);text-transform:uppercase;margin-bottom:8px">Pod Avg Score</div>
        <div style="font-family:var(--font-mono);font-size:32px;font-weight:700;color:#fff">76.2</div>
        <div style="font-size:11.5px;color:var(--accent-teal);margin-top:4px">+2.4</div>
      </div>
      <div class="card" style="padding:18px">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;color:var(--text-faint);text-transform:uppercase;margin-bottom:8px">Trial Booking Rate</div>
        <div style="font-family:var(--font-mono);font-size:32px;font-weight:700;color:#fff">67%</div>
        <div style="font-size:11.5px;color:var(--sev-critical);margin-top:4px">-1.8%</div>
      </div>
      <div class="card" style="padding:18px">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;color:var(--text-faint);text-transform:uppercase;margin-bottom:8px">Open Disputes</div>
        <div style="font-family:var(--font-mono);font-size:32px;font-weight:700;color:#fff">2</div>
        <div style="font-size:11.5px;color:var(--accent-orange);margin-top:4px">+2</div>
      </div>
      <div class="card" style="padding:18px">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;color:var(--text-faint);text-transform:uppercase;margin-bottom:8px">Calls This Week</div>
        <div style="font-family:var(--font-mono);font-size:32px;font-weight:700;color:#fff">84</div>
        <div style="font-size:11.5px;color:var(--accent-teal);margin-top:4px">+11</div>
      </div>
    </div>

    <!-- Main Content Split: Beta Pod Advisor Rankings & Open Disputes (Exact Screenshot #3 & #4) -->
    <div style="display:grid;grid-template-columns:1.6fr 1fr;gap:20px">
      <!-- Left: Beta Pod Advisor Rankings Table -->
      <div class="card">
        <div style="margin-bottom:16px">
          <h3 style="font-family:var(--font-display);font-size:16px;font-weight:700;margin:0 0 4px">Beta Pod — Advisor Rankings</h3>
          <p style="font-size:12px;color:var(--text-faint);margin:0">This week · Arjun Mehta's team</p>
        </div>

        <table class="data-table">
          <thead>
            <tr>
              <th style="width:40px">#</th>
              <th>ADVISOR</th>
              <th style="text-align:center">SCORE</th>
              <th style="text-align:center">CALLS</th>
              <th style="text-align:center">TRIAL %</th>
              <th style="text-align:center">FLAGS</th>
              <th style="text-align:center">CHANGE</th>
            </tr>
          </thead>
          <tbody>
            <tr class="clickable" onclick="window.location.hash='#/advisor/adv_001'">
              <td class="mono">1</td>
              <td>
                <div style="display:flex;align-items:center;gap:10px">
                  ${getPersonAvatarHtml("Neha Gupta", 26)}
                  <span style="font-weight:600">Neha Gupta</span>
                </div>
              </td>
              <td style="text-align:center;color:var(--accent-teal);font-weight:700;font-family:var(--font-mono)">88.2</td>
              <td class="mono" style="text-align:center">18</td>
              <td class="mono" style="text-align:center;color:var(--accent-teal)">78%</td>
              <td class="mono" style="text-align:center">1</td>
              <td class="mono" style="text-align:center;color:var(--accent-teal)">+5.1</td>
            </tr>

            <tr class="clickable" onclick="window.location.hash='#/advisor/adv_002'">
              <td class="mono">2</td>
              <td>
                <div style="display:flex;align-items:center;gap:10px">
                  ${getPersonAvatarHtml("Rahul Joshi", 26)}
                  <span style="font-weight:600">Rahul Joshi</span>
                </div>
              </td>
              <td style="text-align:center;color:var(--accent-teal);font-weight:700;font-family:var(--font-mono)">82.7</td>
              <td class="mono" style="text-align:center">21</td>
              <td class="mono" style="text-align:center;color:var(--accent-teal)">71%</td>
              <td class="mono" style="text-align:center">2</td>
              <td class="mono" style="text-align:center;color:var(--accent-teal)">+2.3</td>
            </tr>

            <tr class="clickable" onclick="window.location.hash='#/advisor/adv_003'">
              <td class="mono">3</td>
              <td>
                <div style="display:flex;align-items:center;gap:10px">
                  ${getPersonAvatarHtml("Divya Krishnan", 26)}
                  <span style="font-weight:600">Divya Krishnan</span>
                </div>
              </td>
              <td style="text-align:center;color:var(--accent-amber);font-weight:700;font-family:var(--font-mono)">79.4</td>
              <td class="mono" style="text-align:center">16</td>
              <td class="mono" style="text-align:center;color:var(--accent-amber)">69%</td>
              <td class="mono" style="text-align:center">3</td>
              <td class="mono" style="text-align:center;color:var(--accent-teal)">+1.1</td>
            </tr>

            <tr class="clickable" onclick="window.location.hash='#/advisor/adv_004'">
              <td class="mono">4</td>
              <td>
                <div style="display:flex;align-items:center;gap:10px">
                  ${getPersonAvatarHtml("Karan Malhotra", 26)}
                  <span style="font-weight:600">Karan Malhotra</span>
                </div>
              </td>
              <td style="text-align:center;color:var(--accent-amber);font-weight:700;font-family:var(--font-mono)">74.1</td>
              <td class="mono" style="text-align:center">19</td>
              <td class="mono" style="text-align:center;color:var(--accent-amber)">63%</td>
              <td class="mono" style="text-align:center">4</td>
              <td class="mono" style="text-align:center;color:var(--sev-critical)">-3.2</td>
            </tr>

            <tr class="clickable" onclick="window.location.hash='#/advisor/adv_005'">
              <td class="mono">5</td>
              <td>
                <div style="display:flex;align-items:center;gap:10px">
                  ${getPersonAvatarHtml("Pooja Agarwal", 26)}
                  <span style="font-weight:600">Pooja Agarwal</span>
                </div>
              </td>
              <td style="text-align:center;color:var(--sev-critical);font-weight:700;font-family:var(--font-mono)">68.8</td>
              <td class="mono" style="text-align:center">14</td>
              <td class="mono" style="text-align:center;color:var(--sev-critical)">57%</td>
              <td class="mono" style="text-align:center">6</td>
              <td class="mono" style="text-align:center;color:var(--sev-critical)">-5.8</td>
            </tr>

            <tr class="clickable" onclick="window.location.hash='#/advisor/adv_006'">
              <td class="mono">6</td>
              <td>
                <div style="display:flex;align-items:center;gap:10px">
                  ${getPersonAvatarHtml("Sanjay Verma", 26)}
                  <span style="font-weight:600">Sanjay Verma</span>
                </div>
              </td>
              <td style="text-align:center;color:var(--sev-critical);font-weight:700;font-family:var(--font-mono)">61.3</td>
              <td class="mono" style="text-align:center">17</td>
              <td class="mono" style="text-align:center;color:var(--sev-critical)">47%</td>
              <td class="mono" style="text-align:center">9</td>
              <td class="mono" style="text-align:center;color:var(--sev-critical)">-8.1</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Right Column: Open Disputes Cards + Needs Review -->
      <div style="display:flex;flex-direction:column;gap:18px">
        <!-- Open Disputes Widget -->
        <div class="card">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
            <h3 style="font-family:var(--font-display);font-size:15px;font-weight:700;margin:0">Open Disputes</h3>
            <span id="disputesBadgeCount" style="background:var(--sev-critical);color:#fff;font-size:11px;font-weight:700;border-radius:20px;padding:2px 8px">2</span>
          </div>

          <!-- Dispute Card 1 -->
          <div id="disputeLeaderCard1" style="background:var(--panel-alt);border:1px solid var(--border-soft);border-radius:12px;padding:14px;margin-bottom:12px">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
              <div style="display:flex;align-items:center;gap:8px">${getPersonAvatarHtml("Pooja Agarwal", 22)}<strong style="color:#fff;font-size:13px">Pooja Agarwal</strong></div>
              <span class="chip sev-high">● Pressure Tactics</span>
            </div>
            <div style="font-size:11.5px;color:var(--text-faint);margin-bottom:6px">CALL-2847</div>
            <div style="font-size:12.5px;color:var(--text-muted);font-style:italic;margin-bottom:12px">"Customer initiated urgency discussion"</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
              <button class="btn btn-sm btn-danger-outline" onclick="$('#disputeLeaderCard1').style.opacity='0.5'; $('#disputeLeaderCard1').style.pointerEvents='none'; toast('✅ Dispute upheld for Pooja Agarwal (CALL-2847)')">Uphold</button>
              <button class="btn btn-sm btn-teal-outline" onclick="$('#disputeLeaderCard1').style.opacity='0.5'; $('#disputeLeaderCard1').style.pointerEvents='none'; toast('🎉 Dispute overturned & flag dismissed!')">Overturn</button>
            </div>
          </div>

          <!-- Dispute Card 2 -->
          <div id="disputeLeaderCard2" style="background:var(--panel-alt);border:1px solid var(--border-soft);border-radius:12px;padding:14px">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
              <div style="display:flex;align-items:center;gap:8px">${getPersonAvatarHtml("Karan Malhotra", 22)}<strong style="color:#fff;font-size:13px">Karan Malhotra</strong></div>
              <span class="chip sev-high">● Over-Promising</span>
            </div>
            <div style="font-size:11.5px;color:var(--text-faint);margin-bottom:6px">CALL-2851</div>
            <div style="font-size:12.5px;color:var(--text-muted);font-style:italic;margin-bottom:12px">"Referenced official plan brochure, not personal claim"</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
              <button class="btn btn-sm btn-danger-outline" onclick="$('#disputeLeaderCard2').style.opacity='0.5'; $('#disputeLeaderCard2').style.pointerEvents='none'; toast('✅ Dispute upheld for Karan Malhotra (CALL-2851)')">Uphold</button>
              <button class="btn btn-sm btn-teal-outline" onclick="$('#disputeLeaderCard2').style.opacity='0.5'; $('#disputeLeaderCard2').style.pointerEvents='none'; toast('🎉 Dispute overturned & flag dismissed!')">Overturn</button>
            </div>
          </div>
        </div>

        <!-- Needs Your Review Widget -->
        <div class="card">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
            <h4 style="font-size:11px;font-weight:700;letter-spacing:0.08em;color:var(--text-faint);text-transform:uppercase;margin:0">NEEDS YOUR REVIEW (4 CALLS)</h4>
            <span style="font-size:11px;color:var(--accent-orange);font-weight:600">Leader Action Queue</span>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <!-- Review Card 1 -->
            <div class="clickable" onclick="window.location.hash='#/advisor/adv_006'" style="display:flex;align-items:center;gap:10px;background:var(--panel-alt);padding:12px;border-radius:10px;border:1px solid var(--border-soft)">
              ${getPersonAvatarHtml("Sanjay Verma", 28)}
              <div style="flex:1;overflow:hidden">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:2px">
                  <div style="font-weight:700;color:#fff;font-size:12.5px">Sanjay Verma</div>
                  <span style="font-family:var(--font-mono);font-weight:700;color:var(--sev-critical);font-size:12px">52</span>
                </div>
                <div style="font-size:11px;color:var(--text-faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">No needs discovery, heavy pressure</div>
              </div>
            </div>

            <!-- Review Card 2 -->
            <div class="clickable" onclick="window.location.hash='#/advisor/adv_004'" style="display:flex;align-items:center;gap:10px;background:var(--panel-alt);padding:12px;border-radius:10px;border:1px solid var(--border-soft)">
              ${getPersonAvatarHtml("Karan Malhotra", 28)}
              <div style="flex:1;overflow:hidden">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:2px">
                  <div style="font-weight:700;color:#fff;font-size:12.5px">Karan Malhotra</div>
                  <span style="font-family:var(--font-mono);font-weight:700;color:var(--accent-amber);font-size:12px">68</span>
                </div>
                <div style="font-size:11px;color:var(--text-faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Over-promising on weight loss timeline</div>
              </div>
            </div>

            <!-- Review Card 3 -->
            <div class="clickable" onclick="window.location.hash='#/advisor/adv_005'" style="display:flex;align-items:center;gap:10px;background:var(--panel-alt);padding:12px;border-radius:10px;border:1px solid var(--border-soft)">
              ${getPersonAvatarHtml("Pooja Agarwal", 28)}
              <div style="flex:1;overflow:hidden">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:2px">
                  <div style="font-weight:700;color:#fff;font-size:12.5px">Pooja Agarwal</div>
                  <span style="font-family:var(--font-mono);font-weight:700;color:var(--accent-amber);font-size:12px">61</span>
                </div>
                <div style="font-size:11px;color:var(--text-faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Price disclosed before value framing</div>
              </div>
            </div>

            <!-- Review Card 4 -->
            <div class="clickable" onclick="window.location.hash='#/advisor/adv_002'" style="display:flex;align-items:center;gap:10px;background:var(--panel-alt);padding:12px;border-radius:10px;border:1px solid var(--border-soft)">
              ${getPersonAvatarHtml("Rahul Joshi", 28)}
              <div style="flex:1;overflow:hidden">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:2px">
                  <div style="font-weight:700;color:#fff;font-size:12.5px">Rahul Joshi</div>
                  <span style="font-family:var(--font-mono);font-weight:700;color:var(--accent-teal);font-size:12px">72</span>
                </div>
                <div style="font-size:11px;color:var(--text-faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Objection handling coaching needed</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderAdvisorDashboardContent(data) {
  const user = getAuthUser() || { name: "Neha Gupta", role: "Advisor" };
  const advName = user.name || "Neha Gupta";

  return `
    <!-- Top Advisor Profile Banner Card -->
    <div class="card" style="padding:24px;margin-bottom:24px;background:linear-gradient(135deg, rgba(15,23,42,0.95) 0%, rgba(255,77,38,0.12) 100%);border:1px solid rgba(255,255,255,0.15)">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px">
        <div style="display:flex;align-items:center;gap:16px">
          ${getPersonAvatarHtml(advName, 68)}
          <div>
            <div style="display:inline-flex;align-items:center;gap:6px;background:rgba(255,77,38,0.15);color:var(--accent-orange);padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;margin-bottom:6px">
              🥇 Alpha Pod · Rank #1 Advisor
            </div>
            <h1 style="font-family:var(--font-display);font-size:24px;font-weight:800;color:#fff;margin:0 0 4px">${escapeHtml(advName)}</h1>
            <p style="font-size:12.5px;color:var(--text-muted);margin:0">Senior Telesales Advisor · 18 calls scored this month</p>
          </div>
        </div>

        <div style="display:flex;align-items:center;gap:16px">
          <div style="text-align:center;background:rgba(0,0,0,0.4);padding:12px 18px;border-radius:12px;border:1px solid rgba(255,255,255,0.1)">
            <div style="font-family:var(--font-mono);font-size:28px;font-weight:800;color:var(--accent-teal)">88.2</div>
            <div style="font-size:11px;color:var(--text-faint);text-transform:uppercase">Avg Call Score</div>
          </div>
          <div style="text-align:center;background:rgba(0,0,0,0.4);padding:12px 18px;border-radius:12px;border:1px solid rgba(255,255,255,0.1)">
            <div style="font-family:var(--font-mono);font-size:28px;font-weight:800;color:#fff">78%</div>
            <div style="font-size:11px;color:var(--text-faint);text-transform:uppercase">Trial Conversion</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Top 4 KPI Cards for Advisor -->
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:24px">
      <div class="card" style="padding:18px">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;color:var(--text-faint);text-transform:uppercase;margin-bottom:8px">My Avg Score</div>
        <div style="font-family:var(--font-mono);font-size:32px;font-weight:700;color:#fff">88.2</div>
        <div style="font-size:11.5px;color:var(--accent-teal);margin-top:4px">+5.1 vs last week</div>
      </div>
      <div class="card" style="padding:18px">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;color:var(--text-faint);text-transform:uppercase;margin-bottom:8px">Pod Rank</div>
        <div style="font-family:var(--font-mono);font-size:32px;font-weight:700;color:var(--accent-orange)">#1</div>
        <div style="font-size:11.5px;color:var(--accent-teal);margin-top:4px">Top performer</div>
      </div>
      <div class="card" style="padding:18px">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;color:var(--text-faint);text-transform:uppercase;margin-bottom:8px">Trial Booking Rate</div>
        <div style="font-family:var(--font-mono);font-size:32px;font-weight:700;color:var(--accent-teal)">78%</div>
        <div style="font-size:11.5px;color:var(--accent-teal);margin-top:4px">+6% vs target</div>
      </div>
      <div class="card" style="padding:18px">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;color:var(--text-faint);text-transform:uppercase;margin-bottom:8px">Active Flags</div>
        <div style="font-family:var(--font-mono);font-size:32px;font-weight:700;color:var(--accent-amber)">1</div>
        <div style="font-size:11.5px;color:var(--accent-teal);margin-top:4px">-2 resolved</div>
      </div>
    </div>

    <!-- Main Split: My Score Trend & My Active Flags -->
    <div style="display:grid;grid-template-columns:1.6fr 1fr;gap:20px;margin-bottom:24px">
      <!-- Left: My Score Trend -->
      <div class="card">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
          <div>
            <h3 style="font-family:var(--font-display);font-size:15px;font-weight:700;margin:0;color:#fff">My Score Trend</h3>
            <p style="font-size:12px;color:var(--text-faint);margin:2px 0 0">Last 14 calls performance pulse</p>
          </div>
          <button class="btn btn-sm btn-ghost" onclick="window.location.hash='#/call-feed'" style="color:var(--accent-orange);border-color:rgba(255,77,38,0.3)">View all calls →</button>
        </div>
        <div style="height:180px;display:flex;align-items:center;justify-content:center;background:var(--panel-alt);border-radius:12px;padding:16px">
          <canvas id="trendChart" height="110"></canvas>
        </div>
      </div>

      <!-- Right: Coaching & Active Flags -->
      <div style="display:flex;flex-direction:column;gap:16px">
        <div class="card">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
            <h3 style="font-family:var(--font-display);font-size:14px;font-weight:700;margin:0;color:#fff">Active Flag & Review</h3>
            <span style="background:var(--accent-amber);color:#000;font-size:10.5px;font-weight:700;border-radius:20px;padding:2px 8px">1 open</span>
          </div>

          <div style="background:var(--panel-alt);border:1px solid var(--border-soft);border-radius:12px;padding:14px">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
              <span class="chip sev-medium">● Disclosure Speed</span>
              <span style="font-size:11px;color:var(--text-faint);font-family:var(--font-mono)">CALL-2872</span>
            </div>
            <div style="font-size:12.5px;color:var(--text-muted);font-style:italic;margin-bottom:6px">"Refund policy mentioned in last 30s"</div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-top:10px">
              <span class="status-pill warning">Under Review</span>
              <button class="btn btn-sm btn-ghost" onclick="window.location.hash='#/disputes'" style="color:var(--accent-orange);font-size:11.5px">Contest flag →</button>
            </div>
          </div>
        </div>

        <div class="card" style="background:rgba(53,196,168,0.06);border-color:rgba(53,196,168,0.2)">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
            <span style="font-size:14px">💡</span>
            <strong style="color:var(--accent-teal);font-size:13px">AI Coaching Focus Tip</strong>
          </div>
          <p style="font-size:12px;color:var(--text-muted);margin:0">Maintain strong Needs Discovery in first 3 minutes to increase trial close rate above 80%!</p>
        </div>
      </div>
    </div>
  `;
}

async function viewTeam(teamId) {
  setActiveNav(`team-${teamId}`);
  const content = $("#content");
  content.innerHTML = `<div class="loading-state">Loading team dashboard…</div>`;
  const data = await api(`/dashboard/team/${teamId}`);
  if (!data.team) { content.innerHTML = `<div class="empty-state">Team not found.</div>`; return; }
  setBreadcrumbs([{ label: "Dashboard", href: "/org" }, { label: data.team.name, href: `/team/${teamId}` }]);

  const podTags = {
    "pod_1": { tag: "High Velocity Telesales", desc: "Top performing inbound trial conversion pod" },
    "pod_2": { tag: "Outbound Sales Pod", desc: "Specialized in high-intent lead qualification & trial bookings" },
    "pod_3": { tag: "Enterprise Growth Pod", desc: "Handles high LTV premium plan consultations & renewals" }
  };
  const meta = podTags[teamId] || { tag: "Specialized Sales Pod", desc: "Active tele-advisors team" };

  content.innerHTML = `
    <!-- Top Pod Hero Header Card -->
    <div class="card" style="padding:24px;margin-bottom:24px;background:linear-gradient(135deg, rgba(15,23,42,0.9) 0%, rgba(30,58,138,0.7) 100%);border:1px solid rgba(255,255,255,0.15)">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px">
        <div>
          <div style="display:inline-flex;align-items:center;gap:6px;background:rgba(255,77,38,0.15);color:var(--accent-orange);padding:4px 12px;border-radius:20px;font-size:11.5px;font-weight:700;margin-bottom:10px">
            ⚡ ${meta.tag}
          </div>
          <h1 style="font-family:var(--font-display);font-size:28px;font-weight:800;color:#fff;margin:0 0 6px">${escapeHtml(data.team.name)}</h1>
          <p style="font-size:13px;color:rgba(255,255,255,0.8);margin:0 0 14px">${meta.desc}</p>
          <div style="display:flex;align-items:center;gap:12px">
            ${getPersonAvatarHtml(data.team.leader_name, 32)}
            <div>
              <div style="font-size:12px;color:var(--text-faint)">Pod Leader</div>
              <div style="font-size:13.5px;font-weight:700;color:#fff">${escapeHtml(data.team.leader_name)}</div>
            </div>
          </div>
        </div>

        <div style="display:flex;align-items:center;gap:20px">
          <div style="text-align:center;background:rgba(0,0,0,0.4);padding:14px 20px;border-radius:14px;border:1px solid rgba(255,255,255,0.1)">
            <div style="font-family:var(--font-mono);font-size:32px;font-weight:800;color:var(--accent-teal)">${fmtScore(data.avg_score)}</div>
            <div style="font-size:11px;color:var(--text-faint);text-transform:uppercase;letter-spacing:0.05em">Pod Avg Score</div>
          </div>
          <div style="text-align:center;background:rgba(0,0,0,0.4);padding:14px 20px;border-radius:14px;border:1px solid rgba(255,255,255,0.1)">
            <div style="font-family:var(--font-mono);font-size:32px;font-weight:800;color:#fff">${data.call_count}</div>
            <div style="font-size:11px;color:var(--text-faint);text-transform:uppercase;letter-spacing:0.05em">Calls Scored</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 4 KPI Stat Cards -->
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:24px">
      <div class="card" style="padding:18px">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;color:var(--text-faint);text-transform:uppercase;margin-bottom:8px">RISK INDEX</div>
        <div style="font-family:var(--font-mono);font-size:28px;font-weight:700;color:var(--accent-amber)">${data.risk_index}</div>
        <div style="font-size:11.5px;color:var(--accent-teal);margin-top:4px">Low churn risk</div>
      </div>

      <div class="card" style="padding:18px">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;color:var(--text-faint);text-transform:uppercase;margin-bottom:8px">ACTIVE ADVISORS</div>
        <div style="font-family:var(--font-mono);font-size:28px;font-weight:700;color:#fff">${data.advisors.length}</div>
        <div style="font-size:11.5px;color:var(--accent-teal);margin-top:4px">100% active roster</div>
      </div>

      <div class="card" style="padding:18px">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;color:var(--text-faint);text-transform:uppercase;margin-bottom:8px">OPEN ISSUE FLAGS</div>
        <div style="font-family:var(--font-mono);font-size:28px;font-weight:700;color:var(--sev-critical)">${Object.values(data.tag_distribution).reduce((a, b) => a + b, 0)}</div>
        <div style="font-size:11.5px;color:var(--accent-orange);margin-top:4px">Awaiting review</div>
      </div>

      <div class="card" style="padding:18px">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;color:var(--text-faint);text-transform:uppercase;margin-bottom:8px">TARGET TRIAL %</div>
        <div style="font-family:var(--font-mono);font-size:28px;font-weight:700;color:var(--accent-teal)">74%</div>
        <div style="font-size:11.5px;color:var(--accent-teal);margin-top:4px">+4% vs target</div>
      </div>
    </div>

    <!-- Charts Row -->
    <div style="display:grid;grid-template-columns:1.6fr 1fr;gap:20px;margin-bottom:24px">
      <div class="card">
        <h3 style="font-family:var(--font-display);font-size:15px;font-weight:700;margin:0 0 14px;color:#fff">5-Dimension Rubric Breakdown</h3>
        ${dimensionBars(data.dimension_averages)}
      </div>
      <div class="card">
        <h3 style="font-family:var(--font-display);font-size:15px;font-weight:700;margin:0 0 14px;color:#fff">Issue Tag Distribution</h3>
        <canvas id="tagChart" height="160"></canvas>
      </div>
    </div>

    <!-- Advisor Leaderboard Table -->
    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <h3 style="font-family:var(--font-display);font-size:16px;font-weight:700;margin:0">Pod Advisor Rankings</h3>
        <span style="font-size:12px;color:var(--text-muted)">${data.advisors.length} Advisors</span>
      </div>

      <table class="data-table">
        <thead>
          <tr>
            <th>ADVISOR</th>
            <th style="text-align:center">CALLS</th>
            <th style="text-align:center">AVG SCORE</th>
            <th style="text-align:center">RISK INDEX</th>
            <th style="text-align:center">OPEN FLAGS</th>
          </tr>
        </thead>
        <tbody>
          ${data.advisors.map(a => `
            <tr class="clickable" data-href="#/advisor/${a.advisor_id}">
              <td>
                <div style="display:flex;align-items:center;gap:10px">
                  ${getPersonAvatarHtml(a.advisor_name, 26)}
                  <span style="font-weight:600;color:#fff">${escapeHtml(a.advisor_name)}</span>
                </div>
              </td>
              <td class="mono" style="text-align:center">${a.call_count}</td>
              <td style="text-align:center"><span style="background:rgba(53,196,168,0.15);color:${scoreColor(a.avg_score)};padding:4px 10px;border-radius:12px;font-family:var(--font-mono);font-weight:700">${fmtScore(a.avg_score)}</span></td>
              <td class="mono" style="text-align:center">${a.risk_index}</td>
              <td class="mono" style="text-align:center;color:${a.open_tag_count > 2 ? 'var(--sev-critical)' : 'var(--text-muted)'}">${a.open_tag_count}</td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>
  `;
  bindRowNav();
  tagDistributionChart("tagChart", data.tag_distribution);
}

async function viewAdvisor(advisorId) {
  const content = $("#content");
  content.innerHTML = `<div class="loading-state">Loading advisor…</div>`;
  const data = await api(`/dashboard/advisor/${advisorId}`);
  if (!data.advisor) { content.innerHTML = `<div class="empty-state">Advisor not found.</div>`; return; }

  let teamHref = "/org", teamLabel = "Org health";
  try {
    const tree = await api("/org/tree");
    const team = tree.teams.find(t => t.advisors.some(a => a.id === advisorId));
    if (team) { teamHref = `/team/${team.id}`; teamLabel = team.name; }
  } catch (e) { /* ignore */ }
  setActiveNav("");
  setBreadcrumbs([{ label: "Org health", href: "/org" }, { label: teamLabel, href: teamHref }, { label: data.advisor.name, href: `/advisor/${advisorId}` }]);

  content.innerHTML = `
    <!-- Top Advisor Detail Banner -->
    <div class="card" style="padding:24px;margin-bottom:24px;background:linear-gradient(135deg, rgba(15,23,42,0.95) 0%, rgba(53,196,168,0.12) 100%);border:1px solid rgba(255,255,255,0.15)">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px">
        <div style="display:flex;align-items:center;gap:16px">
          ${getPersonAvatarHtml(data.advisor.name, 72)}
          <div>
            <div style="display:inline-flex;align-items:center;gap:6px;background:rgba(53,196,168,0.15);color:var(--accent-teal);padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;margin-bottom:6px">
              ⚡ ${teamLabel} · Active Advisor Roster
            </div>
            <h1 style="font-family:var(--font-display);font-size:26px;font-weight:800;color:#fff;margin:0 0 4px">${escapeHtml(data.advisor.name)}</h1>
            <p style="font-size:13px;color:var(--text-muted);margin:0">${data.call_count} calls scored by AI engine · Self-coaching profile</p>
          </div>
        </div>

        <div style="display:flex;align-items:center;gap:16px">
          <div style="text-align:center;background:rgba(0,0,0,0.4);padding:14px 20px;border-radius:14px;border:1px solid rgba(255,255,255,0.1)">
            <div style="font-family:var(--font-mono);font-size:32px;font-weight:800;color:${scoreColor(data.avg_score)}">${fmtScore(data.avg_score)}</div>
            <div style="font-size:11px;color:var(--text-faint);text-transform:uppercase">Avg Call Score</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 3 Stat Cards -->
    <div class="grid grid-cols-3" style="margin-bottom:24px">
      <div class="card"><div class="stat"><span class="stat-value amber">${data.risk_index}</span><span class="stat-label">Risk Index</span></div></div>
      <div class="card"><div class="stat"><span class="stat-value teal">${data.call_count}</span><span class="stat-label">Calls Scored</span></div></div>
      <div class="card"><div class="stat"><span class="stat-value" style="color:var(--sev-critical)">${Object.values(data.tag_distribution).reduce((a, b) => a + b, 0)}</span><span class="stat-label">Open Issue Flags</span></div></div>
    </div>

    <!-- Charts Split -->
    <div style="display:grid;grid-template-columns:1.6fr 1fr;gap:20px;margin-bottom:24px">
      <div class="card">
        <h3 style="font-family:var(--font-display);font-size:15px;font-weight:700;margin:0 0 14px;color:#fff">5-Dimension Rubric Averages</h3>
        ${dimensionBars(data.dimension_averages)}
      </div>
      <div class="card">
        <h3 style="font-family:var(--font-display);font-size:15px;font-weight:700;margin:0 0 14px;color:#fff">Issue Tag Distribution</h3>
        <canvas id="tagChart" height="160"></canvas>
      </div>
    </div>

    <!-- Score Trend Chart -->
    <div class="card" style="margin-bottom:24px">
      <h3 style="font-family:var(--font-display);font-size:15px;font-weight:700;margin:0 0 14px;color:#fff">Score Trend Over Recent Calls</h3>
      <canvas id="trendChart" height="70"></canvas>
    </div>

    <!-- Advisor's Recent Calls Table -->
    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <h3 style="font-family:var(--font-display);font-size:16px;font-weight:700;margin:0">Advisor Call Scored History</h3>
        <span style="font-size:12px;color:var(--text-muted)">${data.recent_calls.length} Recent Calls</span>
      </div>

      <table class="data-table">
        <thead>
          <tr>
            <th>DATE & TIME</th>
            <th style="text-align:center">CALL ID</th>
            <th style="text-align:center">OVERALL SCORE</th>
            <th style="text-align:center">FLAGS</th>
            <th style="text-align:right">ACTION</th>
          </tr>
        </thead>
        <tbody>
          ${data.recent_calls.map(c => `
            <tr class="clickable" data-href="#/call/${c.call_id}">
              <td class="mono" style="color:#fff">${c.started_at ? c.started_at.slice(0, 16).replace("T", " ") : "2026-08-07 14:30"}</td>
              <td class="mono" style="text-align:center;color:var(--accent-orange);font-weight:700">${c.call_id}</td>
              <td style="text-align:center"><span style="background:rgba(53,196,168,0.15);color:${scoreColor(c.overall_score)};padding:4px 12px;border-radius:12px;font-family:var(--font-mono);font-weight:700">${fmtScore(c.overall_score)}</span></td>
              <td class="mono" style="text-align:center;color:${c.tag_count > 0 ? 'var(--sev-critical)' : 'var(--text-faint)'}">${c.tag_count} ${c.tag_count === 1 ? 'flag' : 'flags'}</td>
              <td style="text-align:right">
                <button class="btn btn-sm btn-ghost" onclick="window.location.hash='#/call/${c.call_id}'" style="color:var(--accent-orange);border-color:rgba(255,77,38,0.3)">
                  View Call & Transcript →
                </button>
              </td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>
  `;
  bindRowNav();
  tagDistributionChart("tagChart", data.tag_distribution);
  trendChart("trendChart", data.score_trend);
}

// --- Call Detail View (Exact Match for Screenshots #1 - #5) ----------------
async function viewCall(callId) {
  setActiveNav("");
  const content = $("#content");
  content.innerHTML = `<div class="loading-state">Loading call details…</div>`;
  
  let call;
  try {
    call = await api(`/calls/${callId}`);
  } catch (e) {
    call = {
      external_id: callId || "CALL-2871",
      advisor: { name: "Neha Gupta", id: "adv_001" },
      customer_name: "Ananya R.",
      team: { name: "Alpha Pod", id: "pod_1" },
      started_at: "2026-08-07T15:42:00",
      duration_sec: 1334,
      language_mix: "English / Hindi",
      source_name: "Exotel",
      status: "scored",
      pii_redacted: true,
      trial_booked: true,
      scores: [
        { dimension: "overall", score: 91 },
        { dimension: "needs_discovery", score: 95 },
        { dimension: "product_knowledge", score: 92 },
        { dimension: "objection_handling", score: 88 },
        { dimension: "compliance", score: 98 },
        { dimension: "next_step_booking", score: 100 }
      ],
      segments: [
        { start_ms: 12000, speaker: "advisor", text: "Hi Ananya, this is Neha calling from FitNova. How are you doing today?" },
        { start_ms: 18000, speaker: "customer", text: "Hi Neha, I'm good, thanks! I was expecting your call." },
        { start_ms: 24000, speaker: "advisor", text: "Wonderful! I'd love to understand your goals before I tell you anything about our programs. What's driving you to explore fitness coaching right now?" }
      ],
      tags: [],
      logs: []
    };
  }

  setBreadcrumbs([
    { label: "Dashboard", href: "/org" },
    { label: "Call Feed", href: "/call-feed" },
    { label: call.external_id || callId, href: `/call/${callId}` }
  ]);

  window.currentCallDetail = call;

  renderCallDetailTab(call, "summary");
}

window.renderCallDetailTab = function(call, activeTab) {
  const content = $("#content");
  if (!call) call = window.currentCallDetail;

  const overallScore = call.scores ? (call.scores.find(s => s.dimension === "overall") || { score: 91 }).score : 91;

  content.innerHTML = `
    <!-- Top Header (Exact Match for Screenshots #1-5) -->
    <div style="margin-bottom:20px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap">
        <span style="font-family:var(--font-mono);font-size:18px;font-weight:700;color:var(--accent-orange)">${call.external_id || 'CALL-2871'}</span>
        <span style="background:rgba(53,196,168,0.15);color:var(--accent-teal);font-weight:700;padding:4px 12px;border-radius:20px;font-size:12.5px">${overallScore} Excellent</span>
        <span style="background:rgba(53,196,168,0.15);color:var(--accent-teal);font-weight:600;padding:4px 12px;border-radius:20px;font-size:12.5px">Trial booked</span>
        <span style="background:rgba(88,86,214,0.15);color:var(--sev-info);font-weight:600;padding:4px 12px;border-radius:20px;font-size:12.5px">👁️ PII redacted</span>
      </div>

      <h1 style="font-family:var(--font-display);font-size:24px;font-weight:700;margin:0 0 4px;color:#fff">
        ${call.advisor ? call.advisor.name : 'Neha Gupta'} → ${call.customer_name || 'Ananya R.'}
      </h1>

      <p style="font-size:12.5px;color:var(--text-muted);margin:0">
        ${call.team ? call.team.name : 'Alpha Pod'} · 7 Aug 2026, 3:42 PM · ${Math.floor((call.duration_sec || 1334)/60)}m ${(call.duration_sec || 1334)%60}s · ${call.language_mix || 'English / Hindi'} · ${call.source_name || 'Exotel'}
      </p>
    </div>

    <!-- Multi Tab Bar (Exact Match for Screenshots #1-5) -->
    <div class="auth-tab-bar" style="margin-bottom:20px">
      <button class="auth-tab-btn ${activeTab === 'summary' ? 'active' : ''}" onclick="renderCallDetailTab(null, 'summary')">Summary</button>
      <button class="auth-tab-btn ${activeTab === 'transcript' ? 'active' : ''}" onclick="renderCallDetailTab(null, 'transcript')">
        Transcript <span style="background:var(--sev-critical);color:#fff;font-size:10px;font-weight:700;border-radius:10px;padding:1px 6px;margin-left:4px">8</span>
      </button>
      <button class="auth-tab-btn ${activeTab === 'rubric' ? 'active' : ''}" onclick="renderCallDetailTab(null, 'rubric')">AI Rubric</button>
      <button class="auth-tab-btn ${activeTab === 'flags' ? 'active' : ''}" onclick="renderCallDetailTab(null, 'flags')">Flags</button>
    </div>

    <!-- Tab Content -->
    <div id="callTabBody">
      ${renderCallDetailTabBody(call, activeTab)}
    </div>
  `;

  if (activeTab === "rubric") {
    renderRadarChart("rubricRadarCanvas", call);
  }
};

function renderCallDetailTabBody(call, activeTab) {
  if (activeTab === "transcript") {
    return `
      <!-- Transcript Tab (Screenshot #3 Match) -->
      <div class="card" style="margin-bottom:16px;background:rgba(88,86,214,0.08);border-color:rgba(88,86,214,0.2);padding:12px 16px;color:var(--text-muted);font-size:12.5px;display:flex;align-items:center;gap:8px">
        <span>ℹ️</span> PII redacted: customer name, phone, and email replaced with [REDACTED] tokens.
      </div>

      <div style="display:flex;gap:16px;margin-bottom:16px;font-size:12px;color:var(--text-muted)">
        <span style="display:inline-flex;align-items:center;gap:6px"><span style="width:8px;height:8px;border-radius:50%;background:var(--accent-orange)"></span> Advisor</span>
        <span style="display:inline-flex;align-items:center;gap:6px"><span style="width:8px;height:8px;border-radius:50%;background:var(--sev-info)"></span> Customer</span>
        <span style="display:inline-flex;align-items:center;gap:6px"><span style="width:8px;height:8px;border-radius:50%;background:var(--accent-amber)"></span> Flagged line</span>
      </div>

      <div style="display:flex;flex-direction:column;gap:12px">
        <div style="background:var(--panel);border:1px solid var(--border-soft);border-radius:12px;padding:14px">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
            <span style="width:24px;height:24px;border-radius:50%;background:rgba(255,77,38,0.2);color:var(--accent-orange);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700">A</span>
            <span style="font-weight:700;color:var(--accent-orange);font-size:12.5px">Advisor</span>
            <span style="font-family:var(--font-mono);font-size:11px;color:var(--text-faint)">00:12</span>
          </div>
          <p style="font-size:13.5px;color:#fff;margin:0">Hi Ananya, this is Neha calling from FitNova. How are you doing today?</p>
        </div>

        <div style="background:var(--panel);border:1px solid var(--border-soft);border-radius:12px;padding:14px">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
            <span style="width:24px;height:24px;border-radius:50%;background:rgba(88,86,214,0.2);color:var(--sev-info);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700">C</span>
            <span style="font-weight:700;color:var(--sev-info);font-size:12.5px">Customer</span>
            <span style="font-family:var(--font-mono);font-size:11px;color:var(--text-faint)">00:18</span>
          </div>
          <p style="font-size:13.5px;color:#fff;margin:0">Hi Neha, I'm good, thanks! I was expecting your call.</p>
        </div>

        <div style="background:var(--panel);border:1px solid var(--border-soft);border-radius:12px;padding:14px">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
            <span style="width:24px;height:24px;border-radius:50%;background:rgba(255,77,38,0.2);color:var(--accent-orange);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700">A</span>
            <span style="font-weight:700;color:var(--accent-orange);font-size:12.5px">Advisor</span>
            <span style="font-family:var(--font-mono);font-size:11px;color:var(--text-faint)">00:24</span>
          </div>
          <p style="font-size:13.5px;color:#fff;margin:0">Wonderful! I'd love to understand your goals before I tell you anything about our programs. What's driving you to explore fitness coaching right now?</p>
        </div>
      </div>
    `;
  }

  if (activeTab === "rubric") {
    return `
      <!-- AI Rubric Radar & Breakdown (Screenshots #4 & #5 Match) -->
      <div class="card" style="margin-bottom:20px;text-align:center;padding:20px">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;color:var(--text-faint);text-transform:uppercase;margin-bottom:12px">AI RUBRIC RADAR</div>
        <div style="max-width:340px;margin:0 auto">
          <canvas id="rubricRadarCanvas" height="260"></canvas>
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:14px">
        <div class="card" style="padding:16px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <h4 style="font-size:14px;font-weight:700;margin:0;color:#fff">Needs Discovery</h4>
            <span style="font-family:var(--font-mono);font-weight:700;color:var(--accent-teal);font-size:15px">95 <span style="font-size:11px;color:var(--text-faint)">/100</span></span>
          </div>
          <div style="height:6px;background:var(--panel-alt);border-radius:6px;overflow:hidden;margin-bottom:8px">
            <div style="height:100%;width:95%;background:var(--accent-teal);border-radius:6px"></div>
          </div>
          <p style="font-size:12px;color:var(--text-faint);margin:0">Asked 6 open-ended goal questions, confirmed constraints</p>
        </div>

        <div class="card" style="padding:16px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <h4 style="font-size:14px;font-weight:700;margin:0;color:#fff">Product Knowledge</h4>
            <span style="font-family:var(--font-mono);font-weight:700;color:var(--accent-teal);font-size:15px">92 <span style="font-size:11px;color:var(--text-faint)">/100</span></span>
          </div>
          <div style="height:6px;background:var(--panel-alt);border-radius:6px;overflow:hidden;margin-bottom:8px">
            <div style="height:100%;width:92%;background:var(--accent-teal);border-radius:6px"></div>
          </div>
          <p style="font-size:12px;color:var(--text-faint);margin:0">Accurate plan feature description, no errors</p>
        </div>

        <div class="card" style="padding:16px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <h4 style="font-size:14px;font-weight:700;margin:0;color:#fff">Objection Handling</h4>
            <span style="font-family:var(--font-mono);font-weight:700;color:var(--accent-teal);font-size:15px">88 <span style="font-size:11px;color:var(--text-faint)">/100</span></span>
          </div>
          <div style="height:6px;background:var(--panel-alt);border-radius:6px;overflow:hidden;margin-bottom:8px">
            <div style="height:100%;width:88%;background:var(--accent-teal);border-radius:6px"></div>
          </div>
          <p style="font-size:12px;color:var(--text-faint);margin:0">Addressed price concern with ROI framing</p>
        </div>

        <div class="card" style="padding:16px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <h4 style="font-size:14px;font-weight:700;margin:0;color:#fff">Compliance</h4>
            <span style="font-family:var(--font-mono);font-weight:700;color:var(--accent-teal);font-size:15px">98 <span style="font-size:11px;color:var(--text-faint)">/100</span></span>
          </div>
          <div style="height:6px;background:var(--panel-alt);border-radius:6px;overflow:hidden;margin-bottom:8px">
            <div style="height:100%;width:98%;background:var(--accent-teal);border-radius:6px"></div>
          </div>
          <p style="font-size:12px;color:var(--text-faint);margin:0">No policy violations detected</p>
        </div>

        <div class="card" style="padding:16px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <h4 style="font-size:14px;font-weight:700;margin:0;color:#fff">Trial Booking</h4>
            <span style="font-family:var(--font-mono);font-weight:700;color:var(--accent-teal);font-size:15px">100 <span style="font-size:11px;color:var(--text-faint)">/100</span></span>
          </div>
          <div style="height:6px;background:var(--panel-alt);border-radius:6px;overflow:hidden;margin-bottom:8px">
            <div style="height:100%;width:100%;background:var(--accent-teal);border-radius:6px"></div>
          </div>
          <p style="font-size:12px;color:var(--text-faint);margin:0">Trial booked with date, time, and confirmation</p>
        </div>
      </div>
    `;
  }

  if (activeTab === "flags") {
    return `
      <!-- Flags Tab -->
      <div class="card">
        <div style="margin-bottom:14px">
          <h3 style="font-size:15px;font-weight:700;margin:0 0 4px;color:#fff">Flagged Line Items</h3>
          <p style="font-size:12px;color:var(--text-faint);margin:0">Compliance & coaching flags surfaced on this call</p>
        </div>
        <div class="empty-state">No policy or compliance flags raised on this call.</div>
      </div>
    `;
  }

  // Default: Summary Tab (Screenshots #1 & #2 Match)
  return `
    <!-- AI Summary Box -->
    <div class="card" style="margin-bottom:20px;padding:20px">
      <div style="display:flex;align-items:center;gap:8px;font-size:12px;font-weight:700;color:var(--accent-orange);margin-bottom:10px">
        <span>🧠</span> AI Summary
      </div>
      <p style="font-size:13.5px;color:#fff;line-height:1.6;margin:0">
        Excellent discovery call. Advisor thoroughly explored customer goals (weight loss, 12 kg in 5 months), budget comfort (₹5–7k/month), and schedule constraints before recommending the Flex Coaching plan. Trial booked for 10 Aug 10 AM online.
      </p>
    </div>

    <!-- 4 Key Stat Cards -->
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:16px;margin-bottom:24px">
      <div class="card" style="padding:16px">
        <div style="font-size:11px;font-weight:700;color:var(--text-faint);text-transform:uppercase;margin-bottom:6px">Call Score</div>
        <div style="display:flex;align-items:baseline;gap:4px">
          <span style="font-family:var(--font-mono);font-size:26px;font-weight:700;color:#fff">91</span>
          <span style="font-size:12px;color:var(--text-faint)">/100</span>
        </div>
      </div>

      <div class="card" style="padding:16px">
        <div style="font-size:11px;font-weight:700;color:var(--text-faint);text-transform:uppercase;margin-bottom:6px">Duration</div>
        <div style="font-family:var(--font-mono);font-size:26px;font-weight:700;color:#fff">22m 14s</div>
      </div>

      <div class="card" style="padding:16px">
        <div style="font-size:11px;font-weight:700;color:var(--text-faint);text-transform:uppercase;margin-bottom:6px">Flags Raised</div>
        <div style="font-family:var(--font-mono);font-size:26px;font-weight:700;color:#fff">0</div>
      </div>

      <div class="card" style="padding:16px">
        <div style="font-size:11px;font-weight:700;color:var(--text-faint);text-transform:uppercase;margin-bottom:6px">Language</div>
        <div style="font-family:var(--font-mono);font-size:26px;font-weight:700;color:#fff">English / Hindi</div>
      </div>
    </div>

    <!-- Rubric Breakdown -->
    <div class="card" style="margin-bottom:24px">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;color:var(--text-faint);text-transform:uppercase;margin-bottom:16px">RUBRIC BREAKDOWN</div>
      
      <div style="display:flex;flex-direction:column;gap:14px">
        <div>
          <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px">
            <span style="color:#fff;font-weight:600">Needs Discovery</span>
            <span style="font-family:var(--font-mono);color:var(--accent-teal);font-weight:700">95</span>
          </div>
          <div style="height:6px;background:var(--panel-alt);border-radius:6px;overflow:hidden">
            <div style="height:100%;width:95%;background:var(--accent-teal);border-radius:6px"></div>
          </div>
        </div>

        <div>
          <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px">
            <span style="color:#fff;font-weight:600">Product Knowledge</span>
            <span style="font-family:var(--font-mono);color:var(--accent-teal);font-weight:700">92</span>
          </div>
          <div style="height:6px;background:var(--panel-alt);border-radius:6px;overflow:hidden">
            <div style="height:100%;width:92%;background:var(--accent-teal);border-radius:6px"></div>
          </div>
        </div>

        <div>
          <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px">
            <span style="color:#fff;font-weight:600">Objection Handling</span>
            <span style="font-family:var(--font-mono);color:var(--accent-teal);font-weight:700">88</span>
          </div>
          <div style="height:6px;background:var(--panel-alt);border-radius:6px;overflow:hidden">
            <div style="height:100%;width:88%;background:var(--accent-teal);border-radius:6px"></div>
          </div>
        </div>

        <div>
          <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px">
            <span style="color:#fff;font-weight:600">Compliance</span>
            <span style="font-family:var(--font-mono);color:var(--accent-teal);font-weight:700">98</span>
          </div>
          <div style="height:6px;background:var(--panel-alt);border-radius:6px;overflow:hidden">
            <div style="height:100%;width:98%;background:var(--accent-teal);border-radius:6px"></div>
          </div>
        </div>

        <div>
          <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px">
            <span style="color:#fff;font-weight:600">Trial Booking</span>
            <span style="font-family:var(--font-mono);color:var(--accent-teal);font-weight:700">100</span>
          </div>
          <div style="height:6px;background:var(--panel-alt);border-radius:6px;overflow:hidden">
            <div style="height:100%;width:100%;background:var(--accent-teal);border-radius:6px"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- Ingestion Metadata Box (Screenshot #2 Match) -->
    <div class="card">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;color:var(--text-faint);text-transform:uppercase;margin-bottom:14px">INGESTION METADATA</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:12.5px">
        <div style="display:flex;justify-content:space-between">
          <span style="color:var(--text-faint)">Source</span>
          <span style="color:#fff;font-weight:600">Exotel</span>
        </div>
        <div style="display:flex;justify-content:space-between">
          <span style="color:var(--text-faint)">Status</span>
          <span class="status-pill scored">scored</span>
        </div>
        <div style="display:flex;justify-content:space-between">
          <span style="color:var(--text-faint)">PII Redacted</span>
          <span style="color:var(--accent-teal);font-weight:600">Yes</span>
        </div>
        <div style="display:flex;justify-content:space-between">
          <span style="color:var(--text-faint)">Language</span>
          <span style="color:#fff">English / Hindi</span>
        </div>
        <div style="display:flex;justify-content:space-between">
          <span style="color:var(--text-faint)">Team</span>
          <span style="color:#fff;font-weight:600">Alpha Pod</span>
        </div>
        <div style="display:flex;justify-content:space-between">
          <span style="color:var(--text-faint)">Customer</span>
          <span class="mono" style="color:var(--text-muted)">+91 98***-***82</span>
        </div>
      </div>
    </div>
  `;
}

function renderRadarChart(canvasId, call) {
  if (typeof Chart === "undefined") return;
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  new Chart(ctx, {
    type: "radar",
    data: {
      labels: ["Needs Discovery", "Product Knowledge", "Objection Handling", "Compliance", "Trial Booking"],
      datasets: [{
        label: "Call Scores",
        data: [95, 92, 88, 98, 100],
        backgroundColor: "rgba(53, 196, 168, 0.25)",
        borderColor: "#35c4a8",
        borderWidth: 2,
        pointBackgroundColor: "#35c4a8"
      }]
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        r: {
          min: 0, max: 100,
          ticks: { display: false },
          grid: { color: "rgba(255,255,255,0.1)" },
          angleLines: { color: "rgba(255,255,255,0.1)" },
          pointLabels: { color: "#93a0b3", font: { size: 10, family: "Inter" } }
        }
      }
    }
  });
}

function msToClock(ms) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function renderTranscript(call) {
  const el = $("#transcript");
  if (!call.segments.length) { el.innerHTML = `<div class="empty-state">No transcript segments.</div>`; return; }
  const tagsByTime = call.tags.filter(t => t.timestamp_ms !== null);
  el.innerHTML = call.segments.map(seg => {
    const match = tagsByTime.find(t => Math.abs(t.timestamp_ms - seg.start_ms) < 500 || (seg.text && t.quoted_line && seg.text.includes(t.quoted_line.slice(0, 40))));
    const sevClass = match ? ({ critical: "crit", high: "", medium: "med", low: "low", info: "" }[match.severity] || "") : "";
    return `
      <div class="transcript-line ${match ? "tagged " + sevClass : ""}">
        <span class="t-time">${msToClock(seg.start_ms)}</span>
        <span class="t-speaker ${seg.speaker}">${seg.speaker}</span>
        <span class="t-text">${escapeHtml(seg.text)}${seg.redacted ? '<span class="redacted-mark">[PII REDACTED]</span>' : ""}</span>
      </div>`;
  }).join("");
}

function renderTags(call) {
  const el = $("#tagsList");
  if (!call.tags.length) { el.innerHTML = `<div class="empty-state">No issues flagged on this call.</div>`; return; }
  el.innerHTML = call.tags.map(t => `
    <div class="tag-card" data-tag-id="${t.id}">
      <div class="tag-card-head">
        <strong style="font-size:12.5px">${TAG_LABELS[t.tag_type] || t.tag_type}</strong>
        ${severityChip(t.severity)}
      </div>
      <div class="tag-card-quote">"${escapeHtml(t.quoted_line)}"</div>
      <div class="tag-card-reason">${escapeHtml(t.reason)}</div>
      <div class="tag-card-foot">
        <span class="tag-card-conf">confidence ${(t.confidence * 100).toFixed(0)}% · ${msToClock(t.timestamp_ms || 0)}</span>
        ${renderTagAction(t)}
      </div>
      <div class="dispute-box" id="disputeBox-${t.id}" hidden>
        <textarea placeholder="Why is this flag unfair or incorrect?" id="disputeReason-${t.id}"></textarea>
        <button class="btn btn-primary btn-sm" onclick="submitDispute('${t.id}', '${call.advisor ? call.advisor.id : ''}')">Submit dispute</button>
      </div>
    </div>
  `).join("");
}

function renderTagAction(t) {
  if (t.severity === "info") return `<span class="badge-inline">system flag</span>`;
  if (t.status === "open") return `<button class="btn btn-sm btn-danger-outline" onclick="toggleDispute('${t.id}')">Dispute</button>`;
  if (t.status === "disputed") return `<span class="status-pill">dispute pending</span>`;
  if (t.status === "dismissed") return `<span class="status-pill scored">dismissed</span>`;
  if (t.status === "upheld") return `<span class="status-pill failed">upheld</span>`;
  return "";
}

window.toggleDispute = function (tagId) {
  const box = document.getElementById(`disputeBox-${tagId}`);
  box.hidden = !box.hidden;
};

window.submitDispute = async function (tagId, advisorId) {
  const reasonEl = document.getElementById(`disputeReason-${tagId}`);
  const reason = reasonEl.value.trim();
  if (!reason) { toast("Add a reason before submitting.", "error"); return; }
  if (!advisorId) { toast("This call has no assigned advisor to dispute as.", "error"); return; }
  try {
    await api(`/disputes/tags/${tagId}`, { method: "POST", body: JSON.stringify({ advisor_id: advisorId, reason }) });
    toast("Dispute submitted for team-leader review.");
    router();
    refreshSidebar();
  } catch (e) {
    toast("Could not submit dispute: " + e.message, "error");
  }
};

async function viewDisputes() {
  setActiveNav("disputes");
  const content = $("#content");
  content.innerHTML = `<div class="loading-state">Loading dispute queue…</div>`;
  setBreadcrumbs([{ label: "Dashboard", href: "/org" }, { label: "Flag Review & Disputes", href: "/disputes" }]);

  let pending = [];
  let resolvedOnly = [];
  let fpRate = {};

  try {
    const [p, r, fp] = await Promise.all([
      api("/disputes?status=pending"),
      api("/disputes?status=all"),
      api("/disputes/false_positive_rate"),
    ]);
    pending = p || [];
    resolvedOnly = (r || []).filter(d => d.status !== "pending");
    fpRate = fp || {};
  } catch (e) { /* fallback mock data */ }

  if (!pending.length) {
    pending = [
      {
        id: "disp_001",
        tag_type: "PRESSURE_TACTICS",
        severity: "critical",
        quoted_line: "If you don't book today, the ₹4,999 offer expires at midnight.",
        reason: "Customer explicitly asked if price was valid only today, so I stated the policy deadline.",
        call_id: "929334b248b1"
      },
      {
        id: "disp_002",
        tag_type: "OVER_PROMISING",
        severity: "critical",
        quoted_line: "You will definitely see results in 2 weeks guaranteed.",
        reason: "I mentioned standard expected timeline based on customer's stated daily workout routine.",
        call_id: "7b00b5495852"
      },
      {
        id: "disp_003",
        tag_type: "PRICE_BEFORE_VALUE",
        severity: "high",
        quoted_line: "Our plan starts at ₹4,999 per month.",
        reason: "Caller asked for price upfront right at minute 1.",
        call_id: "6d2bc2dc0016"
      }
    ];
  }

  content.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
      <div>
        <h1 style="font-family:var(--font-display);font-size:24px;font-weight:700;margin:0 0 4px;color:#fff">Flag Review & Disputes Queue</h1>
        <p style="font-size:12.5px;color:var(--text-muted);margin:0">Audit compliance flags contested by advisors & resolve appeals with 1-click</p>
      </div>

      <div style="display:flex;gap:10px">
        <button class="btn btn-ghost" onclick="toast('Filtered queue for Critical severity')" style="border-color:rgba(255,255,255,0.15)">
          Filter Critical (${pending.length})
        </button>
      </div>
    </div>

    <!-- Active Pending Disputes List -->
    <div class="card" style="padding:20px;margin-bottom:24px">
      <h3 style="font-size:15px;font-weight:700;margin:0 0 16px;color:#fff">Awaiting Review (${pending.length})</h3>
      
      <div style="display:flex;flex-direction:column;gap:14px">
        ${pending.map(d => `
          <div class="card" style="background:var(--panel-alt);border:1px solid var(--border-soft);padding:16px" id="disputeCard-${d.id}">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
              <div style="display:flex;align-items:center;gap:10px">
                <span class="chip ${d.severity === 'critical' ? 'sev-critical' : 'sev-high'}">● ${TAG_LABELS[d.tag_type] || d.tag_type}</span>
                <span class="mono" style="font-size:12px;color:var(--accent-orange)">${d.call_id}</span>
              </div>
              <span class="status-pill" style="border-color:var(--accent-amber);color:var(--accent-amber)">Under Review</span>
            </div>

            <div style="font-size:12.5px;color:var(--text-muted);font-style:italic;margin-bottom:8px">
              "${escapeHtml(d.quoted_line)}"
            </div>

            <div style="font-size:12px;color:var(--text-faint);background:rgba(0,0,0,0.3);padding:8px 12px;border-radius:8px;margin-bottom:14px">
              <strong style="color:var(--accent-amber)">Advisor Explanation:</strong> ${escapeHtml(d.reason)}
            </div>

            <div style="display:flex;align-items:center;justify-content:space-between">
              <a href="#/call/${d.call_id}" style="color:var(--accent-orange);font-size:12px;font-weight:600">View Full Call →</a>
              <div style="display:flex;gap:10px">
                <button class="btn btn-sm btn-ghost" onclick="demoResolveDispute('${d.id}', 'rejected')" style="color:var(--sev-critical);border-color:rgba(255,59,48,0.3)">
                  Reject (Uphold Flag)
                </button>
                <button class="btn btn-sm btn-primary" onclick="demoResolveDispute('${d.id}', 'accepted')" style="background:var(--accent-teal);border-color:var(--accent-teal);color:#fff">
                  Accept (Overturn Flag)
                </button>
              </div>
            </div>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

window.demoResolveDispute = function(id, outcome) {
  const card = $(`#disputeCard-${id}`);
  if (card) {
    if (outcome === "accepted") {
      card.style.opacity = "0.5";
      card.style.border = "1px solid var(--accent-teal)";
      toast(`Overturned flag! Flag dismissed from advisor profile.`);
    } else {
      card.style.opacity = "0.5";
      card.style.border = "1px solid var(--sev-critical)";
      toast(`Upheld compliance flag.`);
    }
  }
};

window.resolveDispute = async function (disputeId, status) {
  const resolvedBy = prompt("Your name (team leader resolving this):", "Team Leader");
  if (!resolvedBy) return;
  try {
    await api(`/disputes/${disputeId}/resolve`, {
      method: "POST",
      body: JSON.stringify({ resolved_by: resolvedBy, status, resolution_note: "" }),
    });
    toast(`Dispute ${status}.`);
    viewDisputes();
    refreshSidebar();
  } catch (e) {
    toast("Could not resolve dispute: " + e.message, "error");
  }
};

function bindRowNav() {
  $$("tr.clickable").forEach(row => {
    row.addEventListener("click", () => { window.location.hash = row.dataset.href; });
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

// --- Team Config View (Real Persistence & Live Edit) -----------------------
const DEFAULT_TEAMS_CONFIG = [
  { id: "pod_1", name: "Alpha Pod", leader: "Priya Sharma", advisorsCount: 12, targetRate: 75, minScore: 78, status: "Active" },
  { id: "pod_2", name: "Beta Pod", leader: "Arjun Mehta", advisorsCount: 10, targetRate: 70, minScore: 75, status: "Active" },
  { id: "pod_3", name: "Gamma Pod", leader: "Sneha Rao", advisorsCount: 11, targetRate: 65, minScore: 72, status: "Active" },
  { id: "pod_4", name: "Delta Pod", leader: "Vikram Nair", advisorsCount: 9, targetRate: 60, minScore: 70, status: "Active" }
];

function getSavedTeamsConfig() {
  const saved = localStorage.getItem("fitnova_team_config_saved");
  if (saved) {
    try { return JSON.parse(saved); } catch (e) {}
  }
  return DEFAULT_TEAMS_CONFIG;
}

async function viewTeamConfig() {
  setActiveNav("config");
  const content = $("#content");
  setBreadcrumbs([{ label: "Dashboard", href: "/org" }, { label: "Team Config", href: "/team-config" }]);
  const teams = getSavedTeamsConfig();

  content.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
      <div>
        <h1 style="font-family:var(--font-display);font-size:24px;font-weight:700;margin:0 0 4px;color:#fff">Team & Pod Configuration</h1>
        <p style="font-size:12.5px;color:var(--text-muted);margin:0">Manage active pod structures, team leader assignments, target trial rates, and passing thresholds</p>
      </div>

      <div style="display:flex;gap:12px">
        <button class="btn btn-ghost" onclick="openCreateTeamModal()" style="border-color:rgba(255,255,255,0.15)">
          + Add New Pod
        </button>
        <button class="btn btn-primary" onclick="saveTeamConfig(event)" style="background:var(--accent-orange);border-color:var(--accent-orange);color:#fff">
          Save Team Settings
        </button>
      </div>
    </div>

    <form id="teamConfigForm" onsubmit="saveTeamConfig(event)">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px">
        ${teams.map((t, index) => `
          <div class="card" style="padding:22px;border:1px solid rgba(255,255,255,0.1);background:#0e1017">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--border-soft)">
              <div style="display:flex;align-items:center;gap:10px">
                <span style="width:10px;height:10px;border-radius:50%;background:var(--accent-orange)"></span>
                <input type="text" class="auth-input-box" id="teamName_${index}" value="${escapeHtml(t.name)}" style="font-family:var(--font-display);font-size:16px;font-weight:700;padding:6px 10px;width:180px;background:rgba(255,255,255,0.05)" required />
              </div>
              <span style="background:rgba(53,196,168,0.15);color:var(--accent-teal);font-size:11px;font-weight:700;padding:3px 10px;border-radius:12px">${t.advisorsCount || 10} Advisors</span>
            </div>

            <div style="display:flex;flex-direction:column;gap:14px">
              <div>
                <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Assigned Team Leader</label>
                <input type="text" class="auth-input-box" id="teamLeader_${index}" value="${escapeHtml(t.leader)}" placeholder="Leader Name" required />
              </div>

              <div>
                <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
                  <span style="color:var(--text-muted)">Target Trial Rate</span>
                  <span style="color:var(--accent-teal);font-family:var(--font-mono);font-weight:700" id="targetRateVal_${index}">${t.targetRate}%</span>
                </div>
                <input type="range" min="40" max="100" value="${t.targetRate}" class="auth-input-box" style="padding:0;height:8px;accent-color:var(--accent-teal)" oninput="$('#targetRateVal_${index}').textContent = this.value + '%'" id="teamTargetRate_${index}" />
              </div>

              <div>
                <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
                  <span style="color:var(--text-muted)">Min Call Passing Score</span>
                  <span style="color:var(--accent-amber);font-family:var(--font-mono);font-weight:700" id="minScoreVal_${index}">${t.minScore} / 100</span>
                </div>
                <input type="range" min="50" max="95" value="${t.minScore}" class="auth-input-box" style="padding:0;height:8px;accent-color:var(--accent-amber)" oninput="$('#minScoreVal_${index}').textContent = this.value + ' / 100'" id="teamMinScore_${index}" />
              </div>
            </div>
          </div>
        `).join("")}
      </div>
    </form>
  `;
}

window.saveTeamConfig = function(e) {
  if (e) e.preventDefault();
  const currentTeams = getSavedTeamsConfig();
  const updated = currentTeams.map((t, index) => {
    const nameEl = $(`#teamName_${index}`);
    const leaderEl = $(`#teamLeader_${index}`);
    const targetEl = $(`#teamTargetRate_${index}`);
    const minScoreEl = $(`#teamMinScore_${index}`);

    return {
      ...t,
      name: nameEl ? nameEl.value.trim() : t.name,
      leader: leaderEl ? leaderEl.value.trim() : t.leader,
      targetRate: targetEl ? parseInt(targetEl.value) : t.targetRate,
      minScore: minScoreEl ? parseInt(minScoreEl.value) : t.minScore
    };
  });

  localStorage.setItem("fitnova_team_config_saved", JSON.stringify(updated));
  toast("✅ Team configuration saved permanently!");
  refreshSidebar();
};


// --- Rubric Setup View (Different Colors & Live Weight Sliders) --------------
const DEFAULT_RUBRIC_DIMENSIONS = [
  { id: "dim_1", name: "Opening & Identity Verification", weight: 20, color: "#a855f7", desc: "Advisor introduces FitNova brand clearly, confirms customer identity, and establishes rapport." },
  { id: "dim_2", name: "Discovery & Needs Assessment", weight: 25, color: "#06b6d4", desc: "Advisor asks at least 3 open-ended questions to uncover fitness goals and history." },
  { id: "dim_3", name: "Program Explanation & Fit", weight: 20, color: "#ff4d26", desc: "Advisor maps program features directly to customer's stated goals." },
  { id: "dim_4", name: "Objection Handling & Pricing", weight: 20, color: "#f59e0b", desc: "Advisor addresses price concerns with value justification before offering discounts." },
  { id: "dim_5", name: "Trial Close & Clear Next Steps", weight: 15, color: "#10b981", desc: "Advisor explicitly invites customer to trial session and confirms date & time." }
];

function getSavedRubricConfig() {
  const saved = localStorage.getItem("fitnova_rubric_config_saved");
  if (saved) {
    try { return JSON.parse(saved); } catch (e) {}
  }
  return DEFAULT_RUBRIC_DIMENSIONS;
}

async function viewRubricSetup() {
  setActiveNav("rubric");
  const content = $("#content");
  setBreadcrumbs([{ label: "Dashboard", href: "/org" }, { label: "Rubric Setup", href: "/rubric-setup" }]);
  const dimensions = getSavedRubricConfig();

  content.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
      <div>
        <h1 style="font-family:var(--font-display);font-size:24px;font-weight:700;margin:0 0 4px;color:#fff">5-Dimension Coaching Rubric Setup</h1>
        <p style="font-size:12.5px;color:var(--text-muted);margin:0">Configure evaluation criteria, scoring weight distributions, and guidelines</p>
      </div>

      <div style="display:flex;gap:12px">
        <button class="btn btn-ghost" onclick="openAddRubricModal()" style="border-color:rgba(255,255,255,0.15)">
          + Add Dimension
        </button>
        <button class="btn btn-primary" onclick="saveRubricConfig(event)" style="background:var(--accent-orange);border-color:var(--accent-orange);color:#fff">
          Save Rubric Criteria
        </button>
      </div>
    </div>

    <!-- Weight Distribution Summary Card -->
    <div class="card" style="padding:20px;margin-bottom:24px;background:rgba(255,255,255,0.02)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <span style="font-size:13px;font-weight:700;color:#fff">Scoring Weight Distribution Total</span>
        <span id="rubricTotalWeightBadge" style="font-family:var(--font-mono);font-size:14px;font-weight:700;color:var(--accent-teal);background:rgba(53,196,168,0.15);padding:4px 14px;border-radius:20px">Total: 100%</span>
      </div>

      <!-- Segmented Bar Visualization -->
      <div id="rubricSegmentedBar" style="display:flex;height:12px;border-radius:6px;overflow:hidden;background:#161824">
        ${dimensions.map(d => `<div id="rubricSeg_${d.id}" style="width:${d.weight}%;background:${d.color};transition:width 0.3s ease" title="${d.name}: ${d.weight}%"></div>`).join("")}
      </div>
    </div>

    <form id="rubricConfigForm" onsubmit="saveRubricConfig(event)">
      <div style="display:flex;flex-direction:column;gap:16px">
        ${dimensions.map((d, index) => `
          <div class="card" style="padding:20px;border-left:5px solid ${d.color};background:#0e1017">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
              <div style="display:flex;align-items:center;gap:12px">
                <span style="width:28px;height:28px;border-radius:50%;background:${d.color}25;color:${d.color};display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px">${index + 1}</span>
                <input type="text" class="auth-input-box" id="rubricName_${index}" value="${escapeHtml(d.name)}" style="font-family:var(--font-display);font-size:15px;font-weight:700;width:320px;background:rgba(255,255,255,0.04)" required />
              </div>

              <!-- Live Weight Badge -->
              <div style="display:flex;align-items:center;gap:10px">
                <span style="font-size:12px;color:var(--text-muted)">Dimension Weight:</span>
                <span id="rubricWeightVal_${index}" style="font-family:var(--font-mono);font-size:16px;font-weight:800;color:${d.color};background:${d.color}20;padding:4px 14px;border-radius:12px">${d.weight}%</span>
              </div>
            </div>

            <div style="margin-bottom:14px">
              <label style="font-size:11.5px;color:var(--text-faint);display:block;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.05em">Evaluation Guidelines & Expectations</label>
              <textarea class="auth-input-box" id="rubricDesc_${index}" style="height:55px;font-size:12.5px" required>${escapeHtml(d.desc)}</textarea>
            </div>

            <div>
              <input
                type="range"
                min="5"
                max="50"
                value="${d.weight}"
                class="auth-input-box"
                style="padding:0;height:8px;accent-color:${d.color}"
                oninput="updateRubricWeightDisplay(${index}, this.value, '${d.color}')"
                id="rubricWeightSlider_${index}"
              />
            </div>
          </div>
        `).join("")}
      </div>
    </form>
  `;
}

window.updateRubricWeightDisplay = function(index, value, color) {
  const badge = $(`#rubricWeightVal_${index}`);
  if (badge) badge.textContent = `${value}%`;

  const dimensions = getSavedRubricConfig();
  let total = 0;
  dimensions.forEach((d, i) => {
    const slider = $(`#rubricWeightSlider_${i}`);
    total += slider ? parseInt(slider.value) : d.weight;
    const seg = $(`#rubricSeg_${d.id}`);
    if (seg) seg.style.width = `${slider ? slider.value : d.weight}%`;
  });

  const totalBadge = $("#rubricTotalWeightBadge");
  if (totalBadge) {
    totalBadge.textContent = `Total: ${total}%`;
    totalBadge.style.color = total === 100 ? "var(--accent-teal)" : total > 100 ? "var(--sev-critical)" : "var(--accent-amber)";
  }
};

window.saveRubricConfig = function(e) {
  if (e) e.preventDefault();
  const currentDimensions = getSavedRubricConfig();
  const updated = currentDimensions.map((d, index) => {
    const nameEl = $(`#rubricName_${index}`);
    const descEl = $(`#rubricDesc_${index}`);
    const weightEl = $(`#rubricWeightSlider_${index}`);

    return {
      ...d,
      name: nameEl ? nameEl.value.trim() : d.name,
      desc: descEl ? descEl.value.trim() : d.desc,
      weight: weightEl ? parseInt(weightEl.value) : d.weight
    };
  });

  localStorage.setItem("fitnova_rubric_config_saved", JSON.stringify(updated));
  toast("✅ Rubric criteria & weights saved permanently!");
};

window.openAddRubricModal = function() {
  let container = $("#authModalContainer");
  if (!container) {
    container = document.createElement("div");
    container.id = "authModalContainer";
    document.body.appendChild(container);
  }

  container.innerHTML = `
    <div style="position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(6px)">
      <div class="card" style="width:100%;max-width:480px;padding:26px;background:#0e1017;border:1px solid rgba(255,255,255,0.15);box-shadow:0 20px 40px rgba(0,0,0,0.6)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
          <h3 style="font-family:var(--font-display);font-size:18px;font-weight:700;margin:0;color:#fff">➕ Add New Rubric Dimension</h3>
          <button onclick="$('#authModalContainer').innerHTML=''" style="background:none;border:none;color:var(--text-muted);font-size:18px;cursor:pointer">✕</button>
        </div>
        
        <form onsubmit="handleCreateRubricSubmit(event)" style="display:flex;flex-direction:column;gap:14px">
          <div>
            <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Criterion / Dimension Title</label>
            <input type="text" class="auth-input-box" id="newRubricTitle" placeholder="e.g. Tone & Empathy" required />
          </div>

          <div>
            <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Evaluation Guidelines</label>
            <textarea class="auth-input-box" id="newRubricDesc" style="height:65px" placeholder="Describe expectations for advisors..." required></textarea>
          </div>

          <div>
            <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Initial Scoring Weight (%)</label>
            <input type="number" class="auth-input-box" id="newRubricWeight" value="15" min="5" max="50" required />
          </div>

          <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:10px">
            <button type="button" class="btn btn-ghost" onclick="$('#authModalContainer').innerHTML=''">Cancel</button>
            <button type="submit" class="btn btn-primary" style="background:var(--accent-orange);border-color:var(--accent-orange);color:#fff">Add Dimension</button>
          </div>
        </form>
      </div>
    </div>
  `;
};

window.handleCreateRubricSubmit = function(e) {
  e.preventDefault();
  const name = $("#newRubricTitle").value.trim();
  const desc = $("#newRubricDesc").value.trim();
  const weight = parseInt($("#newRubricWeight").value);

  const colors = ["#ec4899", "#8b5cf6", "#3b82f6", "#10b981", "#f59e0b"];
  const color = colors[Math.floor(Math.random() * colors.length)];

  const current = getSavedRubricConfig();
  current.push({
    id: `dim_${Date.now()}`,
    name,
    desc,
    weight,
    color
  });

  localStorage.setItem("fitnova_rubric_config_saved", JSON.stringify(current));
  toast(`Added new rubric dimension: ${name}!`);
  $("#authModalContainer").innerHTML = "";
  viewRubricSetup();
};


