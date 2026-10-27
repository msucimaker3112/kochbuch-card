# Änderungen

## 0.5.0 (2026-10-27)

- **Rezept aus dem Internet:** neuer Knopf „Aus dem Internet“ auf der Startseite. Adresse einfügen, die Karte liest die schema.org-Rezeptdaten der Seite (JSON-LD oder Mikrodaten) und öffnet den Editor vorausgefüllt: Titel, Beschreibung, Foto, Portionen, Zeiten, Kategorie, Stichwörter, Zutaten und Schritte. Timer und Temperaturen in den Schritten werden erkannt.
- Seitenabruf über `rest_command.kochbuch_abruf` in Home Assistant, ohne den Dienst über öffentliche Abrufdienste als Notlösung.
- Fotos der Quellseite werden in den Bilderspeicher übernommen, wenn die Seite das erlaubt, sonst direkt von dort angezeigt.
- Neues Feld **Quelle** im Editor, im Rezept als Link zur Originalseite.
- Zutaten wie „Zwiebel(n)“ oder „Ei(er)“ werden beim Einfügen als „Zwiebel“ und „Ei“ erkannt.

## 0.4.1

Ausgangsstand: Rezepte mit Fotos, Kategorien und Favoriten, Kochmodus mit Schritt-Timern und Wischgesten, freie Timer, Portionen umrechnen, Zutaten auf die Einkaufsliste, Vorlesen und Sprachsteuerung über Alexa.
