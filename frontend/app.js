// LAP Agent Workbench — frontend.
//
// Every workflow here calls the real backend. The backend owns qualification state; this
// module only renders what it is told, which is why there is no eligibility logic below.

const API = "/api";

const state = {
  callId: null,
  call: null,
  scenarios: [],
  rules: null,
  busy: false,
};

// ---------------------------------------------------------------- utilities

const $ = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

let toastTimer = null;
function toast(message, kind = "info") {
  const el = $("toast");
  el.textContent = message;
  el.dataset.kind = kind;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, kind === "error" ? 6000 : 3000);
}

/** Single fetch wrapper so every endpoint gets the same error surface. */
async function api(path, { method = "GET", body } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = { raw: text }; }
  }

  if (!response.ok) {
    const detail = payload?.problems
      ? payload.problems.map((p) => `${p.field}: ${p.message}`).join("; ")
      : payload?.message ?? payload?.error ?? `HTTP ${response.status}`;
    throw new Error(detail);
  }
  return payload;
}

function formatINR(amount) {
  if (amount == null) return "—";
  if (amount >= 1e7) return `₹${(amount / 1e7).toFixed(2).replace(/\.?0+$/, "")} cr`;
  if (amount >= 1e5) return `₹${(amount / 1e5).toFixed(2).replace(/\.?0+$/, "")} L`;
  return `₹${amount.toLocaleString("en-IN")}`;
}

function formatTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

const FIELD_LABELS = {
  property_type: "Property type",
  ownership_status: "Ownership",
  documents_available: "Documents",
  requested_loan_amount: "Loan amount",
  occupation_income: "Occupation & income",
  market_value: "Market value",
  tenure_years: "Tenure",
};

const MONEY_FIELDS = new Set(["requested_loan_amount", "market_value", "adjusted_loan_amount"]);

function formatValue(field, value) {
  if (value == null) return "—";
  if (MONEY_FIELDS.has(field)) return formatINR(value);
  if (field === "tenure_years") return `${value} yr`;
  return String(value).replace(/_/g, " ");
}

// ---------------------------------------------------------------- tabs

function initTabs() {
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => activate(tab));
    // Arrow-key navigation is expected of a tablist.
    tab.addEventListener("keydown", (event) => {
      const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      if (delta === 0) return;
      event.preventDefault();
      const next = tabs[(index + delta + tabs.length) % tabs.length];
      next.focus();
      activate(next);
    });
  });

  function activate(tab) {
    for (const other of tabs) {
      const selected = other === tab;
      other.setAttribute("aria-selected", String(selected));
      other.classList.toggle("is-active", selected);
      const panel = $(other.getAttribute("aria-controls"));
      panel.hidden = !selected;
      panel.classList.toggle("is-active", selected);
    }
    if (tab.id === "tab-history") refreshHistory();
    if (tab.id === "tab-prompt") loadPrompt();
  }
}

// ---------------------------------------------------------------- status bar

async function loadStatus() {
  try {
    const [provider, health] = await Promise.all([api("/provider"), api("/health")]);

    const pill = $("provider-pill");
    pill.dataset.mode = provider.mode;
    pill.title = provider.note;
    $("provider-label").textContent = `${provider.provider} · ${provider.mode}`;

    $("llm-label").textContent = health.llm.enabled
      ? `understanding: ${health.llm.model}`
      : "understanding: rule-based";
    $("llm-pill").title = health.llm.enabled
      ? "Claude structured extraction, with rule-based fallback."
      : "No ANTHROPIC_API_KEY configured — deterministic rule extraction only.";
  } catch (error) {
    $("provider-label").textContent = "backend unreachable";
    toast(`Could not reach the backend: ${error.message}`, "error");
  }
}

// ---------------------------------------------------------------- scenarios

