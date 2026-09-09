import React, { useState, useEffect, useMemo } from "react";

/* ---------- palette: ledger-paper green, one rust signal ---------- */
const C = {
  paper: "#E4EAE1",
  surface: "#F7F9F5",
  rule: "#BFCDBC",
  ruleSoft: "#D8E1D5",
  ink: "#1F2C25",
  inkSoft: "#5C6F64",
  inkFaint: "#93A399",
  late: "#A63A28",
  soon: "#A87B18",
  launch: "#2C5A73",
  slack: "#42548C",
  ok: "#4A7A5C",
};
const SERIF =
  "'Iowan Old Style','Hoefler Text',Palatino,'Palatino Linotype',Georgia,serif";
const SANS =
  "Inter,ui-sans-serif,system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif";
const KEY = "meetinglog:v2";
const OLD_KEY = "meetinglog:v1";

/* Claude's artifact storage when it's there, the browser's own when running as a site */
const store = {
  async get(k) {
    if (typeof window !== "undefined" && window.storage) return window.storage.get(k);
    const v = typeof localStorage !== "undefined" ? localStorage.getItem(k) : null;
    if (v === null) throw new Error("nothing stored under that key");
    return { key: k, value: v };
  },
  async set(k, v) {
    if (typeof window !== "undefined" && window.storage) return window.storage.set(k, v);
    localStorage.setItem(k, v);
    return { key: k, value: v };
  },
};

/* set window.__AI_ENDPOINT__ to route through your own proxy when self-hosting */
const ENDPOINT =
  (typeof window !== "undefined" && window.__AI_ENDPOINT__) ||
  "https://api.anthropic.com/v1/messages";

/* ---------- the rituals, as agreed ---------- */
const KICKOFF = [
  { id: "goals", label: "Goals and KPIs agreed in writing" },
  { id: "budget", label: "Budget, flight dates and pacing targets confirmed" },
  { id: "tracking", label: "Tracking live and a test conversion verified" },
  { id: "creative", label: "Assets received and the approval process agreed" },
  { id: "reporting", label: "Weekly report recipients and send day agreed" },
  { id: "slack", label: "Shared Slack channel open with the partner" },
  { id: "golive", label: "Go-live notification list confirmed" },
  { id: "escalation", label: "Escalation path agreed for when it goes off plan" },
];
const SLACK_STATES = [
  { v: "none", label: "Not set up" },
  { v: "requested", label: "Requested" },
  { v: "live", label: "Live" },
];
const CADENCES = [
  { v: "two_months", label: "Every 2 months", days: 61 },
  { v: "twice_monthly", label: "Twice a month", days: 15 },
];
const REPORT_SECTIONS = [
  ["snapshot", "Performance snapshot"],
  ["pacing", "Pacing"],
  ["top", "Top performing accounts and platforms"],
  ["optimizations", "Optimization suggestions"],
];
const ISSUE_STATES = [
  { v: "open", label: "Open" },
  { v: "working", label: "Working it" },
  { v: "resolved", label: "Resolved" },
];

/* ---------- dates ---------- */
const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
const todayISO = () => iso(new Date());
const parseISO = (s) => {
  if (!s || typeof s !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s.trim());
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return isNaN(d.getTime()) ? null : d;
};
const daysOut = (s) => {
  const d = parseISO(s);
  if (!d) return null;
  return Math.round((d - parseISO(todayISO())) / 86400000);
};
const addDays = (s, k) => {
  const d = parseISO(s) || new Date();
  d.setDate(d.getDate() + k);
  return iso(d);
};
const fmtDate = (s) => {
  const d = parseISO(s);
  if (!d) return "no date";
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  });
};
const relLabel = (n) => {
  if (n === null) return "no date";
  if (n < 0) return `${Math.abs(n)} ${Math.abs(n) === 1 ? "day" : "days"} late`;
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n <= 30) return `in ${n} days`;
  return `in ${Math.round(n / 7)} weeks`;
};
const urgencyColor = (n) => {
  if (n === null) return C.inkFaint;
  if (n < 0) return C.late;
  if (n <= 3) return C.soon;
  return C.inkSoft;
};

/* ---------- shaping model output ---------- */
const arr = (v) => (Array.isArray(v) ? v.filter(Boolean) : []);
const str = (v) => (typeof v === "string" ? v.trim() : "");
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str(v));
const uid = (p) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

function blankClient(company) {
  return {
    company,
    email: "",
    notify: "",
    slack: { status: "none", channel: "" },
    kickoff: { date: null, done: false, checklist: {}, notes: "" },
    reporting: { on: true, lastSent: null, lastReport: null },
    checkin: { cadence: "two_months", last: null },
    issues: [],
  };
}
/* older saved shapes get filled in rather than dropped */
function hydrateClient(c, company) {
  const b = blankClient(company || (c && c.company) || "Untitled");
  if (!c) return b;
  return {
    ...b,
    ...c,
    company: str(c.company) || b.company,
    slack:
      typeof c.slack === "object" && c.slack
        ? { ...b.slack, ...c.slack }
        : { status: c.slack === "yes" ? "live" : "none", channel: "" },
    kickoff: { ...b.kickoff, ...(c.kickoff || {}) },
    reporting: { ...b.reporting, ...(c.reporting || {}) },
    checkin: { ...b.checkin, ...(c.checkin || {}) },
    issues: arr(c.issues),
  };
}

function normalizeMeeting(raw, data, who, known) {
  const fu = data && typeof data.follow_up === "object" ? data.follow_up : {};
  return {
    id: uid("m"),
    raw,
    company: str(data.company) || str(who) || "Untitled meeting",
    kind: data.kind === "kickoff" ? "kickoff" : data.kind === "checkin" ? "checkin" : "call",
    email: isEmail(data.email) ? str(data.email) : (known && known.email) || "",
    slackMentioned: data.shared_slack === true,
    attendees: arr(data.attendees).map(str).filter(Boolean),
    meeting_date: parseISO(data.meeting_date) ? str(data.meeting_date) : todayISO(),
    summary: str(data.summary),
    decisions: arr(data.decisions).map(str).filter(Boolean),
    action_items: arr(data.action_items)
      .map((a) => ({
        what: str(a && a.what),
        owner: a && a.owner === "them" ? "them" : "me",
        due: parseISO(a && a.due) ? str(a.due) : null,
        done: false,
      }))
      .filter((a) => a.what),
    campaigns: arr(data.campaigns)
      .map((c) => ({
        name: str(c && c.name),
        launch_date: parseISO(c && c.launch_date) ? str(c.launch_date) : null,
        channels: str(c && c.channels),
        notes: str(c && c.notes),
        notified: false,
      }))
      .filter((c) => c.name),
    problems: arr(data.problems).map(str).filter(Boolean),
    open_questions: arr(data.open_questions).map(str).filter(Boolean),
    follow_up: {
      due: parseISO(fu.due) ? str(fu.due) : addDays(todayISO(), 7),
      type: str(fu.type) || "check-in",
      reason: str(fu.reason),
      done: false,
    },
  };
}

async function askClaude(system, prompt) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      system,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const data = await res.json();
  const text = (data.content || [])
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a === -1 || b === -1) throw new Error("No JSON in response");
  return JSON.parse(text.slice(a, b + 1));
}

const structureNotes = (rawNotes, who, known) =>
  askClaude(
    "You turn messy post-meeting notes into a structured record for a partner-marketing team. Reply with one JSON object and nothing else: no prose, no markdown fences.",
    `Today is ${todayISO()}.${who ? `\nThe meeting was with: ${who}` : ""}${
      known && known.email ? `\nOn file for this client: ${known.email}` : ""
    }

Raw notes:
"""
${rawNotes}
"""

Return a single JSON object with exactly these keys:
{
  "company": string,
  "kind": "kickoff" or "checkin" or "call",
  "attendees": string[],
  "email": string or null,
  "shared_slack": true or false,
  "meeting_date": "YYYY-MM-DD",
  "summary": string,
  "decisions": string[],
  "action_items": [{"what": string, "owner": "me" or "them", "due": "YYYY-MM-DD" or null}],
  "campaigns": [{"name": string, "launch_date": "YYYY-MM-DD" or null, "channels": string, "notes": string}],
  "problems": string[],
  "open_questions": string[],
  "follow_up": {"due": "YYYY-MM-DD", "type": string, "reason": string}
}

Rules:
- kind: "kickoff" if this was a kick-off call, "checkin" if a routine check-in, otherwise "call".
- email: the client's email if one appears in the notes, otherwise null. Never invent one.
- shared_slack: true only if the notes mention a shared Slack channel with the partner.
- problems: anything that went off plan, is at risk, or is underdelivering. Empty array if none.
- Resolve relative dates like "next Thursday" against today's date.
- meeting_date is today unless the notes say otherwise.
- campaigns: only what the partner is actually launching or running.
- follow_up.due: always choose a date. 7 days out by default, sooner if time-critical, and shortly before a campaign launch if one is coming.
- summary: two sentences at most. Keep list items under 15 words.
- Do not invent facts that are not in the notes.`
  );

