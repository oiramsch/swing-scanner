# Prompt Implementation Status

> Stand: 2026-04-09 14:30:00  
> Repository: `oiramsch/swing-scanner`

## Status-Legende

- `implemented` = Prompt wurde in einem Issue beauftragt und durch einen gemergten PR umgesetzt.
- `in progress` = Issue/PR offen, Umsetzung läuft.
- `partial` = technisch erledigt, aber eher Test/Cleanup statt Feature-Umsetzung.
- `open/not planned` = Issue geschlossen mit `not_planned` oder (noch) ohne Umsetzung.
- `no ticket found` = Prompt-Datei ohne zugeordnetes Issue/PR.
- `auto-fix` = Kein Prompt — von Claude Code selbstständig diagnostiziert und gefixt.

## 1:1-Abgleich (_Prompts vs. closed Issues/PRs)

| Datei | Zugehöriges Issue | Zugehöriger PR | Status |
|---|---|---|---|
| `_Prompts/Bugfix_FridayScan_NewsCache.md` | – | – | `no ticket found` |
| `_Prompts/Bugfix_ScanMonitoring_NewsCache.md` | [#16](https://github.com/oiramsch/swing-scanner/issues/16) | [#18](https://github.com/oiramsch/swing-scanner/pull/18) | `implemented` |
| `_Prompts/Feature_UnitTests_CI.md` | [#21](https://github.com/oiramsch/swing-scanner/issues/21) | [#22](https://github.com/oiramsch/swing-scanner/pull/22) | `implemented` |
| `_Prompts/Feature_WebSocket_LivePreise.md` | [#23](https://github.com/oiramsch/swing-scanner/issues/23) | [#24](https://github.com/oiramsch/swing-scanner/pull/24) | `implemented` |
| `_Prompts/Feature_BearMarket_Phase2_ShortSelling.md` | [#29](https://github.com/oiramsch/swing-scanner/issues/29) | [#35](https://github.com/oiramsch/swing-scanner/pull/35) | `implemented` |
| `_Prompts/Feature_BearMarket_Phase3_PaperAutoTrading.md` | [#30](https://github.com/oiramsch/swing-scanner/issues/30) | [#37](https://github.com/oiramsch/swing-scanner/pull/37) | `implemented` |
| `_Prompts/Feature_BearMarket_Phase4_PairTrading.md` | [#31](https://github.com/oiramsch/swing-scanner/issues/31) | [#38](https://github.com/oiramsch/swing-scanner/pull/38) | `in progress` |
| `_Prompts/Phase3.2_TradingCockpit.md` | – | – | `no ticket found` |
| `_Prompts/Phase4.1_GhostPortfolioUI.md` | – | – | `no ticket found` |
| `_Prompts/Phase5.x_UserSettings_SaaS.md` | – | – | `open/not planned` |
| `_Prompts/Test_Cleanup.md` | [#19](https://github.com/oiramsch/swing-scanner/issues/19) | [#20](https://github.com/oiramsch/swing-scanner/pull/20) | `partial` |

## Auto-Fixes (kein Prompt, von Claude Code selbstständig gefixt)

| Beschreibung | PR | Datum |
|---|---|---|
| Bear RS Kandidaten immer `watchlist_pending` im tiefen Bärenmarkt (ATR-Fallback + setup_type=bear_rs) | [#36](https://github.com/oiramsch/swing-scanner/pull/36) | 08.04.2026 |
| Duplicate Scan Results durch gleichzeitigen ARQ-Cron + manuellen Trigger (30-Min Idempotenz-Guard) | [#39](https://github.com/oiramsch/swing-scanner/pull/39) | 09.04.2026 |

## Löschkandidaten (_Prompts)

Folgende Prompt-Dateien können gelöscht werden, da vollständig implementiert:

- `_Prompts/Bugfix_ScanMonitoring_NewsCache.md` → PR #18 gemergt
- `_Prompts/Feature_UnitTests_CI.md` → PR #22 gemergt
- `_Prompts/Feature_WebSocket_LivePreise.md` → PR #24 gemergt
- `_Prompts/Feature_BearMarket_Phase2_ShortSelling.md` → PR #35 gemergt
- `_Prompts/Feature_BearMarket_Phase3_PaperAutoTrading.md` → PR #37 gemergt

Behalten:

- `_Prompts/Feature_BearMarket_Phase4_PairTrading.md` → PR #38 noch offen
- `_Prompts/Phase5.x_UserSettings_SaaS.md` → zukünftiges SaaS-Feature
- `_Prompts/Phase3.2_TradingCockpit.md` → prüfen ob noch relevant
- `_Prompts/Phase4.1_GhostPortfolioUI.md` → prüfen ob noch relevant
- `_Prompts/Bugfix_FridayScan_NewsCache.md` → kein Ticket, prüfen ob noch relevant
- `_Prompts/00_Template.md` → Template, immer behalten

## Pflege

- Bei jedem neuen Prompt-Issue nach PR-Merge Status auf `implemented` setzen.
- `Stand`-Datum aktualisieren.
- Falls neue Prompt-Dateien ohne Ticket existieren: `no ticket found` ergänzen.