async function loadScenarios() {
  const container = $("scenario-list");
  try {
    state.scenarios = await api("/scenarios");
    container.setAttribute("aria-busy", "false");

    if (state.scenarios.length === 0) {
      container.innerHTML = '<p class="empty">No scenarios defined.</p>';
      return;
    }

    container.innerHTML = state.scenarios.map((scenario) => `
      <button type="button" class="scenario" data-scenario="${escapeHtml(scenario.id)}">
        <span class="scenario__label">${escapeHtml(scenario.label)}</span>
        <span class="scenario__hint">${escapeHtml(scenario.hint)}</span>
        <span class="scenario__meta">${scenario.turns} turns → ${escapeHtml(scenario.expect.status)}</span>
      </button>`).join("");

    container.querySelectorAll("[data-scenario]").forEach((button) => {
      button.addEventListener("click", () => runScenario(button.dataset.scenario));
    });
  } catch (error) {
    container.setAttribute("aria-busy", "false");
    container.innerHTML = `<p class="empty">Could not load scenarios: ${escapeHtml(error.message)}</p>`;
  }
}

async function runScenario(scenarioId) {
  if (state.busy) return;
  setBusy(true);
  try {
    const created = await api("/calls", { method: "POST", body: { ...readConfig(), scenarioId } });
    state.callId = created.id;
    const result = await api(`/calls/${created.id}/run-scenario`, {
      method: "POST",
      body: { scenarioId },
    });
    render(result);

    const expected = result.scenario?.expect?.status;
    const actual = result.state.qualification_status;
    if (expected && expected !== actual) {
      toast(`Scenario finished as "${actual}" but expected "${expected}".`, "error");
    } else {
      toast(`Scenario complete → ${actual}`);
    }
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setBusy(false);
  }
}

// ---------------------------------------------------------------- call control

function readConfig() {
  return {
    customer_name: $("customer_name").value.trim(),
    agent_name: $("agent_name").value.trim() || undefined,
    agent_gender: $("agent_gender").value,
    language_to_speak: $("language_to_speak").value,
    company_name: $("company_name").value.trim() || undefined,
    additional_context_from_rag: $("rag").value.trim(),
  };
}

function validateConfig() {
  const input = $("customer_name");
  const error = $("customer_name-error");
  const valid = input.value.trim().length > 0;
  error.hidden = valid;
  input.setAttribute("aria-invalid", String(!valid));
  return valid;
}

function setBusy(busy) {
  state.busy = busy;
  document.querySelector(".col--setup").classList.toggle("is-loading", busy);
  $("btn-send").disabled = busy || !state.callId || isTerminal();
  $("btn-start").disabled = busy;
}

function isTerminal() {
  const status = state.call?.state?.qualification_status;
  return ["qualified", "disqualified", "transfer", "callback", "declined"].includes(status);
}

async function startCall(event) {
  event.preventDefault();
  if (!validateConfig()) {
    $("customer_name").focus();
    return;
  }
  setBusy(true);
  try {
    const created = await api("/calls", { method: "POST", body: readConfig() });
    state.callId = created.id;
    render(created);
    $("utterance").focus();
    toast("Call started.");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setBusy(false);
  }
}

async function sendTurn(event) {
  event.preventDefault();
  const input = $("utterance");
  const utterance = input.value.trim();
  if (!utterance || !state.callId || state.busy) return;

  setBusy(true);
  try {
    const result = await api(`/calls/${state.callId}/turn`, {
      method: "POST",
      body: { utterance },
    });
    input.value = "";
    render(result);

    if (result.ignored) toast("Call already concluded — utterance logged but ignored.");
    else if (result.extraction?.degraded) toast("Understanding layer degraded — used rule-based extraction.");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setBusy(false);
    if (!isTerminal()) $("utterance").focus();
  }
}

function resetCall() {
  state.callId = null;
  state.call = null;
  $("transcript").innerHTML = `
    <div class="empty-state">
      <p class="empty-state__title">No active call</p>
      <p>Configure the call on the left and press <strong>Start call</strong>, or run a scripted scenario.</p>
    </div>`;
  $("checklist").innerHTML = '<li class="empty">Start a call to begin.</li>';
  for (const id of ["out-status", "out-gate", "out-amount", "out-reason"]) $(id).textContent = "—";
  for (const id of ["state-json", "history-json", "vars-json"]) $(id).textContent = "—";
  $("decision-explain").hidden = true;
  const chip = $("status-chip");
  chip.textContent = "no active call";
  chip.dataset.status = "idle";
  $("utterance").disabled = true;
  $("btn-send").disabled = true;
  $("btn-reset").disabled = true;
  $("turn-note").hidden = true;
}

