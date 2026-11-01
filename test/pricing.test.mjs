import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const fakeReact = {
	createElement: () => null,
	Fragment: Symbol("Fragment"),
	useState: (v) => [typeof v === "function" ? v() : v, () => {}],
	useEffect: () => {},
	useLayoutEffect: () => {},
	useRef: (v) => ({ current: v }),
	useReducer: (r, i) => [i, () => {}],
	useCallback: (f) => f
};

let captured;
globalThis.window = {
	__ModuleLoader__: {
		load: (definition) => {
			captured = definition;
		}
	}
};
globalThis.document = { querySelector: () => null, head: { appendChild: () => {} }, createElement: () => ({ dataset: {} }) };

const clientUrl = new URL("../lib/client.js", import.meta.url);
await import(clientUrl.href);

assert.equal(captured.id, "dsh-cost-meter");
const mod = captured.factory((id) => {
	if (id === "react") return fakeReact;
	if (id === "react-dom") return { createPortal: () => null };
	throw new Error("unexpected require " + id);
});
const t = mod.__test;

// Tariff windows: weekdays 01:00-04:00 and 06:00-10:00 UTC.
assert.equal(t.isPeak(Date.parse("2026-10-30T02:00:00Z")), true, "Friday 02:00 UTC peak");
assert.equal(t.isPeak(Date.parse("2026-10-30T04:00:00Z")), false, "04:00 boundary off");
assert.equal(t.isPeak(Date.parse("2026-10-30T07:00:00Z")), true, "Friday 07:00 peak");
assert.equal(t.isPeak(Date.parse("2026-10-30T10:00:00Z")), false, "10:00 boundary off");
assert.equal(t.isPeak(Date.parse("2026-10-30T00:30:00Z")), false, "before window off");
assert.equal(t.tariffReason(Date.parse("2026-10-31T02:00:00Z")), "weekend", "Saturday peak hour is off");
assert.equal(t.tariffReason(Date.parse("2026-10-01T02:00:00Z")), "holiday", "National Day is off");
assert.equal(t.tariffReason(Date.parse("2026-10-30T02:00:00Z")), "peak");
assert.equal(t.tariffReason(Date.parse("2026-10-29T23:00:00Z")), "night");

// Flash pricing per 1M tokens.
const peak = Date.parse("2026-10-30T02:00:00Z");
const off = Date.parse("2026-10-31T02:00:00Z");
const d = { in: 1e6, hit: 0, out: 0 };
assert.ok(Math.abs(t.priceDelta(d, "deepseek-flash", peak).cIn - 0.3) < 1e-9, "peak miss $0.30/M");
assert.ok(Math.abs(t.priceDelta(d, "deepseek-flash", off).cIn - 0.15) < 1e-9, "off miss $0.15/M");
assert.ok(Math.abs(t.priceDelta({ in: 0, hit: 1e6, out: 0 }, "deepseek-flash", peak).cHit - 0.006) < 1e-9, "hit $0.006/M");
assert.ok(Math.abs(t.priceDelta({ in: 0, hit: 0, out: 1e6 }, "deepseek-flash", peak).cOut - 1.2) < 1e-9, "output $1.20/M");
assert.ok(Math.abs(t.priceDelta({ in: 1e6, hit: 0, out: 0 }, "deepseek-v4-pro", peak).cIn - 1.32) < 1e-9, "pro peak miss");

// Accrual across a tariff boundary keeps the price of each increment.
let acc = t.accrue(null, { in: 1e6, hit: 0, out: 0 }, "deepseek-flash", peak);
assert.ok(Math.abs(acc.cIn - 0.3) < 1e-9);
acc = t.accrue(acc, { in: 2e6, hit: 0, out: 0 }, "deepseek-flash", off);
assert.ok(Math.abs(acc.cIn - 0.45) < 1e-9, "peak then off increments");
// Same usage again is a no-op.
assert.equal(t.accrue(acc, { in: 2e6, hit: 0, out: 0 }, "deepseek-flash", off), acc);
// A shrink resets the accumulator at the new tariff.
acc = t.accrue(acc, { in: 1e6, hit: 0, out: 0 }, "deepseek-flash", off);
assert.ok(Math.abs(acc.cIn - 0.15) < 1e-9, "reset reprices");

// Formatting.
assert.equal(t.formatUSD(0), "$0,000");
assert.equal(t.formatUSD(0.0234), "$0,023");
assert.equal(t.formatUSD(0.00234), "$0,0023");
assert.equal(t.formatUSD(1.5), "$1,50");
assert.equal(t.compactTokens(842), "842");
assert.equal(t.compactTokens(12400), "12,4k");
assert.equal(t.compactTokens(1e6), "1M");
assert.equal(t.compactTokens(1080000), "1,08M");
assert.equal(t.formatCountdown(90 * 60000), "1 h 30");
assert.equal(t.formatCountdown(15 * 60000), "15 min");

// Next transition from a peak instant.
const next = t.nextTransition(Date.parse("2026-10-30T02:30:00Z"));
assert.equal(new Date(next).toISOString(), "2026-10-30T04:00:00.000Z");

// Slot registration.
const registrations = [];
const ctx = {
	slots: {
		inject: (key, cb) => {
			assert.equal(key, "conversation.session.header.utilities");
			return cb();
		},
		register: (spec, component) => {
			registrations.push({ spec, component });
			return () => {};
		}
	}
};
mod.apply(ctx);
assert.equal(registrations.length, 1);
assert.equal(registrations[0].spec.id, "cost-meter");
assert.equal(registrations[0].spec.order, 30);
assert.equal(registrations[0].component.name, "CostMeter");
assert.deepEqual(mod.inject, ["slots"]);

console.log("pricing tests passed");
