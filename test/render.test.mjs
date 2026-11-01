import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><head></head><body><div id=\"root\"></div></body></html>", {
	url: "http://localhost/",
	pretendToBeVisual: true
});

globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Event = dom.window.Event;
globalThis.MouseEvent = dom.window.MouseEvent;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const require = createRequire(import.meta.url);
const React = require("react");
const { createRoot } = require("react-dom/client");
const act = React.act ?? require("react-dom/test-utils").act;

let captured;
globalThis.window.__ModuleLoader__ = {
	load: (definition) => {
		captured = definition;
	}
};

await import(new URL("../lib/client.js", import.meta.url).href);

const mod = captured.factory((id) => {
	if (id === "react") return React;
	if (id === "react-dom") return require("react-dom");
	throw new Error("unexpected require " + id);
});

assert.equal(captured.id, "dsh-cost-meter");
assert.equal(mod.__test.CostMeter.name, "CostMeter");

const registrations = [];
mod.apply({
	slots: {
		inject: (key, callback) => callback(),
		register: (spec, component) => {
			registrations.push({ spec, component });
			return () => {};
		}
	}
});
assert.equal(registrations.length, 1);
const styleTag = document.querySelector('style[data-plugin="dsh-cost-meter"]');
assert.ok(styleTag !== null, "styles injected");
assert.match(styleTag.textContent, /\[data-tariff=off\] \.dshcm-dot\{background:#3ddc97/, "off-peak dot turns green inside the portaled panel too");

const usage = {
	uncachedInputTokens: 12000,
	outputTokens: 4000,
	cacheReadTokens: 300000,
	cacheWriteTokens: 0
};

const useProjection = (key) => {
	if (key === "tokenUsage") return usage;
	if (key === "modelSelection") return { lastUsed: { provider: "deepseek-official", model: "deepseek-flash" }, pending: null };
	return undefined;
};

const container = document.getElementById("root");
const root = createRoot(container);

await act(async () => {
	root.render(React.createElement(mod.__test.CostMeter, { sessionId: "session-test", useProjection }));
});
await act(async () => {
	await new Promise((resolve) => setTimeout(resolve, 50));
});

const pill = container.querySelector(".dshcm-pill");
assert.ok(pill !== null, "pill rendered");
assert.match(pill.textContent, /\$0,0051/, "off-peak cost: " + pill.textContent);
assert.match(pill.textContent, /316k tok/, "compact token total: " + pill.textContent);
assert.equal(pill.getAttribute("aria-expanded"), "false");
assert.equal(container.querySelector(".dshcm-root").getAttribute("data-tariff"), "off", "weekend is off-peak");

await act(async () => {
	pill.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
});
await act(async () => {
	await new Promise((resolve) => setTimeout(resolve, 30));
});

const panel = document.querySelector(".dshcm-panel");
assert.ok(panel !== null, "panel opened in a portal");
assert.match(panel.textContent, /Coût de la session/);
assert.match(panel.textContent, /Week-end|Heure creuse|Jour férié/);
assert.match(panel.textContent, /Entrée · cache miss/);
assert.match(panel.textContent, /Entrée · cache hit/);
assert.match(panel.textContent, /Sortie/);
assert.match(panel.textContent, /316\s*000\s*tok/, "exact total in the panel");
assert.match(panel.textContent, /\$0,0051/);
assert.match(panel.textContent, /deepseek · deepseek-flash/);
assert.equal(pill.getAttribute("aria-expanded"), "true");
const panelDot = panel.querySelector(".dshcm-dot");
assert.equal(dom.window.getComputedStyle(panelDot).backgroundColor, "rgb(61, 220, 151)", "panel dot is green off-peak");

// Escape closes the panel.
await act(async () => {
	document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
});
assert.equal(document.querySelector(".dshcm-panel"), null, "Escape closes");

await act(async () => {
	root.unmount();
});
assert.equal(container.querySelector(".dshcm-pill"), null, "unmount cleans the pill");

console.log("render tests passed");