const draftReport = (company, campaigns, numbers) =>
  askClaude(
    "You write the weekly partner performance report for a partner-marketing team. Reply with one JSON object and nothing else: no prose, no markdown fences.",
    `Week ending ${todayISO()}. Partner: ${company}.${
      campaigns.length ? `\nLive or upcoming campaigns: ${campaigns.join("; ")}` : ""
    }

This week's raw numbers and observations:
"""
${numbers}
"""

Return a single JSON object:
{
  "snapshot": string,
  "pacing": string,
  "top": string[],
  "optimizations": string[],
  "off_plan": string or null
}

Rules:
- snapshot: two or three sentences on how performance went. Use the actual figures given.
- pacing: whether spend and delivery are ahead, on, or behind plan, and by roughly how much. Say plainly if there is not enough information to judge.
- top: up to five lines naming the best performing accounts and platforms, each with the number that makes it notable.
- optimizations: two to four concrete recommended actions, each one short sentence.
- off_plan: one sentence naming anything that is off plan and needs a decision, or null if all is well.
- Use only the figures provided. Never invent numbers. If something is missing, say what is missing.`
  );

/* ---------- atoms ---------- */
const inputStyle = {
  fontFamily: SANS,
  fontSize: 14,
  color: C.ink,
  background: C.surface,
  border: `1px solid ${C.rule}`,
  borderRadius: 2,
  padding: "7px 9px",
  width: "100%",
  outline: "none",
};

const Field = ({ label, children }) => (
  <label className="block">
    <span
      className="block mb-1"
      style={{ fontFamily: SANS, fontSize: 12, color: C.inkSoft }}
    >
      {label}
    </span>
    {children}
  </label>
);

const Btn = ({ children, onClick, kind = "quiet", disabled }) => {
  const base = {
    fontFamily: SANS,
    fontSize: 13,
    borderRadius: 2,
    padding: "8px 14px",
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.45 : 1,
  };
  const kinds = {
    solid: { background: C.ink, color: C.surface, border: `1px solid ${C.ink}` },
    quiet: { background: "transparent", color: C.inkSoft, border: `1px solid ${C.rule}` },
    bare: {
      background: "transparent",
      color: C.inkSoft,
      border: "1px solid transparent",
      padding: "4px 6px",
      fontSize: 12,
    },
  };
  return (
    <button onClick={disabled ? undefined : onClick} disabled={disabled} style={{ ...base, ...kinds[kind] }}>
      {children}
    </button>
  );
};

const Choice = ({ options, value, onChange, size = 13, tone = C.slack }) => (
  <div className="flex gap-2 flex-wrap">
    {options.map((o) => (
      <button
        key={o.v}
        onClick={() => onChange(o.v)}
        style={{
          fontFamily: SANS,
          fontSize: size,
          borderRadius: 2,
          padding: size < 13 ? "4px 9px" : "7px 11px",
          cursor: "pointer",
          background: value === o.v ? tone : "transparent",
          color: value === o.v ? C.surface : C.inkSoft,
          border: `1px solid ${value === o.v ? tone : C.rule}`,
        }}
      >
        {o.label}
      </button>
    ))}
  </div>
);

const Head = ({ children, size = 20 }) => (
  <h2
    className="pb-2"
    style={{
      fontFamily: SERIF,
      fontSize: size,
      color: C.ink,
      borderBottom: `1px solid ${C.rule}`,
    }}
  >
    {children}
  </h2>
);

const Meta = ({ children, color }) => (
  <span style={{ fontFamily: SANS, fontSize: 12.5, color: color || C.inkSoft }}>
    {children}
  </span>
);

const Body = ({ children, color }) => (
  <p
    style={{
      fontFamily: SANS,
      fontSize: 13.5,
      lineHeight: 1.6,
      color: color || C.ink,
      maxWidth: "68ch",
    }}
  >
    {children}
  </p>
);

/* ---------- cadence maths ---------- */
const cadenceDays = (v) => (CADENCES.find((c) => c.v === v) || CADENCES[0]).days;

function clientDue(client, firstSeen) {
  const anchor = client.kickoff.date || firstSeen || todayISO();
  const report = client.reporting.on
    ? addDays(client.reporting.lastSent || anchor, 7)
    : null;
  const checkin = addDays(client.checkin.last || anchor, cadenceDays(client.checkin.cadence));
  return { report, checkin };
}

/* ---------- intake ---------- */
function Intake({ onFiled, clients }) {
  const [who, setWho] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState(null);

  const known = clients[who.trim().toLowerCase()] || null;

  const run = async () => {
    if (!notes.trim()) return;
    setBusy(true);
    setError("");
    try {
      const data = await structureNotes(notes.trim(), who.trim(), known);
      setDraft(normalizeMeeting(notes.trim(), data, who.trim(), known));
    } catch (e) {
      setError("Couldn't sort those notes. File them as-is and set the dates yourself.");
    }
    setBusy(false);
  };

  if (draft)
    return (
      <ReviewDraft
        draft={draft}
        setDraft={setDraft}
        known={known}
        onFile={() => {
          onFiled(draft);
          setDraft(null);
          setNotes("");
          setWho("");
        }}
        onDiscard={() => setDraft(null)}
      />
    );

  return (
    <div className="p-4 sm:p-5" style={{ background: C.surface, border: `1px solid ${C.rule}` }}>
      <div className="grid gap-3">
        <div>
          <Field label="Which partner?">
            <input
              style={inputStyle}
              value={who}
              onChange={(e) => setWho(e.target.value)}
              placeholder="Partner or company"
            />
          </Field>
          {known && (
            <p className="mt-1">
              <Meta>
                {known.email || "no email yet"} ·{" "}
                <span style={{ color: known.slack.status === "live" ? C.slack : C.inkFaint }}>
                  {known.slack.status === "live"
                    ? `shared channel ${known.slack.channel || "live"}`
                    : "no shared channel"}
                </span>
                {known.kickoff.done ? " · kicked off" : " · kick-off outstanding"}
              </Meta>
            </p>
          )}
        </div>
        <Field label="Paste your notes, however rough">
          <textarea
            style={{ ...inputStyle, minHeight: 128, lineHeight: 1.55, resize: "vertical" }}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={
              "kickoff w sarah + dev at acme. autumn bundle goes live oct 14, paid social + email. tracking not tested yet. sarah.k@acme.com. set up shared channel next week. creative due the 1st"
            }
          />
        </Field>
      </div>
      <div className="flex items-center gap-3 mt-3 flex-wrap">
        <Btn kind="solid" onClick={run} disabled={busy || !notes.trim()}>
          {busy ? "Sorting your notes…" : "Sort out these notes"}
        </Btn>
        {error && (
          <>
            <Meta color={C.late}>{error}</Meta>
            <Btn
              onClick={() => {
                setDraft(
                  normalizeMeeting(notes.trim(), {}, who.trim() || notes.trim().slice(0, 40), known)
                );
                setError("");
              }}
            >
              File as-is
            </Btn>
          </>
        )}
      </div>
    </div>
  );
}

