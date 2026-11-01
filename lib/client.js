window.__ModuleLoader__.load({
	id: "dsh-cost-meter",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		const React = require("react");
		const { createElement: h, useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } = React;
		const { createPortal } = require("react-dom");

		const PLUGIN_ID = "dsh-cost-meter";
		const SLOT = "conversation.session.header.utilities";
		const STORAGE_PREFIX = "dsh-cost-meter:v1:";
		const DAY_MS = 86400000;
		const HOUR_MS = 3600000;

		//#region pricing
		/** DeepSeek API list prices, USD per 1M tokens. Off-peak is half of peak. */
		const PRICES = {
			"deepseek-flash": {
				peak: { miss: 0.3, hit: 0.006, out: 1.2 },
				off: { miss: 0.15, hit: 0.003, out: 0.6 }
			},
			"deepseek-v4-pro": {
				peak: { miss: 1.32, hit: 0.044, out: 3.96 },
				off: { miss: 0.66, hit: 0.022, out: 1.98 }
			}
		};

		/**
		 * Chinese public holidays in 2026, the days DeepSeek bills at off-peak
		 * rates all day. Kept as ranges in Beijing calendar dates.
		 */
		const HOLIDAY_RANGES = [
			["2026-01-01", "2026-01-03"],
			["2026-02-15", "2026-02-23"],
			["2026-04-04", "2026-04-06"],
			["2026-05-01", "2026-05-05"],
			["2026-06-19", "2026-06-21"],
			["2026-09-25", "2026-09-27"],
			["2026-10-01", "2026-10-07"]
		];

		function expandRanges(ranges) {
			const set = new Set();
			for (const [start, end] of ranges) {
				const from = Date.parse(start + "T00:00:00Z");
				const to = Date.parse(end + "T00:00:00Z");
				for (let t = from; t <= to; t += DAY_MS) set.add(new Date(t).toISOString().slice(0, 10));
			}
			return set;
		}

		const HOLIDAYS = expandRanges(HOLIDAY_RANGES);

		/** Normalize an API model name to a priced model key. */
		function normalizeModel(model) {
			const value = String(model ?? "").toLowerCase();
			return value.includes("pro") ? "deepseek-v4-pro" : "deepseek-flash";
		}

		/** Beijing calendar day key and weekday ordinal (0 = Sunday). */
		function beijingDay(at) {
			const date = new Date(at + 8 * HOUR_MS);
			return { key: date.toISOString().slice(0, 10), weekday: date.getUTCDay() };
		}

		function isHoliday(at) {
			return HOLIDAYS.has(beijingDay(at).key);
		}

		/** Whether the peak window is active (weekdays 01-04 and 06-10 UTC). */
		function isPeakWindow(at) {
			const minutes = Math.floor((at % DAY_MS) / 60000);
			return (minutes >= 60 && minutes < 240) || (minutes >= 360 && minutes < 600);
		}

		/** Why the tariff is what it is: weekend, holiday, peak, or plain off-peak. */
		function tariffReason(at) {
			const { weekday } = beijingDay(at);
			if (weekday === 0 || weekday === 6) return "weekend";
			if (isHoliday(at)) return "holiday";
			return isPeakWindow(at) ? "peak" : "night";
		}

		function isPeak(at) {
			return tariffReason(at) === "peak";
		}

		/** Rates for a model at an instant. */
		function ratesFor(model, at) {
			const table = PRICES[normalizeModel(model)];
			return isPeak(at) ? table.peak : table.off;
		}

		/** Cost of a set of token deltas at one instant, split per bucket. */
		function priceDelta(delta, model, at) {
			const rate = ratesFor(model, at);
			return {
				cIn: (delta.in * rate.miss) / 1e6,
				cHit: (delta.hit * rate.hit) / 1e6,
				cOut: (delta.out * rate.out) / 1e6
			};
		}

		function emptyAcc() {
			return { in: 0, hit: 0, out: 0, cIn: 0, cHit: 0, cOut: 0 };
		}

		function totalCost(acc) {
			return acc.cIn + acc.cHit + acc.cOut;
		}

		function totalTokens(acc) {
			return acc.in + acc.hit + acc.out;
		}

		function validAcc(value) {
			if (value === null || typeof value !== "object") return false;
			for (const key of ["in", "hit", "out", "cIn", "cHit", "cOut"]) {
				if (typeof value[key] !== "number" || !Number.isFinite(value[key]) || value[key] < 0) return false;
			}
			return true;
		}

		function sameAcc(left, right) {
			return left.in === right.in && left.hit === right.hit && left.out === right.out && left.cIn === right.cIn && left.cHit === right.cHit && left.cOut === right.cOut;
		}

		/**
		 * Price the growth since the last observation at the current instant.
		 * A shrink means the projection was reset (new session or compaction), so
		 * the whole snapshot is repriced at the current tariff.
		 */
		function accrue(previous, current, model, at) {
			if (previous === null) {
				const priced = priceDelta(current, model, at);
				return { ...current, ...priced };
			}
			const delta = {
				in: current.in - previous.in,
				hit: current.hit - previous.hit,
				out: current.out - previous.out
			};
			if (delta.in < 0 || delta.hit < 0 || delta.out < 0) {
				const priced = priceDelta(current, model, at);
				return { ...current, ...priced };
			}
			if (delta.in === 0 && delta.hit === 0 && delta.out === 0) return previous;
			const priced = priceDelta(delta, model, at);
			return {
				in: current.in,
				hit: current.hit,
				out: current.out,
				cIn: previous.cIn + priced.cIn,
				cHit: previous.cHit + priced.cHit,
				cOut: previous.cOut + priced.cOut
			};
		}
		//#endregion

		//#region formatting
		const exactNumber = new Intl.NumberFormat("fr-FR");
		const clock = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });

		function formatUSD(value) {
			const abs = Math.abs(value);
			const digits = abs === 0 ? 3 : abs < 0.01 ? 4 : abs < 1 ? 3 : 2;
			return "$" + value.toFixed(digits).replace(".", ",");
		}

		/** Compact French token count: 842, 12,4k, 1,08M. */
		function compactTokens(value) {
			if (value < 1000) return String(Math.round(value));
			const units = [
				[1e9, "Md"],
				[1e6, "M"],
				[1e3, "k"]
			];
			for (const [divisor, unit] of units) {
				if (value >= divisor) {
					const scaled = value / divisor;
					const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
					let text = scaled.toFixed(digits);
					if (text.includes(".")) text = text.replace(/0+$/, "").replace(/\.$/, "");
					return text.replace(".", ",") + unit;
				}
			}
			return String(Math.round(value));
		}

		function formatCountdown(ms) {
			const minutes = Math.max(0, Math.round(ms / 60000));
			if (minutes < 60) return minutes + " min";
			const hours = Math.floor(minutes / 60);
			const rest = minutes % 60;
			return rest === 0 ? hours + " h" : hours + " h " + String(rest).padStart(2, "0");
		}

		/** Next minute at which the peak/off-peak classification flips. */
		function nextTransition(at) {
			const peak = isPeak(at);
			let cursor = Math.ceil(at / 60000) * 60000;
			for (let step = 0; step < 8 * 24 * 60; step += 1) {
				if (isPeak(cursor) !== peak) return cursor;
				cursor += 60000;
			}
			return null;
		}

		const TARIFF_COPY = {
			peak: {
				title: "Heure pleine",
				badge: "tarif normal",
				sub: "Entrée et sortie au tarif plein"
			},
			night: {
				title: "Heure creuse",
				badge: "−50 %",
				sub: "Entrée et sortie à moitié prix"
			},
			weekend: {
				title: "Week-end",
				badge: "−50 %",
				sub: "Tarifs creux tout le week-end"
			},
			holiday: {
				title: "Jour férié",
				badge: "−50 %",
				sub: "Tarifs creux toute la journée"
			}
		};
		//#endregion

		//#region storage
		function readAcc(key) {
			try {
				const raw = window.localStorage.getItem(key);
				if (raw === null) return null;
				const parsed = JSON.parse(raw);
				return validAcc(parsed) ? parsed : null;
			} catch {
				return null;
			}
		}

		function writeAcc(key, value) {
			try {
				window.localStorage.setItem(key, JSON.stringify(value));
			} catch {
				/* storage is optional */
			}
		}
		//#endregion

		//#region styles
		const CSS = `
.dshcm-root{display:inline-flex;align-items:center;min-width:0;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);line-height:1.2}
.dshcm-pill{box-sizing:border-box;display:inline-flex;align-items:center;gap:7px;height:26px;padding:0 10px 0 9px;border-radius:999px;border:.5px solid var(--dsw-alias-border-l4,rgba(255,255,255,.14));background:
linear-gradient(180deg,rgba(255,255,255,.055),rgba(255,255,255,.015)),
var(--dsw-alias-bg-layer-1,rgba(24,24,27,.72));color:var(--dsw-alias-label-secondary,#c9c9cf);font:inherit;font-variant-numeric:tabular-nums;white-space:nowrap;cursor:pointer;transition:border-color .16s ease,background-color .16s ease,transform .16s ease;box-shadow:0 1px 0 rgba(255,255,255,.03) inset}
.dshcm-pill:hover{border-color:var(--dsw-alias-border-l3,rgba(255,255,255,.24));background-color:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.dshcm-pill:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#6b9dff));outline-offset:2px}
.dshcm-pill[aria-expanded=true]{border-color:var(--dsw-alias-border-l3,rgba(255,255,255,.24))}
.dshcm-dot{flex:none;width:6px;height:6px;border-radius:50%;background:#ffb454;box-shadow:0 0 0 2px rgba(255,180,84,.13),0 0 8px rgba(255,180,84,.45);transition:background .3s ease,box-shadow .3s ease}
.dshcm-root[data-tariff=off] .dshcm-dot,[data-tariff=off] .dshcm-dot{background:#3ddc97;box-shadow:0 0 0 2px rgba(61,220,151,.13),0 0 8px rgba(61,220,151,.4)}
.dshcm-cost{color:var(--dsw-alias-label-primary,#f4f4f5);font-weight:600;letter-spacing:.01em}
.dshcm-root[data-zero=true] .dshcm-cost{color:var(--dsw-alias-label-tertiary,#8c8c94);font-weight:500}
.dshcm-sep{width:1px;height:11px;background:var(--dsw-alias-separator-primary,rgba(255,255,255,.13))}
.dshcm-tokens{color:var(--dsw-alias-label-tertiary,#8c8c94)}
.dshcm-pulse{animation:dshcmPulse .55s ease-out}
@keyframes dshcmPulse{0%{opacity:.45;transform:translateY(1px)}100%{opacity:1;transform:none}}
.dshcm-panel{position:fixed;z-index:2147483000;width:316px;box-sizing:border-box;padding:15px 16px 13px;border-radius:16px;border:.5px solid var(--dsw-alias-border-l3,rgba(255,255,255,.18));background:var(--dsw-alias-bg-layer-1,#1b1b1f);color:var(--dsw-alias-label-primary,#f4f4f5);box-shadow:0 18px 50px rgba(0,0,0,.45),0 2px 8px rgba(0,0,0,.3);backdrop-filter:blur(18px);font-size:13px;line-height:1.35;animation:dshcmIn .14s ease-out}
@keyframes dshcmIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
.dshcm-eyebrow{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:10.5px;letter-spacing:.09em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary,#8c8c94)}
.dshcm-total{display:flex;align-items:baseline;gap:8px;margin:6px 0 13px}
.dshcm-total strong{font-size:27px;font-weight:650;letter-spacing:.01em;font-variant-numeric:tabular-nums}
.dshcm-total span{font-size:11.5px;color:var(--dsw-alias-label-tertiary,#8c8c94)}
.dshcm-tariff{display:flex;align-items:center;gap:10px;padding:12px 13px;border-radius:12px;background:rgba(255,180,84,.075);border:.5px solid rgba(255,180,84,.2)}
.dshcm-tariff[data-tariff=off]{background:rgba(61,220,151,.07);border-color:rgba(61,220,151,.2)}
.dshcm-tariff .dshcm-dot{box-shadow:0 0 8px rgba(255,180,84,.5)}
.dshcm-tariff[data-tariff=off] .dshcm-dot{box-shadow:0 0 8px rgba(61,220,151,.45)}
.dshcm-tariff-main{min-width:0;flex:1}
.dshcm-tariff-title{display:flex;align-items:center;gap:8px;font-weight:600;font-size:18px;line-height:1.2}
.dshcm-badge{font-size:11.5px;font-weight:600;letter-spacing:.02em;padding:2px 7px;border-radius:999px;background:rgba(255,180,84,.16);color:#ffca85}
.dshcm-tariff[data-tariff=off] .dshcm-badge{background:rgba(61,220,151,.14);color:#7ce8b6}
.dshcm-tariff-sub{margin-top:2px;font-size:12.5px;color:var(--dsw-alias-label-tertiary,#8c8c94)}
.dshcm-when{text-align:right;font-size:11.5px;color:var(--dsw-alias-label-tertiary,#8c8c94);white-space:nowrap}
.dshcm-when b{display:block;font-weight:600;color:var(--dsw-alias-label-secondary,#c9c9cf);font-variant-numeric:tabular-nums}
.dshcm-rows{margin:13px 0 0;display:grid;grid-template-columns:1fr auto auto;gap:7px 10px;align-items:baseline}
.dshcm-rows dt{color:var(--dsw-alias-label-tertiary,#8c8c94);font-size:11.5px;font-weight:400}
.dshcm-rows dd{margin:0;text-align:right;font-variant-numeric:tabular-nums;font-size:11.5px;color:var(--dsw-alias-label-secondary,#c9c9cf)}
.dshcm-rows dd.dshcm-money{color:var(--dsw-alias-label-primary,#f4f4f5);font-weight:550;min-width:56px}
.dshcm-rule{grid-column:1/-1;height:1px;background:var(--dsw-alias-separator-primary,rgba(255,255,255,.1));margin:2px 0}
.dshcm-rows .dshcm-totalrow{font-size:12px;color:var(--dsw-alias-label-primary,#f4f4f5);font-weight:600}
.dshcm-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:12px;padding-top:9px;border-top:.5px solid var(--dsw-alias-separator-primary,rgba(255,255,255,.09));font-size:10.5px;color:var(--dsw-alias-label-tertiary,#8c8c94)}
.dshcm-foot code{font:inherit;color:var(--dsw-alias-label-secondary,#c9c9cf)}
@media (prefers-reduced-motion:reduce){.dshcm-pill,.dshcm-dot{transition:none}.dshcm-pulse,.dshcm-panel{animation:none}}
`;

		function injectStyles() {
			if (typeof document === "undefined") return;
			const existing = document.querySelector('style[data-plugin="' + PLUGIN_ID + '"]');
			if (existing !== null) {
				existing.textContent = CSS;
				return;
			}
			const tag = document.createElement("style");
			tag.dataset.plugin = PLUGIN_ID;
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}
		//#endregion

		//#region ui
		function useNow(interval) {
			const [now, setNow] = useState(() => Date.now());
			useEffect(() => {
				const timer = setInterval(() => setNow(Date.now()), interval);
				return () => clearInterval(timer);
			}, [interval]);
			return now;
		}

		function Row({ label, tokens, cost }) {
			return h(
				React.Fragment,
				null,
				h("dt", null, label),
				h("dd", null, exactNumber.format(tokens)),
				h("dd", { className: "dshcm-money" }, formatUSD(cost))
			);
		}

		function Panel({ anchor, usage, acc, model, onClose }) {
			const [pos, setPos] = useState(null);
			const panelRef = useRef(null);
			const now = useNow(30000);
			const reason = tariffReason(now);
			const peak = reason === "peak";
			const copy = TARIFF_COPY[reason];
			const next = nextTransition(now);
			const total = totalCost(acc);

			useLayoutEffect(() => {
				const rect = anchor.getBoundingClientRect();
				const width = 316;
				const margin = 10;
				const left = Math.min(Math.max(margin, rect.right - width), window.innerWidth - width - margin);
				let top = rect.bottom + 8;
				if (top + 320 > window.innerHeight) top = Math.max(margin, rect.top - 8 - 320);
				setPos({ left, top });
			}, [anchor]);

			useEffect(() => {
				const onPointer = (event) => {
					const target = event.target;
					if (panelRef.current !== null && panelRef.current.contains(target)) return;
					if (anchor.contains(target)) return;
					onClose();
				};
				const onKey = (event) => {
					if (event.key === "Escape") onClose();
				};
				document.addEventListener("pointerdown", onPointer, true);
				document.addEventListener("keydown", onKey);
				return () => {
					document.removeEventListener("pointerdown", onPointer, true);
					document.removeEventListener("keydown", onKey);
				};
			}, [anchor, onClose]);

			const rows = [
				h(Row, { key: "in", label: "Entrée · cache miss", tokens: acc.in, cost: acc.cIn }),
				h(Row, { key: "hit", label: "Entrée · cache hit", tokens: acc.hit, cost: acc.cHit }),
				h(Row, { key: "out", label: "Sortie", tokens: acc.out, cost: acc.cOut }),
				h("div", { key: "rule", className: "dshcm-rule" }),
				h("dt", { key: "tl", className: "dshcm-totalrow" }, "Total"),
				h("dd", { key: "tt", className: "dshcm-totalrow" }, exactNumber.format(totalTokens(acc)) + " tok"),
				h("dd", { key: "tc", className: "dshcm-money dshcm-totalrow" }, formatUSD(total))
			];

			return createPortal(
				h(
					"div",
					{
						ref: panelRef,
						className: "dshcm-panel",
						role: "dialog",
						"aria-label": "Coût de la session",
						style: pos === null ? { left: -9999, top: -9999 } : { left: pos.left, top: pos.top }
					},
					h(
						"div",
						{ className: "dshcm-eyebrow" },
						h("span", null, "Coût de la session"),
						h("span", null, peak ? "plein" : "creux")
					),
					h(
						"div",
						{ className: "dshcm-total" },
						h("strong", null, formatUSD(total)),
						h("span", null, "≈ estimation USD")
					),
					h(
						"div",
						{ className: "dshcm-tariff", "data-tariff": peak ? "peak" : "off" },
						h("span", { className: "dshcm-dot", "aria-hidden": true }),
						h(
							"div",
							{ className: "dshcm-tariff-main" },
							h(
								"div",
								{ className: "dshcm-tariff-title" },
								copy.title,
								h("span", { className: "dshcm-badge" }, copy.badge)
							),
							h("div", { className: "dshcm-tariff-sub" }, copy.sub)
						),
						next !== null &&
							h(
								"div",
								{ className: "dshcm-when" },
								"jusqu'à ",
								h("b", null, clock.format(new Date(next))),
								formatCountdown(next - now)
							)
					),
					h("dl", { className: "dshcm-rows" }, rows),
					h(
						"div",
						{ className: "dshcm-foot" },
						h("code", null, "deepseek · " + normalizeModel(model)),
						h("span", null, "tarifs API USD")
					)
				),
				document.body
			);
		}

		function CostMeter({ sessionId, useProjection }) {
			const usage = useProjection("tokenUsage");
			const selection = useProjection("modelSelection");
			const now = useNow(30000);
			const key = STORAGE_PREFIX + String(sessionId ?? "unknown");
			const selectedModel = selection?.pending?.model ?? selection?.lastUsed?.model;
			const model = typeof selectedModel === "string" ? selectedModel : "deepseek-flash";

			const keyRef = useRef(key);
			const accRef = useRef(readAcc(key));
			if (keyRef.current !== key) {
				keyRef.current = key;
				accRef.current = readAcc(key);
			}
			const [, bump] = useReducer((value) => value + 1, 0);
			const [open, setOpen] = useState(false);
			const rootRef = useRef(null);
			const buttonRef = useRef(null);
			const close = useCallback(() => setOpen(false), []);

			const inTokens = (usage?.uncachedInputTokens ?? 0) + (usage?.cacheWriteTokens ?? 0);
			const hitTokens = usage?.cacheReadTokens ?? 0;
			const outTokens = usage?.outputTokens ?? 0;
			const signature = inTokens + "|" + hitTokens + "|" + outTokens;

			useEffect(() => {
				const current = { in: inTokens, hit: hitTokens, out: outTokens };
				const next = accrue(accRef.current, current, model, Date.now());
				if (next === accRef.current) return;
				if (accRef.current === null && inTokens + hitTokens + outTokens === 0) {
					accRef.current = next;
					return;
				}
				accRef.current = next;
				writeAcc(key, next);
				bump();
			}, [signature, key, model, bump, inTokens, hitTokens, outTokens]);

			const acc = accRef.current ?? emptyAcc();
			const zero = totalTokens(acc) === 0;
			const total = totalCost(acc);
			const peak = isPeak(now);
			const label =
				(total === 0 ? "Aucun jeton facturé" : formatUSD(total) + " sur cette session") +
				" · " +
				compactTokens(totalTokens(acc)) +
				" jetons · tarif " +
				(peak ? "plein" : "creux");

			return h(
				"span",
				{ ref: rootRef, className: "dshcm-root", "data-tariff": peak ? "peak" : "off", "data-zero": zero ? "true" : "false" },
				h(
					"button",
					{
						ref: buttonRef,
						type: "button",
						className: "dshcm-pill",
						"aria-haspopup": "dialog",
						"aria-expanded": open,
						"aria-label": label,
						title: label,
						onClick: () => setOpen((value) => !value)
					},
					h("span", { className: "dshcm-dot", "aria-hidden": true }),
					h("span", { key: total.toFixed(9), className: "dshcm-cost dshcm-pulse" }, formatUSD(total)),
					h("span", { className: "dshcm-sep", "aria-hidden": true }),
					h("span", { className: "dshcm-tokens" }, compactTokens(totalTokens(acc)) + " tok")
				),
				open && buttonRef.current !== null && h(Panel, { anchor: buttonRef.current, usage, acc, model, onClose: close })
			);
		}
		//#endregion

		function apply(ctx) {
			injectStyles();
			ctx.slots.inject(SLOT, () =>
				ctx.slots.register(
					{
						name: SLOT,
						id: "cost-meter",
						order: 30
					},
					CostMeter
				)
			);
		}

		exports.apply = apply;
		exports.inject = ["slots"];
		exports.__test = {
			isPeak,
			tariffReason,
			nextTransition,
			priceDelta,
			accrue,
			ratesFor,
			normalizeModel,
			formatUSD,
			compactTokens,
			formatCountdown,
			emptyAcc,
			CostMeter,
			Panel
		};
		return module.exports;
	}
});
