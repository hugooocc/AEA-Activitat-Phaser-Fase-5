import Phaser from 'phaser';

export class OfficeScene extends Phaser.Scene {
  constructor() { super('OfficeScene'); }

  preload() {
    this.load.tilemapTiledJSON('mapa', '/assets/maps/oficina.json');
    this.load.image('tiles_oficina', '/assets/tilesets/pixel_office.png');
    this.load.spritesheet('george', '/assets/sprites/george.png', { frameWidth: 48, frameHeight: 48 });
  }

  create() {
    const map = this.make.tilemap({ key: 'mapa' });
    const tileset = map.addTilesetImage('pixel_office', 'tiles_oficina');
    map.createLayer('Terra', tileset, 0, 0);
    this.capaParets = map.createLayer('Parets', tileset, 0, 0);
    this.capaParets?.setCollisionByProperty({ collides: true });

    this.zones = [];
    map.getObjectLayer('Objectes')?.objects.forEach((obj) => {
      const props = this.obtenirPropietats(obj);
      const cx = obj.x + (obj.width || 0) / 2, cy = obj.y + (obj.height || 0) / 2;
      if (props.tipus === 'spawn') {
        this.jugador = this.physics.add.sprite(cx, cy, 'george', 0);
        this.jugador.body.setSize(16, 12); this.jugador.body.setOffset(16, 32);
        this.jugador.setCollideWorldBounds(true);
        if (this.capaParets) this.physics.add.collider(this.jugador, this.capaParets);
      }
      if (props.tipus === 'zona') {
        const rect = new Phaser.Geom.Rectangle(obj.x, obj.y, obj.width, obj.height);
        // [FASE 5] Ja no hi ha streamUrl: cada zona és una sala de vídeo i el
        // nom de la zona és el nom de la sala al servidor de senyalització.
        this.zones.push({
          nom: props.nomSala || 'Sala',
          titolMonitor: props.titolMonitor || props.nomSala,
          rect
        });
        this.add.rectangle(cx, cy, obj.width, obj.height, 0x10b981, 0.18).setStrokeStyle(1.5, 0x10b981);
        this.add.text(cx, obj.y + 12, props.nomSala || 'Sala', { fontSize: '11px', color: '#a7f3d0' }).setOrigin(0.5);
      }
    });

    this.zonaActual = null; this.direccio = 'avall';
    this.frameQuiets = { avall: 0, esquerra: 1, amunt: 2, dreta: 3 };
    // [FASE 5] El nom amb què l'usuari ha entrat (PhaserCanvas el desa al registry abans de create())
    this.etiqueta = this.add.text(this.jugador.x, this.jugador.y - 30, this.registry.get('nomJugador') || 'George',
      { fontSize: '13px', color: '#ffffff', backgroundColor: '#0f172a88' }).setOrigin(0.5);
    this.crearAnimacions();
    this.cursors = this.input.keyboard.createCursorKeys();
    this.teclesWASD = this.input.keyboard.addKeys('W,A,S,D');
  }

  obtenirPropietats(obj) {
    const res = {}; (obj.properties || []).forEach((p) => { res[p.name] = p.value; }); return res;
  }

  crearAnimacions() {
    [{ clau: 'caminar-avall', frames: [0, 4, 8, 12] }, { clau: 'caminar-esquerra', frames: [1, 5, 9, 13] },
     { clau: 'caminar-amunt', frames: [2, 6, 10, 14] }, { clau: 'caminar-dreta', frames: [3, 7, 11, 15] }]
      .forEach((d) => this.anims.create({ key: d.clau, frames: this.anims.generateFrameNumbers('george', { frames: d.frames }), frameRate: 8, repeat: -1 }));
  }

  update() {
    if (!this.jugador) return;
    let vx = 0, vy = 0;
    if (this.cursors.left.isDown || this.teclesWASD.A.isDown) vx = -1;
    if (this.cursors.right.isDown || this.teclesWASD.D.isDown) vx = 1;
    if (this.cursors.up.isDown || this.teclesWASD.W.isDown) vy = -1;
    if (this.cursors.down.isDown || this.teclesWASD.S.isDown) vy = 1;
    const vel = new Phaser.Math.Vector2(vx, vy).normalize().scale(160);
    this.jugador.setVelocity(vel.x, vel.y);
    if (vx !== 0 || vy !== 0) {
      this.direccio = Math.abs(vx) > Math.abs(vy) ? (vx < 0 ? 'esquerra' : 'dreta') : (vy < 0 ? 'amunt' : 'avall');
      this.jugador.anims.play(`caminar-${this.direccio}`, true);
    } else { this.jugador.anims.stop(); this.jugador.setFrame(this.frameQuiets[this.direccio]); }
    this.etiqueta.setPosition(this.jugador.x, this.jugador.y - 30);
    this.comprovarZones();
  }

  comprovarZones() {
    const trobada = this.zones.find((z) => Phaser.Geom.Rectangle.Contains(z.rect, this.jugador.x, this.jugador.y + 14)) || null;
    if (trobada?.nom !== this.zonaActual?.nom) {
      this.zonaActual = trobada;
      // <-- IMPORTANT: Envia { nom, titolMonitor } a Vue (o null en sortir al passadís).
      // [FASE 5] Vue farà servir el nom per unir-se a la sala de vídeo.
      this.game.events.emit('canvi-zona', trobada ? {
        nom: trobada.nom,
        titolMonitor: trobada.titolMonitor
      } : null);
    }
  }

  // [NOU] Mètode cridat des de Vue per aturar el teclat quan s'obre el modal
  bloquejarControls(bloquejat) {
    this.input.keyboard.enabled = !bloquejat; // <-- CLAU: Activa o desactiva WASD/fletxes
    if (bloquejat) {
      // [MILLORA] Amb el teclat desactivat, Phaser ja no rep el keyup: si una tecla estava premuda
      // en obrir el modal, isDown es queda a true i update() fa caminar en George tot sol.
      this.input.keyboard.resetKeys();
      // [MILLORA] Deixa d'interceptar W, A, S, D, fletxes i espai a tota la pàgina
      // (si no, en un xat dins del modal «wasd hola» s'escriu «hol»).
      this.input.keyboard.disableGlobalCapture();
    } else {
      this.input.keyboard.enableGlobalCapture(); // [MILLORA]
    }
    if (bloquejat && this.jugador) {
      this.jugador.setVelocity(0, 0); // <-- IMPORTANT: Frena en sec perquè no llisqui
      this.jugador.anims.stop(); this.jugador.setFrame(this.frameQuiets[this.direccio]);
    }
  }
}