// ---------------------------------------------------------------- rendering

const GATE_REASONS = {
  not_verified: "Customer identity is not yet confirmed.",
  checklist_incomplete: "Not all seven checklist items are answered.",
  transfer_flow: "Routed to the loan-transfer specialist, so no senior-expert handoff.",
  disqualified: "A disqualifying answer was given.",
  callback_requested: "Customer asked to be called back.",
  amount_alternative_unresolved: "The ₹75 lakh alternative offer has not been accepted.",
  agricultural_property_not_eligible: "Agricultural property is not eligible.",
  original_documents_required: "Original documents are required.",
  cash_income_not_eligible: "Cash income is not eligible.",
  tenure_out_of_range: "Tenure must be 3–15 years.",
};

const OUTCOME_TEXT = {
  qualified: "All seven items answered and every criterion passed. A senior loan expert handoff is recorded.",
  disqualified: "Qualification stopped on a deterministic rule. No further questions were asked.",
  transfer: "Existing loan or EMI-reduction request detected — routed to the loan-transfer specialist.",
  callback: "Customer was busy. A callback time was requested; nothing is actually scheduled.",
  declined: "Customer chose not to proceed. The call was closed politely.",
};

function render(payload) {
  state.call = payload;
  renderTranscript(payload.transcript);
  renderChecklist(payload);
  renderOutcome(payload);

  $("state-json").textContent = JSON.stringify(payload.state, null, 2);
  $("history-json").textContent = payload.state.answer_history?.length
    ? JSON.stringify(payload.state.answer_history, null, 2)
    : "No corrections recorded.";
  $("vars-json").textContent = JSON.stringify(payload.prompt_variables, null, 2);

  const terminal = isTerminal();
  $("utterance").disabled = terminal;
  $("btn-send").disabled = terminal || state.busy;
  $("btn-reset").disabled = false;

  const note = $("turn-note");
  if (terminal) {
    note.textContent = "This call has concluded. Press “End & reset” to start another.";
    note.hidden = false;
  } else {
    note.hidden = true;
  }
}

function renderTranscript(transcript) {
  const container = $("transcript");
  if (!transcript?.length) {
    container.innerHTML = '<div class="empty-state"><p>No turns yet.</p></div>';
    return;
  }
  container.innerHTML = transcript.map((turn) => `
    <div class="turn turn--${turn.role === "agent" ? "agent" : "customer"}">
      <span class="turn__meta">${turn.role === "agent" ? "Agent" : "Customer"} · ${formatTime(turn.ts)}</span>
      <div class="turn__bubble">${escapeHtml(turn.text)}</div>
    </div>`).join("");
  container.scrollTop = container.scrollHeight;
}

function renderChecklist(payload) {
  const current = payload.state.current_checklist_item;
  $("checklist").innerHTML = payload.checklist.map((item) => {
    const values = Object.entries(item.values)
      .map(([field, value]) => formatValue(field, value))
      .filter((text) => text !== "—");
    return `
      <li class="item" data-answered="${item.answered}" data-current="${item.id === current}">
        <span class="checklist__num">${item.item}</span>
        <span class="checklist__name">${escapeHtml(FIELD_LABELS[item.id] ?? item.id)}</span>
        <span class="checklist__value">${escapeHtml(values.length ? values.join(" · ") : "—")}</span>
      </li>`;
  }).join("");
}

