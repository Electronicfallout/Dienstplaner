# Dienstplaner

Dienstplan, Urlaubsplanung und Zeiterfassung für ein kleines Team. Läuft im Browser am PC, am Android-Handy (auch GrapheneOS, ohne Google-Dienste) und am iPhone und lässt sich wie eine App auf den Startbildschirm legen.

**App öffnen:** https://electronicfallout.github.io/Dienstplaner/

## Was die App kann

- **Dienstplan** als Wochen- und Monatsansicht. Schichten antippen statt Zeiten tippen, Stunden werden automatisch berechnet.
- **Pausenregel:** Dauert ein Dienst länger als 6 Stunden, werden 30 Minuten Pause abgezogen (einstellbar).
- **Fixer Wochenplan** pro Person, österreichische Feiertage automatisch, Events im Shop und Anmerkungen pro Tag.
- **Urlaub:** Anspruch (5 Wochen × Wochenstunden, Teilzeit automatisch anteilig), genommen, geplant, Rest. Mitarbeiter stellen Anträge, der Planer genehmigt, und der Urlaub steht dann im Plan. Jahresübersicht „Wer ist wann weg?“.
- **Zeiterfassung:** Mitarbeiter tragen ihre tatsächlichen Zeiten ein („Wie geplant“ mit einem Tipp). Soll/Ist pro Monat und ein laufendes Zeitkonto (Plus-/Minusstunden).
- **Drucken** und **Excel-Export** pro Monat, **Import** der alten Excel-Dienstpläne (ein Blatt pro Monat).
- Funktioniert **offline** und gleicht später ab. Ändern zwei Geräte gleichzeitig, werden die Änderungen zusammengeführt statt überschrieben.

## Wo liegen die Daten?

Ausschließlich in der Dropbox des Planers, im Ordner `Apps/<Name der Dropbox-App>/`:

- `dienstplan.json`: Plan, Mitarbeiter, Schichten, Einstellungen
- `mitarbeiter/<id>.json`: Zeiten und Urlaubsanträge je Mitarbeiter, **verschlüsselt** (AES-256). Lesen können nur der Mitarbeiter (mit seinem Passwort) und der Planer (mit dem Planer-Passwort).

In diesem Repository liegt nur der Programmcode, keine Daten.

## Einrichtung (einmalig, ca. 10 Minuten)

### 1. Dropbox-App anlegen

1. https://www.dropbox.com/developers/apps öffnen und mit der Dropbox anmelden, in der die Daten liegen sollen.
2. **Create app** → *Scoped access* → *App folder* → einen Namen vergeben (muss bei Dropbox eindeutig sein, z. B. `Dienstplaner-MeinShop`).
3. Reiter **Permissions**: Häkchen bei `files.metadata.read`, `files.content.read`, `files.content.write` → unten **Submit**.
4. Reiter **Settings**:
   - Bei **OAuth 2 → Redirect URIs** eintragen: `https://electronicfallout.github.io/Dienstplaner/` → **Add**
   - **Allow public clients (Implicit Grant & PKCE)** muss auf *Allow* stehen.
   - Den **App key** kopieren (den *App secret* braucht man nicht).

### 2. Als Planer anmelden

1. Die App öffnen → **Ich plane** → App key einfügen → **Mit Dropbox verbinden** → bei Dropbox erlauben.
2. **Planer-Passwort** festlegen. Gut merken: ohne dieses Passwort sind die Zeiten der Mitarbeiter nicht mehr lesbar.
3. Unter **Einstellungen** die alte Excel-Datei importieren oder Mitarbeiter anlegen, Wochenstunden prüfen.

Weitere Planer-PCs: dort genauso **Ich plane** mit demselben App key und derselben Dropbox, danach mit dem Planer-Passwort anmelden.

### 3. Mitarbeiter einladen

**Einstellungen → Mitarbeiter → Einladen** zeigt einen QR-Code, einen Link und einen Code.

- **Android / GrapheneOS** (Vanadium, Firefox, Chrome): Link öffnen, im Browsermenü **App installieren** bzw. **Zum Startbildschirm hinzufügen**.
- **iPhone**: Link in **Safari** öffnen → Teilen → **Zum Home-Bildschirm**. Danach die App vom Home-Bildschirm öffnen und dort **Ich bin Mitarbeiter** → Code einfügen (die App am Home-Bildschirm hat einen eigenen Speicher, deshalb den Code dort noch einmal eingeben).
- Danach legt jeder sein **eigenes Passwort** fest. Vergessen? Der Planer kann es unter *Mitarbeiter → Bearbeiten → Passwort zurücksetzen* neu setzen.

### 4. Kalender-Abo (optional, zum Testen)

Unter *Einstellungen → Mitarbeiter → Bearbeiten* das Häkchen **Kalender-Abo** setzen. Die App schreibt dann die veröffentlichten Dienste dieser Person (31 Tage zurück bis „veröffentlicht bis“, sonst 120 Tage voraus) als `kalender/dienste-<name>-<kürzel>.ics` in den Dropbox-App-Ordner, nach jeder Planänderung neu.

1. In der Dropbox die Datei öffnen → **Teilen** → **Link kopieren**. Am Ende des Links `dl=0` durch `dl=1` ersetzen.
2. Google Kalender am PC öffnen → links bei **Weitere Kalender** auf **+** → **Per URL** → Link einfügen → **Kalender hinzufügen**.
3. Google lädt die Datei nur alle paar Stunden neu; Änderungen kommen also verzögert an.

Wer den Link hat, sieht die Dienste dieser Person. Link in der Dropbox löschen = Abo beendet.

## Sicherheit, ehrlich gesagt

- Der Einladungscode erlaubt Zugriff auf den Dropbox-App-Ordner (nicht auf den Rest der Dropbox). Mitarbeiter sehen den Dienstplan, die Zeiten und Anträge der anderen sind aber verschlüsselt.
- Technisch könnte jemand mit dem Code Dateien im App-Ordner verändern oder löschen. Dropbox hebt frühere Versionen 30 Tage auf; zusätzlich gibt es unter *Einstellungen → Daten* eine Sicherung zum Herunterladen.
- Zugang für alle widerrufen: in der Dropbox unter *Einstellungen → Verbundene Apps* die App trennen, danach neu verbinden und neue Einladungen verschicken.

## Technik

Statische Web-App ohne Server (HTML, CSS, JavaScript-Module), gehostet über GitHub Pages. Daten über die Dropbox-API (OAuth mit PKCE), Verschlüsselung mit WebCrypto (PBKDF2, AES-GCM, RSA-OAEP). Mitgelieferte Bibliotheken: [SheetJS](https://sheetjs.com) 0.18.5 (Apache-2.0) für Excel, [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) 1.4.4 (MIT).

Lokal starten: `python3 -m http.server` im Projektordner, dann http://localhost:8000 öffnen („Nur ausprobieren“ speichert nur im Browser).
