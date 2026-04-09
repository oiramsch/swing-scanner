# Prompt Implementation Status

> Stand: 2026-04-09 09:47:23  
> Repository: `oiramsch/swing-scanner`

## Status-Legende

- `implemented` = Prompt wurde in einem Issue beauftragt und durch einen gemergten PR umgesetzt.
- `partial` = technisch erledigt, aber eher Test/Cleanup statt Feature-Umsetzung.
- `open/not planned` = Issue geschlossen mit `not_planned` oder (noch) ohne Umsetzung.
- `no ticket found` = Prompt-Datei ohne zugeordnetes Issue/PR.

## 1:1-Abgleich (_Prompt/_Prompts vs. closed Issues/PRs)

| Datei | Zugehöriges Issue | Zugehöriger PR | Status |
|---|---|---|---|
| `_Prompts/Bugfix_ScanMonitoring_NewsCache.md` | [#16](https://github.com/oiramsch/swing-scanner/issues/16) | [#18](https://github.com/oiramsch/swing-scanner/pull/18) | `implemented` |
| `_Prompts/Feature_UnitTests_CI.md` | [#21](https://github.com/oiramsch/swing-scanner/issues/21) | [#22](https://github.com/oiramsch/swing-scanner/pull/22) | `implemented` |
| `_Prompts/Feature_WebSocket_LivePreise.md` | [#23](https://github.com/oiramsch/swing-scanner/issues/23) | [#24](https://github.com/oiramsch/swing-scanner/pull/24) | `implemented` |
| `_Prompts/Feature_BearMarket_Phase2_ShortSelling.md` | [#29](https://github.com/oiramsch/swing-scanner/issues/29) | [#35](https://github.com/oiramsch/swing-scanner/pull/35) | `implemented` |
| `_Prompts/Feature_BearMarket_Phase3_PaperAutoTrading.md` | [#33](https://github.com/oiramsch/swing-scanner/issues/33) | – | `open/not planned` |
| `_Prompts/Feature_BearMarket_Phase4_PairTrading.md` | [#34](https://github.com/oiramsch/swing-scanner/issues/34) | – | `open/not planned` |
| `_Prompts/Test_Cleanup.md` | [#19](https://github.com/oiramsch/swing-scanner/issues/19) | [#20](https://github.com/oiramsch/swing-scanner/pull/20) | `partial` |

## Pflege

- Bei jedem neuen Prompt-Issue nach PR-Merge Status auf `implemented` setzen.
- `Stand`-Datum aktualisieren.
- Falls neue Prompt-Dateien ohne Ticket existieren: `no ticket found` ergänzen.