// The developer terminal, after Aceternity's Terminal, rebuilt without React: tabs switch between a
// shell session and the two source files, and the session types itself once when it scrolls into
// view. The output is the real output of verify.ts on the first mainnet receipt (SDK 0.1.1).
// No sound. Reduced motion prints the whole session at once. Screen readers get the session as
// plain text from the hidden <pre> next to it; the typed copy is aria-hidden.

import { $, $$, RM } from "./util.js";

type Seg = [cls: string, text: string];
interface Step {
  cmd: string;
  out: Seg[][];
}

const pad = (s: string) => s.padEnd(13);
const row = (name: string, r: "pass" | "skipped"): Seg[] => [["", pad(name)], [r === "pass" ? "t-pass" : "t-skip", r]];

const SESSION: Step[] = [
  { cmd: "npm install assay-receipts", out: [[["t-dim", "+ "], ["", "assay-receipts@0.1.1"]]] },
  {
    cmd: "npx tsx verify.ts 0x1b443b45…12e35c5f2",
    out: [
      row("jws", "pass"),
      row("hash", "pass"),
      row("kid", "pass"),
      row("merkle", "pass"),
      row("anchored", "pass"),
      row("outputCommit", "skipped"),
      row("promptCommit", "skipped"),
      row("cosigned", "skipped"),
    ],
  },
  { cmd: "# skipped: needs your salt, or the receipt names no co-signer", out: [] },
];

function prompt(): HTMLElement {
  const p = document.createElement("span");
  p.className = "t-prompt";
  p.innerHTML = '<span class="t-path">~/app</span> <span class="t-dim">$</span> ';
  return p;
}

function line(): HTMLDivElement {
  const d = document.createElement("div");
  d.className = "t-line";
  return d;
}

function segs(parts: Seg[]): HTMLDivElement {
  const d = line();
  for (const [cls, text] of parts) {
    const s = document.createElement("span");
    if (cls) s.className = cls;
    s.textContent = text;
    d.append(s);
  }
  return d;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function initTerminal(): void {
  const root = $("#term");
  const out = $("#term-lines");
  if (!root || !out) return;

  // Tabs: click or arrow keys, with a roving tabindex.
  const tabs = $$<HTMLButtonElement>('[role="tab"]', root);
  const select = (t: HTMLButtonElement, focus = false) => {
    for (const x of tabs) {
      const on = x === t;
      x.setAttribute("aria-selected", String(on));
      x.tabIndex = on ? 0 : -1;
      const pane = document.getElementById(x.getAttribute("aria-controls") ?? "");
      if (pane) pane.hidden = !on;
    }
    if (focus) t.focus();
  };
  tabs.forEach((t, i) => {
    t.addEventListener("click", () => select(t));
    t.addEventListener("keydown", (e) => {
      const k = e.key;
      const j = k === "ArrowRight" ? i + 1 : k === "ArrowLeft" ? i - 1 : k === "Home" ? 0 : k === "End" ? tabs.length - 1 : null;
      if (j === null) return;
      e.preventDefault();
      select(tabs[(j + tabs.length) % tabs.length], true);
    });
  });

  const caret = document.createElement("span");
  caret.className = "t-caret";

  const printAll = () => {
    out.textContent = "";
    for (const s of SESSION) {
      const l = line();
      l.append(prompt(), document.createTextNode(s.cmd));
      l.classList.toggle("t-note", s.cmd.startsWith("#"));
      out.append(l);
      for (const o of s.out) out.append(segs(o));
    }
    const last = line();
    last.append(prompt(), caret);
    out.append(last);
  };

  if (RM) {
    printAll();
    return;
  }

  // Leave the box its full height from the start so nothing below it moves while it types.
  const run = async () => {
    out.textContent = "";
    for (const s of SESSION) {
      const l = line();
      l.classList.toggle("t-note", s.cmd.startsWith("#"));
      const typed = document.createTextNode("");
      l.append(prompt(), typed, caret);
      out.append(l);
      await wait(380);
      for (let i = 1; i <= s.cmd.length; i++) {
        typed.nodeValue = s.cmd.slice(0, i);
        await wait(s.cmd.startsWith("#") ? 14 : 26 + Math.random() * 34);
      }
      await wait(320);
      for (const o of s.out) {
        out.append(segs(o));
        await wait(s.out.length > 1 ? 85 : 260);
      }
      await wait(520);
    }
    const last = line();
    last.append(prompt(), caret);
    out.append(last);
  };

  const io = new IntersectionObserver(
    (es) => {
      if (!es[0].isIntersecting) return;
      io.disconnect();
      void run();
    },
    { threshold: 0.4 },
  );
  // Show the first prompt right away, with the caret blinking.
  const first = line();
  first.append(prompt(), caret);
  out.append(first);
  io.observe(root);
}
