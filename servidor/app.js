// =============================================================
//  Oficina virtual · Fase 5 · Servidor de senyalització
//
//  Aquest servidor NO transporta el vídeo ni l'àudio. Només:
//    1. Guarda el nom de cada usuari.
//    2. Sap a quina sala (zona del mapa de Tiled) és cada usuari.
//    3. Reenvia les senyals de SimplePeer (offer, answer i candidats ICE)
//       entre companys de la MATEIXA sala.
//  Les càmeres viatgen directament de navegador a navegador (P2P).
//
//  En producció també serveix la carpeta dist/ (npm run build).
// =============================================================

import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';

// 3030 com al xat WebRTC (el 3000 sol estar ocupat). Es pot canviar amb PORT.
const PORT = process.env.PORT || 3030;
const MAX_NOM = 20;
const MAX_NOM_SALA = 40;
const MAX_PER_SALA = 6; // connexió en malla: cada persona envia la càmera a totes les altres

const app = express();
const server = http.createServer(app);

// El WebSocket comparteix el port amb Express, a la ruta /senyal
const wss = new WebSocketServer({ server, path: '/senyal', maxPayload: 64 * 1024 });

// Versió de producció del joc (si existeix)
const carpetaDist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
app.use(express.static(carpetaDist));

// id -> { nom, ws, sala }
const usuaris = new Map();
// nom de la sala -> Set d'ids
const sales = new Map();

function enviar(ws, missatge) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(missatge));
}

function membresDe(sala) {
  return [...(sales.get(sala) ?? [])].map((id) => ({ id, nom: usuaris.get(id).nom }));
}

// Envia a tots els membres d'una sala la llista actualitzada
function avisarSala(sala) {
  const membres = membresDe(sala);
  for (const id of sales.get(sala) ?? []) {
    enviar(usuaris.get(id).ws, { type: 'membres', sala, membres });
  }
}

function sortirDeSala(id) {
  const usuari = usuaris.get(id);
  if (!usuari?.sala) return;

  const sala = usuari.sala;
  usuari.sala = null;
  sales.get(sala)?.delete(id);
  console.log(`  ${usuari.nom} surt de «${sala}»`);

  if (sales.get(sala)?.size === 0) sales.delete(sala);
  else avisarSala(sala);
}

function validarNom(nom) {
  if (typeof nom !== 'string') return 'El nom ha de ser un text';
  const net = nom.trim();
  if (net === '') return 'El nom no pot estar buit';
  if (net.length > MAX_NOM) return `El nom no pot tenir més de ${MAX_NOM} caràcters`;
  for (const usuari of usuaris.values()) {
    if (usuari.nom.toLowerCase() === net.toLowerCase()) return 'Aquest nom ja està en ús';
  }
  return null;
}

wss.on('connection', (ws) => {
  let id = null; // s'assigna quan l'usuari entra amb el seu nom

  ws.on('message', (dades) => {
    let msg;
    try {
      msg = JSON.parse(dades.toString());
    } catch {
      return; // ignorem el que no sigui JSON
    }
    if (typeof msg !== 'object' || msg === null) return;

    switch (msg.type) {
      // ① L'usuari diu el seu nom
      case 'login': {
        if (id) return;
        const error = validarNom(msg.nom);
        if (error) {
          enviar(ws, { type: 'login-error', motiu: error });
          return;
        }
        id = crypto.randomUUID();
        const nom = msg.nom.trim();
        usuaris.set(id, { nom, ws, sala: null });
        console.log(`Entra ${nom} (${usuaris.size} connectats)`);
        enviar(ws, { type: 'login-ok', id, nom });
        break;
      }

      // ② En George ha trepitjat una zona del mapa
      case 'entrar-sala': {
        if (!id) return;
        const sala = typeof msg.sala === 'string' ? msg.sala.trim().slice(0, MAX_NOM_SALA) : '';
        if (sala === '' || usuaris.get(id).sala === sala) return;

        sortirDeSala(id); // per si venia d'una altra sala
        const membres = sales.get(sala) ?? new Set();
        if (membres.size >= MAX_PER_SALA) {
          enviar(ws, { type: 'sala-plena', sala, maxim: MAX_PER_SALA });
          return;
        }

        // Companys que JA hi eren: el nouvingut iniciarà la connexió amb cadascun
        const companys = membresDe(sala);
        membres.add(id);
        sales.set(sala, membres);
        usuaris.get(id).sala = sala;
        console.log(`  ${usuaris.get(id).nom} entra a «${sala}» (${membres.size} a la sala)`);

        enviar(ws, { type: 'sala-unida', sala, companys });
        avisarSala(sala);
        break;
      }

      // ③ En George ha sortit al passadís
      case 'sortir-sala': {
        if (!id) return;
        sortirDeSala(id);
        break;
      }

      // ④ Senyalització de SimplePeer: només entre companys de la mateixa sala
      case 'signal': {
        if (!id) return;
        const origen = usuaris.get(id);
        const desti = usuaris.get(msg.to);
        if (!desti || !origen.sala || desti.sala !== origen.sala) return;

        const tipus = msg.data?.senyal?.type;
        if (tipus && tipus !== 'candidate') console.log(`  Senyal ${tipus}: ${origen.nom} -> ${desti.nom}`);
        enviar(desti.ws, { type: 'signal', from: id, data: msg.data });
        break;
      }
    }
  });

  // ⑤ En tancar la pestanya el traiem de la sala i de la llista
  ws.on('close', () => {
    if (!id) return;
    console.log(`Surt ${usuaris.get(id).nom}`);
    sortirDeSala(id);
    usuaris.delete(id);
  });
});

wss.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`El port ${PORT} ja està en ús. Arrenca'l en un altre, per exemple:`);
    console.error('  PowerShell:  $env:PORT=4000; npm run servidor');
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, () => {
  console.log(`Servidor de senyalització a ws://localhost:${PORT}/senyal`);
  console.log(`(Versió de producció del joc a http://localhost:${PORT} si has fet npm run build)`);
});
