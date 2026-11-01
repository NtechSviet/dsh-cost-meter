# dsh-cost-meter

Shows, live in the header of every DeepSeek Harness session, the number of tokens
consumed and the cost of the session in US dollars. The badge accounts for the
DeepSeek API peak and off-peak hours.

**Languages:** [Français](README.md) · [English](README.en.md) · [中文](README.zh.md)

## What you see

- A discreet pill in the session header: `$0.023 · 12.4k tok`.
- A green dot off-peak, amber during peak hours.
- On click, a detailed panel: cache-miss input, cache-hit input, output, total,
  the current tariff and when the tariff next changes.

## Pricing

DeepSeek public pricing (USD per million tokens):

| Model | Cache-hit input | Cache-miss input | Output |
| --- | --- | --- | --- |
| `deepseek-flash` — off-peak | 0.003 | 0.15 | 0.60 |
| `deepseek-flash` — peak | 0.006 | 0.30 | 1.20 |
| `deepseek-v4-pro` — off-peak | 0.022 | 0.66 | 1.98 |
| `deepseek-v4-pro` — peak | 0.044 | 1.32 | 3.96 |

Peak hours: Monday–Friday, 01:00–04:00 and 06:00–10:00 UTC, excluding Chinese
public holidays. Everything else is off-peak (half price).

## Installation

Clone the repository, then, from the plugin folder:

```sh
git clone https://github.com/NtechSviet/dsh-cost-meter.git
cd dsh-cost-meter
dsh plugin --profile desktop add .
```

Then restart DeepSeek Harness. The badge appears in the header of every open
session.

Uninstall:

```sh
dsh plugin --profile desktop remove dsh-cost-meter
```

## Notes

- The cost is an estimate: each new increment of usage is priced at the moment
  it is observed, then kept per session in `localStorage`. A session that
  crosses a peak/off-peak switch is therefore still priced correctly.
- Prices live in `lib/client.js` (the `PRICES` constant). Chinese public
  holidays for 2026 are in `HOLIDAY_RANGES`; add the following years as they are
  published.
- The model is read from the session's `modelSelection` projection.

## License

MIT — see [LICENSE](LICENSE).
