// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import type { Board } from "../src/lib/indexer.js";
import { parseHash } from "../src/router.js";
import { mountHosts, renderBoard } from "../src/views/hosts.js";

const GLM = "0x6cc954dc904d6bf2f1c308fedd093554068e88708ed27a3f644fd82e61e5d271";
const INET = "0xdc2a70c1b3a2a80d0717b04a4bf858c5c701641d7f2d2bcee6dbe5467851c220"; // openrouter:inference-net
const HOST1962 = "0xbc6bc5b79f83de1bb4e63bacbdb8d82c8a38e1c9caa38043f8b6ba33ffb33e6c";
const UNKNOWN = `0x${"ab".repeat(32)}`;
const V = "0x4bac2be288b5931886eec4c555895ce6bcab19e7";
const entry = (rank: number, hostKey: string, lo: number, drift = 0) => ({
  rank,
  hostKey,
  latestCiLowBps: lo,
  latestCiHighBps: 10000,
  passRateBps: 9500,
  gradeCount: 2,
  driftCount: drift,
  latestT: "1791178507",
  latest_id: `10143-${V}-${GLM}-${hostKey}-1791178507`,
});
const board: Board = {
  id: `10143-${V}-${GLM}`,
  chainId: 10143,
  model: GLM,
  verifier: { address: V, agentId: "1981" },
  hostCount: 3,
  leaderHostKey: INET,
  leaderCiLowBps: 9123,
  updatedTimestamp: 1791178949,
  // Deliberately out of order: the page must follow `rank`.
  entries: [entry(2, HOST1962, 9000), entry(3, UNKNOWN, 7000, 1), entry(1, INET, 9123)].sort((x, y) => x.rank - y.rank),
};
const data = {
  boards: [board],
  drifts: [{ id: "d", model: GLM, hostKey: UNKNOWN, dropBps: 1200, previousCiLowBps: 8200, ciHighBps: 7000, timestamp: 1791178949, stats_id: `10143-${V}-${GLM}-${UNKNOWN}` }],
  attestations: [{ grade_id: entry(1, INET, 9123).latest_id, agree: true, passed: 40, total: 40, txHash: "0x" }],
};

describe("hosts leaderboard", () => {
  it("follows rank, draws the band from the latest interval, and names only known hosts", () => {
    const el = renderBoard(board, data);
    const rows = [...el.querySelectorAll("tbody tr")];
    expect(rows.map((r) => r.querySelector(".rank-mark")!.textContent)).toEqual(["1", "2", "3"]);
    expect(rows[0].textContent).toContain("inference-net");
    expect(rows[0].textContent).toContain("91.2% to 100.0%");
    expect(rows[1].querySelector("a")!.getAttribute("href")).toBe("#hosts/1962?chain=10143");
    expect(rows[2].textContent).toContain("unlabelled host");
  });

  it("flags a dropped grade and shows the CRE re-check per grade", () => {
    const rows = [...renderBoard(board, data).querySelectorAll("tbody tr")];
    expect(rows[2].textContent).toContain("Grade dropped");
    expect(rows[2].querySelector(".band-fill")!.classList.contains("tone-coral")).toBe(true);
    expect(rows[0].textContent).toContain("Agrees");
    expect(rows[1].textContent).toContain("Not yet");
  });

  it("shows five hosts per page and pages through the rest", () => {
    const many = { ...board, hostCount: 12, entries: Array.from({ length: 12 }, (_, i) => entry(i + 1, `0x${String(i + 1).padStart(64, "0")}`, 9000 - i)) };
    const el = renderBoard(many, data);
    const ranks = () => [...el.querySelectorAll("tbody tr .rank-mark")].map((r) => r.textContent);
    expect(ranks()).toEqual(["1", "2", "3", "4", "5"]);
    expect(el.querySelector(".pager-count")!.textContent).toBe("1 to 5 of 12");
    expect(el.querySelectorAll(".pager-btn[aria-label^='Page']")).toHaveLength(3);
    el.querySelector<HTMLButtonElement>(".pager-btn[aria-label='Next page']")!.click();
    expect(ranks()).toEqual(["6", "7", "8", "9", "10"]);
    el.querySelector<HTMLButtonElement>(".pager-btn[aria-label='Page 3']")!.click();
    expect(ranks()).toEqual(["11", "12"]);
    expect(el.querySelector<HTMLButtonElement>(".pager-btn[aria-label='Next page']")!.disabled).toBe(true);
  });

  it("filters by tag or agent id", () => {
    expect(renderBoard(board, data, "1962").querySelectorAll("tbody tr")).toHaveLength(1);
  });

  it("shows the indexer state, not an error stack, when the indexer is down", async () => {
    const root = document.createElement("main");
    mountHosts(root, parseHash("#hosts"), async () => {
      throw new Error("Indexer: HTTP 503");
    });
    await vi.waitFor(() => expect(root.textContent).toContain("needs the indexer"));
  });
});
