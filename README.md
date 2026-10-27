# Kochbuch

**Ein eigenes Kochbuch für Home Assistant.** Rezepte schreiben und bebildern, aus dem Internet einlesen, mit dem Kochmodus Schritt für Schritt nachkochen und Zutaten auf die Einkaufsliste setzen. Komplett deutsch, gemacht für das Küchen-Tablet.

![Kochbuch: Startseite mit Rezepten, Suche und Kategorien](docs/img/start.jpg)

- **Rezepte** mit Foto, Kategorie, Stichwörtern, Schwierigkeit, Zeiten, Notizen und Favoriten. Suche über Titel, Zutaten und Stichwörter.
- **Aus dem Internet:** Adresse einer Rezeptseite einfügen (Chefkoch, Lecker, Foodblogs …), die Karte füllt den Editor aus. Vor dem Speichern prüfst du alles.
- **Kochmodus:** großer Text, Zutaten je Schritt, Timer mit Ring und Alarm, Temperatur, Wischen oder Pfeiltasten zum Blättern. Der Bildschirm bleibt an.
- **Portionen umrechnen:** Mengen passen sich an, aus „1000 g“ wird „1 kg“.
- **Einkaufsliste:** fehlende Zutaten mit Menge auf eine `todo`-Liste setzen (zum Beispiel Bring! oder die Einkaufsliste von Home Assistant). Was schon draufsteht, wird erkannt.
- **Freie Timer** für Eier, Nudeln, Reis oder eigene Zeiten, auf Wunsch mit Ansage über einen Lautsprecher.
- **Vorlesen und Sprachsteuerung:** Schritte vorlesen lassen, „Alexa, nächster Schritt“ über Routinen.

Rezepte liegen in einem eigenen Dashboard von Home Assistant, Fotos im Bilderspeicher von Home Assistant. Sie sind damit in jedem normalen Backup enthalten. Eine Datenbank oder ein Add-on brauchst du nicht.

## So sieht es aus

**Rezept:** Zeiten und Schwierigkeit auf einen Blick, Zutaten zum Abhaken, Portionen mit − und + umrechnen. Schritte mit Timer zeigen die Dauer gleich mit.

![Rezeptansicht mit Zutaten, Portionen und Zubereitung](docs/img/rezept.jpg)

**Kochmodus:** ein Schritt pro Seite in großer Schrift, rechts die Zutaten für genau diesen Schritt und der Timer. Antippen startet ihn, läuft er ab, klingelt die Karte und sagt es auf Wunsch über Alexa an. Weiter geht es per Knopf, Wischen, Pfeiltaste oder „Alexa, nächster Schritt“.

![Kochmodus mit laufendem Timer und Zutaten für den Schritt](docs/img/kochmodus.jpg)

**Einkaufsliste:** Die Zutaten gehen mit Menge auf deine `todo`-Liste. Was schon draufsteht, ist abgewählt.

![Zutaten auf die Einkaufsliste übernehmen](docs/img/einkaufsliste.jpg)

**Rezept aus dem Internet:** Adresse einfügen, „Einlesen“ antippen …

![Fenster „Rezept aus dem Internet“ mit eingefügter Adresse](docs/img/import-dialog.jpg)

… und der Editor ist ausgefüllt: Foto, Titel, Beschreibung, Zutaten mit Menge, Einheit und Hinweis, darunter die Schritte. Prüfen, speichern, fertig.

![Vom Import ausgefüllter Editor](docs/img/import-editor.jpg)

**Auf dem Handy** ordnet sich alles untereinander an:

<p>
  <img src="docs/img/handy-start.jpg" alt="Startseite auf dem Handy" width="300">
  &nbsp;
  <img src="docs/img/handy-rezept.jpg" alt="Rezept auf dem Handy" width="300">
</p>

*Die Screenshots zeigen Beispielrezepte, Bildnachweise [unten](#bildnachweise).*

## Installation

### Über HACS (benutzerdefiniertes Repository)

HACS → ⋮ → *Benutzerdefinierte Repositories* → `https://github.com/msucimaker3112/kochbuch-card`, Kategorie *Dashboard* → herunterladen → Browser neu laden.

> Solange das Repository privat ist, geht das nicht. Dann den manuellen Weg nehmen.

### Manuell

1. `kochbuch-card.js` nach `/config/www/kochbuch-card.js` kopieren (zum Beispiel mit der App *File editor* oder per Samba).
2. Einstellungen → Dashboards → ⋮ → *Ressourcen* → *Ressource hinzufügen*: URL `/local/kochbuch-card.js?v=0.5.2`, Typ *JavaScript-Modul*.
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

### Urheberrecht

Eingelesene Rezepte, vor allem **Fotos** und ausformulierte Texte, sind urheberrechtlich geschützt. Zutatenlisten und das Gericht selbst sind es in der Regel nicht. Die Funktion ist für **dein privates Kochbuch** gedacht, vergleichbar mit Ausdrucken oder Abspeichern der Seite. Veröffentliche eingelesene Rezepte nicht und gib sie nicht weiter. Die Karte speichert die Quelle mit und verlinkt im Rezept auf das Original. Das Import-Fenster zeigt denselben Hinweis.

Das ist keine Rechtsberatung.

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

## Bildnachweise

Die Gerichtsfotos in den Screenshots stammen von Wikimedia Commons und sind gemeinfrei (CC0 oder Public Domain):

| Gericht | Foto | Urheber |
|---|---|---|
| Kaiserschmarrn | [Kaiserschmarrn, Munich.jpg](https://commons.wikimedia.org/wiki/File:Kaiserschmarrn,_Munich.jpg) | Gerda Arendt, CC0 |
| Lasagne | [Halal Beef Lasagne and Cauliflowers – Foodilic 2024-08-12.jpg](https://commons.wikimedia.org/wiki/File:Halal_Beef_Lasagne_and_Cauliflowers_-_Foodilic_2024-08-12.jpg) | Andy Li, CC0 |
| Spaghetti Carbonara | [Spaghetti alla Carbonara.jpg](https://commons.wikimedia.org/wiki/File:Spaghetti_alla_Carbonara.jpg) | Mattes Boch, Public Domain |
| Shakshuka | [Shakshuka (Unsplash).jpg](https://commons.wikimedia.org/wiki/File:Shakshuka_(Unsplash).jpg) | Jarosław Ceborski, CC0 |
| Flammkuchen | [Elsässer Flammkuchen in Strasbourg 2.JPG](https://commons.wikimedia.org/wiki/File:Els%C3%A4sser_Flammkuchen_in_Strasbourg_2.JPG) | Brücke-Osteuropa, CC0 |
| Wiener Schnitzel | [Wiener Schnitzel mit Preiselbeeren 3.jpg](https://commons.wikimedia.org/wiki/File:Wiener_Schnitzel_mit_Preiselbeeren_3.jpg) | Brücke-Osteuropa, CC0 |

Die Adresse `beispiel-rezepte.de` in den Screenshots ist ein Platzhalter.

## Lizenz

MIT, siehe [LICENSE](LICENSE).