function ReviewDraft({ draft, setDraft, known, onFile, onDiscard }) {
  const set = (patch) => setDraft({ ...draft, ...patch });
  const setFU = (patch) => setDraft({ ...draft, follow_up: { ...draft.follow_up, ...patch } });
  const setCampaign = (i, patch) =>
    setDraft({
      ...draft,
      campaigns: draft.campaigns.map((c, j) => (j === i ? { ...c, ...patch } : c)),
    });

  return (
    <div className="p-4 sm:p-5" style={{ background: C.surface, border: `1px solid ${C.ink}` }}>
      <Meta>Check the dates before this goes in the log.</Meta>

      <div className="grid gap-3 mt-4 sm:grid-cols-3">
        <Field label="Partner">
          <input style={inputStyle} value={draft.company} onChange={(e) => set({ company: e.target.value })} />
        </Field>
        <Field label="Met on">
          <input
            type="date"
            style={inputStyle}
            value={draft.meeting_date}
            onChange={(e) => set({ meeting_date: e.target.value })}
          />
        </Field>
        <Field label="Their email">
          <input
            style={inputStyle}
            value={draft.email}
            placeholder="name@company.com"
            onChange={(e) => set({ email: e.target.value })}
          />
        </Field>
      </div>

      <div className="grid gap-3 mt-3 sm:grid-cols-3">
        <Field label="This was a">
          <Choice
            size={12.5}
            tone={C.ink}
            value={draft.kind}
            onChange={(v) => set({ kind: v })}
            options={[
              { v: "kickoff", label: "Kick-off" },
              { v: "checkin", label: "Check-in" },
              { v: "call", label: "Other call" },
            ]}
          />
        </Field>
        <Field label="Follow up by">
          <input
            type="date"
            style={inputStyle}
            value={draft.follow_up.due}
            onChange={(e) => setFU({ due: e.target.value })}
          />
        </Field>
        <Field label="Follow-up is a">
          <input style={inputStyle} value={draft.follow_up.type} onChange={(e) => setFU({ type: e.target.value })} />
        </Field>
      </div>

      {draft.kind === "kickoff" && (
        <p className="mt-3">
          <Meta color={C.launch}>
            Filing this starts {draft.company}&rsquo;s kick-off checklist and sets the weekly report
            clock running.
          </Meta>
        </p>
      )}
      {draft.slackMentioned && known && known.slack.status !== "live" && (
        <p className="mt-1">
          <Meta color={C.slack}>
            Your notes mention a shared channel — mark it live on the Partners tab once it&rsquo;s open.
          </Meta>
        </p>
      )}

      {draft.campaigns.length > 0 && (
        <div className="mt-5">
          <Meta>Campaigns picked up from the notes</Meta>
          {draft.campaigns.map((c, i) => (
            <div key={i} className="grid gap-3 mt-2 sm:grid-cols-3">
              <input style={inputStyle} value={c.name} onChange={(e) => setCampaign(i, { name: e.target.value })} />
              <input
                type="date"
                style={inputStyle}
                value={c.launch_date || ""}
                onChange={(e) => setCampaign(i, { launch_date: e.target.value || null })}
              />
              <input
                style={inputStyle}
                value={c.channels}
                placeholder="Channels"
                onChange={(e) => setCampaign(i, { channels: e.target.value })}
              />
            </div>
          ))}
        </div>
      )}

      <div className="mt-5 pt-4" style={{ borderTop: `1px solid ${C.ruleSoft}` }}>
        <MeetingBody m={draft} />
      </div>

      <div className="flex gap-3 mt-5">
        <Btn kind="solid" onClick={onFile}>
          Put it in the log
        </Btn>
        <Btn onClick={onDiscard}>Start over</Btn>
      </div>
    </div>
  );
}

/* ---------- the spine: everything waiting on you ---------- */
/* ---------- one place that works out everything on the horizon ---------- */
function setupGaps(clients) {
  const out = [];
  Object.values(clients).forEach((c) => {
    const missing = [];
    if (!c.kickoff.done) missing.push("kick-off sign-off");
    if (c.slack.status !== "live")
      missing.push(c.slack.status === "requested" ? "Slack channel (requested)" : "Slack channel");
    if (!c.notify) missing.push("go-live list");
    if (missing.length)
      out.push({
        key: c.company.toLowerCase(),
        company: c.company,
        detail: missing.join(", "),
        tone: c.kickoff.done ? C.slack : C.late,
        rank: c.kickoff.done ? 1 : 0,
      });
  });
  return out.sort((a, b) => a.rank - b.rank || a.company.localeCompare(b.company));
}

/* every recurrence of a ritual between two dates, so the calendar can look ahead */
function recurrences(startISO, stepDays, fromISO, toISO) {
  const out = [];
  if (!startISO || !stepDays) return out;
  let d = startISO;
  let guard = 0;
  while (d < fromISO && guard < 500) {
    d = addDays(d, stepDays);
    guard += 1;
  }
  while (d <= toISO && guard < 500) {
    out.push(d);
    d = addDays(d, stepDays);
    guard += 1;
  }
  return out;
}

function buildAgenda({ meetings, clients, firstSeen, fromISO, toISO, repeat }) {
  const booked = {};
  meetings.forEach((m) => {
    if (m.follow_up.done) return;
    const k = m.company.toLowerCase();
    booked[k] = booked[k] || [];
    booked[k].push(m.follow_up.due);
  });
  const alreadyBooked = (key, date) =>
    (booked[key] || []).some((d) => Math.abs(daysOut(d) - daysOut(date)) <= 10);

  const items = [];

  Object.values(clients).forEach((c) => {
    const key = c.company.toLowerCase();
    const due = clientDue(c, firstSeen[key]);

    if (due.report) {
      const dates = repeat ? recurrences(due.report, 7, fromISO, toISO) : [due.report];
      dates.forEach((d) =>
        items.push({ kind: "report", date: d, label: c.company, detail: "weekly report due", key })
      );
    }

    const cad = cadenceDays(c.checkin.cadence);
    const cadLabel = `${(CADENCES.find((x) => x.v === c.checkin.cadence) || CADENCES[0]).label.toLowerCase()} check-in`;
    const dates = repeat ? recurrences(due.checkin, cad, fromISO, toISO) : [due.checkin];
    dates.forEach((d) => {
      if (!repeat && alreadyBooked(key, d)) return;
      items.push({ kind: "checkin", date: d, label: c.company, detail: cadLabel, key });
    });
  });

  meetings.forEach((m) => {
    if (!m.follow_up.done)
      items.push({
        kind: "follow",
        date: m.follow_up.due,
        label: m.company,
        detail: m.follow_up.type,
        id: m.id,
        key: m.company.toLowerCase(),
      });
    m.campaigns.forEach((c, ci) => {
      if (!c.launch_date) return;
      const n = daysOut(c.launch_date);
      if (n >= 0)
        items.push({
          kind: "launch",
          date: c.launch_date,
          label: c.name,
          detail: `${m.company} goes live`,
          key: m.company.toLowerCase(),
        });
      if (n !== null && n <= 0 && !c.notified)
        items.push({
          kind: "notify",
          date: c.launch_date,
          label: c.name,
          detail: `email the go-live notice for ${m.company}`,
          id: m.id,
          ci,
          key: m.company.toLowerCase(),
        });
    });
  });

  const weight = (it) => (it.kind === "notify" ? -1000 : daysOut(it.date) ?? 9999);
  return items.sort((a, b) => weight(a) - weight(b));
}

const KIND_TONE = {
  report: C.ink,
  checkin: C.ok,
  follow: C.soon,
  launch: C.launch,
  notify: C.late,
};
const KIND_WORD = {
  report: "Report",
  checkin: "Check-in",
  follow: "Follow-up",
  launch: "Launch",
  notify: "Go-live notice",
};

