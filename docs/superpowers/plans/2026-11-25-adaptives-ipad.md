# Adaptives iPad-Layout
**Goal:** Vorhandene Panel- und Dashboard-Belegung automatisch auf die iPad-Flaeche einpassen.
**Spec:** Nutzerauftrag vom 25.11.2026; Referenzgeraet 1024 × 748 CSS-Pixel, quer.
**Constraints:** Keine neue Konfiguration, kein neues Profil, keine neuen Widget-Groessen. Bestehende Rasterzahl, Positionen und Themes erhalten. Panels 480 × 480 und 960 × 480 unveraendert. Keine Produktivbedienung oder Installation.

### Task 1: Automatische Flaechennutzung
- Files: `config/app/webfrontend/html/panel.html`, `design-system/README.md`.
- Interface: `adaptiveTablet()` erkennt iPad aus bestehendem Modell oder Browsermerkmalen; CSS erhaelt die vorhandene Rastergeometrie ohne globale Skalierung.
- Test: iPad mit altem Auto-/Festzoom fuellt 1024 × 748, auch mit bestehenden Split-Panes und Dashboard. Anzahl und gespeicherte Widget-Belegung bleiben gleich.

### Task 2: Geometrie ohne Datenverlust
- Files: `config/app/webfrontend/html/panel.html`.
- Interface: Resize behandelt Detailseiten ohne Raster-Renderer; Formulare und Streams bleiben bestehen.
- Test: Eingabe, Fokus, Detailansicht und Kameraknoten bleiben bei Groessenwechsel erhalten.

### Task 3: Regression
- Files: `qa/test_adaptive_ipad.mjs`.
- Test: Isolierte Browser-Fixtures fuer iPad, Desktop, 480er- und 960er-Panel; bestehende Simulator- und Kamera-Tests.
- Done when: gezielte Tests und relevante Quickchecks bestehen; verbleibende echte Safari-Pruefung benannt.
