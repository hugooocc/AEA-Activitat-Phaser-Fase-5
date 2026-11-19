# poc-oficina-virtual · Fase 5

**Sales de vídeo reals amb SimplePeer** (Vue 3 + Phaser 4 + Vite + Node.js).

A la Fase 4, el monitor de cada sala reproduïa un MP4 públic. Ara cada zona del mapa és una **sala de vídeo**: quan dues o més persones hi són, es veuen i s'escolten per càmera. El vídeo viatja directament de navegador a navegador (WebRTC). El servidor Node.js només fa de **servidor de senyalització**.

> Els enllaços de l'enunciat de la Fase 5 apunten a les mateixes presentacions de la Fase 4. Aquesta fase s'ha construït a partir de les pistes del curs:
>
> - Fase 1: *«connexions SimplePeer (Fases 4 i 5)»*.
> - Fase 4.a: *«En entrar a una sala, SimplePeer negocia l'oferta/resposta SDP amb els companys de la mateixa sala […] només canviarem `:src` per `:srcObject`»*.
>
> El servidor segueix el mateix esquema que la pràctica *Chat WebRTC*: Express + `ws`, port 3030.

## Execució

**Desenvolupament** (dos terminals):

```bash
npm install
npm run servidor   # terminal 1 · senyalització a ws://localhost:3030/senyal
npm run dev        # terminal 2 · joc a http://localhost:5173 (Vite reenvia /senyal al 3030)
```

**Producció** (un sol procés):

```bash
npm run build      # genera dist/
npm run servidor   # serveix dist/ i la senyalització a http://localhost:3030
```

**Per provar-ho:**

1. Obre **dues pestanyes del mateix navegador** (Chrome) i entra amb **noms diferents**. A Windows, dos navegadors diferents normalment no poden fer servir la webcam alhora.
2. Camina amb **WASD** o amb les **fletxes** fins a la mateixa sala: Sala de Reunions o Zona Cafè.
3. Es veuen per càmera. Fes servir auriculars si les dues pestanyes són al mateix ordinador, perquè si no hi haurà eco.

La càmera només funciona a `localhost` o amb HTTPS. Des d'un altre ordinador (per IP i HTTP) es pot entrar, però sense càmera: només es veuen els companys.

### Si la càmera no s'obre

Si no es pot obrir la càmera, s'entra igualment: veus els companys, i el panell explica el motiu amb un botó **«Torna-ho a provar»**. Quan la càmera s'obre, s'envia als companys de la sala sense haver de tornar a entrar.

| Missatge | Què fer |
| --- | --- |
| *Alguna cosa bloqueja la càmera* | Una altra aplicació (Teams, Zoom, Càmera de Windows…) o **un altre navegador** la fa servir: tanca'ls. Als portàtils, mira també la **tapa física** de la webcam, la **tecla amb una càmera ratllada** o el **mode privacitat de la càmera** (a Lenovo, a Lenovo Vantage). Si l'app Càmera de Windows diu «Algo está bloqueando la cámara», el bloqueig és del portàtil. |
| *El permís de la càmera està denegat* | Clica la icona de la càmera a la barra d'adreces i tria «Permet». Les vistes prèvies integrades a l'editor (VS Code, Antigravity…) no deixen fer servir la càmera: obre `http://localhost:5173` a Chrome. |
| *Només funciona a localhost o amb HTTPS* | Obre la pàgina amb `localhost`, no per IP. |

## Arquitectura

```text
 OfficeScene.js ──canvi-zona──▶ PhaserCanvas.vue ──canviZona──▶ App.vue ──entrarSala(nom)──▶ useSalaVideo.js
  (zona Tiled)                    (pont)                       (UI)       sortirSala()         (WebSocket + SimplePeer)
                                                                                                    │  ▲
                                                                                    senyals (JSON)  ▼  │  membres de la sala
                                                                                              servidor/app.js
                                                                                      (Express + ws · sales per zona)

 Navegador A ◀════════════ vídeo + àudio P2P (WebRTC, SimplePeer) ════════════▶ Navegador B
```

1. **Phaser** detecta en quina zona és en George i emet `canvi-zona` amb `{ nom, titolMonitor }`, o `null` al passadís. És el mateix que a la Fase 4.
2. **`App.vue`** ho converteix en `entrarSala(zona.nom)` o `sortirSala()`.
3. El **servidor** apunta l'usuari a la sala i li respon amb els companys que **ja hi eren**.
4. El **nouvingut** crea un `SimplePeer({ initiator: true, stream })` per a cada company. Els altres responen quan reben l'offer. Com que només inicia qui arriba, no es creuen mai dues ofertes.
5. `peer.on('stream', remoteStream)` → `<video :srcObject="remoteStream">`. És el canvi que anunciava la Fase 4.