/* ---------- the spine, grouped so late things can't hide ---------- */
function Rail({ meetings, clients, firstSeen, onDone, onSnooze, onJump, onNotified }) {
  const [showAll, setShowAll] = useState(false);

  const { setup, buckets, hiddenCount } = useMemo(() => {
    const all = buildAgenda({ meetings, clients, firstSeen, repeat: false });
    const groups = [
      { id: "late", title: "Late", tone: C.late, items: [] },
      { id: "now", title: "Today and tomorrow", tone: C.soon, items: [] },
      { id: "week", title: "This week", tone: C.ink, items: [] },
      { id: "soon", title: "Next fortnight", tone: C.inkSoft, items: [] },
      { id: "later", title: "Further out", tone: C.inkFaint, items: [] },
    ];
    all.forEach((it) => {
      const n = daysOut(it.date);
      const g =
        n === null ? 4 : n < 0 ? 0 : n <= 1 ? 1 : n <= 7 ? 2 : n <= 14 ? 3 : 4;
      groups[g].items.push(it);
    });
    const shown = showAll ? groups : groups.slice(0, 4);
    return {
      setup: setupGaps(clients),
      buckets: shown.filter((g) => g.items.length),
      hiddenCount: showAll ? 0 : groups[4].items.length,
    };
  }, [meetings, clients, firstSeen, showAll]);

  const setupVisible = showAll ? setup : setup.slice(0, 3);
  const nothing = !setup.length && !buckets.length && !hiddenCount;

  if (nothing)
    return <Meta color={C.inkFaint}>Nothing waiting on you. File a meeting to start the clocks.</Meta>;

  return (
    <div>
      {setupVisible.length > 0 && (
        <div className="pb-2">
          <p className="pt-3 pb-1">
            <Meta color={C.inkFaint}>Not set up yet</Meta>
          </p>
          {setupVisible.map((it, i) => (
            <div
              key={it.key}
              className="flex gap-3 py-2 cursor-pointer"
              onClick={() => onJump(it.key)}
              style={{ borderTop: i ? `1px solid ${C.ruleSoft}` : "none" }}
            >
              <div className="shrink-0" style={{ width: 3, background: it.tone, borderRadius: 2 }} />
              <div className="min-w-0">
                <div style={{ fontFamily: SERIF, fontSize: 16, color: C.ink }}>{it.company}</div>
                <Meta>{it.detail}</Meta>
              </div>
            </div>
          ))}
          {!showAll && setup.length > 3 && (
            <Meta color={C.inkFaint}>and {setup.length - 3} more partner(s)</Meta>
          )}
        </div>
      )}

      {buckets.map((g) => (
        <div key={g.id} className="pt-4">
          <div
            className="flex items-baseline gap-2 pb-1"
            style={{ borderBottom: `1px solid ${C.ruleSoft}` }}
          >
            <span style={{ fontFamily: SANS, fontSize: 11.5, color: g.tone, letterSpacing: "0.02em" }}>
              {g.title}
            </span>
            <Meta color={C.inkFaint}>{g.items.length}</Meta>
          </div>
          {g.items.map((it, i) => {
            const n = daysOut(it.date);
            const col = KIND_TONE[it.kind] || C.inkSoft;
            return (
              <div
                key={i}
                className="flex gap-3 py-2"
                style={{ borderTop: i ? `1px solid ${C.ruleSoft}` : "none" }}
              >
                <div className="shrink-0" style={{ width: 3, background: col, borderRadius: 2 }} />
                <div className="min-w-0 grow">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span style={{ fontFamily: SERIF, fontSize: 16.5, color: C.ink, lineHeight: 1.25 }}>
                      {it.label}
                    </span>
                    <Meta color={g.id === "late" ? C.late : C.inkSoft}>{relLabel(n)}</Meta>
                  </div>
                  <Meta>
                    {it.detail} · {fmtDate(it.date)}
                  </Meta>
                  <div className="flex gap-1 mt-1 flex-wrap">
                    {it.kind === "follow" && (
                      <>
                        <Btn kind="bare" onClick={() => onDone(it.id)}>
                          Done
                        </Btn>
                        <Btn kind="bare" onClick={() => onSnooze(it.id, 7)}>
                          Push a week
                        </Btn>
                      </>
                    )}
                    {(it.kind === "report" || it.kind === "checkin") && (
                      <Btn kind="bare" onClick={() => onJump(it.key)}>
                        Open {it.label}
                      </Btn>
                    )}
                    {it.kind === "notify" && (
                      <Btn kind="bare" onClick={() => onNotified(it.id, it.ci)}>
                        Notice sent
                      </Btn>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ))}

      {(hiddenCount > 0 || showAll) && (
        <div className="pt-3 mt-2" style={{ borderTop: `1px solid ${C.ruleSoft}` }}>
          <Btn kind="bare" onClick={() => setShowAll(!showAll)}>
            {showAll ? "Show only what's near" : `Show what's further out (${hiddenCount})`}
          </Btn>
        </div>
      )}
    </div>
  );
}

/* ---------- meeting body ---------- */
function MeetingBody({ m, onToggleAction }) {
  const Section = ({ title, children }) => (
    <div className="mt-3">
      <Meta>{title}</Meta>
      {children}
    </div>
  );
  const li = { fontFamily: SANS, fontSize: 13.5, color: C.ink, lineHeight: 1.6 };

  return (
    <div>
      {m.summary && (
        <p style={{ fontFamily: SERIF, fontSize: 16, lineHeight: 1.6, color: C.ink, maxWidth: "62ch" }}>
          {m.summary}
        </p>
      )}

      {m.problems.length > 0 && (
        <div
          className="mt-3 p-3"
          style={{ background: C.paper, borderLeft: `3px solid ${C.late}` }}
        >
          <Meta color={C.late}>Off plan</Meta>
          <ul>
            {m.problems.map((p, i) => (
              <li key={i} style={li}>
                {p}
              </li>
            ))}
          </ul>
        </div>
      )}

      {m.action_items.length > 0 && (
        <Section title="To do">
          <ul>
            {m.action_items.map((a, i) => (
              <li key={i} className="flex items-start gap-2" style={li}>
                <input
                  type="checkbox"
                  checked={!!a.done}
                  onChange={() => onToggleAction && onToggleAction(i)}
                  disabled={!onToggleAction}
                  style={{ marginTop: 5, accentColor: C.ok }}
                />
                <span
                  style={{
                    textDecoration: a.done ? "line-through" : "none",
                    color: a.done ? C.inkFaint : C.ink,
                  }}
                >
                  {a.what}
                  <span style={{ color: C.inkFaint, fontSize: 12 }}>
                    {" "}
                    — {a.owner === "me" ? "mine" : "theirs"}
                    {a.due ? `, ${fmtDate(a.due)}` : ""}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {m.campaigns.length > 0 && (
        <Section title="Campaigns">
          <ul>
            {m.campaigns.map((c, i) => (
              <li key={i} style={li}>
                <span style={{ color: C.launch }}>{c.name}</span>
                {c.launch_date ? ` — live ${fmtDate(c.launch_date)}` : " — no date yet"}
                {c.channels ? ` · ${c.channels}` : ""}
                {c.notes ? <span style={{ color: C.inkSoft }}> · {c.notes}</span> : null}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {m.decisions.length > 0 && (
        <Section title="Decided">
          <ul>
            {m.decisions.map((d, i) => (
              <li key={i} style={li}>
                {d}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {m.open_questions.length > 0 && (
        <Section title="Still open">
          <ul>
            {m.open_questions.map((q, i) => (
              <li key={i} style={{ ...li, color: C.inkSoft }}>
                {q}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function LogEntry({ m, client, isNewest, onToggleAction, onDelete }) {
  const [open, setOpen] = useState(false);
  const [invite, setInvite] = useState(false);
  const n = daysOut(m.follow_up.due);
  const kindLabel = m.kind === "kickoff" ? "Kick-off" : m.kind === "checkin" ? "Check-in" : null;

  return (
    <div
      className="py-4"
      style={{ borderTop: `1px solid ${C.rule}`, animation: isNewest ? "settle 700ms ease-out" : "none" }}
    >
      <div className="flex items-baseline gap-3 flex-wrap cursor-pointer" onClick={() => setOpen(!open)}>
        <span style={{ fontFamily: SERIF, fontSize: 22, color: C.ink }}>{m.company}</span>
        {kindLabel && <Meta color={C.launch}>{kindLabel}</Meta>}
        <Meta>
          {fmtDate(m.meeting_date)}
          {m.attendees.length ? ` · ${m.attendees.join(", ")}` : ""}
        </Meta>
        <span className="grow" />
        <Meta color={m.follow_up.done ? C.ok : urgencyColor(n)}>
          {m.follow_up.done ? "followed up" : relLabel(n)}
        </Meta>
      </div>

      {!open && m.summary && (
        <p
          className="mt-1"
          style={{
            fontFamily: SANS,
            fontSize: 13.5,
            color: C.inkSoft,
            maxWidth: "70ch",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {m.summary}
        </p>
      )}

      {open && (
        <div className="mt-2">
          <p className="mb-3">
            <Meta>
              {(client && client.email) || m.email || "no email yet"}
              {client && client.slack.status === "live" ? (
                <span style={{ color: C.slack }}> · {client.slack.channel || "shared channel live"}</span>
              ) : null}
            </Meta>
          </p>
          <MeetingBody m={m} onToggleAction={(i) => onToggleAction(m.id, i)} />

          <div className="mt-4 flex gap-2 flex-wrap">
            <Btn kind="bare" onClick={() => setInvite(!invite)}>
              {invite ? "Hide invite text" : "Draft the invite"}
            </Btn>
            <Btn kind="bare" onClick={() => onDelete(m.id)}>
              Delete entry
            </Btn>
          </div>

          {invite && (
            <div
              className="mt-2 p-3"
              style={{
                background: C.paper,
                border: `1px dashed ${C.rule}`,
                fontFamily: SANS,
                fontSize: 13,
                color: C.ink,
                lineHeight: 1.6,
                whiteSpace: "pre-wrap",
                userSelect: "all",
              }}
            >
              {`${m.company} — ${m.follow_up.type}\n${fmtDate(
                m.follow_up.due
              )} · Google Meet · 30 min\nInvite: ${
                (client && client.email) || m.email || "no email on file yet"
              }${
                client && client.slack.status === "live"
                  ? ` — or post it in ${client.slack.channel || "the shared channel"}`
                  : ""
              }\n\nFollowing up on our ${fmtDate(m.meeting_date)} conversation.${
                m.follow_up.reason ? ` ${m.follow_up.reason}` : ""
              }${m.campaigns.length ? `\n\nTo cover: ${m.campaigns.map((c) => c.name).join(", ")}` : ""}${
                m.problems.length ? `\nStill outstanding: ${m.problems.join("; ")}` : ""
              }`}
            </div>
          )}

          {m.raw && (
            <details className="mt-3">
              <summary style={{ fontFamily: SANS, fontSize: 12, color: C.inkFaint, cursor: "pointer" }}>
                Original notes
              </summary>
              <div className="mt-2">
                <Body color={C.inkSoft}>{m.raw}</Body>
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- campaigns, with the go-live notice ---------- */
function Campaigns({ meetings, clients, onNotified }) {
  const rows = useMemo(() => {
    const out = [];
    meetings.forEach((m) =>
      m.campaigns.forEach((c, ci) => out.push({ ...c, company: m.company, id: m.id, ci }))
    );
    return out.sort((a, b) => {
      if (!a.launch_date) return 1;
      if (!b.launch_date) return -1;
      return a.launch_date < b.launch_date ? -1 : 1;
    });
  }, [meetings]);

  if (!rows.length)
    return (
      <div className="py-6">
        <Meta color={C.inkFaint}>
          No campaigns yet. Mention what a partner is launching in your notes and it lands here.
        </Meta>
      </div>
    );

  return (
    <div>
      {rows.map((c, i) => {
        const n = daysOut(c.launch_date);
        const live = n !== null && n <= 0;
        const client = clients[c.company.toLowerCase()];
        return (
          <div key={i} className="py-4 flex gap-4" style={{ borderTop: `1px solid ${C.ruleSoft}` }}>
            <div
              className="shrink-0"
              style={{ width: 92, fontFamily: SANS, fontSize: 13, color: live ? C.launch : n !== null && n < 7 ? C.soon : C.inkSoft }}
            >
              {fmtDate(c.launch_date)}
            </div>
            <div className="min-w-0 grow">
              <div style={{ fontFamily: SERIF, fontSize: 18, color: C.ink }}>{c.name}</div>
              <Meta>
                {c.company}
                {c.channels ? ` · ${c.channels}` : ""}
                {n !== null ? ` · ${live ? "live" : relLabel(n)}` : ""}
              </Meta>
              {c.notes && (
                <div className="mt-1">
                  <Body color={C.inkSoft}>{c.notes}</Body>
                </div>
              )}
              {live && (
                <div className="mt-2">
                  {c.notified ? (
                    <Meta color={C.ok}>Go-live notice sent</Meta>
                  ) : (
                    <div>
                      <Meta color={C.late}>Go-live notice not sent</Meta>
                      <div
                        className="mt-1 p-3"
                        style={{
                          background: C.paper,
                          border: `1px dashed ${C.rule}`,
                          fontFamily: SANS,
                          fontSize: 13,
                          color: C.ink,
                          lineHeight: 1.6,
                          whiteSpace: "pre-wrap",
                          userSelect: "all",
                        }}
                      >
                        {`To: ${(client && client.notify) || (client && client.email) || "no notification list set"}\nSubject: Live now — ${c.name} (${c.company})\n\n${c.name} is live as of ${fmtDate(c.launch_date)}${c.channels ? ` across ${c.channels}` : ""}.\n\nFirst weekly report follows within seven days. Anything urgent before then, reply here${client && client.slack.status === "live" ? ` or ping ${client.slack.channel || "the shared channel"}` : ""}.`}
                      </div>
                      <div className="mt-1">
                        <Btn kind="bare" onClick={() => onNotified(c.id, c.ci)}>
                          Mark notice sent
                        </Btn>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- weekly report drafting ---------- */
function ReportPanel({ client, campaigns, onSent }) {
  const [numbers, setNumbers] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [report, setReport] = useState(client.reporting.lastReport || null);

  const run = async () => {
    if (!numbers.trim()) return;
    setBusy(true);
    setError("");
    try {
      const r = await draftReport(client.company, campaigns, numbers.trim());
      setReport({
        date: todayISO(),
        snapshot: str(r.snapshot),
        pacing: str(r.pacing),
        top: arr(r.top).map(str).filter(Boolean),
        optimizations: arr(r.optimizations).map(str).filter(Boolean),
        off_plan: str(r.off_plan) || null,
      });
    } catch (e) {
      setError("Couldn't draft that. Check the numbers and try again.");
    }
    setBusy(false);
  };

  const text = report
    ? `${client.company} — weekly report, week ending ${fmtDate(report.date)}\n\nPerformance snapshot\n${
        report.snapshot
      }\n\nPacing\n${report.pacing}\n\nTop performing accounts and platforms\n${report.top
        .map((t) => `— ${t}`)
        .join("\n")}\n\nOptimization suggestions\n${report.optimizations
        .map((t) => `— ${t}`)
        .join("\n")}${report.off_plan ? `\n\nNeeds a decision\n${report.off_plan}` : ""}`
    : "";

  return (
    <div className="mt-3">
      <Field label="Paste this week's numbers and anything you noticed">
        <textarea
          style={{ ...inputStyle, minHeight: 92, lineHeight: 1.55, resize: "vertical" }}
          value={numbers}
          onChange={(e) => setNumbers(e.target.value)}
          placeholder="spend 12.4k of 15k budget, 310 conversions, cpa $40 vs $35 target. meta best at 41% of convs, tiktok flat. acct 'northside' 2x everyone else"
        />
      </Field>
      <div className="flex items-center gap-3 mt-2 flex-wrap">
        <Btn onClick={run} disabled={busy || !numbers.trim()}>
          {busy ? "Writing it up…" : "Draft the four sections"}
        </Btn>
        {error && <Meta color={C.late}>{error}</Meta>}
      </div>

      {report && (
        <div className="mt-3">
          <div
            className="p-3"
            style={{
              background: C.paper,
              border: `1px dashed ${C.rule}`,
              fontFamily: SANS,
              fontSize: 13,
              color: C.ink,
              lineHeight: 1.65,
              whiteSpace: "pre-wrap",
              userSelect: "all",
            }}
          >
            {text}
          </div>
          {report.off_plan && (
            <p className="mt-2">
              <Meta color={C.late}>
                Off plan — log it as an issue below so the problem solving is on the record.
              </Meta>
            </p>
          )}
          <div className="mt-2 flex gap-2 flex-wrap">
            <Btn kind="solid" onClick={() => onSent(report)}>
              Mark sent, reset the week
            </Btn>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- one partner, all the rituals ---------- */
function PartnerCard({ client, meetings, firstSeen, expanded, onExpand, onUpdate, onDelete }) {
  const [issue, setIssue] = useState({ what: "", tried: "", owner: "" });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const key = client.company.toLowerCase();
  const mine = meetings.filter((m) => m.company.toLowerCase() === key);
  const due = clientDue(client, firstSeen[key]);
  const reportN = due.report === null ? null : daysOut(due.report);
  const checkinN = daysOut(due.checkin);
  const doneCount = KICKOFF.filter((k) => client.kickoff.checklist[k.id]).length;
  const campaignNames = mine
    .flatMap((m) => m.campaigns.map((c) => `${c.name}${c.launch_date ? ` (live ${fmtDate(c.launch_date)})` : ""}`))
    .slice(0, 6);
  const openIssues = client.issues.filter((i) => i.status !== "resolved").length;

  const set = (patch) => onUpdate(client.company, patch);
  const setIn = (field, patch) => set({ [field]: { ...client[field], ...patch } });

  return (
    <div className="py-4" style={{ borderTop: `1px solid ${C.rule}` }}>
      <div className="flex items-baseline gap-3 flex-wrap cursor-pointer" onClick={() => onExpand(expanded ? null : key)}>
        <span style={{ fontFamily: SERIF, fontSize: 21, color: C.ink }}>{client.company}</span>
        <Meta>
          {mine.length} meeting{mine.length === 1 ? "" : "s"}
        </Meta>
        <span className="grow" />
        {!client.kickoff.done && <Meta color={C.late}>kick-off open</Meta>}
        {client.slack.status !== "live" && <Meta color={C.slack}>no channel</Meta>}
        {openIssues > 0 && (
          <Meta color={C.late}>
            {openIssues} issue{openIssues === 1 ? "" : "s"}
          </Meta>
        )}
        <Meta color={urgencyColor(reportN)}>
          {due.report ? `report ${relLabel(reportN)}` : "reporting off"}
        </Meta>
      </div>

      {!expanded && (
        <p className="mt-1">
          <Meta>
            {client.email || "no email yet"} · kick-off {doneCount}/{KICKOFF.length} · check-in{" "}
            {relLabel(checkinN)}
          </Meta>
        </p>
      )}

      {expanded && (
        <div className="mt-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Main contact email">
              <input
                style={inputStyle}
                value={client.email}
                placeholder="name@company.com"
                onChange={(e) => set({ email: e.target.value })}
              />
            </Field>
            <Field label="Go-live notification list">
              <input
                style={inputStyle}
                value={client.notify}
                placeholder="who gets the email when a campaign goes live"
                onChange={(e) => set({ notify: e.target.value })}
              />
            </Field>
          </div>

          {/* shared slack channel */}
          <div className="mt-5 pt-4" style={{ borderTop: `1px solid ${C.ruleSoft}` }}>
            <Meta>Shared Slack channel</Meta>
            <div className="grid gap-3 mt-2 sm:grid-cols-2 items-end">
              <Choice
                size={12.5}
                options={SLACK_STATES}
                value={client.slack.status}
                onChange={(v) => setIn("slack", { status: v })}
              />
              <input
                style={inputStyle}
                value={client.slack.channel}
                placeholder="#cf-partnername"
                onChange={(e) => setIn("slack", { channel: e.target.value })}
              />
            </div>
          </div>

          {/* kick-off */}
          <div className="mt-5 pt-4" style={{ borderTop: `1px solid ${C.ruleSoft}` }}>
            <div className="flex items-baseline gap-3 flex-wrap">
              <Meta>
                Kick-off call — {doneCount} of {KICKOFF.length} done
              </Meta>
              <span className="grow" />
              <Meta color={client.kickoff.done ? C.ok : C.late}>
                {client.kickoff.done ? `signed off ${fmtDate(client.kickoff.date)}` : "not signed off"}
              </Meta>
            </div>
            <div className="mt-2">
              {KICKOFF.map((k) => (
                <label key={k.id} className="flex items-start gap-2 py-1" style={{ cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={!!client.kickoff.checklist[k.id]}
                    onChange={() =>
                      setIn("kickoff", {
                        checklist: {
                          ...client.kickoff.checklist,
                          [k.id]: !client.kickoff.checklist[k.id],
                        },
                      })
                    }
                    style={{ marginTop: 4, accentColor: C.ok }}
                  />
                  <span
                    style={{
                      fontFamily: SANS,
                      fontSize: 13.5,
                      lineHeight: 1.5,
                      color: client.kickoff.checklist[k.id] ? C.inkFaint : C.ink,
                      textDecoration: client.kickoff.checklist[k.id] ? "line-through" : "none",
                    }}
                  >
                    {k.label}
                  </span>
                </label>
              ))}
            </div>
            <div className="grid gap-3 mt-3 sm:grid-cols-2 items-end">
              <Field label="Kick-off date">
                <input
                  type="date"
                  style={inputStyle}
                  value={client.kickoff.date || ""}
                  onChange={(e) => setIn("kickoff", { date: e.target.value || null })}
                />
              </Field>
              <div>
                <Btn
                  onClick={() =>
                    setIn("kickoff", {
                      done: !client.kickoff.done,
                      date: client.kickoff.date || todayISO(),
                    })
                  }
                >
                  {client.kickoff.done ? "Reopen kick-off" : "Sign off kick-off"}
                </Btn>
              </div>
            </div>
            {doneCount < KICKOFF.length && client.kickoff.done && (
              <p className="mt-2">
                <Meta color={C.soon}>Signed off with {KICKOFF.length - doneCount} item(s) still unticked.</Meta>
              </p>
            )}
          </div>

          {/* weekly reporting */}
          <div className="mt-5 pt-4" style={{ borderTop: `1px solid ${C.ruleSoft}` }}>
            <div className="flex items-baseline gap-3 flex-wrap">
              <Meta>Weekly reporting</Meta>
              <span className="grow" />
              <Meta color={urgencyColor(reportN)}>
                {client.reporting.on
                  ? `${client.reporting.lastSent ? `last sent ${fmtDate(client.reporting.lastSent)} · ` : ""}due ${relLabel(reportN)}`
                  : "paused"}
              </Meta>
            </div>
            <div className="mt-2">
              <Choice
                size={12.5}
                tone={C.ink}
                options={[
                  { v: "on", label: "Weekly" },
                  { v: "off", label: "Paused" },
                ]}
                value={client.reporting.on ? "on" : "off"}
                onChange={(v) => setIn("reporting", { on: v === "on" })}
              />
            </div>
            {client.reporting.on && (
              <ReportPanel
                client={client}
                campaigns={campaignNames}
                onSent={(report) => setIn("reporting", { lastSent: todayISO(), lastReport: report })}
              />
            )}
          </div>

          {/* check-ins */}
          <div className="mt-5 pt-4" style={{ borderTop: `1px solid ${C.ruleSoft}` }}>
            <div className="flex items-baseline gap-3 flex-wrap">
              <Meta>Check-in cadence</Meta>
              <span className="grow" />
              <Meta color={urgencyColor(checkinN)}>
                {client.checkin.last ? `last ${fmtDate(client.checkin.last)} · ` : ""}next {relLabel(checkinN)}
              </Meta>
            </div>
            <div className="flex gap-3 mt-2 flex-wrap items-center">
              <Choice
                size={12.5}
                tone={C.ink}
                options={CADENCES}
                value={client.checkin.cadence}
                onChange={(v) => setIn("checkin", { cadence: v })}
              />
              <Btn kind="bare" onClick={() => setIn("checkin", { last: todayISO() })}>
                Log one today
              </Btn>
            </div>
          </div>

          {/* problem solving */}
          <div className="mt-5 pt-4" style={{ borderTop: `1px solid ${C.ruleSoft}` }}>
            <Meta>When it doesn&rsquo;t go to plan</Meta>
            {client.issues.length > 0 && (
              <div className="mt-2">
                {client.issues.map((it) => (
                  <div key={it.id} className="py-2" style={{ borderTop: `1px solid ${C.ruleSoft}` }}>
                    <div className="flex items-baseline gap-3 flex-wrap">
                      <Body>{it.what}</Body>
                      <span className="grow" />
                      <Meta color={it.status === "resolved" ? C.ok : C.late}>{fmtDate(it.opened)}</Meta>
                    </div>
                    {it.tried && (
                      <Body color={C.inkSoft}>Tried: {it.tried}</Body>
                    )}
                    <div className="flex gap-3 mt-1 flex-wrap items-center">
                      <Choice
                        size={12}
                        tone={it.status === "resolved" ? C.ok : C.late}
                        options={ISSUE_STATES}
                        value={it.status}
                        onChange={(v) =>
                          set({
                            issues: client.issues.map((x) => (x.id === it.id ? { ...x, status: v } : x)),
                          })
                        }
                      />
                      {it.owner && <Meta>{it.owner}</Meta>}
                      <Btn
                        kind="bare"
                        onClick={() => set({ issues: client.issues.filter((x) => x.id !== it.id) })}
                      >
                        Remove
                      </Btn>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="grid gap-3 mt-3 sm:grid-cols-3 items-end">
              <Field label="What went wrong">
                <input
                  style={inputStyle}
                  value={issue.what}
                  onChange={(e) => setIssue({ ...issue, what: e.target.value })}
                />
              </Field>
              <Field label="What we tried">
                <input
                  style={inputStyle}
                  value={issue.tried}
                  onChange={(e) => setIssue({ ...issue, tried: e.target.value })}
                />
              </Field>
              <Field label="Owner">
                <input
                  style={inputStyle}
                  value={issue.owner}
                  onChange={(e) => setIssue({ ...issue, owner: e.target.value })}
                />
              </Field>
            </div>
            <div className="mt-2">
              <Btn
                disabled={!issue.what.trim()}
                onClick={() => {
                  set({
                    issues: [
                      { id: uid("i"), opened: todayISO(), status: "open", ...issue },
                      ...client.issues,
                    ],
                  });
                  setIssue({ what: "", tried: "", owner: "" });
                }}
              >
                Log the issue
              </Btn>
            </div>
          </div>

          <div className="mt-6 pt-4" style={{ borderTop: `1px solid ${C.ruleSoft}` }}>
            {confirmDelete ? (
              <div className="flex gap-2 flex-wrap items-center">
                <Meta color={C.late}>
                  Remove {client.company} and {mine.length} filed meeting
                  {mine.length === 1 ? "" : "s"}? This can't be undone.
                </Meta>
                <Btn kind="bare" onClick={() => onDelete(client.company)}>
                  Yes, remove
                </Btn>
                <Btn kind="bare" onClick={() => setConfirmDelete(false)}>
                  Keep them
                </Btn>
              </div>
            ) : (
              <Btn kind="bare" onClick={() => setConfirmDelete(true)}>
                Remove this partner
              </Btn>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- calendar ---------- */
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function Calendar({ meetings, clients, firstSeen, onJump, onDone, onNotified }) {
  const today = parseISO(todayISO());
  const [cursor, setCursor] = useState({ y: today.getFullYear(), m: today.getMonth() });
  const [picked, setPicked] = useState(todayISO());

  const grid = useMemo(() => {
    const first = new Date(cursor.y, cursor.m, 1);
    /* weeks start Monday */
    const lead = (first.getDay() + 6) % 7;
    const start = new Date(cursor.y, cursor.m, 1 - lead);
    const cells = [];
    for (let i = 0; i < 42; i += 1) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      cells.push({ iso: iso(d), inMonth: d.getMonth() === cursor.m, day: d.getDate() });
    }
    /* trim a trailing all-blank week */
    return cells.slice(0, cells.slice(35).some((c) => c.inMonth) ? 42 : 35);
  }, [cursor]);

  const byDay = useMemo(() => {
    if (!grid.length) return {};
    const items = buildAgenda({
      meetings,
      clients,
      firstSeen,
      fromISO: grid[0].iso,
      toISO: grid[grid.length - 1].iso,
      repeat: true,
    });
    const out = {};
    items.forEach((it) => {
      if (!it.date) return;
      out[it.date] = out[it.date] || [];
      out[it.date].push(it);
    });
    return out;
  }, [grid, meetings, clients, firstSeen]);

  const meetingsByDay = useMemo(() => {
    const out = {};
    meetings.forEach((m) => {
      out[m.meeting_date] = out[m.meeting_date] || [];
      out[m.meeting_date].push(m);
    });
    return out;
  }, [meetings]);

  const step = (delta) => {
    const d = new Date(cursor.y, cursor.m + delta, 1);
    setCursor({ y: d.getFullYear(), m: d.getMonth() });
  };

  const dayItems = byDay[picked] || [];
  const dayMeetings = meetingsByDay[picked] || [];

  return (
    <div>
      <div className="flex items-baseline gap-3 py-3 flex-wrap">
        <span style={{ fontFamily: SERIF, fontSize: 20, color: C.ink }}>
          {MONTHS[cursor.m]} {cursor.y}
        </span>
        <span className="grow" />
        <Btn kind="bare" onClick={() => step(-1)}>
          ‹ Previous
        </Btn>
        <Btn
          kind="bare"
          onClick={() => {
            setCursor({ y: today.getFullYear(), m: today.getMonth() });
            setPicked(todayISO());
          }}
        >
          Today
        </Btn>
        <Btn kind="bare" onClick={() => step(1)}>
          Next ›
        </Btn>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}>
        {DOW.map((d) => (
          <div key={d} className="pb-1" style={{ borderBottom: `1px solid ${C.rule}` }}>
            <span style={{ fontFamily: SANS, fontSize: 11, color: C.inkFaint }}>{d}</span>
          </div>
        ))}

        {grid.map((cell) => {
          const items = byDay[cell.iso] || [];
          const mtgs = meetingsByDay[cell.iso] || [];
          const isToday = cell.iso === todayISO();
          const isPicked = cell.iso === picked;
          return (
            <div
              key={cell.iso}
              onClick={() => setPicked(cell.iso)}
              className="p-1 cursor-pointer"
              style={{
                minHeight: 74,
                borderBottom: `1px solid ${C.ruleSoft}`,
                borderRight: `1px solid ${C.ruleSoft}`,
                background: isPicked ? C.surface : "transparent",
                opacity: cell.inMonth ? 1 : 0.38,
                outline: isToday ? `1px solid ${C.ink}` : "none",
              }}
            >
              <div
                style={{
                  fontFamily: SANS,
                  fontSize: 12,
                  color: isToday ? C.ink : C.inkSoft,
                  fontWeight: isToday ? 600 : 400,
                }}
              >
                {cell.day}
              </div>
              {items.slice(0, 2).map((it, i) => (
                <div
                  key={i}
                  className="mt-1 px-1"
                  style={{
                    background: KIND_TONE[it.kind],
                    color: C.surface,
                    fontFamily: SANS,
                    fontSize: 10,
                    borderRadius: 2,
                    overflow: "hidden",
                    whiteSpace: "nowrap",
                    textOverflow: "ellipsis",
                  }}
                >
                  {it.label}
                </div>
              ))}
              {items.length > 2 && (
                <div style={{ fontFamily: SANS, fontSize: 10, color: C.inkSoft, paddingLeft: 2 }}>
                  +{items.length - 2} more
                </div>
              )}
              {mtgs.length > 0 && (
                <div style={{ fontFamily: SANS, fontSize: 10, color: C.inkFaint, paddingLeft: 2 }}>
                  {mtgs.length} met
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-5 pt-3" style={{ borderTop: `1px solid ${C.rule}` }}>
        <span style={{ fontFamily: SERIF, fontSize: 18, color: C.ink }}>{fmtDate(picked)}</span>
        {dayItems.length === 0 && dayMeetings.length === 0 && (
          <p className="mt-1">
            <Meta color={C.inkFaint}>Nothing on this day.</Meta>
          </p>
        )}

        {dayItems.map((it, i) => (
          <div key={i} className="flex gap-3 py-2" style={{ borderTop: `1px solid ${C.ruleSoft}` }}>
            <div
              className="shrink-0"
              style={{ width: 3, background: KIND_TONE[it.kind], borderRadius: 2 }}
            />
            <div className="min-w-0 grow">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span style={{ fontFamily: SERIF, fontSize: 16.5, color: C.ink }}>{it.label}</span>
                <Meta color={KIND_TONE[it.kind]}>{KIND_WORD[it.kind]}</Meta>
              </div>
              <Meta>{it.detail}</Meta>
              <div className="flex gap-1 mt-1 flex-wrap">
                <Btn kind="bare" onClick={() => onJump(it.key)}>
                  Open partner
                </Btn>
                {it.kind === "follow" && (
                  <Btn kind="bare" onClick={() => onDone(it.id)}>
                    Done
                  </Btn>
                )}
                {it.kind === "notify" && (
                  <Btn kind="bare" onClick={() => onNotified(it.id, it.ci)}>
                    Notice sent
                  </Btn>
                )}
              </div>
            </div>
          </div>
        ))}

        {dayMeetings.map((m) => (
          <div key={m.id} className="py-2" style={{ borderTop: `1px solid ${C.ruleSoft}` }}>
            <div className="flex items-baseline gap-2 flex-wrap">
              <span style={{ fontFamily: SERIF, fontSize: 16.5, color: C.ink }}>{m.company}</span>
              <Meta color={C.inkFaint}>
                met — {m.kind === "kickoff" ? "kick-off" : m.kind === "checkin" ? "check-in" : "call"}
              </Meta>
            </div>
            {m.summary && <Meta>{m.summary}</Meta>}
          </div>
        ))}
      </div>

      <p className="mt-4">
        <Meta color={C.inkFaint}>
          Weekly reports and check-ins repeat forward from their last one, so future months show the
          rhythm rather than a single date.
        </Meta>
      </p>
    </div>
  );
}

/* ---------- app ---------- */
export default function MeetingLog() {
  const [meetings, setMeetings] = useState([]);
  const [clients, setClients] = useState({});
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("log");
  const [newest, setNewest] = useState(null);
  const [openClient, setOpenClient] = useState(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    (async () => {
      let loaded = null;
      try {
        const r = await store.get(KEY);
        loaded = r && r.value ? JSON.parse(r.value) : null;
      } catch (e) {
        /* nothing at v2 */
      }
      if (!loaded) {
        try {
          const r = await store.get(OLD_KEY);
          const old = r && r.value ? JSON.parse(r.value) : null;
          if (old && Array.isArray(old.meetings))
            loaded = { meetings: old.meetings, clients: old.contacts || {} };
        } catch (e) {
          /* nothing to migrate */
        }
      }
      if (loaded) {
        const ms = arr(loaded.meetings).map((m) => ({
          ...m,
          kind: m.kind || "call",
          problems: arr(m.problems),
          campaigns: arr(m.campaigns).map((c) => ({ ...c, notified: !!c.notified })),
        }));
        const cs = {};
        Object.keys(loaded.clients || {}).forEach((k) => {
          cs[k] = hydrateClient(loaded.clients[k]);
        });
        ms.forEach((m) => {
          const k = m.company.toLowerCase();
          if (!cs[k]) cs[k] = hydrateClient({ email: m.email }, m.company);
        });
        setMeetings(ms);
        setClients(cs);
      }
      setLoading(false);
    })();
  }, []);

  const persist = async (nextMeetings, nextClients = clients) => {
    setMeetings(nextMeetings);
    setClients(nextClients);
    try {
      await store.set(KEY, JSON.stringify({ meetings: nextMeetings, clients: nextClients }));
      setSaveError("");
    } catch (e) {
      setSaveError("That change didn't save. Try again in a moment.");
    }
  };

  /* when a partner was first seen, so the cadences have an anchor */
  const firstSeen = useMemo(() => {
    const out = {};
    meetings.forEach((m) => {
      const k = m.company.toLowerCase();
      if (!out[k] || m.meeting_date < out[k]) out[k] = m.meeting_date;
    });
    return out;
  }, [meetings]);

  const onFiled = (m) => {
    setNewest(m.id);
    const k = m.company.toLowerCase();
    const prev = clients[k] || blankClient(m.company);
    const next = {
      ...prev,
      company: m.company,
      email: m.email || prev.email,
      kickoff:
        m.kind === "kickoff" && !prev.kickoff.date
          ? { ...prev.kickoff, date: m.meeting_date }
          : prev.kickoff,
      checkin: m.kind === "checkin" ? { ...prev.checkin, last: m.meeting_date } : prev.checkin,
      issues: m.problems.length
        ? [
            ...m.problems.map((p) => ({
              id: uid("i"),
              opened: m.meeting_date,
              status: "open",
              what: p,
              tried: "",
              owner: "",
            })),
            ...prev.issues,
          ]
        : prev.issues,
    };
    persist([m, ...meetings], { ...clients, [k]: next });
    setTab("log");
  };

  const onUpdateClient = (company, patch) => {
    const k = company.toLowerCase();
    const prev = clients[k] || blankClient(company);
    persist(meetings, { ...clients, [k]: { ...prev, ...patch } });
  };
  const onDone = (id) =>
    persist(meetings.map((m) => (m.id === id ? { ...m, follow_up: { ...m.follow_up, done: true } } : m)));
  const onSnooze = (id, k) =>
    persist(
      meetings.map((m) =>
        m.id === id
          ? {
              ...m,
              follow_up: {
                ...m.follow_up,
                due: addDays(daysOut(m.follow_up.due) < 0 ? todayISO() : m.follow_up.due, k),
              },
            }
          : m
      )
    );
  const onToggleAction = (id, i) =>
    persist(
      meetings.map((m) =>
        m.id === id
          ? { ...m, action_items: m.action_items.map((a, j) => (j === i ? { ...a, done: !a.done } : a)) }
          : m
      )
    );
  const onNotified = (id, ci) =>
    persist(
      meetings.map((m) =>
        m.id === id
          ? { ...m, campaigns: m.campaigns.map((c, j) => (j === ci ? { ...c, notified: true } : c)) }
          : m
      )
    );
  const onDelete = (id) => persist(meetings.filter((m) => m.id !== id));
  const onDeleteClient = (company) => {
    const k = company.toLowerCase();
    const nextClients = { ...clients };
    delete nextClients[k];
    if (openClient === k) setOpenClient(null);
    persist(
      meetings.filter((m) => m.company.toLowerCase() !== k),
      nextClients
    );
  };
  const jump = (key) => {
    setTab("partners");
    setOpenClient(key);
  };

  const attention = useMemo(() => {
    let n = 0;
    meetings.forEach((m) => {
      if (!m.follow_up.done && daysOut(m.follow_up.due) <= 0) n += 1;
      m.campaigns.forEach((c) => {
        if (c.launch_date && daysOut(c.launch_date) <= 0 && !c.notified) n += 1;
      });
    });
    Object.values(clients).forEach((c) => {
      const due = clientDue(c, firstSeen[c.company.toLowerCase()]);
      if (due.report && daysOut(due.report) <= 0) n += 1;
      if (daysOut(due.checkin) <= 0) n += 1;
      if (!c.kickoff.done) n += 1;
    });
    return n;
  }, [meetings, clients, firstSeen]);

  const partnerList = useMemo(
    () => Object.values(clients).sort((a, b) => a.company.localeCompare(b.company)),
    [clients]
  );

  return (
    <div style={{ background: C.paper, minHeight: "100%" }}>
      <style>{`
        @keyframes settle { from { background: ${C.surface}; } to { background: transparent; } }
        @media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
        input:focus, textarea:focus, button:focus-visible, summary:focus-visible {
          outline: 2px solid ${C.launch}; outline-offset: 1px;
        }
      `}</style>

      <div className="mx-auto px-4 sm:px-6 py-6" style={{ maxWidth: 1100 }}>
        <header
          className="flex items-end justify-between gap-4 pb-4 flex-wrap"
          style={{ borderBottom: `2px solid ${C.ink}` }}
        >
          <h1 style={{ fontFamily: SERIF, fontSize: 31, color: C.ink, lineHeight: 1 }}>
            Partner log
          </h1>
          <Meta color={attention ? C.late : C.inkSoft}>
            {loading
              ? "Opening the log…"
              : attention
              ? `${attention} thing${attention > 1 ? "s" : ""} need you`
              : `${meetings.length} meeting${meetings.length === 1 ? "" : "s"} filed`}
          </Meta>
        </header>

        <div className="mt-5">
          <Intake onFiled={onFiled} clients={clients} />
        </div>

        {saveError && (
          <p className="mt-3">
            <Meta color={C.late}>{saveError}</Meta>
          </p>
        )}

        <div className="mt-8 grid gap-8 lg:grid-cols-3">
          <aside className="lg:col-span-1">
            <Head>Coming up</Head>
            {!loading && (
              <Rail
                meetings={meetings}
                clients={clients}
                firstSeen={firstSeen}
                onDone={onDone}
                onSnooze={onSnooze}
                onJump={jump}
                onNotified={onNotified}
              />
            )}
          </aside>

          <main className="lg:col-span-2">
            <div className="flex gap-4 pb-2 flex-wrap" style={{ borderBottom: `1px solid ${C.rule}` }}>
              {[
                ["log", "Log"],
                ["calendar", "Calendar"],
                ["partners", "Partners"],
                ["campaigns", "Campaigns"],
              ].map(([t, label]) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  style={{
                    fontFamily: SERIF,
                    fontSize: 20,
                    color: tab === t ? C.ink : C.inkFaint,
                    background: "none",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {loading ? (
              <div className="py-6">
                <Meta color={C.inkFaint}>Loading your partners…</Meta>
              </div>
            ) : tab === "log" ? (
              meetings.length === 0 ? (
                <div className="py-6">
                  <Body color={C.inkFaint}>
                    Nothing filed yet. Paste the notes from your last call above and they&rsquo;ll be
                    sorted into a summary, to-dos, campaigns, anything off plan, and a follow-up date.
                  </Body>
                </div>
              ) : (
                meetings.map((m) => (
                  <LogEntry
                    key={m.id}
                    m={m}
                    client={clients[m.company.toLowerCase()]}
                    isNewest={m.id === newest}
                    onToggleAction={onToggleAction}
                    onDelete={onDelete}
                  />
                ))
              )
            ) : tab === "calendar" ? (
              <Calendar
                meetings={meetings}
                clients={clients}
                firstSeen={firstSeen}
                onJump={jump}
                onDone={onDone}
                onNotified={onNotified}
              />
            ) : tab === "partners" ? (
              partnerList.length === 0 ? (
                <div className="py-6">
                  <Meta color={C.inkFaint}>
                    No partners yet. File a meeting and their kick-off checklist and reporting clock
                    start here.
                  </Meta>
                </div>
              ) : (
                partnerList.map((c) => (
                  <PartnerCard
                    key={c.company.toLowerCase()}
                    client={c}
                    meetings={meetings}
                    firstSeen={firstSeen}
                    expanded={openClient === c.company.toLowerCase()}
                    onExpand={setOpenClient}
                    onUpdate={onUpdateClient}
                    onDelete={onDeleteClient}
                  />
                ))
              )
            ) : (
              <Campaigns meetings={meetings} clients={clients} onNotified={onNotified} />
            )}
          </main>
        </div>

        <footer
          className="mt-10 pt-4 flex items-center gap-3 flex-wrap"
          style={{ borderTop: `1px solid ${C.ruleSoft}` }}
        >
          <Meta color={C.inkFaint}>Saved to this app only — private to you.</Meta>
          <span className="grow" />
          {confirmClear ? (
            <>
              <Meta color={C.late}>Delete every meeting and partner?</Meta>
              <Btn
                kind="bare"
                onClick={() => {
                  persist([], {});
                  setConfirmClear(false);
                }}
              >
                Yes, clear it
              </Btn>
              <Btn kind="bare" onClick={() => setConfirmClear(false)}>
                Keep them
              </Btn>
            </>
          ) : (
            <Btn kind="bare" onClick={() => setConfirmClear(true)}>
              Clear the log
            </Btn>
          )}
        </footer>
      </div>
    </div>
  );
}
