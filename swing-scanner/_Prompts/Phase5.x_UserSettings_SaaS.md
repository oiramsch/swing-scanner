# Task: UserSettings — SaaS-fähige Benutzer-Settings

## Zielsetzung
Die `AppSetting`-Tabelle ist eine globale Key-Value-Tabelle ohne `tenant_id`.
Sobald mehrere Nutzer den Scanner verwenden, teilen sie sich ntfy-Topic,
Claude-Key und Alert-Flags — das ist falsch.
Ziel: Migration zu `UserSetting(tenant_id, key, value)` damit jeder Nutzer
eigene Einstellungen hat.

## Kontext & Dateien

### Aktueller Stand (nach PR #12)
- `backend/database.py` — `AppSetting`-Modell + Helpers:
  - `get/set_ntfy_topic()` — global, kein tenant_id
  - `get/set_anthropic_api_key()` — global, kein tenant_id
  - `get/set_ntfy_alerts()` — global, kein tenant_id
  - `was/set_summary_notified()` — global (akzeptabel, da scan-bezogen)
  - `was/set_ntfy_entry_sent()` — global (akzeptabel, da scan-bezogen)
- `backend/main.py` — Startup lädt ntfy_topic + anthropic_api_key aus DB in `settings.*`
- `backend/notifier.py` — `send_push()` liest topic aus DB

### Warum noch nicht gemacht
Für den aktuellen Einzelnutzer-Betrieb ist `AppSetting` ausreichend.
Die Broker-Credentials (Alpaca, TR, IBKR) sind bereits korrekt per
`tenant_id` isoliert (`BrokerConnection`-Tabelle).

### Was geändert werden muss
1. **Neues Modell** `UserSetting` in `database.py`:
   ```python
   class UserSetting(SQLModel, table=True):
       id: Optional[int] = Field(default=None, primary_key=True)
       tenant_id: str = Field(index=True)
       key: str
       value: str
   ```
2. **Helpers anpassen** — alle `get/set_ntfy_topic`, `get/set_anthropic_api_key`,
   `get/set_ntfy_alerts` bekommen `tenant_id: str` als Parameter
3. **API-Endpoints** in `main.py` übergeben `current_user.tenant_id`
4. **notifier.py** — `send_push()` kann keinen tenant_id-Kontext haben
   (wird aus Scheduler-Jobs ohne HTTP-Request aufgerufen). Lösung:
   pro Nutzer eine Worker-Instanz, oder ntfy_topic wird beim Scan-Start
   aus DB in den Job-Kontext geladen.
5. **Migration** — bestehende `AppSetting`-Einträge in `UserSetting` für
   den Default-Tenant migrieren

### Wichtiger Sonderfall: notifier.py
`send_push()` wird aus ARQ-Jobs (Scheduler) aufgerufen — kein HTTP-Request,
kein `current_user`. Der Topic muss entweder:
- Global bleiben (akzeptabel für Single-Tenant-Betrieb)
- Oder: Bei Job-Start als Kontext-Variable übergeben werden

## Definition of Done
@claude: Führe `gh pr create` ERST aus, wenn du alle folgenden Punkte geprüft und abgehakt hast:
- [ ] `UserSetting`-Tabelle mit `tenant_id` existiert in `database.py`
- [ ] Alle ntfy + anthropic-key Helpers verwenden `tenant_id`
- [ ] API-Endpoints übergeben `current_user.tenant_id`
- [ ] Bestehende `AppSetting`-Einträge werden bei Migration auf Default-Tenant übertragen
- [ ] `notifier.py` — Lösung für tenant-losen Scheduler-Kontext dokumentiert/implementiert
- [ ] Kein bestehender Test bricht
- [ ] `AppSetting` bleibt für scan-bezogene Dedup-Keys erhalten (summary_notified, entry_sent)
