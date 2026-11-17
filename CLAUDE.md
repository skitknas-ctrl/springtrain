# Spring Train – Android-spel

Spring Train ("gummitåg") är ett spel för Android i liggande läge. Man kör ett lok med vagnar runt en sluten bana ett antal
varv (5 som standard) så fort som möjligt utan att spåra ur. Lok och vagnar är förbundna med fjädrar som både kan sträckas
och tryckas ihop kring ett viloläge (en tänkt teleskopstång håller fjädern rak och ger hårda stopp). Bara loket har broms,
så de tunga vagnarna skjuter på när man bromsar. Mynt från klarade banor används i shopen: starkare motor, bättre bromsar
eller ett annat tåg.

- Ägare: Dick (GitHub `skitknas-ctrl`). Källa: https://github.com/skitknas-ctrl/springtrain, gren `main`, publikt repo.
- Arbetskopia: `P:\Appar\SpringTrain\`. Paketnamn `com.gr8eam.springtrain` (testbyggen `.debug`).
- Ingen offentlig webbsida. Admin för inställningar: https://gr8eam.com/springtrain/ (bara admin via gr8eam auth),
  lokal kod `C:\Users\dick\kod\gr8eam.com\springtrain\`.
- Gränssnittet i spelet är på engelska. Kommentarer i koden och adminsidan är på svenska.
- Svara Dick på svenska. Samma arbetssätt som Kalejdo (`P:\Appar\Kalejdo\CLAUDE.md`).

## Filer

```
web/index.html          sidan: HTML + CSS (menyer, reglage, shop, resultat)
web/js/defaults.js      inbyggda standardinställningar (fysik, ekonomi, tåg, banor) – samma struktur som admin sparar
web/js/sim.js           bana (sluten Catmull-Rom-kurva) och tågfysik; körs också i Node och på adminsidan
web/js/game.js          spelet: inställningar från servern, sparning, menyer, reglage, ritning, ljud
tools/calibrate.js      provkör banorna med den inbyggda föraren; ger banfakta och partider
app/                    Android-skalet (Kotlin, en WebView), se nedan
.github/workflows/build.yml   bygger test-APK vid varje push
```

Det finns ingen JDK eller Android SDK på Dicks dator. Appen byggs av GitHub Actions efter push.

## Så hänger det ihop

- `app/build.gradle.kts` (uppgiften `copyWeb`) kopierar hela `web/` till appens assets. `MainActivity.kt` visar
  `https://appassets.androidplatform.net/assets/index.html` i en WebView, liggande läge (`sensorLandscape`), systemfälten dolda,
  skärmen tänd. Bryggan `window.SpringTrainApp`: `quit()` och `appVersion()`. Bakåtknappen anropar `window.stBack()` i sidan
  (paus / tillbaka till menyn); svarar den false stängs appen.
- Vid start läser `game.js` senast hämtade inställningar ur localStorage (`springtrain.config.v1`), hämtar sedan
  `https://gr8eam.com/springtrain/api/config.php` (högst 2,5 s väntan bakom startbilden) och lägger svaret ovanpå
  `defaults.js` med `ST_SIM.merge` (objekt slås ihop nyckel för nyckel, listorna `trains` och `levels` ersätts helt).
  Ett sent svar sparas till nästa start.
- Spelarens data ligger i localStorage `springtrain.save.v1`: `money`, `train` (valt tåg), `owned` (`{tågid: {engine, brake}}`),
  `best` (bästa tid per ban-id), `stars`, `sound`. Ban- och tåg-id får därför inte bytas på sådant som redan finns.

## Fysiken (sim.js)

- Tåget rör sig i en dimension längs banan: varje fordon har läge `s` och fart `v`. Loket är 9 m, vagnarna 6 m.
- Koppling j: utsträckning `x = s[j] − s[j+1] − viloavstånd`. Kraft `springK·x + springDamp·Δv`. Vid `|x| > springTravel`
  tar teleskopet stopp (oelastisk stöt med `stopBounce`).
- Loket: dragkraft = gas × min(`force`, `power`/fart). Broms bara på loket. Alla fordon: rullmotstånd, luftmotstånd och
  tyngdkraft längs lutningen.
- Urspårning per fordon: `v²·|krökning| / derailG` är kurvbelastningen (mätaren CURVE LOAD); över 1 längre än
  `derailGrace` sekunder spårar fordonet ur. En vagn kan alltså spåra ur fast loket klarade kurvan.
- `autopilot(train, margin)` är en enkel förare (demon bakom menyn, kalibrering, adminsidans "Räkna partider").

## Prova lokalt

```
python -m http.server 8766 --directory P:\Appar\SpringTrain\web
```

Öppna http://localhost:8766/ i liggande mobilformat (t.ex. 860×400). Tangentbord: pil upp/W = gas, pil ned/S/mellanslag = broms.
Provlägen: `?level=N` startar bana N (0 = första) direkt, `&auto=1` låter föraren köra, `&margin=0.8` förarens marginal,
`&warp=20` spolar fram 20 sekunder, `?screen=shop|levels|info` öppnar en meny. Skärmbild utan fönster: headless Edge
(`msedge --headless=new --window-size=860,400 --screenshot=...`).

Efter ändrad fysik eller ändrade banor: `node tools/calibrate.js --par` och för in partiderna i `defaults.js`.
Bygget kör `node tools/calibrate.js --check` (varje bana ska gå att köra klart med starttåget).

## GitHub och byggen

- Commita direkt på `main`, meddelanden på svenska. Varje push bygger en test-APK (release `0.1.0-test.<n>`, de tre senaste sparas):
  https://github.com/skitknas-ctrl/springtrain/releases/latest/download/springtrain-debug.apk
- Kontrollera bygget: `gh run list -R skitknas-ctrl/springtrain -L 1`.
- Jobbet `play` (körs för hand eller vid tagg `v*`) bygger en signerad AAB för Google Play. Det kräver secrets
  `RELEASE_KEYSTORE_BASE64`, `RELEASE_KEYSTORE_PASSWORD`, `RELEASE_KEY_ALIAS`, `RELEASE_KEY_PASSWORD`. Ingen uppladdningsnyckel
  är skapad än. Nycklar och annat privat läggs i `privat/` (står i .gitignore), aldrig i repot.

## Adminsidan och API:et (gr8eam.com/springtrain)

- `index.php` (kräver `auth_require_admin()`): formulär för allmänt, fysik, ekonomi, tåg och banor, förhandsbild av varje bana,
  "Räkna partider", historik över sparade versioner och rå JSON.
- `api/config.php`: öppet GET med CORS `*` ger `{config, updated}`; sparning (POST, admin + csrf) skriver till
  `springtrain_config` (en rad) och `springtrain_config_logg` (30 senaste) i `gr8eam_db`.
- `defaults.js` och `sim.js` på servern är KOPIOR av `web/js/` i det här repot. Kopiera dem före varje deploy:

```
Copy-Item P:\Appar\SpringTrain\web\js\defaults.js, P:\Appar\SpringTrain\web\js\sim.js C:\Users\dick\kod\gr8eam.com\springtrain\
cd C:\Users\dick\kod\gr8eam.com
tar czf - springtrain | ssh -i ~/.ssh/id_ed25519_isba root@78.109.17.72 'cd /opt/docker-apps/gr8eam/html && tar xzf - --no-same-owner && chown -R 1004:1004 springtrain'
```