function renderOutcome(payload) {
  const status = payload.state.qualification_status;
  const chip = $("status-chip");
  chip.textContent = status.replace(/_/g, " ");
  chip.dataset.status = status;

  $("out-status").textContent = status;

  const gate = payload.handoff_gate;
  $("out-gate").textContent = gate.ok ? "open" : `blocked (${gate.reason})`;

  const amount = payload.effective_loan_amount;
  const adjusted = payload.state.adjusted_loan_amount;
  $("out-amount").textContent = adjusted
    ? `${formatINR(adjusted)} (capped from ${formatINR(payload.state.requested_loan_amount)})`
    : formatINR(amount);

  $("out-reason").textContent = payload.state.termination_reason ?? "—";

  const explain = $("decision-explain");
  const parts = [];
  if (OUTCOME_TEXT[status]) parts.push(OUTCOME_TEXT[status]);
  if (payload.state.disqualification_rule) {
    parts.push(`Rule applied: ${payload.state.disqualification_rule}.`);
  }
  if (!gate.ok && status === "in_progress" && GATE_REASONS[gate.reason]) {
    parts.push(GATE_REASONS[gate.reason]);
  }
  if (parts.length) {
    explain.textContent = parts.join(" ");
    explain.dataset.kind = status;
    explain.hidden = false;
  } else {
    explain.hidden = true;
  }
}

// ---------------------------------------------------------------- history

async function refreshHistory() {
  const body = $("history-body");
  try {
    const [calls, callbacks] = await Promise.all([api("/calls"), api("/callbacks")]);

    body.innerHTML = calls.length === 0
      ? '<tr><td colspan="7" class="empty">No calls yet.</td></tr>'
      : calls.map((call) => `
        <tr>
          <td>${escapeHtml(call.customer_name)}</td>
          <td>${escapeHtml(call.language)}</td>
          <td><span class="tag" data-status="${escapeHtml(call.status)}">${escapeHtml(call.status)}</span></td>
          <td>${escapeHtml(call.termination_reason ?? "—")}</td>
          <td>${call.turns}</td>
          <td>${formatTime(call.createdAt)}</td>
          <td><button type="button" class="btn btn--small" data-open="${escapeHtml(call.id)}">Open</button></td>
        </tr>`).join("");

    body.querySelectorAll("[data-open]").forEach((button) => {
      button.addEventListener("click", async () => {
        try {
          const call = await api(`/calls/${button.dataset.open}`);
          state.callId = call.id;
          render(call);
          document.getElementById("tab-workspace").click();
        } catch (error) {
          toast(error.message, "error");
        }
      });
    });

    $("callback-body").innerHTML = callbacks.length === 0
      ? '<tr><td colspan="3" class="empty">None.</td></tr>'
      : callbacks.map((row) => `
        <tr>
          <td>${escapeHtml(row.customer_name)}</td>
          <td>${escapeHtml(row.requested_time ?? "not stated")}</td>
          <td><span class="tag">${row.scheduled ? "scheduled" : "request only"}</span></td>
        </tr>`).join("");
  } catch (error) {
    body.innerHTML = `<tr><td colspan="7" class="empty">Could not load history: ${escapeHtml(error.message)}</td></tr>`;
  }
}

// ---------------------------------------------------------------- prompt

async function loadPrompt() {
  const pre = $("prompt-text");
  try {
    const language = $("prompt-language").value;
    const data = await api(`/prompt?language=${encodeURIComponent(language)}`);
    pre.textContent = data.rendered;

    $("prompt-vars").innerHTML = Object.entries(data.variables).map(([key, value]) => `
      <div class="var">
        <span class="var__key">{{${escapeHtml(key)}}}</span>
        <span class="var__val">${escapeHtml(String(value).slice(0, 160) || "—")}</span>
      </div>`).join("");

    if (data.unresolved.length > 0) {
      toast(`Prompt has unresolved variables: ${data.unresolved.join(", ")}`, "error");
    }
  } catch (error) {
    pre.textContent = `Could not load the prompt: ${error.message}`;
  }
}

// ---------------------------------------------------------------- knowledge & rules

