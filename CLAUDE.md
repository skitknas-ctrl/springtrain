# Spring Train – Android-spel

Spring Train ("gummitåg") är ett spel för Android i liggande läge. Man kör ett lok med vagnar runt en sluten bana ett antal
varv (5 som standard) så fort som möjligt utan att spåra ur. Lok och vagnar är förbundna med fjädrar som både kan sträckas
och tryckas ihop kring ett viloläge (en tänkt teleskopstång håller fjädern rak och ger hårda stopp). Bara loket har broms,
så de tunga vagnarna skjuter på när man bromsar. Mynt från klarade banor används i shopen: starkare motor, bättre bromsar,
styvare fjädrar (de är mjuka från början) eller ett annat tåg. Banan får korsa sig själv (åtta): i samma plan, eller med bro
eller tunnel.

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
  `best` (bästa tid per ban-id), `stars`, `sound`. Uppgraderingar per tåg: `engine`, `brake`, `spring` (nivå 0–`maxLevel`). Ban- och tåg-id får därför inte bytas på sådant som redan finns.

## Fysiken (sim.js)

- Tåget rör sig i en dimension längs banan: varje fordon har läge `s` och fart `v`. Loket är 9 m, vagnarna 6 m.
- Koppling j: utsträckning `x = s[j] − s[j+1] − viloavstånd`. Kraft `springK·x + springDamp·Δv`. Vid `|x| > springTravel`
  tar teleskopet stopp (oelastisk stöt med `stopBounce`).
- Loket: dragkraft = gas × min(`force`, `power`/fart). Broms bara på loket. Alla fordon: rullmotstånd, luftmotstånd och
  tyngdkraft längs lutningen.
- Urspårning per fordon: `v²·|krökning| / derailG` är kurvbelastningen (mätaren CURVE LOAD); över 1 längre än
  `derailGrace` sekunder spårar fordonet ur. En vagn kan alltså spåra ur fast loket klarade kurvan.
- Fjäderns styvhet = `physics.springK` × (1 + `economy.springStep` × köpt fjädernivå). `springK` är alltså det mjukaste läget.
- Korsningar: `buildTrack` hittar ställen där spåret korsar sig självt (`track.crossings`). Höjdskillnad under 0,6 m =
  korsning i samma plan; minst `CLEAR` (4,5 m) = olika plan (`sep`), som ritas som bro eller, med `crossing: 'tunnel'` på banan,
  som tunnel. Däremellan ser det fel ut (adminsidans editor varnar). Tåget kan inte krocka med sig självt.
- `autopilot(train, margin)` är en enkel förare (demon bakom menyn, kalibrering, adminsidans "Räkna partider").

## Ritningen (game.js)

- Sned vy uppifrån utan kameravridning: `px(x)`, `py(y, z)`. Allt har mörk konturlinje (`INK`) för ett tecknat utseende.
- Marken är en förritad gräsplatta (`makeGrass`) som läggs ut i rutor. Landskapet (dammar, hus, lador, väderkvarnar, får, kor,
  träd, buskar, stenar, höbalar) slumpas fram per bana i `levelData` med fast frö och läggs i rutor om `CELL` meter, så att bara
  det synliga gås igenom. Inget placeras på spåret (`clearOfTrack`). Det finns ännu inget sätt att placera föremål för hand.
- Ritordning i `render`: mark och dammar → allt spår utom spannen → föremål och fordon sorterade bortifrån och framåt →
  spannen över korsningar (bro eller tunnelkulle med stenmynningar; fordon i en mynning mot kameran ritas om inuti ett urklipp)
  → fordon som står uppe på ett spann → rök → molnskuggor → karta.
- Fordonen byggs av lådor (`box`) med detaljer på sidan mot kameran (`sideRect`), hjul med snurrande ekrar och fem sorters
  vagnslast (`WAGON_KINDS`).

## Prova lokalt

```
python -m http.server 8766 --directory P:\Appar\SpringTrain\web
```

Öppna http://localhost:8766/ i liggande mobilformat (t.ex. 860×400). Tangentbord: pil upp/W = gas, pil ned/S/mellanslag = broms.
Provlägen: `?level=N` startar bana N (0 = första) direkt, `&auto=1` låter föraren köra, `&margin=0.8` förarens marginal,
`&warp=20` spolar fram 20 sekunder, `?screen=shop|levels|info` öppnar en meny. `?local=1` hoppar över hämtningen från servern
(bara inbyggda värden), `&pos=120&hold=1` ställer tåget 120 m in på banan och håller det stilla, `&find=house` (mill, pond,
sheep, cow, tree) ställer kameran vid första föremålet av den sorten. Ta en skärmbild i taget: flera samtidiga Edge hänger sig. Skärmbild utan fönster: headless Edge
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
  "Räkna partider", historik över sparade versioner och rå JSON. Baneditorn (helskärm, `edOppna`) öppnas från varje bana: dra
  punkter, klicka på spåret för ny punkt, höjdprofil där höjder dras, ångra, mallar (oval, åtta, stor slinga), korsningar
  markeras. "Lägg till inbyggda banor som saknas" hämtar nya banor ur `defaults.js` till den sparade listan.
