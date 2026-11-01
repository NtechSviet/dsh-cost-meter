# dsh-cost-meter

Affiche en direct, dans l'en-tête de chaque session DeepSeek Harness, le nombre de
tokens consommés et le coût de la session en dollars US. Le badge tient compte des
heures pleines et creuses de l'API DeepSeek.

**Langues :** [Français](README.md) · [English](README.en.md) · [中文](README.zh.md)

## Ce que vous voyez

- Une capsule discrète dans l'en-tête de session : `$0,023 · 12,4k tok`.
- Un point vert en heures creuses, ambre en heures pleines.
- Au clic, un panneau détaillé : entrée cache miss, entrée cache hit, sortie,
  total, tarif en cours et heure du prochain changement de tarif.

## Tarifs appliqués

Tarifs publics DeepSeek (USD par million de tokens) :

| Modèle | Entrée cache hit | Entrée cache miss | Sortie |
| --- | --- | --- | --- |
| `deepseek-flash` — creux | 0,003 | 0,15 | 0,60 |
| `deepseek-flash` — plein | 0,006 | 0,30 | 1,20 |
| `deepseek-v4-pro` — creux | 0,022 | 0,66 | 1,98 |
| `deepseek-v4-pro` — plein | 0,044 | 1,32 | 3,96 |

Heures pleines : lundi–vendredi, 01:00–04:00 et 06:00–10:00 UTC, hors jours
fériés chinois. Tout le reste est en tarif creux (moitié prix).

## Installation

Cloner le dépôt, puis depuis le dossier du plugin :

```sh
git clone https://github.com/NtechSviet/dsh-cost-meter.git
cd dsh-cost-meter
dsh plugin --profile desktop add .
```

Puis redémarrez DeepSeek Harness. Le badge apparaît dans l'en-tête de chaque
session ouverte.

Désinstallation :

```sh
dsh plugin --profile desktop remove dsh-cost-meter
```

## Notes

- Le coût est une estimation : chaque nouvelle consommation est tarifée à
  l'instant où elle est observée, puis conservée par session dans
  `localStorage`. Une session qui traverse une bascule plein/creux reste donc
  correctement ventilée.
- Les tarifs sont codés dans `lib/client.js` (constante `PRICES`). Les jours
  fériés chinois 2026 sont dans `HOLIDAY_RANGES` ; ajoutez les années suivantes
  au fur et à mesure de leur publication.
- Le modèle est lu depuis la projection `modelSelection` de la session.

## Licence

MIT — voir [LICENSE](LICENSE).
