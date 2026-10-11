import { emptyState, h, section, setPageTab } from "./dom.js";
import { CHAIN_ID, CHAINS, DOCS_URL, QUICKSTART_URL, chainConfig } from "./lib/config.js";
import { match, parseHash, tabOf, type Route } from "./router.js";
import { initReveal } from "./ui/motion.js";
import { mountNetworkSwitch, unlockChain } from "./ui/network-switch.js";
import { mountAsk } from "./views/ask.js";
import { mountGrades } from "./views/grades.js";
import { mountHosts } from "./views/hosts.js";
import { mountHost } from "./views/host.js";
import { mountReceipt } from "./views/receipt.js";
import { mountVault } from "./views/vault.js";
import { mountVerify } from "./views/verify.js";

const VIEWS = { verify: mountVerify, ask: mountAsk, grades: mountGrades, vault: mountVault };
const TAB_NAMES: Record<string, string> = { verify: "Verify", ask: "Ask", grades: "Grades", hosts: "Hosts", vault: "Vault", developers: "Developers" };
const main = document.getElementById("main")!;

function link(label: string, href: string, variant: "primary" | "secondary") {
  return h("a", { class: `btn btn-${variant}`, href }, label);
}

function notFound(root: HTMLElement, route: Route) {
  root.append(
    section(
      "That page isn't here",
      route.path[0] === "r" ? "A receipt hash is 0x followed by 64 hex characters." : "The link may be old, or the route moved.",
      h("div", { class: "row" }, link("Verify a receipt", "#verify", "primary"), link("Docs", DOCS_URL, "secondary")),
    ),
  );
}

function planned(root: HTMLElement, title: string, step: number) {
  // Dev builds name the build step; the deployed site just says the page isn't live yet.
  const text = import.meta.env.DEV ? `Coming in step ${step}.` : "This page isn't live yet. Receipts can be verified today.";
  root.append(section(title, "", emptyState({ title: `${title} is on its way`, text, tone: "sky", action: link("Verify a receipt", "#verify", "secondary") })));
}

/// Pages not built as their own view send people to the closest real one instead of a "coming soon" card.
function redirect(route: Route): boolean {
  const [top, sub] = route.path;
  if (top === "grades" && sub === "verifiers") location.replace("#grades");
  else if (top === "developers" && sub === undefined) location.href = QUICKSTART_URL;
  else return false;
  return true;
}

function render(route: Route, focus: boolean) {
  if (redirect(route)) return;
  draw(route, focus);
}

function draw(route: Route, focus: boolean) {
  const m = match(route);
  const tab = m.view === "notFound" ? "" : tabOf(route);
  setPageTab(TAB_NAMES[tab] ?? "");
  // Only the receipt view pins the network; every other route gets the switch back.
  unlockChain();
  main.replaceChildren();
  if (m.view === "notFound") notFound(main, route);
  else if (m.view === "planned") planned(main, m.title, m.step);
  else if (m.view === "receipt") mountReceipt(main, route);
  else if (m.view === "host") mountHost(main, route);
  else if (m.view === "hosts") mountHosts(main, route);
  else if (m.view === "grades") mountGrades(main, route.params);
  else VIEWS[m.view](main);
  for (const a of document.querySelectorAll<HTMLAnchorElement>("[data-tab]")) {
    if (a.dataset.tab === tab) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
  // Polish layer: the new page rises in once; cards and sections below the fold reveal on scroll.
  main.classList.remove("route-in");
  void main.offsetWidth;
  main.classList.add("route-in");
  initReveal(main);
  // Move focus to the new page so keyboard and screen reader users land on it.
  if (focus) main.focus();
}

/// Top-bar network switch: a Mainnet | Testnet segmented control (src/ui/network-switch.ts).
function networkSwitch() {
  const foot = document.getElementById("network-foot");
  if (foot) foot.textContent = `${chainConfig(CHAIN_ID).name}, chain ${CHAIN_ID}.`;
  const slot = document.getElementById("network-switch");
  if (slot && Object.keys(CHAINS).length > 1) mountNetworkSwitch(slot);
}

networkSwitch();
addEventListener("hashchange", () => render(parseHash(location.hash), true));
render(parseHash(location.hash), false);