- Det som sparats på servern ersätter hela listorna `trains` och `levels`. Nya banor i `defaults.js` syns därför inte i appen
  förrän de lagts till i admin och sparats.
- `api/config.php`: öppet GET med CORS `*` ger `{config, updated}`; sparning (POST, admin + csrf) skriver till
  `springtrain_config` (en rad) och `springtrain_config_logg` (30 senaste) i `gr8eam_db`.
- `defaults.js` och `sim.js` på servern är KOPIOR av `web/js/` i det här repot. Kopiera dem före varje deploy:

```
Copy-Item P:\Appar\SpringTrain\web\js\defaults.js, P:\Appar\SpringTrain\web\js\sim.js C:\Users\dick\kod\gr8eam.com\springtrain\
cd C:\Users\dick\kod\gr8eam.com
tar czf - springtrain | ssh -i ~/.ssh/id_ed25519_isba root@78.109.17.72 'cd /opt/docker-apps/gr8eam/html && tar xzf - --no-same-owner && chown -R 1004:1004 springtrain'
```

## 20 banor (2026-11-18, Dick)
- Banorna gjordes om till 20 med stigande svårighet och längd (ersätter de tidigare 6/9; Dicks varv-ändringar på servern
  slopades). Bana 1 `lvl01` = en 400 m löparbana (oval, vänstra kurvan r28 skarpare än högra r33), platt, 3 varv, tutorial.
  Sedan fler kurvor åt båda håll, backar (krön lagt strax FÖRE de snäva svängarna → utför ner i svängen, vagnarna skjuter
  på), och tre figur-åttor med bro/tunnel (`lvl06` tunnel, `lvl11` bro, `lvl16` tunnel). Vagnar 2→6. Aldrig mer än 3 varv.
  Guldtider ~77–222 s (mål ~4 min speltid för en människa). Alla går att köra klart med starttåget (bygget: `calibrate --check`).
- Formerna genereras + provkörs (tid/varv/svårighet) av scratchpad-skriptet `st_gen.js` (oval/flower/fig8 + autopilot-sökning),
  `st_emit.py` skriver `levels`-blocket i `web/js/defaults.js` OCH `kod\gr8eam.com\springtrain\defaults.js` (identiska) och
  hela serverns config (`st_config.json`). `view.meters` = 150 (Dicks serverinställning) i båda.
- Serverns config (gr8eam_db `springtrain_config` id 1) uppdaterad till dessa 20 banor via `st_update.php` i gr8eam-app
  (behåller updated_by). Gammal config säkerhetskopierad på servern: `/tmp/st_config_backup_20261118.json` (6 banor).
  defaults.js deployad till gr8eam-containern (admins "Återställ"). Appen hämtar serverns config vid start → visar de 20.

## 20 banor med var sin form (2026-11-18 kväll, Dick: "alla ska vara unika uppifrån sett")
- Ersätter avsnittet ovan: de förra banorna (oval + "flower"-varianter + åttor) såg för lika ut uppifrån. Nu har varje bana en egen
  silhuett: oval, njure, triangel, L, jordnöt, åtta (tunnel), hästsko, T, klöver, hjärta, stående åtta (bro), krona, kors,
  sjöstjärna, fluga, slinga-i-slinga (tunnel), treudd (E), oregelbunden slinga, Z och en lång oregelbunden slutbana. Varannan
  bana är spegelvänd så att körriktningen växlar. Id `lvl01`–`lvl20` är oförändrade; namnen är nya.
- Skripten ligger i `tools/banor/` (kopior av arbetsfilerna; sökvägarna i dem pekar på en scratchpad-mapp och måste ändras
  före körning): `gen.js` (formerna som hörnpolygoner med rundade hörn eller kurvor → jämnt fördelade styrpunkter → skalning →
  backar), `join.js`, `sheet.py` (översiktsbild), `emit.py` (skriver `levels` i båda `defaults.js` + serverns config).
  `node gen.js --shapes` ritar bara formerna, `node gen.js 6 12` skalar bana 6–12, `node gen.js probe 9 1.2,2` provkör en skala.
- Lärdomar: (1) styrpunkterna måste ligga JÄMNT längs banan – ojämnt fördelade punkter ger små knyckar i Catmull-Rom som
  spårar ur tåget på till synes raka bitar. (2) Större skala hjälper inte alltid mot urspårning; tiden har ett minimum per form.
  Därför väljs först minsta skala (snävaste kurvan ≥ 19 m på bana 2, ned till 13 m på bana 20), sedan flest varv (högst 3 resp. 2)
  som ryms i måltiden, sedan skalas banan upp till måltiden. Treudden blev 1 varv (2,3 km). (3) Styrpunkternas läge längs spåret
  måste sökas framåt i tur och ordning, annars får punkter nära en korsning det andra spårets höjd.
- Backar: krön 0,7 halvbredder före de skarpaste kurvorna, fler/högre/brantare för varje bana (0 på bana 1–2, upp till 4 krön,
  7 m och 9 % lutning). Vagnar 2→6. Guldtider 78–222 s. `calibrate --check` går igenom.
- Servern uppdaterad på samma sätt som förra gången (`st_update.php`); föregående config: `/tmp/st_config_backup_20261118_kvall.json`.
