// =============================================================
//  [NOU FASE 5] Sales de vídeo amb SimplePeer
//
//  1. WebSocket (/senyal): entrem amb un nom, ens unim a la sala de la
//     zona on és en George i intercanviem la senyalització.
//  2. SimplePeer: un peer per cada company de la sala (connexió en malla).
//     El NOUVINGUT inicia la connexió amb els que ja hi eren, així mai
//     no es creuen dues ofertes.
//  3. peer.on('stream'): la càmera del company arriba i la guardem perquè
//     App.vue la posi al <video> amb :srcObject.
// =============================================================

import { ref, shallowRef, reactive, computed, markRaw } from 'vue';
// Versió ja empaquetada per al navegador (la normal necessita polyfills de Node)
import SimplePeer from 'simple-peer/simplepeer.min.js';

// Servidor STUN públic: serveix per descobrir la IP pública darrere d'un router (NAT)
const CONFIG_RTC = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

const novaSessio = () => Date.now().toString(36) + Math.random().toString(36).slice(2);

export function useSalaVideo() {
  // ---------- Estat reactiu (el llegeix App.vue) ----------
  const estatServidor = ref('connectant'); // 'connectant' | 'connectat' | 'desconnectat'
  const jo = ref(null);                    // { id, nom } un cop dins
  const salaActual = ref(null);            // nom de la sala on som (o null al passadís)
  const avisSala = ref('');                // p. ex. «La sala és plena»
  const streamLocal = shallowRef(null);    // la nostra càmera (MediaStream)
  const errorCamera = ref('');             // per què no s'ha pogut obrir la càmera
  const membres = ref([]);                 // [{ id, nom }] companys de la sala (sense mi)
  const connexions = reactive(new Map());  // id -> { estat, stream }

  // Llista per a la interfície: cada company amb l'estat de la seva connexió
  const companys = computed(() => membres.value.map((m) => ({
    ...m,
    estat: connexions.get(m.id)?.estat ?? 'connectant',
    stream: connexions.get(m.id)?.stream ?? null
  })));

  // ---------- Estat intern ----------
  const peers = new Map(); // id -> { peer, sessio }
  let salaDemanada = null; // sala que hem demanat al servidor
  let esperaLogin = null;  // { resolve, reject } mentre esperem 'login-ok'

  // =============================================================
  //  1. WebSocket (servidor de senyalització)
  // =============================================================
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${protocol}//${location.host}/senyal`);

  ws.addEventListener('open', () => { estatServidor.value = 'connectat'; });
  ws.addEventListener('close', () => {
    estatServidor.value = 'desconnectat';
    esperaLogin?.reject(new Error('No hi ha connexió amb el servidor'));
    tancarTots();
    membres.value = [];
    salaActual.value = null;
    salaDemanada = null;
  });

  ws.addEventListener('message', (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }

    switch (msg.type) {
      case 'login-ok':
        jo.value = { id: msg.id, nom: msg.nom };
        esperaLogin?.resolve(jo.value);
        esperaLogin = null;
        break;
      case 'login-error':
        esperaLogin?.reject(new Error(msg.motiu));
        esperaLogin = null;
        break;
      case 'sala-unida':
        if (msg.sala !== salaDemanada) return; // ja n'hem sortit
        salaActual.value = msg.sala;
        // El nouvingut som nosaltres: iniciem la connexió amb cada company que ja hi era
        for (const company of msg.companys) crearPeer(company.id, true, novaSessio());
        break;
      case 'membres':
        if (msg.sala !== salaActual.value) return;
        actualitzarMembres(msg.membres);
        break;
      case 'sala-plena':
        avisSala.value = `La sala «${msg.sala}» és plena (màxim ${msg.maxim} persones).`;
        salaDemanada = null;
        break;
      case 'signal':
        rebreSenyal(msg.from, msg.data);
        break;
    }
  });

  function enviar(msg) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  // ---------- Accions públiques ----------
  function login(nom) {
    return new Promise((resolve, reject) => {
      if (ws.readyState !== WebSocket.OPEN) {
        reject(new Error('No hi ha connexió amb el servidor'));
        return;
      }
      esperaLogin = { resolve, reject };
      enviar({ type: 'login', nom });
    });
  }

  // Demana la càmera (i el micròfon si n'hi ha). Si no es pot, entrem igualment,
  // veurem els companys i errorCamera explica per què no s'ha pogut obrir.
  async function activarCamera() {
    errorCamera.value = '';
    if (!navigator.mediaDevices?.getUserMedia) {
      errorCamera.value = window.isSecureContext
        ? 'Aquest navegador no permet fer servir la càmera.'
        : `La càmera només funciona a localhost o amb HTTPS (ara la pàgina és ${location.origin}).`;
      return null;
    }

    const video = { width: { ideal: 320 }, height: { ideal: 240 } };
    let stream = null;
    let error = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video, audio: true });
    } catch (err) {
      error = err;
      // Potser el que falla és el micròfon: provem només amb vídeo
      try { stream = await navigator.mediaDevices.getUserMedia({ video, audio: false }); } catch (err2) { error = err2; }
    }
    if (!stream) {
      console.warn('No s\'ha pogut obrir la càmera:', error?.name, error?.message);
      errorCamera.value = explicarErrorCamera(error);
      return null;
    }

    streamLocal.value = markRaw(stream); // <-- CLAU: markRaw (veure peer.on('stream'))

    // Si la càmera s'atura (tapa, tecla de privacitat, s'endolla a una altra app…), ho expliquem
    stream.getVideoTracks()[0]?.addEventListener('ended', () => {
      if (streamLocal.value !== stream) return;
      streamLocal.value = null;
      errorCamera.value = 'La càmera s\'ha aturat (desconnectada o bloquejada).';
    });

    // Si ja érem en una sala, enviem la càmera als companys: SimplePeer renegocia sol
    // (les noves offer/answer passen pel mateix servidor de senyalització)
    for (const { peer } of peers.values()) {
      try { peer.addStream(stream); } catch (err) { console.warn('No s\'ha pogut afegir la càmera:', err.message); }
    }
    return stream;
  }

  // Missatge comprensible per a cada error de getUserMedia
  function explicarErrorCamera(err) {
    switch (err?.name) {
      case 'NotReadableError':
      case 'TrackStartError':
        return 'Alguna cosa bloqueja la càmera: la fa servir una altra aplicació o un altre navegador, o el portàtil la té desactivada (tapa física, tecla amb una càmera ratllada o mode privacitat). Allibera-la i torna-ho a provar.';
      case 'NotAllowedError':
      case 'PermissionDeniedError':
        return 'El permís de la càmera està denegat. Clica la icona de la càmera a la barra d\'adreces, tria «Permet» i torna-ho a provar.';
      case 'NotFoundError':
      case 'DevicesNotFoundError':
        return 'No s\'ha trobat cap càmera connectada.';
      case 'OverconstrainedError':
        return 'La càmera no admet la resolució demanada.';
      default:
        return `No s'ha pogut obrir la càmera (${err?.name || 'error desconegut'}).`;
    }
  }

  function entrarSala(nom) {
    if (!jo.value || salaDemanada === nom) return;
    sortirSala();
    avisSala.value = '';
    salaDemanada = nom;
    enviar({ type: 'entrar-sala', sala: nom });
  }

  function sortirSala() {
    if (!salaDemanada) return;
    enviar({ type: 'sortir-sala' });
    salaDemanada = null;
    salaActual.value = null;
    membres.value = [];
    tancarTots();
  }

  // =============================================================
  //  2. SimplePeer (un peer per company)
  // =============================================================
  function crearPeer(id, iniciador, sessio) {
    tancarPeer(id);

    const peer = new SimplePeer({
      initiator: iniciador,
      trickle: true,
      config: CONFIG_RTC,
      stream: streamLocal.value ?? undefined,
      // Si no tenim càmera, igualment volem REBRE la del company
      offerOptions: { offerToReceiveAudio: true, offerToReceiveVideo: true }
    });
    peers.set(id, { peer, sessio });
    connexions.set(id, { estat: 'connectant', stream: null });

    const esActual = () => peers.get(id)?.peer === peer;

    // SimplePeer genera l'offer/answer i els candidats ICE: els enviem pel servidor
    peer.on('signal', (senyal) => {
      if (esActual()) enviar({ type: 'signal', to: id, data: { sessio, senyal } });
    });

    peer.on('connect', () => {
      if (esActual()) connexions.set(id, { ...connexions.get(id), estat: 'connectat' });
    });

    // <-- CLAU: aquí arriba el remoteStream que substitueix el MP4 de la Fase 4.
    // markRaw(): si Vue l'embolcallés en un Proxy reactiu, video.srcObject = proxy
    // llançaria un TypeError (no és un MediaStream «de debò»).
    peer.on('stream', (stream) => {
      if (esActual()) connexions.set(id, { ...connexions.get(id), stream: markRaw(stream) });
    });

    peer.on('close', () => { if (esActual()) tancarPeer(id); });

    // Si no escoltem 'error', SimplePeer llança una excepció
    peer.on('error', (err) => {
      console.warn('Error en la connexió P2P:', err.code || err.message);
      if (esActual()) tancarPeer(id);
    });

    return peer;
  }

  function tancarPeer(id) {
    const actual = peers.get(id);
    peers.delete(id);
    connexions.delete(id);
    actual?.peer.destroy();
  }

  function tancarTots() {
    for (const id of [...peers.keys()]) tancarPeer(id);
  }

  // Arriba una senyal d'un company
  function rebreSenyal(desde, dades) {
    const { sessio, senyal } = dades ?? {};
    if (typeof sessio !== 'string' || typeof senyal !== 'object' || senyal === null) return;

    // Senyal de la connexió que ja tenim: la passem al peer
    const actual = peers.get(desde);
    if (actual && actual.sessio === sessio) {
      try { actual.peer.signal(senyal); } catch (err) { console.warn('Senyal descartada:', err.message); }
      return;
    }

    // Connexió nova: només ens serveix la seva offer (els candidats antics s'ignoren)
    if (senyal.type !== 'offer' || !salaActual.value) return;
    crearPeer(desde, false, sessio).signal(senyal);
  }

  // El servidor ens diu qui hi ha a la sala: tanquem els peers dels que han marxat
  function actualitzarMembres(llista) {
    membres.value = llista.filter((m) => m.id !== jo.value?.id);
    const presents = new Set(membres.value.map((m) => m.id));
    for (const id of [...peers.keys()]) if (!presents.has(id)) tancarPeer(id);
  }

  return {
    estatServidor, jo, salaActual, avisSala, streamLocal, errorCamera, companys,
    login, activarCamera, entrarSala, sortirSala
  };
}
