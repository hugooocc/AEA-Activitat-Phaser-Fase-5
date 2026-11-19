<script setup>
import { ref, computed, watch } from 'vue';
import PhaserCanvas from './components/PhaserCanvas.vue';
import { useSalaVideo } from './xarxa/useSalaVideo.js'; // [NOU FASE 5]

// ---------- [NOU FASE 5] Xarxa: senyalització + SimplePeer ----------
const xarxa = useSalaVideo();
const { estatServidor, jo, salaActual, avisSala, streamLocal, errorCamera, companys } = xarxa;

// Si la càmera no s'ha pogut obrir (p. ex. bloquejada), es pot tornar a provar sense recarregar
const provantCamera = ref(false);
async function tornarAProvarCamera() {
  provantCamera.value = true;
  try { await xarxa.activarCamera(); } finally { provantCamera.value = false; }
}

// Pantalla d'entrada
const nomEntrada = ref('');
const errorEntrada = ref('');
const entrant = ref(false);

async function entrar() {
  const nom = nomEntrada.value.trim();
  errorEntrada.value = '';
  if (!nom) { errorEntrada.value = 'Escriu el teu nom.'; return; }

  entrant.value = true;
  try {
    // El clic del botó és un gest de l'usuari: permet demanar la càmera
    // i que després els vídeos dels companys es reprodueixin amb so.
    if (!streamLocal.value) await xarxa.activarCamera();
    await xarxa.login(nom);
  } catch (err) {
    errorEntrada.value = err.message;
  } finally {
    entrant.value = false;
  }
}

// ---------- Fase 4: zona + modal ----------
const zonaActiva = ref(null); // { nom, titolMonitor } o null
const refCanvas = ref(null);
const modalObert = ref(false);
const idAmpliat = ref(null);  // [FASE 5] quin company es veu en gran
const companyAmpliat = computed(() => companys.value.find((c) => c.id === idAmpliat.value) ?? null);

// [NOU FASE 5] <-- CLAU: la zona de Phaser decideix la sala de vídeo
watch(zonaActiva, (zona) => {
  if (zona) xarxa.entrarSala(zona.nom);
  else xarxa.sortirSala();
});

function obrirModalGran(id) {
  idAmpliat.value = id;
  modalObert.value = true;
  refCanvas.value?.bloquejarControls(true); // Atura el teclat de Phaser
}
function tancarModalGran() {
  modalObert.value = false;
  idAmpliat.value = null;
  refCanvas.value?.bloquejarControls(false); // Reactiva el teclat de Phaser
}

// [FASE 5] Si el company que estàvem mirant en gran marxa, tanquem el modal
watch(companyAmpliat, (company) => {
  if (modalObert.value && !company) tancarModalGran();
});

const TEXT_ESTAT = { connectant: 'Connectant…', connectat: 'En directe' };
</script>

