import { chip, emptyState, field, h, section, shortHash, skeleton } from "../dom.js";
import { CHAINS, chainConfig } from "../lib/config.js";
import { fetchBoards, type Attestation, type Board, type BoardEntry, type Drift } from "../lib/indexer.js";
import { KNOWN_HOSTS, KNOWN_MODELS } from "../lib/known.js";
import type { Route } from "../router.js";
import { showPageChain } from "../ui/network-switch.js";
import { table, tile } from "./host.js";

type Data = Awaited<ReturnType<typeof fetchBoards>>;

const pct = (bps: number) => `${(bps / 100).toFixed(1)}%`;
const modelName = (hash: string) => KNOWN_MODELS[hash.toLowerCase()];
const day = (unix: number | string) => new Date(Number(unix) * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

function boardLabel(b: Board): string {
  const chain = CHAINS[b.chainId]?.short ?? `chain ${b.chainId}`;
  const verifier = b.verifier.agentId ? `verifier ${b.verifier.agentId}` : `${b.verifier.address.slice(0, 8)}…`;
  return `${modelName(b.model) ?? `${b.model.slice(0, 10)}…`} · ${chain} · ${verifier} · ${b.hostCount} hosts`;
}

/// Names come only from known.ts (preimages we can prove); anything else is a short hash.
export function hostCell(hostKey: string, b: Board): Node {
  const k = KNOWN_HOSTS[hostKey.toLowerCase()];
  if (!k) return h("div", {}, shortHash(hostKey), h("div", { class: "hint" }, "unlabelled host"));
  const agent = /^erc8004:(\d+):(\d+)$/.exec(k.preimage);
  const model = modelName(b.model);
  const href = agent
    ? `#hosts/${agent[2]}?chain=${agent[1]}`
    : `#grades?${new URLSearchParams({ ...(model ? { model } : {}), host: k.preimage, chain: String(b.chainId), v: b.verifier.address })}`;
  // OpenRouter labels are the tag itself, so the second line only adds what the label doesn't say.
  const detail = agent ? `${k.preimage} · signs receipts` : `${k.preimage.split(":")[0]} · graded only`;
  return h("div", { class: "host-cell" }, h("a", { href }, k.label), h("div", { class: "hint" }, detail));
}

/// The latest interval drawn on a 0 to 100% track. The text beside it carries the same numbers.
export function band(e: BoardEntry, tone: string): Node {
  const lo = e.latestCiLowBps / 100;
  const hi = e.latestCiHighBps / 100;
  return h(
    "div",
    { class: "band-cell" },
    h("div", { class: "band", "aria-hidden": "true" }, h("span", { class: `band-fill tone-${tone}`, style: `left:${lo}%;width:${Math.max(hi - lo, 1)}%` })),
    h("span", { class: "mono" }, `${pct(e.latestCiLowBps)} to ${pct(e.latestCiHighBps)}`),
  );
}

export function creCell(a: Attestation | undefined): Node {
  if (!a) return chip("Not yet", "muted");
  return a.agree ? chip("Agrees", "lime", { dot: true }) : chip("Disagrees", "coral", { dot: true });
}

export const PER_PAGE = 5;

export function renderBoard(b: Board, data: Data, query = ""): HTMLElement {
  const byGrade = new Map(data.attestations.map((a) => [a.grade_id, a]));
  const drifts = data.drifts.filter((d) => d.stats_id.startsWith(`${b.chainId}-`) && d.model === b.model);
  const q = query.trim().toLowerCase();
  const entries = b.entries.filter((e) => {
    if (!q) return true;
    const k = KNOWN_HOSTS[e.hostKey.toLowerCase()];
    return e.hostKey.toLowerCase().includes(q) || (k && (k.preimage.toLowerCase().includes(q) || k.label.toLowerCase().includes(q)));
  });
  const leader = KNOWN_HOSTS[b.leaderHostKey.toLowerCase()];

  const tiles = h(
    "div",
    { class: "tiles" },
    tile("Hosts graded", b.hostCount, "k-bone"),
    tile("Leader, lower bound", pct(b.leaderCiLowBps), "k-lime", leader?.label ?? `${b.leaderHostKey.slice(0, 10)}…`),
    tile("Grade drops", drifts.length, drifts.length ? "k-coral" : "k-bone", "Since the first grade"),
    tile("Last update", day(b.updatedTimestamp), "k-bone"),
  );

  // Gold only for hosts that are actually ahead: tied intervals share a rank in all but name.
  const ahead = (e: BoardEntry) => e.rank <= 3 && b.entries.filter((x) => x.latestCiLowBps >= e.latestCiLowBps).length <= 3;
  const tied = b.entries.length > 1 && b.entries.every((x) => x.latestCiLowBps === b.entries[0].latestCiLowBps && x.latestCiHighBps === b.entries[0].latestCiHighBps);
  const rows = entries.map((e) => {
    const att = byGrade.get(e.latest_id);
    const tone = e.driftCount > 0 || att?.agree === false ? "coral" : "lime";
    return [
      h("span", { class: `rank-mark${ahead(e) ? " top" : ""}`, "aria-label": `Rank ${e.rank}` }, String(e.rank)),
      hostCell(e.hostKey, b),
      band(e, tone),
      pct(e.passRateBps),
      String(e.gradeCount),
      e.driftCount > 0 ? chip("Grade dropped", "coral", { dot: true }) : "0",
      creCell(att),
      day(e.latestT),
    ];
  });
  // Five hosts per page, so a 39-host board reads as a card, not a wall. Search still covers every host.
  const head = ["Rank", "Host", "Latest 95% interval", "Pass rate, all grades", "Grades", "Drift", "CRE re-check", "Last graded"];
  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const tableSlot = h("div", { class: "board-page" });
  const pager = h("nav", { class: "pager", "aria-label": "Leaderboard pages" });
  const show = (p: number, focus = false) => {
    const page = Math.min(Math.max(p, 0), pages - 1);
    const from = page * PER_PAGE;
    const t = table(head, rows.slice(from, from + PER_PAGE));
    t.classList.add("board-table");
    tableSlot.replaceChildren(t);
    if (pages === 1) return pager.replaceChildren();
    const btn = (label: string, to: number, opts: { current?: boolean; disabled?: boolean; aria?: string } = {}) => {
      const b = h("button", { type: "button", class: `pager-btn${opts.current ? " current" : ""}`, ...(opts.aria ? { "aria-label": opts.aria } : {}), ...(opts.current ? { "aria-current": "page" } : {}) }, label);
      b.disabled = !!opts.disabled;
      b.addEventListener("click", () => show(to, true));
      return b;
    };
    pager.replaceChildren(
      h("span", { class: "pager-count" }, `${from + 1} to ${Math.min(from + PER_PAGE, rows.length)} of ${rows.length}`),
      h(
        "span",
        { class: "pager-btns" },
        btn("Prev", page - 1, { disabled: page === 0, aria: "Previous page" }),
        ...Array.from({ length: pages }, (_, i) => btn(String(i + 1), i, { current: i === page, aria: `Page ${i + 1}` })),
        btn("Next", page + 1, { disabled: page === pages - 1, aria: "Next page" }),
      ),
    );
    if (focus) pager.querySelector<HTMLButtonElement>(".pager-btn.current")?.focus();
  };
  let body: HTMLElement;
  if (rows.length) {
    show(0);
    body = h("div", { class: "board-paged" }, tableSlot, pager);
  } else {
    body = emptyState({ title: "No host matches", text: "Try an agent id, an OpenRouter tag or part of a host key.", tone: "muted" });
    body.classList.add("board-table");
  }
  const tieNote = tied
    ? h("p", { class: "banner banner-sky board-tie", role: "note" }, `Every host on this board has the same interval (${pct(b.entries[0].latestCiLowBps)} to ${pct(b.entries[0].latestCiHighBps)}): they all passed every check. The order among them is only the order the grades were posted, not a ranking. Harder checks are what separate hosts.`)
    : null;

  const driftCard = h(
    "section",
    { class: "card" },
    h("div", { class: "card-head" }, h("h2", {}, "Drift"), chip("Grade dropped", "coral")),
    h("p", { class: "hint" }, "A drift event is written when a host's new interval sits entirely below its previous one."),
    drifts.length
      ? h(
          "ul",
          { class: "drifts" },
          ...drifts.map((d: Drift) =>
            h("li", {}, h("strong", {}, KNOWN_HOSTS[d.hostKey.toLowerCase()]?.label ?? `${d.hostKey.slice(0, 10)}…`), ` fell ${pct(d.dropBps)}: was ${pct(d.previousCiLowBps)} low, now ${pct(d.ciHighBps)} high · ${day(d.timestamp)}`),
          ),
        )
      : h("p", {}, "No host on this board has dropped since its first grade."),
  );
  const how = h(
    "section",
    { class: "card" },
    h("h2", {}, "How the ranking works"),
    h(
      "ul",
      {},
      h("li", {}, "One board per verifier and model. Pick a different verifier and the order can change."),
      h("li", {}, "Rank uses the lower end of the latest 95% interval, not the average, so a host only climbs when its worst case gets better."),
      h("li", {}, "Rows with an agent id sign receipts. Rows with an OpenRouter tag are graded only."),
      h("li", {}, "CRE re-check shows whether the Chainlink workflow recomputed the grade from its evidence and agreed. Not yet means no re-check has run on that grade."),
    ),
  );
  return h("div", { class: "board" }, tiles, tieNote, body, h("div", { class: "receipt-grid" }, h("div", { class: "col" }, driftCard), h("div", { class: "col" }, how)));
}

export function mountHosts(root: HTMLElement, route: Route, load: typeof fetchBoards = fetchBoards) {
  const slot = h("div", { "aria-busy": "true" }, skeleton(6, 56));
  root.append(
    section("Every host for one model, ranked", "Ranked by one verifier's latest lower bound, so a host only climbs when its worst case gets better. Data comes from the Envio indexer.", slot),
  );
  load()
    .then((data) => {
      slot.removeAttribute("aria-busy");
      if (!data.boards.length) {
        slot.replaceChildren(emptyState({ title: "No host has been graded yet.", text: "Grades appear here once a verifier posts one onchain.", tone: "lime", action: h("a", { href: "#grades", class: "btn btn-secondary" }, "Open Grades") }));
        return;
      }
      const picker = h("select", {}, ...data.boards.map((b) => h("option", { value: b.id }, boardLabel(b)))) as HTMLSelectElement;
      const wanted = route.params.get("board");
      picker.value = data.boards.some((b) => b.id === wanted) ? wanted! : data.boards[0].id;
      const find = h("input", { type: "search", placeholder: "Agent id, OpenRouter tag or host key", autocomplete: "off" }) as HTMLInputElement;
      const boardSlot = h("div");
      const draw = () => {
        const b = data.boards.find((x) => x.id === picker.value)!;
        showPageChain(b.chainId);
        boardSlot.replaceChildren(renderBoard(b, data, find.value));
      };
      picker.addEventListener("change", draw);
      find.addEventListener("input", draw);
      slot.replaceChildren(h("div", { class: "row board-controls" }, field("Board", picker).row, field("Find a host", find).row), boardSlot);
      draw();
    })
    .catch(() => {
      slot.removeAttribute("aria-busy");
      slot.replaceChildren(emptyState({ title: "The leaderboard needs the indexer, and it didn't answer.", text: `Grades are still readable from the chain on ${chainConfig(Number(route.params.get("chain")) || 143).name}.`, tone: "coral", action: h("a", { href: "#grades", class: "btn btn-secondary" }, "Open Grades") }));
    });
}
