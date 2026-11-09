# Wayfolder

**Przeglądarka i organizer plików na Windows dla grafików i twórców gier.**

> **Wczesna wersja (beta) – v0.3.11.** Wayfolder działa i jest używany na co dzień, ale mogą trafić się niedoróbki. Każde przeniesienie, kopiowanie, zmianę nazwy i usunięcie da się cofnąć z dziennika, ale rób kopie ważnych prac.

**[Pobierz Wayfolder 0.3.11 dla Windows](https://github.com/Crimyan/wayfolder/releases/download/v0.3.11-beta/Wayfolder_0.3.11_x64-setup.exe)**

[English](README.md)

https://github.com/user-attachments/assets/cccda89b-8ab7-4523-b251-53f9fb57f2de

## Co potrafi

**Przeglądanie jak w Eksploratorze, ale pod pliki graficzne**

- Karty, pasek ścieżki, drzewo, siatka i lista, przeciąganie do i z Eksploratora i innych programów, schowek i menu kontekstowe Windows.
- Miniatury PSD/PSB, AI, EPS, INDD, AEP, Blendera, DDS, EXR/HDR, TGA, TIFF, WebP, wideo i PDF – oraz wszystko, co pokazuje Windows.
- Panel podglądu: obrazy, strony PDF/AI, modele 3D (FBX, OBJ, GLB/glTF, STL, PLY, DAE, 3MF, 3DS), wideo, dźwięk, fonty, tekst i kod, zawartość ZIP.
- Dziennik z cofaniem każdej operacji.

**Wyszukiwanie**

- Wyszukiwanie na wszystkich dyskach (Ctrl+Spacja) z filtrami typu, dysku i daty. Foldery programów i systemu są pomijane.
- Filtr bieżącego folderu ze wzorcami typu `BG*` i słowami w dowolnej kolejności.

**Porządkowanie**

- Własne statusy (np. *Final*, *Do poprawki*) i tagi. Idą za plikami, także przenoszonymi w Eksploratorze.
- **Projekty** – nakładka na zwykłe foldery: kolor, szablony struktury (Gra, Zlecenie dla klienta, Ilustracja albo własne), foldery wejściowe.
- **Kolejka sortowania** – nowe pliki z Pulpitu, Pobranych czy folderu renderów trafiają do kolejki projektu. *„Co to jest?”* pyta krok po kroku po prawdziwych folderach projektu, uczy się z Twoich decyzji i może zgadywać po treści obrazu (opcjonalny model CLIP, działa lokalnie).
- **Nowy folder z istniejącego** – kopia struktury folderu ze zmianą nazw plików w jednej tabeli.
- **Porządki** – duplikaty, kopie („- Kopia”, „(1)”), zapomniane foldery na pulpicie i stare pliki tymczasowe, z archiwum zachowującym oryginalne ścieżki.

**Drugi pulpit i widget**

- Nieskończona tablica z grupami skrótów, notatkami, panelami referencji ze swobodnym przybliżaniem (wklejanie obrazów ze schowka), licznikami kolejki i kaflem sortowania.
- Pływający widget (z zasobnika) z tą samą tablicą i wyszukiwaniem na górze.

**Dodatki**

- Wbudowane: Zmiana nazw wielu plików (domyślnie włączona), Konwerter obrazów (13 formatów, m.in. WebP, ICO, DDS), Porównanie obrazów, Akcje Photoshopa, Game Assets (atlasy, trim, kanały PBR, DDS do silników gier), Upscale (powiększanie obrazów AI ×2–×4 na karcie graficznej), Do wysłania (zmniejsza zdjęcia i filmy do limitu Discorda albo maila). Włączysz je w Ustawieniach › Dodatki.
- Własny dodatek zrobisz w kilku linijkach JavaScriptu: pozycje w menu pod prawym przyciskiem, własne okno, operacje na plikach z cofaniem. Zobacz **[poradnik dodatków](ADDONS.pl.md)** i [przykłady](addon-examples).

**Integracja z Windows (opcjonalna, w Ustawieniach)**

- Start z Windows, Win+E otwiera Wayfolder, foldery z pulpitu i innych programów otwierają się w Wayfolder. Wyłączenie – albo odinstalowanie – przywraca Eksplorator.
- Sam się aktualizuje: pyta GitHub o najnowszą wersję i instaluje ją jednym kliknięciem. Nic o Twoich plikach nie jest wysyłane.

## Instalacja

1. Pobierz **[Wayfolder_0.3.11_x64-setup.exe](https://github.com/Crimyan/wayfolder/releases/download/v0.3.11-beta/Wayfolder_0.3.11_x64-setup.exe)**. Możesz też kliknąć *Code → Download ZIP* na górze tej strony – instalator jest w środku ZIP-a. Wszystkie wersje: [Releases](../../releases).
2. Uruchom. Instaluje się tylko dla Twojego konta (bez uprawnień administratora) w `%LOCALAPPDATA%\Wayfolder` i dodaje skrót w menu Start. Instalator pyta o język (English albo Polski); zmienisz go później w Ustawieniach.
3. Windows SmartScreen może ostrzec o nieznanym wydawcy (beta nie jest podpisana) – wybierz *Więcej informacji → Uruchom mimo to*.

Wymagania: Windows 10 lub 11 (x64). WebView2 instaluje się sam, jeśli go brakuje.

Odinstalowanie: *Ustawienia → Aplikacje* w Windows. Można przy tym usunąć dane Wayfolder (projekty, tagi, tablicę, miniatury).

## Twoje dane zostają na komputerze

Wayfolder nigdzie nie wysyła plików ani ich nazw. Miniatury, indeks, tagi, projekty i tablica są w Twoim profilu (`%APPDATA%` / `%LOCALAPPDATA%\app.wayfolder.desktop`). Opcjonalne rozpoznawanie obrazów (CLIP) pobiera model raz i działa lokalnie.

## Stan

Beta. W planach: podgląd dokumentów Office, kolejne języki, podpis cyfrowy, automatyczne aktualizacje.

Znalazłeś błąd albo masz pomysł? Załóż [zgłoszenie](../../issues) – zrzut ekranu i opis, jak do tego doszło, bardzo pomagają.

## Licencja

Wayfolder jest darmowy do pobrania i używania w czasie bety. Kod źródłowy nie jest publiczny.
© 2026 Crimyan. Wszelkie prawa zastrzeżone.