### Missatges del servidor de senyalització (`/senyal`)

| Missatge | Sentit | Contingut |
| --- | --- | --- |
| `login` / `login-ok` / `login-error` | client ⇄ servidor | nom (únic, màxim 20 caràcters) / `{ id, nom }` / `motiu` |
| `entrar-sala` | client → servidor | `sala`: el nom de la zona de Tiled |
| `sala-unida` | servidor → nouvingut | `companys`: els que ja hi eren (el nouvingut els truca) |
| `membres` | servidor → tota la sala | llista actualitzada cada cop que algú entra o surt |
| `sortir-sala` | client → servidor | en sortir al passadís |
| `sala-plena` | servidor → client | la sala ja té 6 persones |
| `signal` | client → servidor → client | `{ sessio, senyal }` de SimplePeer (offer, answer, candidats ICE) |

El servidor **només reenvia senyals entre persones de la mateixa sala**.

## Fitxers

| Fitxer | Canvis |
| --- | --- |
| `servidor/app.js` | **Nou.** Senyalització amb sales, validació de noms i servei de `dist/` en producció. |
| `src/xarxa/useSalaVideo.js` | **Nou.** Composable: WebSocket, càmera (`getUserMedia`), un peer per company i estat reactiu (`companys`, `salaActual`…). |
| `src/App.vue` | Pantalla d'entrada (nom i càmera), la càmera pròpia, un monitor per company i el modal amb la càmera del company triat. |
| `src/components/PhaserCanvas.vue` | Prop `nomJugador`, que es desa al `game.registry` abans que s'executi `create()`. |
| `src/game/OfficeScene.js` | L'etiqueta mostra el nom de l'usuari. Les zones ja no porten `streamUrl`. |
| `public/assets/maps/oficina.{tmx,json}` | Sense `streamUrl`: el nom de la zona (`nomSala`) és el nom de la sala de vídeo. |
| `vite.config.js` | Proxy de `/senyal` cap al servidor 3030 en desenvolupament. |

## Detalls importants

- **`markRaw(stream)`**: si Vue embolcalla el `MediaStream` en un Proxy reactiu, `video.srcObject = proxy` llança un `TypeError`. Per això els streams es guarden amb `markRaw()` i `shallowRef()`.
- **`simple-peer/simplepeer.min.js`**: és la versió ja empaquetada per al navegador. La versió normal demana polyfills de Node (`Buffer`, `process`…) que Vite no inclou.
- **Sessions**: cada connexió porta un identificador. Les senyals d'una connexió antiga (per exemple, de quan algú surt i torna a entrar) es descarten.
- **El gest d'entrada**: el clic a «Entra a l'oficina» demana la càmera i desbloqueja l'autoplay amb so dels companys.
- **El modal** (Fase 4) mostra en gran la càmera del company clicat. Va silenciat perquè l'àudio continua sortint del monitor petit (sense eco ni tall). Si aquell company surt de la sala, el modal es tanca sol i el teclat es desbloqueja.
- **Sense càmera**: s'entra igualment. Gràcies a `offerToReceiveVideo/Audio`, es poden rebre les càmeres dels companys.

## Proves fetes (navegador real amb càmera simulada, 3 usuaris)

- [x] Un nom repetit es rebutja. L'etiqueta d'en George mostra el nom amb què s'ha entrat.
- [x] Sola a la sala → missatge d'espera.
- [x] 2 persones a la sala → cadascuna rep el `MediaStream` de l'altra (vídeo i àudio en directe, amb so).
- [x] 3 persones → connexió en malla (cadascuna veu les altres dues).
- [x] Clic a un company → modal amb la seva càmera i teclat bloquejat. Si el company surt, el modal es tanca i el teclat torna.
- [x] Qui surt al passadís perd els monitors. Cada zona és una sala independent.
- [x] En tancar una pestanya, aquella persona desapareix dels monitors dels altres.
- [x] Canvi de sala i reconnexió amb sessions noves.
- [x] Versió de producció servida per Express: dos usuaris caminen fins a la sala i es veuen.
- [x] Cap error a la consola.

## Límits coneguts

- **Malla**: cada persona envia la càmera a totes les altres. Per això el màxim és de 6 per sala.
- **Només STUN**: entre xarxes amb NAT estrictes caldria un servidor TURN.
- **No es veuen els altres avatars al mapa**: les posicions encara no se sincronitzen. Seria el pas següent (backend del joc).

## Lliurament

Comprimir la carpeta en un `.zip` **sense `node_modules`** (ni `dist`), o lliurar l'enllaç al repositori Git.
