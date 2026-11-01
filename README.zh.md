# dsh-cost-meter

在每个 DeepSeek Harness 会话的标题栏中，实时显示已消耗的 token 数量和该会话以美元计的
费用。徽标会根据 DeepSeek API 的峰谷时段自动切换计价。

**语言：** [Français](README.md) · [English](README.en.md) · [中文](README.zh.md)

## 界面效果

- 会话标题栏中一个低调的小胶囊：`$0,023 · 12,4k tok`。
- 谷时显示绿点，峰时显示琥珀色点。
- 点击后展开详细面板：未命中缓存的输入、命中缓存的输入、输出、总计、当前费率，
  以及下一次费率切换的时间。

## 计费标准

DeepSeek 官方公开价格（美元 / 百万 token）：

| 模型 | 输入（命中缓存） | 输入（未命中缓存） | 输出 |
| --- | --- | --- | --- |
| `deepseek-flash` — 谷时 | 0.003 | 0.15 | 0.60 |
| `deepseek-flash` — 峰时 | 0.006 | 0.30 | 1.20 |
| `deepseek-v4-pro` — 谷时 | 0.022 | 0.66 | 1.98 |
| `deepseek-v4-pro` — 峰时 | 0.044 | 1.32 | 3.96 |

峰时：周一至周五，UTC 01:00–04:00 与 06:00–10:00，中国法定节假日除外。其余时段均为
谷时（半价）。

## 安装

克隆仓库后，在插件目录中执行：

```sh
git clone https://github.com/NtechSviet/dsh-cost-meter.git
cd dsh-cost-meter
dsh plugin --profile desktop add .
```

然后重启 DeepSeek Harness。每个打开的会话标题栏中都会出现该徽标。

卸载：

```sh
dsh plugin --profile desktop remove dsh-cost-meter
```

## 说明

- 费用为估算值：每一笔新增消耗都按被观测到的那一刻的费率计价，并按会话保存在
  `localStorage` 中。因此，跨越峰谷切换的会话依然能被正确分摊计价。
- 费率写在 `lib/client.js` 的 `PRICES` 常量中。2026 年中国法定节假日位于
  `HOLIDAY_RANGES`；后续年份公布后请自行补充。
- 当前模型从会话的 `modelSelection` 投影中读取。

## 许可证

MIT — 见 [LICENSE](LICENSE)。