async function loadRules() {
  const container = $("rules-view");
  try {
    state.rules = await api("/rules");
    const r = state.rules;

    const chips = (values, kind) => values
      .map((value) => `<span class="rule-chip" data-kind="${kind}">${escapeHtml(value)}</span>`)
      .join("");

    container.innerHTML = `
      <div class="rule-group">
        <h4>Property type</h4>
        <div class="rule-list">${chips(r.property_types.eligible, "ok")}${chips(r.property_types.disqualifying, "bad")}</div>
      </div>
      <div class="rule-group">
        <h4>Ownership</h4>
        <div class="rule-list">${chips(r.ownership.eligible, "ok")}</div>
        <p class="rule-note">Joint ownership is eligible.</p>
      </div>
      <div class="rule-group">
        <h4>Documents</h4>
        <div class="rule-list">${chips(r.documents.eligible, "ok")}${chips(r.documents.disqualifying, "bad")}</div>
      </div>
      <div class="rule-group">
        <h4>Loan amount</h4>
        <div class="rule-list">
          <span class="rule-chip" data-kind="ok">≤ ${formatINR(r.max_loan)}</span>
          <span class="rule-chip" data-kind="bad">&gt; ${formatINR(r.max_loan)} → offer cap</span>
        </div>
        <p class="rule-note">Above the cap the customer is offered ${formatINR(r.max_loan)}; only an explicit decline ends the call.</p>
      </div>
      <div class="rule-group">
        <h4>Income mode</h4>
        <div class="rule-list">${chips(r.income.eligible, "ok")}${chips(r.income.disqualifying, "bad")}</div>
      </div>
      <div class="rule-group">
        <h4>Tenure</h4>
        <div class="rule-list"><span class="rule-chip" data-kind="ok">${r.tenure.min}–${r.tenure.max} years inclusive</span></div>
      </div>
      <div class="rule-group">
        <h4>Market value</h4>
        <div class="rule-list"><span class="rule-chip" data-kind="ok">no threshold</span></div>
        <p class="rule-note">${escapeHtml(r.market_value.note)}</p>
      </div>`;
  } catch (error) {
    container.textContent = `Could not load rules: ${error.message}`;
  }
}

async function loadKnowledge() {
  const list = $("kb-list");
  try {
    const data = await api("/knowledge");
    list.innerHTML = data.entries.map((entry) => `
      <li><code>${escapeHtml(entry.id)}</code><br />${escapeHtml(entry.text)}</li>`).join("")
      + `<li><code>deferred</code><br />${escapeHtml(data.note)}</li>`;
  } catch (error) {
    list.innerHTML = `<li class="empty">Could not load: ${escapeHtml(error.message)}</li>`;
  }
}

async function queryKnowledge(event) {
  event.preventDefault();
  const question = $("kb-question").value.trim();
  if (!question) return;
  const box = $("kb-result");
  try {
    const result = await api("/knowledge/query", { method: "POST", body: { question } });
    const kind = result.deferred ? "deferred" : result.hit ? "hit" : "miss";
    const label = result.deferred
      ? `deferred → ${result.deferred}`
      : result.hit ? `grounded answer (${result.id})` : "no grounded answer";
    const text = result.deferred
      ? "The agent defers this to the senior loan expert and states no figure."
      : result.hit ? result.text
      : "The agent says it does not have the information rather than inventing one.";
    box.dataset.kind = kind;
    box.innerHTML = `<p class="kb-result__label">${escapeHtml(label)}</p><p>${escapeHtml(text)}</p>`;
    box.hidden = false;
  } catch (error) {
    box.dataset.kind = "miss";
    box.textContent = error.message;
    box.hidden = false;
  }
}

// ---------------------------------------------------------------- boot

function init() {
  initTabs();
  $("config-form").addEventListener("submit", startCall);
  $("turn-form").addEventListener("submit", sendTurn);
  $("btn-reset").addEventListener("click", resetCall);
  $("btn-refresh-history").addEventListener("click", refreshHistory);
  $("prompt-language").addEventListener("change", loadPrompt);
  $("kb-form").addEventListener("submit", queryKnowledge);
  $("customer_name").addEventListener("input", () => {
    if ($("customer_name").getAttribute("aria-invalid") === "true") validateConfig();
  });

  $("btn-copy-prompt").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("prompt-text").textContent);
      toast("Rendered prompt copied.");
    } catch {
      toast("Clipboard unavailable — select the text manually.", "error");
    }
  });

  loadStatus();
  loadScenarios();
  loadRules();
  loadKnowledge();
}

document.addEventListener("DOMContentLoaded", init);
