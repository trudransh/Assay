# Do hosts respect max_tokens? Kimi K2.6, 8 Oct 2026

**Question.** When an agent sets `max_tokens`, does the host serving Kimi K2.6 stop there? Agents use the cap to bound cost.

**Result.** 3 of the 16 OpenRouter hosts that answered ignored a 16-token cap in 59 of their 60 trials. They returned a median of about 1,750 to 2,160 tokens (roughly 600 of them visible text, the rest reasoning) and were billed 70 to 126 times what Moonshot's own endpoint charged for the identical request. The other 13 hosts, Moonshot's own endpoint among them, and Assay's Kimi host (agent 10316) stopped at 16 tokens every time.

| | Hosts | Trials over the cap |
|---|---|---|
| Ignored the cap | 3 | 59 of 60 |
| Respected the cap | 13, plus Assay host 10316 | 0 of 260 |
| Not measured (rate-limited every request) | 1 | none answered |

**It's the provider, not the router.** Every host was tried 10 times with OpenRouter's `require_parameters` off and 10 times with it on. With it on, OpenRouter only routes to a provider that declares support for every parameter in the request, so a host that still overruns declares `max_tokens` support and ignores it. All three overran in both modes. One more detail points the same way: Moonshot's own endpoint respected the cap, yet OpenRouter wouldn't route to it with `require_parameters` on (`404 No endpoints found that can handle the requested parameters`). Declared parameter support didn't predict behaviour in either direction.

**Method.** `harness/cap_probe.py`: prompt "Write a 500-word essay about rivers.", `max_tokens: 16`, `temperature: 0`, each provider pinned with `allow_fallbacks: false`. A reply counts as over the cap when `completion_tokens` exceeds 18 (two tokens of slack for tokenizer differences). Costs are OpenRouter's billed `usage.cost` per request. 350 requests in total, $0.40: 17 OpenRouter endpoints × 20 (10 per mode) plus 10 sent straight to Assay host 10316. 320 were answered (the 60 and 260 above); the 30 that weren't are gmicloud's 20 rate-limited requests and Moonshot's 10 with `require_parameters` on, which OpenRouter refused to route.

**Names.** The three hosts were sent their logs on 8 Oct and have 7 days to reply, so they're named here on 15 Oct, with their replies. Until then only its sha256 is public: `cap_20261008T095026Z.jsonl`, sha256 `0x08c0fa666d1c0af2d1b7c109cd1c5cbc987412c0d62a894413b38b92f335420e`. Anyone can check on 15 Oct that the published file is the one measured today.

**Limits.** One model, one prompt, one day, 10 trials per host and mode. Usage and cost numbers come from OpenRouter's response; nothing signs them. The reasoning and visible token split comes from `completion_tokens_details`, which some hosts report inconsistently (a few show slightly more reasoning tokens than completion tokens). Overrunning hosts still gave correct tool calls in the grading run: this is about cost control, not answer quality.
