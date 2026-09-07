import { element } from "./render.js";
import { journeyRequest, journeySession } from "./journeyApi.js";
import { normalizeJourneyDraft } from "./journeyModel.js";

export const PENDING_SAVE_KEY = "feeveto_pending_account_save_v1";
export function readPendingSave(storage) {
  try {
    const value = JSON.parse(storage?.getItem(PENDING_SAVE_KEY));
    return value?.requestKey && value?.draft
      ? { ...value, draft: normalizeJourneyDraft(value.draft) }
      : null;
  } catch {
    return null;
  }
}
export function initializeSavedAudits({
  getClerk,
  getValue,
  onOpen,
  onPending = () => {},
  sessionStorage,
}) {
  const byId = (id) => document.getElementById(id);
  const saveButton = byId("save-assessment"),
    message = byId("save-status"),
    list = byId("saved-audit-list"),
    history = byId("saved-audit-history");
  let pending = readPendingSave(sessionStorage),
    currentId = "",
    currentOwner = "",
    owner = "",
    epoch = 0,
    saving = false,
    loading = 0;
  function storePending() {
    try {
      if (pending)
        sessionStorage?.setItem(PENDING_SAVE_KEY, JSON.stringify(pending));
      else sessionStorage?.removeItem(PENDING_SAVE_KEY);
    } catch {
      message.textContent =
        "Answers are kept in this tab, but sign-in recovery storage is unavailable. Return here after signing in.";
    }
  }
  function clearPending() {
    pending = null;
    storePending();
  }
  function label() {
    saveButton.textContent = currentId
      ? "Save a new dated assessment"
      : "Save this audit";
  }
  const session = () => journeySession(getClerk);
  async function loadList(offset = 0) {
    const request = ++loading,
      revision = epoch;
    byId("saved-audits-status").textContent = "Loading your account audits…";
    try {
      const { clerk, user, token } = await session();
      if (revision !== epoch) return;
      if (!user || !token) {
        byId("saved-audits-status").textContent =
          "Sign in to open your account audits. Browser-saved subscriptions remain below.";
        if (clerk) clerk.openSignIn();
        return;
      }
      const value = await journeyRequest(`audits?offset=${offset}`, { token });
      if (request !== loading || revision !== epoch) return;
      if (!offset) list.replaceChildren();
      for (const audit of value.audits) {
        const card = element("article", "saved-audit-card");
        card.append(
          element("h3", "", audit.title),
          element(
            "p",
            "",
            `${audit.versions} dated ${audit.versions === 1 ? "assessment" : "assessments"} · updated ${new Date(audit.updated_at).toLocaleString()}`,
          ),
        );
        const open = element("button", "button button-secondary", "Open audit");
        open.type = "button";
        open.addEventListener("click", () => void openAudit(audit.audit_id));
        card.append(open);
        list.append(card);
      }
      byId("saved-audits-status").textContent = value.audits.length
        ? "Your account-owned audits. Opening history does not change it."
        : "No account audits yet. Personalise a result, then choose Save this audit.";
      byId("saved-audits-more").hidden = value.nextOffset === null;
      byId("saved-audits-more").dataset.offset = value.nextOffset;
    } catch (error) {
      if (request === loading && revision === epoch)
        byId("saved-audits-status").textContent = error.message;
    }
  }
  function displayVersion(version) {
    currentId = version.auditId;
    currentOwner = owner;
    label();
    onOpen(version);
    message.textContent = version.restricted
      ? version.message
      : `Saved assessment from ${new Date(version.createdAt).toLocaleString()}. Reevaluate to add a new version.`;
    byId("reevaluate-assessment").hidden = false;
  }
  async function openAudit(id, before) {
    const revision = epoch,
      request = ++loading;
    try {
      const { token, user } = await session();
      if (revision !== epoch || !user) return;
      const value = await journeyRequest(
        `audits?id=${encodeURIComponent(id)}${before ? `&before=${before}` : ""}`,
        { token },
      );
      if (revision !== epoch || request !== loading) return;
      owner = user;
      if (!before) {
        history.replaceChildren();
        displayVersion(value.versions[0]);
      }
      for (const version of value.versions) {
        const button = element(
          "button",
          "text-button",
          `${new Date(version.createdAt).toLocaleString()} · version ${version.version}`,
        );
        button.type = "button";
        button.addEventListener("click", () => displayVersion(version));
        history.append(button);
      }
      byId("saved-history-more").hidden = value.nextBefore === null;
      byId("saved-history-more").onclick = () =>
        void openAudit(id, value.nextBefore);
      byId("saved-history-title").hidden = false;
    } catch (error) {
      if (revision === epoch)
        byId("saved-audits-status").textContent = error.message;
    }
  }
  async function finishSave() {
    if (saving || !pending) return;
    saving = true;
    saveButton.disabled = true;
    const revision = epoch,
      ticket = pending;
    try {
      const { clerk, user, token } = await session();
      if (revision !== epoch || pending !== ticket) return;
      onPending();
      saveButton.hidden = false;
      if (!user || !token) {
        message.textContent = clerk
          ? "Sign in to finish saving. Your completed answers are kept."
          : "Sign-in is not configured in this preview. Your completed answers are kept on this device.";
        if (clerk) clerk.openSignIn();
        return;
      }
      if (ticket.expectedOwner && ticket.expectedOwner !== user) {
        clearPending();
        message.textContent =
          "The account changed. Open an audit belonging to this account or save a new one.";
        return;
      }
      ticket.expectedOwner = user;
      storePending();
      owner = user;
      message.textContent = "Saving a fresh, dated assessment to your account…";
      const value = await journeyRequest("audits", { token, body: ticket });
      if (revision !== epoch || pending !== ticket) return;
      clearPending();
      displayVersion(value.saved);
      void loadList();
    } catch (error) {
      if (revision === epoch && pending === ticket) {
        onPending();
        saveButton.hidden = false;
        message.textContent = `${error.message} Choose Save again to retry without creating a duplicate.`;
      }
    } finally {
      saving = false;
      saveButton.disabled = false;
      if (revision !== epoch && pending && owner)
        queueMicrotask(() => void finishSave());
    }
  }
  async function startSave({ reevaluate = false } = {}) {
    if (saving) return;
    if (!pending) {
      const value = getValue();
      if (!value?.draft || (!value.assessment && !reevaluate)) {
        message.textContent = "Create your personal assessment first.";
        return;
      }
      pending = {
        draft: normalizeJourneyDraft(value.draft),
        marketCurrency: value.marketCurrency,
        requestKey: crypto.randomUUID(),
        auditId: currentId,
        expectedOwner: currentId ? currentOwner : "",
      };
      storePending();
    }
    await finishSave();
  }
  async function authChanged() {
    const revision = ++epoch;
    loading++;
    list.replaceChildren();
    history.replaceChildren();
    byId("saved-history-title").hidden = true;
    byId("saved-history-more").hidden = true;
    byId("saved-audits-more").hidden = true;
    let user;
    try {
      ({ user } = await session());
    } catch (error) {
      if (revision === epoch)
        byId("saved-audits-status").textContent = error.message;
      return;
    }
    if (revision !== epoch) return;
    if (owner && user !== owner) {
      currentId = "";
      currentOwner = "";
      if (pending?.expectedOwner) clearPending();
    }
    owner = user;
    label();
    byId("reevaluate-assessment").hidden = true;
    byId("saved-audits-status").textContent = user
      ? "Your saved audits are ready to open."
      : "Sign in to open account audits. Your local audit still works without an account.";
    if (pending && user) void finishSave();
  }
  saveButton.addEventListener("click", () => void startSave());
  byId("reevaluate-assessment").addEventListener("click", () => {
    if (saving) return;
    clearPending();
    void startSave({ reevaluate: true });
  });
  byId("load-saved-audits").addEventListener("click", () => void loadList());
  byId("saved-audits-more").addEventListener(
    "click",
    (event) => void loadList(Number(event.target.dataset.offset)),
  );
  document.addEventListener("feeveto:access-change", () => void authChanged());
  void authChanged();
  return {
    draftChanged({ newAudit = false } = {}) {
      clearPending();
      if (newAudit) {
        currentId = "";
        currentOwner = "";
      }
      label();
      byId("reevaluate-assessment").hidden = !currentId;
      message.textContent = saving
        ? "Your new draft is kept. The earlier save may finish separately; check your account history."
        : "";
    },
    assessmentReady() {
      saveButton.hidden = false;
      label();
    },
    hideSave() {
      saveButton.hidden = true;
    },
    loadList,
  };
}
