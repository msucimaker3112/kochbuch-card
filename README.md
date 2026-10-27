# Kochbuch

**Ein eigenes Kochbuch für Home Assistant.** Rezepte schreiben und bebildern, aus dem Internet einlesen, mit dem Kochmodus Schritt für Schritt nachkochen und Zutaten auf die Einkaufsliste setzen. Komplett deutsch, gemacht für das Küchen-Tablet.

- **Rezepte** mit Foto, Kategorie, Stichwörtern, Schwierigkeit, Zeiten, Notizen und Favoriten. Suche über Titel, Zutaten und Stichwörter.
- **Aus dem Internet:** Adresse einer Rezeptseite einfügen (Chefkoch, Lecker, Foodblogs …), die Karte füllt den Editor aus. Vor dem Speichern prüfst du alles.
- **Kochmodus:** großer Text, Zutaten je Schritt, Timer mit Ring und Alarm, Temperatur, Wischen oder Pfeiltasten zum Blättern. Der Bildschirm bleibt an.
- **Portionen umrechnen:** Mengen passen sich an, aus „1000 g“ wird „1 kg“.
- **Einkaufsliste:** fehlende Zutaten mit Menge auf eine `todo`-Liste setzen (zum Beispiel Bring! oder die Einkaufsliste von Home Assistant). Was schon draufsteht, wird erkannt.
- **Freie Timer** für Eier, Nudeln, Reis oder eigene Zeiten, auf Wunsch mit Ansage über einen Lautsprecher.
- **Vorlesen und Sprachsteuerung:** Schritte vorlesen lassen, „Alexa, nächster Schritt“ über Routinen.

Rezepte liegen in einem eigenen Dashboard von Home Assistant, Fotos im Bilderspeicher von Home Assistant. Sie sind damit in jedem normalen Backup enthalten. Eine Datenbank oder ein Add-on brauchst du nicht.

## Installation

### Über HACS (benutzerdefiniertes Repository)

HACS → ⋮ → *Benutzerdefinierte Repositories* → `https://github.com/msucimaker3112/kochbuch-card`, Kategorie *Dashboard* → herunterladen → Browser neu laden.

> Solange das Repository privat ist, geht das nicht. Dann den manuellen Weg nehmen.

### Manuell

1. `kochbuch-card.js` nach `/config/www/kochbuch-card.js` kopieren (zum Beispiel mit der App *File editor* oder per Samba).
2. Einstellungen → Dashboards → ⋮ → *Ressourcen* → *Ressource hinzufügen*: URL `/local/kochbuch-card.js?v=0.5.0`, Typ *JavaScript-Modul*.
3. Browser hart neu laden (Strg + Umschalt + R) bzw. in der Companion-App den Frontend-Cache zurücksetzen.

Bei jedem Update die Zahl hinter `?v=` erhöhen, damit Browser und App die neue Datei laden.

## Einrichtung

Am besten ein eigenes Dashboard im Panel-Modus anlegen, damit die Karte die ganze Seite nutzt:

```yaml
views:
  - title: Kochbuch
    path: rezepte
    type: panel
    cards:
      - type: custom:kochbuch-card
        title: Kochbuch
        store: kochbuch-daten
        shopping_list: todo.einkaufsliste
        announce: notify.alexa_media_kueche
```

| Option | Standard | Bedeutung |
|---|---|---|
| `title` | `Kochbuch` | Überschrift auf der Startseite |
| `store` | `kochbuch-daten` | URL-Pfad des Dashboards, in dem die Rezepte gespeichert werden. Wird beim ersten Speichern angelegt, falls es fehlt. Nicht von Hand bearbeiten. |
| `shopping_list` | – | `todo`-Entität für „Auf die Einkaufsliste“. Ohne Angabe gibt es den Knopf nicht. |
| `announce` | – | Dienst für Timer-Ansagen, zum Beispiel `notify.alexa_media_kueche` |
| `speak` | Wert von `announce` | Dienst für das Vorlesen der Schritte |
| `voice` | siehe unten | Schalter oder Knöpfe für die Sprachsteuerung |

**Speichern geht nur mit einem Administrator-Konto**, weil die Rezepte in einer Dashboard-Konfiguration liegen. Lesen und Kochen geht mit jedem Konto.

## Rezepte aus dem Internet

Der Knopf **„Aus dem Internet“** (auf schmalen Bildschirmen nur das Globus-Symbol) liest Rezeptseiten ein. Fast alle Rezeptseiten liefern ihre Rezepte zusätzlich als maschinenlesbare Daten ([schema.org/Recipe](https://schema.org/Recipe)) mit. Die Karte übernimmt daraus Titel, Beschreibung, Foto, Portionen, Zeiten, Kategorie, Stichwörter, Zutaten und Schritte. Zeiten wie „20 Minuten“ werden zu Timern, „180 °C“ zur Temperatur des Schritts. Seiten ohne solche Daten liefern nur Titel und Foto. Den Rest fügst du dann mit „Als Text einfügen“ hinzu.

Der Browser darf fremde Webseiten nicht direkt lesen, deshalb ruft **Home Assistant** die Seite ab. Dafür in `configuration.yaml` eintragen:

```yaml
rest_command:
  kochbuch_abruf:
    url: "{{ url }}"
    method: get
    timeout: 20
    headers:
      User-Agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
      Accept: "text/html,application/xhtml+xml"
      Accept-Language: "de-DE,de;q=0.9"
```

Danach unter Entwicklerwerkzeuge → YAML die Konfiguration prüfen und *REST-Befehle* neu laden. Ein Neustart ist nicht nötig.

Ohne diesen Dienst versucht die Karte öffentliche Abrufdienste (allorigins.win, codetabs.com). Die sind oft überlastet und bekommen die Adresse des Rezepts zu sehen, sie sind also nur eine Notlösung.

Hinweis: Mit dem Dienst kann jedes Konto in Home Assistant eine beliebige Adresse über Home Assistant abrufen lassen.

## Sprachsteuerung mit Alexa

Die Karte beobachtet drei Helfer. Lege sie als *Schalter* (`input_boolean`) oder *Taste* (`input_button`) an und schalte bzw. drücke sie in Alexa-Routinen:

| Befehl | Standard-Helfer | Wirkung |
|---|---|---|
| `next` | `input_boolean.kochbuch_weiter` | Rezept geöffnet: Kochmodus starten. Im Kochmodus: nächster Schritt |
| `back` | `input_boolean.kochbuch_zuruck` | Schritt zurück |
| `read` | `input_boolean.kochbuch_vorlesen` | aktuellen Schritt bzw. Zutatenliste vorlesen |

Schalter setzt die Karte nach dem Befehl selbst wieder aus. Andere Helfer:

```yaml
voice:
  next: input_button.kochbuch_weiter
  back: input_button.kochbuch_zurueck
  read: input_button.kochbuch_vorlesen
```

Vorgelesen wird über `speak` (sonst `announce`) mit `data: {type: tts}`, passend für Alexa Media Player.

## Daten

- **Rezepte:** im Dashboard `store` unter dem Schlüssel `kochbuch` der Konfiguration. Mehrere Geräte arbeiten auf demselben Stand, jede Änderung liest vorher neu.
- **Fotos:** im Bilderspeicher von Home Assistant (`/api/image`), beim Hochladen auf höchstens 1600 px verkleinert. Ersetzte oder gelöschte Fotos werden mit entfernt.
- **Gerätebezogen** (nur im Browser): zuletzt gewählte Kategorie und ob Schritte automatisch vorgelesen werden.

## Lizenz

MIT, siehe [LICENSE](LICENSE).