<template>
  <!-- ============ [NOU FASE 5] Pantalla d'entrada ============ -->
  <main v-if="!jo" class="entrada">
    <form class="targeta-entrada" @submit.prevent="entrar">
      <h1>Oficina Virtual</h1>
      <p class="subtitol">Entra amb el teu nom. Quan dues persones siguin a la mateixa sala, es veuran per càmera.</p>
      <label for="nom">Nom</label>
      <input id="nom" v-model="nomEntrada" maxlength="20" autocomplete="off" placeholder="Per exemple, George" autofocus />
      <button type="submit" :disabled="estatServidor !== 'connectat' || entrant">
        {{ entrant ? 'Entrant…' : 'Entra a l\'oficina' }}
      </button>
      <p v-if="errorEntrada" class="error">{{ errorEntrada }}</p>
      <p v-if="estatServidor === 'connectant'" class="ajuda">Connectant amb el servidor de senyalització…</p>
      <p v-else-if="estatServidor === 'desconnectat'" class="error">
        No es pot connectar amb el servidor. Has arrencat <code>npm run servidor</code>?
      </p>
    </form>
  </main>

  <!-- ============ Oficina (Fases 4 i 5) ============ -->
  <main v-else class="layout-oficina">
    <PhaserCanvas ref="refCanvas" :nom-jugador="jo.nom" @canvi-zona="zonaActiva = $event" />

    <aside class="panell-lateral">
      <h2>Oficina Virtual</h2>
      <div class="capcalera-usuari">
        <!-- La meva càmera (silenciada per no sentir-me a mi mateix) -->
        <div class="camera-propia">
          <video v-if="streamLocal" :srcObject="streamLocal" :muted="true" autoplay playsinline class="mirall"></video>
          <span v-else class="sense-camera">Sense càmera</span>
        </div>
        <div>
          <p class="usuari"><span class="punt" :class="estatServidor"></span>{{ jo.nom }}</p>
          <p v-if="estatServidor === 'desconnectat'" class="error">Sense connexió amb el servidor</p>
          <p v-else-if="!streamLocal" class="ajuda-mini">Només veuràs els companys</p>
          <p v-else class="ajuda-mini">La teva càmera</p>
        </div>
      </div>

      <!-- Per què no tenim càmera, i botó per tornar-ho a provar (el clic és un gest d'usuari) -->
      <div v-if="!streamLocal && errorCamera" class="avis-camera">
        <p>{{ errorCamera }}</p>
        <button type="button" :disabled="provantCamera" @click="tornarAProvarCamera">
          {{ provantCamera ? 'Provant…' : 'Torna-ho a provar' }}
        </button>
      </div>

      <p v-if="!zonaActiva" class="estat-passadis">Estàs al passadís</p>

      <template v-else>
        <h3 class="titol-sala">📡 {{ zonaActiva.titolMonitor }}</h3>
        <p v-if="avisSala" class="error">{{ avisSala }}</p>
        <p v-else-if="salaActual && companys.length === 0" class="ajuda">
          Ets l'única persona de la sala. Obre una altra pestanya, entra amb un altre nom i camina fins aquí.
        </p>

        <!-- [NOU FASE 5] Un monitor per company: el MP4 de la Fase 4 passa a ser el remoteStream.
             Amb un sol company ocupa tota l'amplada; amb més, graella de 2 columnes. -->
        <div class="graella" :class="{ un: companys.length === 1 }">
          <div v-for="company in companys" :key="company.id" class="monitor-mini" :title="`Ampliar ${company.nom}`" @click="obrirModalGran(company.id)">
            <div class="monitor-capcalera">
              <span class="nom-company">{{ company.nom }}</span>
              <span v-if="!company.stream" class="estat connectant">{{ TEXT_ESTAT[company.estat] }}</span>
              <span v-else class="accio">{{ companys.length === 1 ? 'Ampliar' : '⤢' }}</span>
            </div>
            <!-- <-- CLAU: :src="streamUrl" (Fase 4) → :srcObject="remoteStream" (Fase 5) -->
            <video v-if="company.stream" :srcObject="company.stream" autoplay playsinline></video>
            <div v-else class="video-espera">Esperant la càmera…</div>
          </div>
        </div>
      </template>
    </aside>

    <!-- Finestra modal gran -->
    <div v-if="modalObert && companyAmpliat" class="modal-overlay" @click.self="tancarModalGran">
      <div class="modal-caixa">
        <div class="modal-capcalera">
          <h3>{{ companyAmpliat.nom }} · {{ zonaActiva?.titolMonitor }}</h3>
          <button class="boto-tancar" @click="tancarModalGran">Tancar [X]</button>
        </div>
        <!-- Silenciat: l'àudio continua sortint del monitor petit (no hi ha eco ni tall) -->
        <video :srcObject="companyAmpliat.stream" :muted="true" autoplay playsinline class="video-gran"></video>
      </div>
    </div>
  </main>
</template>

<style scoped>
/* ---------- [NOU FASE 5] Pantalla d'entrada ---------- */
.entrada { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; background: #0f172a; color: #f8fafc; font-family: sans-serif; box-sizing: border-box; }
.targeta-entrada { width: 100%; max-width: 380px; display: flex; flex-direction: column; gap: 10px; background: #1e293b; padding: 28px; border-radius: 14px; border: 1px solid #334155; }
.targeta-entrada h1 { margin: 0; font-size: 26px; }
.subtitol { margin: 0 0 8px; color: #94a3b8; font-size: 14px; line-height: 1.4; }
.targeta-entrada label { font-size: 13px; color: #94a3b8; }
.targeta-entrada input { padding: 10px 12px; border-radius: 8px; border: 1px solid #334155; background: #0f172a; color: #f8fafc; font-size: 16px; }
.targeta-entrada button { padding: 10px; border: none; border-radius: 8px; background: #10b981; color: #0f172a; font-weight: bold; font-size: 15px; cursor: pointer; }
.targeta-entrada button:disabled { opacity: 0.5; cursor: not-allowed; }
.error { color: #f87171; font-size: 13px; margin: 0; }
.ajuda { color: #94a3b8; font-size: 13px; margin: 8px 0 0; line-height: 1.4; }
code { background: #0f172a; padding: 1px 5px; border-radius: 4px; }

/* ---------- Oficina (Fase 4) ---------- */
.layout-oficina { display: flex; gap: 20px; padding: 20px; background: #0f172a; min-height: 100vh; color: #f8fafc; font-family: sans-serif; box-sizing: border-box; }
.panell-lateral { width: 320px; flex-shrink: 0; background: #1e293b; padding: 16px; border-radius: 12px; border: 1px solid #334155; }
.panell-lateral h2 { margin: 0 0 6px; }
.monitor-mini { margin-top: 12px; background: #0f172a; border: 2px solid #10b981; border-radius: 10px; overflow: hidden; cursor: pointer; transition: transform 0.15s; }
.monitor-mini:hover { transform: scale(1.02); border-color: #34d399; }
.monitor-capcalera { display: flex; justify-content: space-between; padding: 8px 12px; background: #064e3b; font-size: 13px; font-weight: bold; }
.monitor-mini video { width: 100%; display: block; background: black; aspect-ratio: 4 / 3; object-fit: cover; }

/* [NOU FASE 5] */
.capcalera-usuari { display: flex; align-items: center; gap: 12px; }
.usuari { display: flex; align-items: center; gap: 6px; margin: 0; font-size: 15px; font-weight: bold; }
.ajuda-mini { margin: 2px 0 0; font-size: 12px; color: #94a3b8; }
.punt { width: 9px; height: 9px; border-radius: 50%; background: #64748b; }
.punt.connectat { background: #10b981; }
.punt.desconnectat { background: #ef4444; }
.camera-propia { width: 112px; flex-shrink: 0; aspect-ratio: 4 / 3; border-radius: 8px; overflow: hidden; border: 1px solid #334155; background: #0f172a; display: flex; align-items: center; justify-content: center; }
.camera-propia video { width: 100%; height: 100%; display: block; object-fit: cover; }
.mirall { transform: scaleX(-1); } /* la pròpia imatge, com en un mirall */
.sense-camera { font-size: 11px; color: #94a3b8; text-align: center; padding: 4px; }
.avis-camera { margin-top: 10px; padding: 10px 12px; border-radius: 8px; background: rgba(251, 191, 36, 0.1); border: 1px solid rgba(251, 191, 36, 0.45); }
.avis-camera p { margin: 0 0 8px; font-size: 12.5px; line-height: 1.4; color: #fde68a; }
.avis-camera button { padding: 5px 12px; border: none; border-radius: 6px; background: #fbbf24; color: #0f172a; font-weight: bold; font-size: 12.5px; cursor: pointer; }
.avis-camera button:disabled { opacity: 0.6; cursor: wait; }
.estat-passadis { color: #94a3b8; }
.titol-sala { margin: 16px 0 0; font-size: 15px; }
.graella { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.graella.un { grid-template-columns: 1fr; }
.graella .monitor-mini { margin-top: 12px; }
.graella:not(.un) .monitor-mini { margin-top: 2px; }
.graella:not(.un) { margin-top: 12px; }
.graella:not(.un) .monitor-capcalera { padding: 6px 8px; font-size: 12px; }
.nom-company { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.accio { flex-shrink: 0; margin-left: 6px; }
.estat.connectant { color: #fbbf24; flex-shrink: 0; margin-left: 6px; }
.video-espera { aspect-ratio: 4 / 3; display: flex; align-items: center; justify-content: center; color: #94a3b8; font-size: 13px; }

/* Finestra modal gran (Fase 4) */
.modal-overlay { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.85); display: flex; align-items: center; justify-content: center; z-index: 50; }
.modal-caixa { background: #1e293b; border: 2px solid #38bdf8; border-radius: 14px; width: 90%; max-width: 820px; overflow: hidden; box-shadow: 0 25px 50px rgba(0,0,0,0.6); }
.modal-capcalera { display: flex; justify-content: space-between; align-items: center; padding: 14px 20px; background: #0f172a; border-bottom: 1px solid #334155; }
.boto-tancar { background: #ef4444; color: white; border: none; padding: 6px 14px; border-radius: 6px; font-weight: bold; cursor: pointer; }
.video-gran { width: 100%; max-height: 70vh; display: block; background: black; }
</style>
