/**
 * Cohete 3D del juego Crash (WebGL puro, sin librerías).
 *
 * Carga dos modelos GLB (assets/rocket.glb y assets/flame.glb), los dibuja con
 * una cámara ortográfica en píxeles encima del gráfico, hace girar el cohete
 * sobre su propio eje mientras sube y anima la llama por código (parpadeo de
 * largo/ancho y brillo; crece un poco con el multiplicador).
 *
 * Si WebGL o los modelos fallan, create() devuelve null y el juego usa el
 * emoji 🚀 como respaldo.
 */
(function () {
  const VS = `
    attribute vec3 aPos; attribute vec3 aNormal; attribute vec3 aColor;
    uniform mat4 uMVP; uniform mat3 uNM;
    varying vec3 vN; varying vec3 vC;
    void main(){ vN = uNM * aNormal; vC = aColor; gl_Position = uMVP * vec4(aPos, 1.0); }`;
  const FS = `
    precision mediump float;
    varying vec3 vN; varying vec3 vC;
    uniform float uLit; uniform float uGain; uniform float uAlpha;
    void main(){
      vec3 n = normalize(vN);
      if (!gl_FrontFacing) n = -n;
      float d = max(dot(n, normalize(vec3(-0.35, 0.55, 0.85))), 0.0);
      vec3 lit = vC * (0.42 + 0.78 * d);
      vec3 col = mix(vC * uGain, lit, uLit);
      gl_FragColor = vec4(col * uAlpha, uAlpha);
    }`;

  // ---------- matrices 4x4 (column-major) ----------
  const ident = () => new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
  function mul(a, b) { // a * b
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
    return o;
  }
  const translate = (x, y, z) => { const m = ident(); m[12] = x; m[13] = y; m[14] = z; return m; };
  const scale = (x, y, z) => { const m = ident(); m[0] = x; m[5] = y; m[10] = z; return m; };
  const rotZ = (a) => { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c,s,0,0, -s,c,0,0, 0,0,1,0, 0,0,0,1]); };
  const rotX = (a) => { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([1,0,0,0, 0,c,s,0, 0,-s,c,0, 0,0,0,1]); };
  function ortho(w, h) {
    const n = -600, f = 600;
    return new Float32Array([2 / w,0,0,0, 0,2 / h,0,0, 0,0,-2 / (f - n),0, -1,-1,-(f + n) / (f - n),1]);
  }
  const rot3 = (m) => new Float32Array([m[0],m[1],m[2], m[4],m[5],m[6], m[8],m[9],m[10]]);

  // ---------- carga de GLB (1 malla, POSITION + índices) ----------
  async function loadGlb(url) {
    const buf = await (await fetch(url)).arrayBuffer();
    const dv = new DataView(buf);
    if (dv.getUint32(0, true) !== 0x46546c67) throw new Error("GLB inválido");
    const jsonLen = dv.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen)));
    const binStart = 20 + jsonLen + 8;
    const prim = json.meshes[0].primitives[0];
    const read = (accIdx, Type) => {
      const acc = json.accessors[accIdx];
      const bv = json.bufferViews[acc.bufferView];
      const off = binStart + (bv.byteOffset || 0) + (acc.byteOffset || 0);
      const n = acc.count * (acc.type === "VEC3" ? 3 : 1);
      return new Type(buf.slice(off, off + n * Type.BYTES_PER_ELEMENT));
    };
    const pos = read(prim.attributes.POSITION, Float32Array);
    const ia = json.accessors[prim.indices];
    const idx = read(prim.indices, ia.componentType === 5125 ? Uint32Array : Uint16Array);
    return { pos, idx };
  }

  // Gira el modelo -45° sobre Z: el eje del cohete (que viene en diagonal) queda en +X.
  function rotateAxisToX(pos) {
    const c = Math.SQRT1_2;
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i], y = pos[i + 1];
      pos[i] = (x + y) * c;
      pos[i + 1] = (-x + y) * c;
    }
  }
  function computeNormals(pos, idx) {
    const nrm = new Float32Array(pos.length);
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const k of [a, b, c]) { nrm[k] += nx; nrm[k + 1] += ny; nrm[k + 2] += nz; }
    }
    for (let i = 0; i < nrm.length; i += 3) {
      const l = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]) || 1;
      nrm[i] /= l; nrm[i + 1] /= l; nrm[i + 2] /= l;
    }
    return nrm;
  }
  const hex = (h) => [(h >> 16 & 255) / 255, (h >> 8 & 255) / 255, (h & 255) / 255];

  // Los modelos son malla blanca sin color: se pintan por zonas.
  function rocketColors(pos) {
    const col = new Float32Array(pos.length);
    const BODY = hex(0xf1f5f9), RED = hex(0xef4444), WIN = hex(0x38bdf8), DARK = hex(0x475569);
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i], y = pos[i + 1], z = pos[i + 2];
      const r = Math.hypot(y, z);
      let c = BODY;
      if (x > 0.85) c = RED;                       // punta
      else if (r > 0.68 && x < -0.15) c = RED;     // aletas
      else if (z > 0.38 && Math.abs(x) < 0.5 && r > 0.4) c = WIN; // ventana
      else if (x < -0.78) c = DARK;                // tobera
      col.set(c, i);
    }
    return col;
  }
  // La llama: base clara/amarilla -> naranja -> rojo en la punta (x=0 es la base).
  function flameColors(pos, length) {
    const col = new Float32Array(pos.length);
    for (let i = 0; i < pos.length; i += 3) {
      const t = Math.min(1, Math.max(0, -pos[i] / length));
      let r, g, b;
      if (t < 0.45) { const k = t / 0.45; r = 1; g = 0.96 - 0.38 * k; b = 0.62 - 0.52 * k; }
      else { const k = (t - 0.45) / 0.55; r = 1 - 0.12 * k; g = 0.58 - 0.45 * k; b = 0.10 - 0.05 * k; }
      col[i] = r; col[i + 1] = g; col[i + 2] = b;
    }
    return col;
  }

  let modelsPromise = null;
  function loadModels() {
    if (!modelsPromise) {
      modelsPromise = Promise.all([loadGlb("assets/rocket.glb"), loadGlb("assets/flame.glb")]).then(([rk, fl]) => {
        rotateAxisToX(rk.pos);
        rotateAxisToX(fl.pos);
        // La base de la llama (extremo redondeado, el de x máximo) pasa a x = 0.
        let fmax = -Infinity, fmin = Infinity;
        for (let i = 0; i < fl.pos.length; i += 3) { fmax = Math.max(fmax, fl.pos[i]); fmin = Math.min(fmin, fl.pos[i]); }
        for (let i = 0; i < fl.pos.length; i += 3) fl.pos[i] -= fmax;
        const flameLen = fmax - fmin;
        return {
          rocket: { pos: rk.pos, idx: rk.idx, nrm: computeNormals(rk.pos, rk.idx), col: rocketColors(rk.pos) },
          flame: { pos: fl.pos, idx: fl.idx, nrm: computeNormals(fl.pos, fl.idx), col: flameColors(fl.pos, flameLen), len: flameLen },
        };
      });
      modelsPromise.catch(() => { modelsPromise = null; });
    }
    return modelsPromise;
  }

  async function create(container) {
    let models;
    try { models = await loadModels(); } catch (e) { return null; }
    const canvas = document.createElement("canvas");
    canvas.className = "crash-3d";
    const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: true });
    if (!gl) return null;

    const sh = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    let prog;
    try {
      prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    } catch (e) { return null; }
    gl.useProgram(prog);
    const loc = {
      pos: gl.getAttribLocation(prog, "aPos"), nrm: gl.getAttribLocation(prog, "aNormal"), col: gl.getAttribLocation(prog, "aColor"),
      mvp: gl.getUniformLocation(prog, "uMVP"), nm: gl.getUniformLocation(prog, "uNM"),
      lit: gl.getUniformLocation(prog, "uLit"), gain: gl.getUniformLocation(prog, "uGain"), alpha: gl.getUniformLocation(prog, "uAlpha"),
    };
    const mkBuf = (target, data) => { const b = gl.createBuffer(); gl.bindBuffer(target, b); gl.bufferData(target, data, gl.STATIC_DRAW); return b; };
    gl.getExtension("OES_element_index_uint");
    const mesh = (m) => ({
      pos: mkBuf(gl.ARRAY_BUFFER, m.pos), nrm: mkBuf(gl.ARRAY_BUFFER, m.nrm), col: mkBuf(gl.ARRAY_BUFFER, m.col),
      idx: mkBuf(gl.ELEMENT_ARRAY_BUFFER, m.idx), count: m.idx.length,
      type: m.idx instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
    });
    const rocket = mesh(models.rocket), flame = mesh(models.flame);

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);
    container.appendChild(canvas);

    let W = 0, H = 0;
    function fit() {
      const w = container.clientWidth, h = container.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (w !== W || h !== H || canvas.width !== Math.round(w * dpr)) {
        W = w; H = h;
        canvas.width = Math.max(1, Math.round(w * dpr));
        canvas.height = Math.max(1, Math.round(h * dpr));
        gl.viewport(0, 0, canvas.width, canvas.height);
      }
    }
    function drawMesh(m, model, lit, gain, alpha) {
      gl.bindBuffer(gl.ARRAY_BUFFER, m.pos); gl.enableVertexAttribArray(loc.pos); gl.vertexAttribPointer(loc.pos, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, m.nrm); gl.enableVertexAttribArray(loc.nrm); gl.vertexAttribPointer(loc.nrm, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, m.col); gl.enableVertexAttribArray(loc.col); gl.vertexAttribPointer(loc.col, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.idx);
      gl.uniformMatrix4fv(loc.mvp, false, mul(ortho(W, H), model));
      gl.uniformMatrix3fv(loc.nm, false, rot3(model.rotOnly || model));
      gl.uniform1f(loc.lit, lit); gl.uniform1f(loc.gain, gain); gl.uniform1f(loc.alpha, alpha);
      gl.drawElements(gl.TRIANGLES, m.count, m.type, 0);
    }

    const SIZE = 34; // píxeles por unidad del modelo (cohete ~75 px de largo)
    return {
      canvas,
      hide() { fit(); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); },
      /** x,y en píxeles del contenedor (y hacia abajo); angle en radianes de pantalla (y hacia abajo). */
      draw({ x, y, angle, mult, time }) {
        fit();
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        const base = mul(translate(x, H - y, 0), rotZ(-angle));
        const roll = rotX(time * 3.2); // vueltas sobre su propio eje
        const rot = mul(rotZ(-angle), roll);
        const R = mul(mul(base, roll), scale(SIZE, SIZE, SIZE));
        R.rotOnly = rot;
        drawMesh(rocket, R, 1, 1, 1);

        // Llama: parpadea en largo y ancho; crece un poco con el multiplicador.
        const k = Math.min(1, Math.log(Math.max(1, mult)) / Math.log(20));
        const f1 = Math.sin(time * 31) * 0.5 + Math.sin(time * 17.3 + 1.1) * 0.5;
        const f2 = Math.sin(time * 23 + 2.3) * 0.5 + Math.sin(time * 41 + 0.4) * 0.5;
        const len = (0.5 + 0.4 * k) * (1 + 0.16 * f1);
        const wid = (0.5 + 0.18 * k) * (1 + 0.1 * f2);
        const tailX = -0.72; // el rocket termina en x ~ -0.9; la llama se mete un poco bajo la tobera
        const F = mul(mul(mul(base, roll), scale(SIZE, SIZE, SIZE)), mul(translate(tailX, 0, 0), scale(len, wid, wid)));
        F.rotOnly = rot;
        drawMesh(flame, F, 0, 0.9 + 0.22 * (0.5 + 0.5 * f2), 0.95);
      },
      destroy() { if (canvas.parentNode) canvas.parentNode.removeChild(canvas); const e = gl.getExtension("WEBGL_lose_context"); if (e) e.loseContext(); },
    };
  }

  window.Crash3D = { create };
})();
