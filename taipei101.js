/**
 * 台北101 (TAIPEI 101) 超高精細3Dモデル＆インタラクティブビューア
 * スケール: 1 Three.js Unit = 1.0 メートル (全高 508.0m)
 */

(function () {
  "use strict";

  // ============================================================================
  // 1. シーン・カメラ・レンダラー・OrbitControls の初期化
  // ============================================================================
  const container = document.getElementById("canvas-container");
  const annotationsContainer = document.getElementById("annotations-container");
  const statsEl = document.getElementById("model-stats");

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8ab8dc);
  scene.fog = new THREE.FogExp2(0x9dc2df, 0.00028);

  const camera = new THREE.PerspectiveCamera(
    42,
    window.innerWidth / window.innerHeight,
    1.0,
    8000
  );
  // 初期位置：写真2枚目のような正面やや斜めからの全景アングル
  camera.position.set(140, 255, 620);

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.outputEncoding = THREE.sRGBEncoding;
  container.appendChild(renderer.domElement);

  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 245, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.maxDistance = 2600;
  controls.minDistance = 12;
  controls.maxPolarAngle = Math.PI * 0.96; // 下からの見上げも許容
  controls.update();

  // ============================================================================
  // 2. プロシージャル環境マップ（青空・太陽・都市反射）の生成
  // ============================================================================
  function createSkyEnvTexture(mode) {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");

    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    if (mode === "day") {
      grad.addColorStop(0.0, "#3b76b4");
      grad.addColorStop(0.45, "#7cb2de");
      grad.addColorStop(0.5, "#b7d6ec");
      grad.addColorStop(0.52, "#5a6c73");
      grad.addColorStop(1.0, "#26383f");
    } else if (mode === "sunset") {
      grad.addColorStop(0.0, "#243b6b");
      grad.addColorStop(0.35, "#8b5270");
      grad.addColorStop(0.48, "#f08c4b");
      grad.addColorStop(0.52, "#4a3836");
      grad.addColorStop(1.0, "#181c24");
    } else {
      grad.addColorStop(0.0, "#050b14");
      grad.addColorStop(0.48, "#0f2038");
      grad.addColorStop(0.52, "#121a24");
      grad.addColorStop(1.0, "#05080c");
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 256);

    // 太陽光のハイライトスポット
    if (mode !== "night") {
      const sunGrad = ctx.createRadialGradient(
        360,
        mode === "day" ? 70 : 115,
        2,
        360,
        mode === "day" ? 70 : 115,
        70
      );
      sunGrad.addColorStop(0, "rgba(255, 252, 235, 1.0)");
      sunGrad.addColorStop(0.3, "rgba(255, 240, 200, 0.5)");
      sunGrad.addColorStop(1, "rgba(255, 255, 255, 0)");
      ctx.fillStyle = sunGrad;
      ctx.fillRect(0, 0, 512, 256);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.encoding = THREE.sRGBEncoding;
    return tex;
  }

  const envTextures = {
    day: createSkyEnvTexture("day"),
    sunset: createSkyEnvTexture("sunset"),
    night: createSkyEnvTexture("night"),
  };
  scene.environment = envTextures.day;

  // ============================================================================
  // 3. ライティング設定（太陽光・半球光・アンビエント・夜景アクセント）
  // ============================================================================
  const hemiLight = new THREE.HemisphereLight(0xdff0ff, 0x4b6268, 0.85);
  hemiLight.position.set(0, 600, 0);
  scene.add(hemiLight);

  const sunLight = new THREE.DirectionalLight(0xfff9ee, 1.45);
  sunLight.position.set(320, 460, 320);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.width = 2048;
  sunLight.shadow.mapSize.height = 2048;
  sunLight.shadow.camera.near = 50;
  sunLight.shadow.camera.far = 1500;
  const d = 320;
  sunLight.shadow.camera.left = -d;
  sunLight.shadow.camera.right = d;
  sunLight.shadow.camera.top = d + 180;
  sunLight.shadow.camera.bottom = -100;
  sunLight.shadow.bias = -0.0005;
  scene.add(sunLight);

  // 背面の陰影を柔らかく起こすフィルライト
  const fillLight = new THREE.DirectionalLight(0x8ab8e6, 0.45);
  fillLight.position.set(-280, 220, -260);
  scene.add(fillLight);

  // ============================================================================
  // 4. 高解像度プロシージャル・ファサードテクスチャの生成
  // ============================================================================
  /**
   * 台北101の8節モジュール用カーテンウォールテクスチャ（8フロア分×横スパン）
   * 翡翠色（ジェイド・ブルーグリーン）の複層ガラス、水平スパンドレル帯、垂直マリオンを精密描画
   */
  function createModuleFacadeTextures(floors = 8, cols = 24) {
    const width = 1024;
    const height = 1024;

    // 1) カラーマップ (Albedo)
    const colorCanvas = document.createElement("canvas");
    colorCanvas.width = width;
    colorCanvas.height = height;
    const cCtx = colorCanvas.getContext("2d");

    // 2) ラフネスマップ (ガラスは滑らか=黒、サッシはマット=白)
    const roughCanvas = document.createElement("canvas");
    roughCanvas.width = width;
    roughCanvas.height = height;
    const rCtx = roughCanvas.getContext("2d");

    // 3) バンプマップ (凹凸)
    const bumpCanvas = document.createElement("canvas");
    bumpCanvas.width = width;
    bumpCanvas.height = height;
    const bCtx = bumpCanvas.getContext("2d");

    // 4) エミッシブマップ (夜景の室内灯)
    const emiCanvas = document.createElement("canvas");
    emiCanvas.width = width;
    emiCanvas.height = height;
    const eCtx = emiCanvas.getContext("2d");

    // ベース塗り（深い翡翠グリーン）
    cCtx.fillStyle = "#295a60";
    cCtx.fillRect(0, 0, width, height);

    rCtx.fillStyle = "#282828"; // ガラス基本ラフネス（低）
    rCtx.fillRect(0, 0, width, height);

    bCtx.fillStyle = "#808080";
    bCtx.fillRect(0, 0, width, height);

    eCtx.fillStyle = "#000000";
    eCtx.fillRect(0, 0, width, height);

    const floorH = height / floors;
    const colW = width / cols;

    // 疑似乱数シード（再現性のある窓の明暗パターン）
    let seed = floors * 137 + cols * 53;
    function rand() {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    }

    for (let f = 0; f < floors; f++) {
      const y0 = f * floorH;
      const spandrelH = floorH * 0.30; // 層間スパンドレル帯（濃い青緑＋金属枠）
      const windowH = floorH - spandrelH;

      // 層間スパンドレル帯（各フロアの上部または下部）
      const spGrad = cCtx.createLinearGradient(0, y0, 0, y0 + spandrelH);
      spGrad.addColorStop(0.0, "#17373c");
      spGrad.addColorStop(0.25, "#1f474d");
      spGrad.addColorStop(0.85, "#193a3f");
      spGrad.addColorStop(1.0, "#4c7a7e");
      cCtx.fillStyle = spGrad;
      cCtx.fillRect(0, y0, width, spandrelH);

      // スパンドレル部のラフネス＆バンプ
      rCtx.fillStyle = "#7a7a7a";
      rCtx.fillRect(0, y0, width, spandrelH);
      bCtx.fillStyle = "#a8a8a8";
      bCtx.fillRect(0, y0, width, spandrelH);

      // 水平のシルバーグリーン・ルーバーライン（写真に見える水平の細いストライプ）
      cCtx.fillStyle = "#629497";
      cCtx.fillRect(0, y0 + 2, width, 3);
      cCtx.fillStyle = "#4d7e82";
      cCtx.fillRect(0, y0 + spandrelH - 3, width, 3);

      // 各窓セルの描画
      for (let c = 0; c < cols; c++) {
        const x0 = c * colW;
        const v = rand();

        // ガラス1枚ごとの微妙な翡翠色トーン変化（リアルなビル反射感）
        const hue = 185 + (v - 0.5) * 6;
        const sat = 40 + (v - 0.5) * 8;
        const light = 31 + (v - 0.5) * 7;

        const winGrad = cCtx.createLinearGradient(
          x0,
          y0 + spandrelH,
          x0,
          y0 + floorH
        );
        winGrad.addColorStop(0, `hsl(${hue}, ${sat}%, ${light - 3}%)`);
        winGrad.addColorStop(0.5, `hsl(${hue}, ${sat + 3}%, ${light + 3}%)`);
        winGrad.addColorStop(1, `hsl(${hue}, ${sat}%, ${light - 2}%)`);

        cCtx.fillStyle = winGrad;
        cCtx.fillRect(x0 + 2, y0 + spandrelH + 2, colW - 4, windowH - 4);

        // ガラス面はツルツルで凹んでいる
        rCtx.fillStyle = "#181818";
        rCtx.fillRect(x0 + 2, y0 + spandrelH + 2, colW - 4, windowH - 4);
        bCtx.fillStyle = "#555555";
        bCtx.fillRect(x0 + 2, y0 + spandrelH + 2, colW - 4, windowH - 4);

        // 夜景用の室内灯（フロアごと・部屋ごとの点灯パターン）
        const litProb = rand();
        if (litProb > 0.58) {
          const warm = rand() > 0.35;
          eCtx.fillStyle = warm
            ? `rgba(255, 228, 170, ${0.45 + rand() * 0.45})`
            : `rgba(205, 235, 255, ${0.4 + rand() * 0.4})`;
          eCtx.fillRect(x0 + 4, y0 + spandrelH + 5, colW - 8, windowH - 9);
        }

        // 垂直マリオン（サッシ枠）
        cCtx.fillStyle = "#3e6d71";
        cCtx.fillRect(x0, y0, 3, floorH);
        rCtx.fillStyle = "#909090";
        rCtx.fillRect(x0, y0, 3, floorH);
        bCtx.fillStyle = "#d8d8d8";
        bCtx.fillRect(x0, y0, 3, floorH);
      }
    }

    // 中央とコーナー寄りの縦構造ピラーラインを強調（写真2枚目の縦の陰影とディテール）
    const pillarCols = [0, 4, 8, Math.floor(cols / 2), cols - 8, cols - 4];
    pillarCols.forEach((pc) => {
      const px = pc * colW;
      cCtx.fillStyle = "#20474b";
      cCtx.fillRect(px - 3, 0, 7, height);
      cCtx.fillStyle = "#699a9d";
      cCtx.fillRect(px - 1, 0, 2, height);
      bCtx.fillStyle = "#ffffff";
      bCtx.fillRect(px - 3, 0, 7, height);
    });

    const colorTex = new THREE.CanvasTexture(colorCanvas);
    colorTex.wrapS = THREE.RepeatWrapping;
    colorTex.wrapT = THREE.ClampToEdgeWrapping;
    colorTex.encoding = THREE.sRGBEncoding;
    colorTex.anisotropy = 8;

    const roughTex = new THREE.CanvasTexture(roughCanvas);
    roughTex.wrapS = THREE.RepeatWrapping;
    roughTex.wrapT = THREE.ClampToEdgeWrapping;

    const bumpTex = new THREE.CanvasTexture(bumpCanvas);
    bumpTex.wrapS = THREE.RepeatWrapping;
    bumpTex.wrapT = THREE.ClampToEdgeWrapping;

    const emiTex = new THREE.CanvasTexture(emiCanvas);
    emiTex.wrapS = THREE.RepeatWrapping;
    emiTex.wrapT = THREE.ClampToEdgeWrapping;
    emiTex.encoding = THREE.sRGBEncoding;

    return { colorTex, roughTex, bumpTex, emiTex };
  }

  const moduleTex = createModuleFacadeTextures(8, 28);
  const baseTex = createModuleFacadeTextures(24, 36);
  const topTowerTex = createModuleFacadeTextures(10, 12);

  // ============================================================================
  // 5. マテリアル定義（写真2枚目のリアルな翡翠ガラス・シルバー装飾・ゴールドTMD）
  // ============================================================================
  const glassMaterials = []; // 不透明度・夜景切り替え対象リスト

  // 8節モジュールのガラスカーテンウォールマテリアル
  const pagodaGlassMat = new THREE.MeshStandardMaterial({
    map: moduleTex.colorTex,
    roughnessMap: moduleTex.roughTex,
    bumpMap: moduleTex.bumpTex,
    bumpScale: 0.35,
    emissiveMap: moduleTex.emiTex,
    emissive: new THREE.Color(0xffffff),
    emissiveIntensity: 0.0, // 昼間は0、夜景で上げる
    metalness: 0.42,
    roughness: 0.28,
    envMapIntensity: 1.35,
  });
  glassMaterials.push(pagodaGlassMat);

  // 第8節専用マテリアル（ウィンド・ダンパー透視機能でここだけ半透明にもできるように分離）
  const section8GlassMat = pagodaGlassMat.clone();
  glassMaterials.push(section8GlassMat);

  // 基壇部（1F〜26F）のカーテンウォールマテリアル
  const baseGlassMat = new THREE.MeshStandardMaterial({
    map: baseTex.colorTex,
    roughnessMap: baseTex.roughTex,
    bumpMap: baseTex.bumpTex,
    bumpScale: 0.35,
    emissiveMap: baseTex.emiTex,
    emissive: new THREE.Color(0xffffff),
    emissiveIntensity: 0.0,
    metalness: 0.4,
    roughness: 0.3,
    envMapIntensity: 1.3,
  });
  glassMaterials.push(baseGlassMat);

  // 92F〜101F上部タワーマテリアル
  const upperTowerMat = new THREE.MeshStandardMaterial({
    map: topTowerTex.colorTex,
    roughnessMap: topTowerTex.roughTex,
    bumpMap: topTowerTex.bumpTex,
    bumpScale: 0.3,
    emissiveMap: topTowerTex.emiTex,
    emissive: new THREE.Color(0xffffff),
    emissiveIntensity: 0.0,
    metalness: 0.42,
    roughness: 0.28,
    envMapIntensity: 1.35,
  });
  glassMaterials.push(upperTowerMat);

  // 濃緑〜ダークティールの構造フレーム・ルーバー（節のくびれ、基壇部水平バンド、コーナー柱）
  const darkJadeFrameMat = new THREE.MeshStandardMaterial({
    color: 0x1e4449,
    metalness: 0.45,
    roughness: 0.48,
  });

  // 明るいシルバーメタリック（古銭、如意クレスト、コーニス軒トリム、頂部リング）
  const silverTrimMat = new THREE.MeshStandardMaterial({
    color: 0xc8d6dc,
    metalness: 0.72,
    roughness: 0.26,
  });

  // 古銭のメイン円盤（写真2枚目のような少し青みがかったマットシルバーグレー）
  const coinDiscMat = new THREE.MeshStandardMaterial({
    color: 0x9cb2bc,
    metalness: 0.62,
    roughness: 0.32,
  });

  // スパイア（尖塔）のホワイトシルバー塗装
  const spireMat = new THREE.MeshStandardMaterial({
    color: 0xdce6ec,
    metalness: 0.55,
    roughness: 0.3,
  });

  // 夜景ライトアップ発光バー用マテリアル（曜日別カラーで発光）
  const accentLightMat = new THREE.MeshStandardMaterial({
    color: 0xa0b8be,
    emissive: new THREE.Color(0x30d158),
    emissiveIntensity: 0.0,
    metalness: 0.5,
    roughness: 0.3,
  });

  // 黄金のウィンド・ダンパー（660トン TMD）用マテリアル
  const goldDamperMat = new THREE.MeshStandardMaterial({
    color: 0xf5b82e,
    emissive: new THREE.Color(0x4a3000),
    emissiveIntensity: 0.25,
    metalness: 0.88,
    roughness: 0.18,
  });

  // ============================================================================
  // 6. 台北101 特有の「W字ステップコーナー断面」ロフトジオメトリ生成関数
  // ============================================================================
  /**
   * 台北101の平面断面（4つの主面が張り出し、四隅が階段状に2段セットバック＋斜めカットされた
   * 特徴的な「W字コーナー」断面）を持つ2D輪郭点列を生成する。
   * @param {number} halfWidth 主面までの中心からの距離 (幅の半分)
   * @param {number} cornerInset コーナーのセットバック深さ比率 (デフォルト 0.22)
   */
  function getTaipei101CrossSectionPoints(halfWidth, cornerInset = 0.22) {
    const R = halfWidth;
    const m = R * (1 - cornerInset); // 主面の端の座標 (約 0.78 R)
    const s1 = R * (1 - cornerInset * 0.45); // 1段目セットバック深さ (約 0.90 R)
    const c1 = R * (1 - cornerInset * 1.32); // 1段目の横位置 (約 0.71 R)
    const s2 = R * (1 - cornerInset * 0.88); // 2段目セットバック深さ (約 0.81 R)
    const c2 = R * (1 - cornerInset * 1.65); // 2段目の内角位置 (約 0.64 R)

    // 1象限あたり7点 × 4象限 = 28点の反時計回り輪郭
    // これにより、主面のフラット部と四隅のW字ステップの垂直陰影ラインが本物通りに表現される
    const pts = [
      // 東面 (X = +R) の上半分から北東コーナーへ
      { x: R, z: m },
      { x: s1, z: m },
      { x: s1, z: c1 },
      { x: s2, z: c1 },
      { x: s2, z: c2 }, // 北東コーナーの斜めチャンファー始点
      { x: c2, z: s2 }, // 北東コーナーの斜めチャンファー終点
      { x: c1, z: s2 },
      { x: c1, z: s1 },
      { x: m, z: s1 },
      // 北面 (Z = +R)
      { x: m, z: R },
      { x: -m, z: R },
      // 北西コーナー
      { x: -m, z: s1 },
      { x: -c1, z: s1 },
      { x: -c1, z: s2 },
      { x: -c2, z: s2 },
      { x: -s2, z: c2 },
      { x: -s2, z: c1 },
      { x: -s1, z: c1 },
      { x: -s1, z: m },
      // 西面 (X = -R)
      { x: -R, z: m },
      { x: -R, z: -m },
      // 南西コーナー
      { x: -s1, z: -m },
      { x: -s1, z: -c1 },
      { x: -s2, z: -c1 },
      { x: -s2, z: -c2 },
      { x: -c2, z: -s2 },
      { x: -c1, z: -s2 },
      { x: -c1, z: -s1 },
      { x: -m, z: -s1 },
      // 南面 (Z = -R)
      { x: -m, z: -R },
      { x: m, z: -R },
      // 南東コーナー
      { x: m, z: -s1 },
      { x: c1, z: -s1 },
      { x: c1, z: -s2 },
      { x: c2, z: -s2 },
      { x: s2, z: -c2 },
      { x: s2, z: -c1 },
      { x: s1, z: -c1 },
      { x: s1, z: -m },
      // 東面の南端へ戻る
      { x: R, z: -m },
    ];
    return pts;
  }

  /**
   * 下端半径 bottomR から上端半径 topR へロフト（押し出し）した
   * W字コーナー断面を持つ THREE.BufferGeometry を生成する。
   * 各面ごとに独立した頂点＆法線を持たせることで、縦方向の折り目（エッジ）がくっきり出る。
   */
  function createLoftedSectionGeometry(
    bottomR,
    topR,
    height,
    cornerInset = 0.22,
    uScale = 1.0
  ) {
    const botPts = getTaipei101CrossSectionPoints(bottomR, cornerInset);
    const topPts = getTaipei101CrossSectionPoints(topR, cornerInset);
    const n = botPts.length;

    const positions = [];
    const uvs = [];
    const indices = [];

    // 周囲長を計算してUVのU座標を実寸比例にする
    let perimeter = 0;
    const segLengths = [];
    for (let i = 0; i < n; i++) {
      const next = (i + 1) % n;
      const dx = topPts[next].x - topPts[i].x;
      const dz = topPts[next].z - topPts[i].z;
      const len = Math.sqrt(dx * dx + dz * dz);
      segLengths.push(len);
      perimeter += len;
    }

    let accumU = 0;
    let vertIndex = 0;

    // 側面のクアッドを張る（フラットな面法線を得るためセグメントごとに4頂点）
    for (let i = 0; i < n; i++) {
      const next = (i + 1) % n;
      const b0 = botPts[i];
      const b1 = botPts[next];
      const t0 = topPts[i];
      const t1 = topPts[next];

      const u0 = (accumU / (perimeter * 0.25)) * uScale;
      accumU += segLengths[i];
      const u1 = (accumU / (perimeter * 0.25)) * uScale;

      positions.push(
        b0.x, 0, b0.z,
        b1.x, 0, b1.z,
        t1.x, height, t1.z,
        t0.x, height, t0.z
      );

      uvs.push(u0, 0, u1, 0, u1, 1, u0, 1);

      indices.push(
        vertIndex, vertIndex + 1, vertIndex + 2,
        vertIndex, vertIndex + 2, vertIndex + 3
      );
      vertIndex += 4;
    }

    // 上面キャップ（屋根）
    const topCenterIdx = vertIndex;
    positions.push(0, height, 0);
    uvs.push(0.5, 0.5);
    vertIndex++;

    for (let i = 0; i < n; i++) {
      const next = (i + 1) % n;
      const t0 = topPts[i];
      const t1 = topPts[next];
      positions.push(t0.x, height, t0.z, t1.x, height, t1.z);
      uvs.push(0, 0, 1, 1);
      indices.push(topCenterIdx, vertIndex + 1, vertIndex);
      vertIndex += 2;
    }

    // 下面キャップ（底面：下から見上げたときに裏透けしないように）
    const botCenterIdx = vertIndex;
    positions.push(0, 0, 0);
    uvs.push(0.5, 0.5);
    vertIndex++;

    for (let i = 0; i < n; i++) {
      const next = (i + 1) % n;
      const b0 = botPts[i];
      const b1 = botPts[next];
      positions.push(b0.x, 0, b0.z, b1.x, 0, b1.z);
      uvs.push(0, 0, 1, 1);
      indices.push(botCenterIdx, vertIndex, vertIndex + 1);
      vertIndex += 2;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3)
    );
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  // ============================================================================
  // 7. 伝統装飾パーツ：「如意（Ruyi / 双雲紋クレスト）」と「古銭（方孔円銭）」の3D造形
  // ============================================================================
  /**
   * 各節の4面中央上端に取り付けられている白銀の「如意（双雲紋）」装飾メッシュを生成
   * 写真2枚目で各節の真ん中上部にT字・双カール状に光っている象徴的なディテール
   */
  function createRuyiCrestGroup(scale = 1.0) {
    const group = new THREE.Group();

    // 1) 中央の縦スパイン（背骨レリーフ）
    const spineGeo = new THREE.BoxGeometry(1.1 * scale, 5.2 * scale, 1.4 * scale);
    const spine = new THREE.Mesh(spineGeo, silverTrimMat);
    spine.position.set(0, -1.2 * scale, 0.5 * scale);
    group.add(spine);

    // 中央上部の盾型エンブレム
    const shieldGeo = new THREE.CylinderGeometry(
      1.3 * scale,
      0.8 * scale,
      2.6 * scale,
      6
    );
    const shield = new THREE.Mesh(shieldGeo, silverTrimMat);
    shield.position.set(0, 0.4 * scale, 0.9 * scale);
    group.add(shield);

    // 2) 左右に広がる双雲カール（如意のアーム＋渦巻き）
    [-1, 1].forEach((dir) => {
      // 横へ伸びるアーチバー
      const armGeo = new THREE.BoxGeometry(4.2 * scale, 1.05 * scale, 1.25 * scale);
      const arm = new THREE.Mesh(armGeo, silverTrimMat);
      arm.position.set(dir * 2.2 * scale, 1.0 * scale, 0.65 * scale);
      arm.rotation.z = dir * -0.08;
      group.add(arm);

      // 先端の渦巻き（クラウドスクロール・トーラス＋円盤）
      const curlOuterGeo = new THREE.TorusGeometry(
        1.25 * scale,
        0.42 * scale,
        10,
        20,
        Math.PI * 1.65
      );
      const curlOuter = new THREE.Mesh(curlOuterGeo, silverTrimMat);
      curlOuter.position.set(dir * 4.3 * scale, 0.45 * scale, 0.75 * scale);
      curlOuter.rotation.z = dir === 1 ? -Math.PI * 0.3 : -Math.PI * 0.7;
      group.add(curlOuter);

      // 渦巻きの中心コア
      const coreGeo = new THREE.CylinderGeometry(
        0.55 * scale,
        0.55 * scale,
        1.1 * scale,
        12
      );
      coreGeo.rotateX(Math.PI / 2);
      const core = new THREE.Mesh(coreGeo, silverTrimMat);
      core.position.set(dir * 4.3 * scale, 0.45 * scale, 0.75 * scale);
      group.add(core);

      // 下段の小さなセカンダリ雲紋カール
      const subCurlGeo = new THREE.TorusGeometry(
        0.75 * scale,
        0.28 * scale,
        8,
        16,
        Math.PI * 1.5
      );
      const subCurl = new THREE.Mesh(subCurlGeo, silverTrimMat);
      subCurl.position.set(dir * 1.5 * scale, -0.7 * scale, 0.6 * scale);
      group.add(subCurl);
    });

    // 夜景ライトアップ時に如意の背面を照らすアクセントバー
    const lightBarGeo = new THREE.BoxGeometry(8.5 * scale, 0.45 * scale, 0.6 * scale);
    const lightBar = new THREE.Mesh(lightBarGeo, accentLightMat);
    lightBar.position.set(0, 1.65 * scale, 0.9 * scale);
    group.add(lightBar);

    return group;
  }

  /**
   * 24F〜27Fの4面に取り付けられた巨大な「古銭（方孔円銭）」オブジェクトを生成
   * 写真2枚目の基壇部すぐ上で強い存在感を放つ円盤＋中央の四角い枠モールド
   */
  function createAncientCoinGroup() {
    const group = new THREE.Group();
    const radius = 9.6; // 直径 約19.2m

    // 1) メイン円盤ベース
    const discGeo = new THREE.CylinderGeometry(radius, radius, 2.2, 48);
    discGeo.rotateX(Math.PI / 2);
    const disc = new THREE.Mesh(discGeo, coinDiscMat);
    disc.castShadow = true;
    disc.receiveShadow = true;
    group.add(disc);

    // 2) 外周の分厚い立体リム（縁取りリング）
    const outerRimGeo = new THREE.TorusGeometry(radius - 0.5, 0.75, 16, 48);
    const outerRim = new THREE.Mesh(outerRimGeo, silverTrimMat);
    outerRim.position.z = 0.85;
    group.add(outerRim);

    // 内側の中間リング溝
    const midRimGeo = new THREE.TorusGeometry(radius * 0.68, 0.28, 12, 40);
    const midRim = new THREE.Mesh(midRimGeo, silverTrimMat);
    midRim.position.z = 1.05;
    group.add(midRim);

    // 3) 中央の「方孔（正方形の穴モールド）」
    const holeSize = 5.4;
    const frameThick = 0.75;

    // 中央のくぼんだダークジェイドガラス面
    const centerHoleGeo = new THREE.BoxGeometry(holeSize, holeSize, 1.8);
    const centerHole = new THREE.Mesh(centerHoleGeo, darkJadeFrameMat);
    centerHole.position.z = 0.45;
    group.add(centerHole);

    // 正方形の立体額縁（上下左右4本のフレームバー）
    const hBarGeo = new THREE.BoxGeometry(holeSize + frameThick * 2, frameThick, 1.3);
    const vBarGeo = new THREE.BoxGeometry(frameThick, holeSize, 1.3);

    const topBar = new THREE.Mesh(hBarGeo, silverTrimMat);
    topBar.position.set(0, (holeSize + frameThick) / 2, 0.95);
    const botBar = new THREE.Mesh(hBarGeo, silverTrimMat);
    botBar.position.set(0, -(holeSize + frameThick) / 2, 0.95);
    const leftBar = new THREE.Mesh(vBarGeo, silverTrimMat);
    leftBar.position.set(-(holeSize + frameThick) / 2, 0, 0.95);
    const rightBar = new THREE.Mesh(vBarGeo, silverTrimMat);
    rightBar.position.set((holeSize + frameThick) / 2, 0, 0.95);

    group.add(topBar, botBar, leftBar, rightBar);

    // 夜景時に古銭の周囲を彩るリングライト
    const glowRingGeo = new THREE.TorusGeometry(radius + 0.15, 0.22, 8, 48);
    const glowRing = new THREE.Mesh(glowRingGeo, accentLightMat);
    glowRing.position.z = 0.5;
    group.add(glowRing);

    return group;
  }

  // ============================================================================
  // 8. 台北101 本体モデルの組み立て (全高 508.0m)
  // ============================================================================
  const taipei101Group = new THREE.Group();
  scene.add(taipei101Group);

  // --------------------------------------------------------------------------
  // 8-A. 基壇部（Base / Skirt Frustum: y = 0m 〜 114m, 1F〜26F）
  // --------------------------------------------------------------------------
  const baseHeight = 114.0;
  const baseBottomR = 38.5; // 地上幅 約77m
  const baseTopR = 25.8;    // 26F幅 約51.6m

  const baseGeo = createLoftedSectionGeometry(
    baseBottomR,
    baseTopR,
    baseHeight,
    0.21,
    1.2
  );
  const baseMesh = new THREE.Mesh(baseGeo, baseGlassMat);
  baseMesh.castShadow = true;
  baseMesh.receiveShadow = true;
  taipei101Group.add(baseMesh);

  // 基壇部の水平ダブルバンド（写真2枚目の基壇部中腹にある2組の太い水平ライン＋下部ライン）
  const baseBandHeights = [
    { y: 18, h: 2.0 },
    { y: 38, h: 2.4 },
    { y: 43, h: 2.4 },
    { y: 71, h: 2.4 },
    { y: 76, h: 2.4 },
    { y: 102, h: 2.2 },
  ];
  baseBandHeights.forEach((b) => {
    const t = b.y / baseHeight;
    const r = baseBottomR * (1 - t) + baseTopR * t + 0.35;
    const bandGeo = createLoftedSectionGeometry(r, r - 0.15, b.h, 0.21, 1.0);
    const bandMesh = new THREE.Mesh(bandGeo, darkJadeFrameMat);
    bandMesh.position.y = b.y;
    taipei101Group.add(bandMesh);

    // バンド上端のシルバートリムライン
    const trimGeo = createLoftedSectionGeometry(r + 0.12, r + 0.12, 0.55, 0.21, 1.0);
    const trimMesh = new THREE.Mesh(trimGeo, silverTrimMat);
    trimMesh.position.y = b.y + b.h;
    taipei101Group.add(trimMesh);
  });

  // 基壇部の四隅の段々になったステップ柱（写真2枚目の基壇部左右の斜めエッジのギザギザ段差）
  const numBaseSteps = 7;
  for (let s = 0; s < numBaseSteps; s++) {
    const y0 = s * (baseHeight / numBaseSteps);
    const stepH = baseHeight / numBaseSteps - 1.2;
    const t = y0 / baseHeight;
    const r = baseBottomR * (1 - t) + baseTopR * t;

    const corners = [
      [1, 1],
      [-1, 1],
      [-1, -1],
      [1, -1],
    ];
    corners.forEach(([cx, cz]) => {
      const stepBoxGeo = new THREE.BoxGeometry(4.5, stepH, 4.5);
      const stepBox = new THREE.Mesh(stepBoxGeo, darkJadeFrameMat);
      stepBox.position.set(cx * r * 0.73, y0 + stepH / 2, cz * r * 0.73);
      stepBox.rotation.y = Math.PI / 4;
      taipei101Group.add(stepBox);

      // 段差のキャップトリム
      const capGeo = new THREE.BoxGeometry(4.9, 0.8, 4.9);
      const cap = new THREE.Mesh(capGeo, silverTrimMat);
      cap.position.set(cx * r * 0.73, y0 + stepH + 0.4, cz * r * 0.73);
      cap.rotation.y = Math.PI / 4;
      taipei101Group.add(cap);
    });
  }

  // --------------------------------------------------------------------------
  // 8-B. 古銭（方孔円銭）＆ 24F〜27F コーナー雲紋カラー部 (y = 108m 〜 122m)
  // --------------------------------------------------------------------------
  // 26F〜27Fのくびれ（ネック構造体）
  const neckGeo = createLoftedSectionGeometry(25.2, 24.8, 10.0, 0.20, 1.0);
  const neckMesh = new THREE.Mesh(neckGeo, darkJadeFrameMat);
  neckMesh.position.y = 113.0;
  taipei101Group.add(neckMesh);

  // 四隅に巻き付くシルバーの水平装飾カラー（写真2枚目で左右の古銭の間・角に見える銀色の帯）
  const collarGeo = createLoftedSectionGeometry(26.2, 25.8, 6.8, 0.19, 1.0);
  const collarMesh = new THREE.Mesh(collarGeo, silverTrimMat);
  collarMesh.position.y = 111.5;
  taipei101Group.add(collarMesh);

  // 四隅のコーナー部にある雲紋（如意）レリーフ彫刻
  for (let i = 0; i < 4; i++) {
    const angle = (i * Math.PI) / 2 + Math.PI / 4;
    const cornerRuyi = createRuyiCrestGroup(0.95);
    const dist = 25.8 * 1.02;
    cornerRuyi.position.set(
      Math.sin(angle) * dist,
      115.2,
      Math.cos(angle) * dist
    );
    cornerRuyi.rotation.y = angle;
    taipei101Group.add(cornerRuyi);
  }

  // 4面の巨大古銭（東・西・南・北）
  const coinY = 114.8;
  const coinDist = 26.2;
  for (let i = 0; i < 4; i++) {
    const angle = (i * Math.PI) / 2;
    const coin = createAncientCoinGroup();
    coin.position.set(
      Math.sin(angle) * coinDist,
      coinY,
      Math.cos(angle) * coinDist
    );
    coin.rotation.y = angle;
    taipei101Group.add(coin);

    // 古銭を支える台座ブラケット
    const pedGeo = new THREE.BoxGeometry(10.5, 4.0, 2.4);
    const ped = new THREE.Mesh(pedGeo, silverTrimMat);
    ped.position.set(
      Math.sin(angle) * (coinDist - 0.5),
      coinY - 8.2,
      Math.cos(angle) * (coinDist - 0.5)
    );
    ped.rotation.y = angle;
    taipei101Group.add(ped);
  }

  // --------------------------------------------------------------------------
  // 8-C. 8つの「竹の節（斗 / Pagoda Modules）」（y = 122m 〜 382m, 全8節）
  // --------------------------------------------------------------------------
  const pagodaStartY = 122.0;
  const sectionTotalH = 32.5; // 1節 32.5m × 8 = 260m (122m -> 382m)
  const flareBodyH = 29.4;    // 逆テーパーガラス部の高さ
  const neckRecessH = 3.1;    // 節と節の間のくびれ高さ
  const secBottomR = 24.4;    // 下端幅 約48.8m
  const secTopR = 29.2;       // 上端幅 約58.4m（外側に約7度開く）

  for (let s = 0; s < 8; s++) {
    const secY = pagodaStartY + s * sectionTotalH;
    const isSec8 = s === 7; // 第8節（87F〜90F、内部に黄金ウィンド・ダンパーを格納）

    const secGroup = new THREE.Group();
    secGroup.position.y = secY;
    taipei101Group.add(secGroup);

    // 1) 逆テーパーW字断面のメインボディ（8フロア分）
    const bodyGeo = createLoftedSectionGeometry(
      secBottomR,
      secTopR,
      flareBodyH,
      0.22,
      1.0
    );
    const matToUse = isSec8 ? section8GlassMat : pagodaGlassMat;
    const bodyMesh = new THREE.Mesh(bodyGeo, matToUse);
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    secGroup.add(bodyMesh);

    // 2) 各節の上端のシルバーホワイト・コーニス（軒トリム）
    const corniceGeo = createLoftedSectionGeometry(
      secTopR + 0.35,
      secTopR + 0.55,
      1.05,
      0.22,
      1.0
    );
    const corniceMesh = new THREE.Mesh(corniceGeo, silverTrimMat);
    corniceMesh.position.y = flareBodyH - 0.2;
    secGroup.add(corniceMesh);

    // 夜景ライトアップ用：各節の上端をぐるりと囲むLEDライン
    const ledRimGeo = createLoftedSectionGeometry(
      secTopR + 0.48,
      secTopR + 0.48,
      0.55,
      0.22,
      1.0
    );
    const ledRimMesh = new THREE.Mesh(ledRimGeo, accentLightMat);
    ledRimMesh.position.y = flareBodyH + 0.85;
    secGroup.add(ledRimMesh);

    // 3) 次の節へつながる内側のくびれ（ネック・セットバック部）
    const upperNeckGeo = createLoftedSectionGeometry(
      secBottomR + 0.8,
      secBottomR + 0.3,
      neckRecessH,
      0.22,
      1.0
    );
    const upperNeckMesh = new THREE.Mesh(upperNeckGeo, darkJadeFrameMat);
    upperNeckMesh.position.y = flareBodyH;
    secGroup.add(upperNeckMesh);

    // 4) 各節の4面中央上端に輝く「如意（Ruyi / 双雲紋）」装飾（写真2枚目のT字クレスト）
    for (let f = 0; f < 4; f++) {
      const angle = (f * Math.PI) / 2;
      const ruyi = createRuyiCrestGroup(1.05);
      // 逆テーパー上端の主面位置に配置
      const ruyiDist = secTopR - 0.15;
      ruyi.position.set(
        Math.sin(angle) * ruyiDist,
        flareBodyH - 1.5,
        Math.cos(angle) * ruyiDist
      );
      ruyi.rotation.y = angle;
      secGroup.add(ruyi);
    }

    // 5) 四隅の段差ルーフキャップとコーナーブレース（立体感を高めるエッジ装飾）
    for (let c = 0; c < 4; c++) {
      const cAngle = (c * Math.PI) / 2 + Math.PI / 4;
      const cDist = secTopR * 0.92;
      const capBlockGeo = new THREE.BoxGeometry(4.2, 1.3, 4.2);
      const capBlock = new THREE.Mesh(capBlockGeo, silverTrimMat);
      capBlock.position.set(
        Math.sin(cAngle) * cDist,
        flareBodyH + 0.3,
        Math.cos(cAngle) * cDist
      );
      capBlock.rotation.y = cAngle;
      secGroup.add(capBlock);
    }
  }

  // --------------------------------------------------------------------------
  // 8-D. 第8節の内部：660トン 黄金ウィンド・ダンパー (Tuned Mass Damper)
  //      y = 352m 〜 380m (87F〜92F)
  // --------------------------------------------------------------------------
  const damperChamberGroup = new THREE.Group();
  damperChamberGroup.position.set(0, 366.0, 0);
  taipei101Group.add(damperChamberGroup);

  // 内部の吹き抜け空間を照らす暖色ポイントライト
  const damperLight = new THREE.PointLight(0xffcf6b, 2.2, 48);
  damperLight.position.set(0, 4, 0);
  damperChamberGroup.add(damperLight);

  // 周囲の展望回廊リング（88F・89F屋内展望フロアと4本のメガコラム内柱）
  const galleryRingGeo = new THREE.TorusGeometry(13.5, 1.2, 12, 36);
  galleryRingGeo.rotateX(Math.PI / 2);
  const galleryRing1 = new THREE.Mesh(galleryRingGeo, darkJadeFrameMat);
  galleryRing1.position.y = -5.5;
  const galleryRing2 = new THREE.Mesh(galleryRingGeo, darkJadeFrameMat);
  galleryRing2.position.y = 1.5;
  damperChamberGroup.add(galleryRing1, galleryRing2);

  // 揺れるダンパー球体＋吊り下げケーブルの親グループ（アニメーション用）
  const damperPendulumGroup = new THREE.Group();
  damperPendulumGroup.position.set(0, 12.0, 0); // 92Fの支点
  damperChamberGroup.add(damperPendulumGroup);

  // 41層の鋼板ディスクを積層した直径5.5m（視認性のため少し強調した半径4.6m）の黄金球体
  const damperBallGroup = new THREE.Group();
  damperBallGroup.position.set(0, -12.0, 0);
  damperPendulumGroup.add(damperBallGroup);

  const sphereRadius = 4.8;
  const numPlates = 19;
  for (let p = 0; p < numPlates; p++) {
    const frac = (p / (numPlates - 1)) * 2 - 1; // -1 to 1
    const plateY = frac * sphereRadius * 0.92;
    const rAtY = Math.sqrt(Math.max(0.05, 1 - frac * frac)) * sphereRadius;
    const plateH = (sphereRadius * 1.95) / numPlates;

    const plateGeo = new THREE.CylinderGeometry(rAtY, rAtY, plateH * 0.9, 32);
    const plateMesh = new THREE.Mesh(plateGeo, goldDamperMat);
    plateMesh.position.y = plateY;
    damperBallGroup.add(plateMesh);
  }

  // 赤道部のバンパーリング
  const bumperRingGeo = new THREE.TorusGeometry(sphereRadius + 0.35, 0.35, 12, 36);
  bumperRingGeo.rotateX(Math.PI / 2);
  const bumperRing = new THREE.Mesh(bumperRingGeo, silverTrimMat);
  damperBallGroup.add(bumperRing);

  // 8本の太い吊り下げスチールケーブル
  for (let c = 0; c < 8; c++) {
    const cAngle = (c * Math.PI) / 4;
    const cableGeo = new THREE.CylinderGeometry(0.18, 0.18, 12.5, 8);
    const cable = new THREE.Mesh(cableGeo, silverTrimMat);
    cable.position.set(
      Math.cos(cAngle) * 2.8,
      -6.0,
      Math.sin(cAngle) * 2.8
    );
    damperPendulumGroup.add(cable);
  }

  // 下部の油圧ダッシュポット（制振シリンダー群）
  const cradleGeo = new THREE.CylinderGeometry(3.8, 5.2, 2.5, 16);
  const cradle = new THREE.Mesh(cradleGeo, silverTrimMat);
  cradle.position.set(0, -8.5, 0);
  damperChamberGroup.add(cradle);

  // --------------------------------------------------------------------------
  // 8-E. 頂上部（91F展望台トランジション・92F〜101F細身タワー・円盤キャップ・尖塔508m）
  //      写真2枚目のシルエットとディテールを徹底再現 (y = 382m 〜 508m)
  // --------------------------------------------------------------------------
  // 1) 第8節屋上のトランジション台座（89F〜91F: y = 382m 〜 398m）
  // 写真2枚目を見ると、第8節の上端から内側に絞られた上すぼまりの台形屋根＋4面の中央クレストがある
  const transY = 382.0;
  const transH = 16.0;
  const transGeo = createLoftedSectionGeometry(19.6, 15.6, transH, 0.20, 0.6);
  const transMesh = new THREE.Mesh(transGeo, pagodaGlassMat);
  transMesh.position.y = transY;
  taipei101Group.add(transMesh);

  // トランジション部の四隅の太いシルバー斜めストラット（写真2枚目の斜めの白い稜線）
  for (let i = 0; i < 4; i++) {
    const cAngle = (i * Math.PI) / 2 + Math.PI / 4;
    const strutGeo = new THREE.BoxGeometry(2.2, transH + 1.5, 2.8);
    const strut = new THREE.Mesh(strutGeo, silverTrimMat);
    strut.position.set(
      Math.sin(cAngle) * 16.8,
      transY + transH / 2,
      Math.cos(cAngle) * 16.8
    );
    strut.rotation.y = cAngle;
    strut.rotation.x = -0.22;
    taipei101Group.add(strut);

    // 4面中央のアーチ・如意クレスト＆白色通信アンテナ
    const fAngle = (i * Math.PI) / 2;
    const topRuyi = createRuyiCrestGroup(0.72);
    topRuyi.position.set(
      Math.sin(fAngle) * 16.2,
      transY + transH - 2.5,
      Math.cos(fAngle) * 16.2
    );
    topRuyi.rotation.y = fAngle;
    taipei101Group.add(topRuyi);
  }

  // 91階屋外展望デッキのコーニス＆安全フェンス（y = 398m）
  const deckGeo = createLoftedSectionGeometry(16.6, 16.8, 1.6, 0.20, 0.5);
  const deckMesh = new THREE.Mesh(deckGeo, silverTrimMat);
  deckMesh.position.y = transY + transH;
  taipei101Group.add(deckMesh);

  // 2) 92F〜101F 上部細身タワー（ピナクル基部: y = 399.6m 〜 434.0m）
  // 写真2枚目をよく見ると、この細身タワー自体も「下すぼまり・上広がり」の逆テーパー角柱になっている！
  const pinnacleY = 399.6;
  const pinnacleH = 34.4;
  const pinBotR = 9.4;
  const pinTopR = 11.4; // 上に向かってわずかに広がる

  const pinnacleGeo = createLoftedSectionGeometry(
    pinBotR,
    pinTopR,
    pinnacleH,
    0.18,
    0.5
  );
  const pinnacleMesh = new THREE.Mesh(pinnacleGeo, upperTowerMat);
  pinnacleMesh.position.y = pinnacleY;
  pinnacleMesh.castShadow = true;
  taipei101Group.add(pinnacleMesh);

  // 細身タワー途中の水平リング帯（写真2枚目の細身タワーにある水平の節ライン）
  [0.33, 0.66, 0.92].forEach((ratio) => {
    const ry = pinnacleY + pinnacleH * ratio;
    const rr = pinBotR * (1 - ratio) + pinTopR * ratio + 0.25;
    const pRingGeo = createLoftedSectionGeometry(rr, rr, 0.9, 0.18, 0.5);
    const pRing = new THREE.Mesh(pRingGeo, silverTrimMat);
    pRing.position.y = ry;
    taipei101Group.add(pRing);
  });

  // 101階頂部の大きく張り出したコーニス（軒: y = 434m）
  const crownCorniceGeo = createLoftedSectionGeometry(
    pinTopR + 0.9,
    pinTopR + 1.4,
    2.2,
    0.18,
    0.5
  );
  const crownCornice = new THREE.Mesh(crownCorniceGeo, silverTrimMat);
  crownCornice.position.y = pinnacleY + pinnacleH - 0.5;
  taipei101Group.add(crownCornice);

  // 細身タワー上端の4面にも小さな如意クレスト
  for (let i = 0; i < 4; i++) {
    const fAngle = (i * Math.PI) / 2;
    const miniRuyi = createRuyiCrestGroup(0.48);
    miniRuyi.position.set(
      Math.sin(fAngle) * (pinTopR + 0.5),
      pinnacleY + pinnacleH - 1.2,
      Math.cos(fAngle) * (pinTopR + 0.5)
    );
    miniRuyi.rotation.y = fAngle;
    taipei101Group.add(miniRuyi);
  }

  // 細身タワー上端のライトアップリング
  const crownLightGeo = createLoftedSectionGeometry(
    pinTopR + 1.2,
    pinTopR + 1.2,
    0.7,
    0.18,
    0.5
  );
  const crownLight = new THREE.Mesh(crownLightGeo, accentLightMat);
  crownLight.position.y = pinnacleY + pinnacleH + 1.6;
  taipei101Group.add(crownLight);

  // 3) ペントハウス段差台座 ＆ 円盤ソーサーキャップ（y = 436m 〜 449.2m）
  // 写真2枚目で尖塔のすぐ根元にある2段の四角い台座と、横に張り出した白い円盤（皿状リング）
  const ped1Geo = createLoftedSectionGeometry(7.2, 6.8, 7.0, 0.16, 0.4);
  const ped1 = new THREE.Mesh(ped1Geo, darkJadeFrameMat);
  ped1.position.y = 436.0;
  taipei101Group.add(ped1);

  const ped2Geo = createLoftedSectionGeometry(5.2, 4.6, 5.2, 0.15, 0.4);
  const ped2 = new THREE.Mesh(ped2Geo, silverTrimMat);
  ped2.position.y = 443.0;
  taipei101Group.add(ped2);

  // 特徴的な円盤状ソーサーキャップ（y = 447.5m）
  const saucerGroup = new THREE.Group();
  saucerGroup.position.y = 447.5;
  taipei101Group.add(saucerGroup);

  const saucerBotGeo = new THREE.CylinderGeometry(6.8, 3.8, 1.4, 32);
  const saucerBot = new THREE.Mesh(saucerBotGeo, silverTrimMat);
  saucerGroup.add(saucerBot);

  const saucerRimGeo = new THREE.CylinderGeometry(7.2, 6.8, 0.7, 32);
  saucerRimGeo.translate(0, 1.0, 0);
  const saucerRim = new THREE.Mesh(saucerRimGeo, spireMat);
  saucerGroup.add(saucerRim);

  const saucerGlowGeo = new THREE.CylinderGeometry(7.0, 7.0, 0.45, 32);
  saucerGlowGeo.translate(0, 0.5, 0);
  const saucerGlow = new THREE.Mesh(saucerGlowGeo, accentLightMat);
  saucerGroup.add(saucerGlow);

  // 4) 先端スパイア（尖塔: y = 449.2m 〜 508.0m、高さ約58.8m）
  // 写真2枚目の通り、等間隔に水平のフランジリング（節）が刻まれた白銀の尖塔
  const spireStartY = 449.0;
  const spireTotalH = 59.0; // 449 + 59 = 508.0m

  // スパイア下部シャフト
  const spireLowerGeo = new THREE.CylinderGeometry(1.75, 2.45, 26.0, 24);
  spireLowerGeo.translate(0, 13.0, 0);
  const spireLower = new THREE.Mesh(spireLowerGeo, spireMat);
  spireLower.position.y = spireStartY;
  taipei101Group.add(spireLower);

  // スパイア上部シャフト
  const spireUpperGeo = new THREE.CylinderGeometry(0.42, 1.65, 33.0, 24);
  spireUpperGeo.translate(0, 16.5, 0);
  const spireUpper = new THREE.Mesh(spireUpperGeo, spireMat);
  spireUpper.position.y = spireStartY + 26.0;
  taipei101Group.add(spireUpper);

  // スパイアに刻まれた15段の水平リング（写真2枚目のギザギザの節）
  const numSpireRings = 15;
  for (let r = 0; r < numSpireRings; r++) {
    const frac = r / numSpireRings;
    const ry = spireStartY + 3.5 + frac * (spireTotalH - 5.0);
    const radiusAtY = (1 - frac) * 2.55 + frac * 0.85;
    const sRingGeo = new THREE.CylinderGeometry(
      radiusAtY,
      radiusAtY * 0.92,
      0.75,
      24
    );
    const sRing = new THREE.Mesh(sRingGeo, silverTrimMat);
    sRing.position.y = ry;
    taipei101Group.add(sRing);
  }

  // 最頂部（508.0m）の航空障害灯ビーコン（赤色点滅）
  const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff2a2a });
  const beaconGeo = new THREE.SphereGeometry(0.9, 16, 16);
  const beaconMesh = new THREE.Mesh(beaconGeo, beaconMat);
  beaconMesh.position.y = 508.0;
  taipei101Group.add(beaconMesh);

  // ============================================================================
  // 9. 周辺環境：台北101モール（裙楼）・台北南山広場（写真1の右のビル）・信義区街並み・象山ビュー
  // ============================================================================
  const cityGroup = new THREE.Group();
  scene.add(cityGroup);

  // 9-A. 地面・道路グリッド基盤
  const groundGeo = new THREE.CircleGeometry(3200, 64);
  groundGeo.rotateX(-Math.PI / 2);
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x3b484c,
    roughness: 0.92,
    metalness: 0.05,
  });
  const groundMesh = new THREE.Mesh(groundGeo, groundMat);
  groundMesh.position.y = -0.2;
  groundMesh.receiveShadow = true;
  cityGroup.add(groundMesh);

  // 台北101足元のプラザ舗装
  const plazaGeo = new THREE.BoxGeometry(230, 0.8, 220);
  const plazaMat = new THREE.MeshStandardMaterial({
    color: 0x7c8b90,
    roughness: 0.75,
  });
  const plazaMesh = new THREE.Mesh(plazaGeo, plazaMat);
  plazaMesh.position.set(35, 0.2, 0);
  plazaMesh.receiveShadow = true;
  cityGroup.add(plazaMesh);

  // 9-B. 台北101ショッピングモール（タワー東側に隣接する裙楼・アーチ型ガラス屋根）
  const mallGroup = new THREE.Group();
  mallGroup.position.set(78, 0, 0);
  cityGroup.add(mallGroup);

  const mallBodyGeo = new THREE.BoxGeometry(74, 34, 118);
  const mallBodyMat = new THREE.MeshStandardMaterial({
    color: 0x4b6a70,
    roughness: 0.45,
    metalness: 0.35,
  });
  const mallBody = new THREE.Mesh(mallBodyGeo, mallBodyMat);
  mallBody.position.y = 17;
  mallBody.castShadow = true;
  mallBody.receiveShadow = true;
  mallGroup.add(mallBody);

  // モール屋上の特徴的なかまぼこ型スカイライト屋根
  const skylightGeo = new THREE.CylinderGeometry(16, 16, 112, 20, 1, false, 0, Math.PI);
  skylightGeo.rotateX(Math.PI / 2);
  const skylight = new THREE.Mesh(skylightGeo, silverTrimMat);
  skylight.position.y = 34;
  mallGroup.add(skylight);

  // 9-C. 写真1枚目の右側にそびえる「台北南山広場 (Taipei Nan Shan Plaza: 高さ272m)」
  // 写真1枚目を見ると、台北101の右側に、頂部が斜めにカットされ、中央に縦のスリットが入った濃紺〜青黒色の特徴的な超高層ビルが写っている！
  const nanshanGroup = new THREE.Group();
  nanshanGroup.position.set(225, 0, -45); // 写真1枚目の構図と一致する位置
  cityGroup.add(nanshanGroup);

  const nanshanH = 272.0;
  // 合掌型のテーパー断面をカスタム頂点で表現
  const nanBotW = 34;
  const nanTopW = 25;
  const nanGeo = new THREE.CylinderGeometry(nanTopW, nanBotW, nanshanH, 6);
  nanGeo.scale(1.15, 1.0, 0.72);
  const nanMat = new THREE.MeshStandardMaterial({
    map: baseTex.colorTex,
    color: 0x5c7f99,
    metalness: 0.62,
    roughness: 0.22,
    emissiveMap: baseTex.emiTex,
    emissive: new THREE.Color(0x99ccff),
    emissiveIntensity: 0.0,
  });
  glassMaterials.push(nanMat);

  const nanshanMesh = new THREE.Mesh(nanGeo, nanMat);
  nanshanMesh.position.y = nanshanH / 2;
  nanshanMesh.castShadow = true;
  nanshanMesh.receiveShadow = true;
  nanshanGroup.add(nanshanMesh);

  // 台北南山広場の頂部トラスフレームと中央の白い縦スパイン（写真1枚目の特徴）
  const nanSpineGeo = new THREE.BoxGeometry(2.2, nanshanH + 4, 38);
  const nanSpine = new THREE.Mesh(nanSpineGeo, silverTrimMat);
  nanSpine.position.y = nanshanH / 2;
  nanshanGroup.add(nanSpine);

  const nanCrownGeo = new THREE.BoxGeometry(38, 28, 26);
  const nanCrownMat = new THREE.MeshStandardMaterial({
    color: 0x3b586e,
    metalness: 0.5,
    roughness: 0.3,
    wireframe: false,
  });
  const nanCrown = new THREE.Mesh(nanCrownGeo, nanCrownMat);
  nanCrown.position.y = nanshanH - 12;
  nanshanGroup.add(nanCrown);

  // 9-D. 周囲の信義区ビル群（写真1枚目の手前や左右に見える白いビル・ベージュのマンション群・オフィス街）
  function createCityBuildings() {
    const bldgConfigs = [
      // 左側の四角いベージュのビル（写真1枚目の左端：国泰金融センター等）
      { x: -165, z: -30, w: 48, d: 36, h: 138, color: 0xc8beae },
      // 台北101と南山広場の間の手前の中層ビル群（写真1枚目の中央下）
      { x: 52, z: 120, w: 34, d: 34, h: 112, color: 0x7b7872 },
      { x: 15, z: 105, w: 58, d: 28, h: 68, color: 0xd8e4ec },
      { x: 145, z: 95, w: 42, d: 34, h: 105, color: 0xd4c8b4 },
      { x: 205, z: 105, w: 44, d: 34, h: 102, color: 0xd4c8b4 },
      // 右側の白い高層ビルと茶色いタワー群（写真1枚目の右端）
      { x: 310, z: 55, w: 44, d: 36, h: 148, color: 0xf0f4f8 },
      { x: 385, z: 35, w: 54, d: 44, h: 175, color: 0xc4b8a2 },
      { x: 340, z: -70, w: 46, d: 46, h: 195, color: 0x9aa6b0 },
      { x: 380, z: 110, w: 42, d: 38, h: 115, color: 0x8e867c },
      // 手前左下のマンション群（写真1枚目の左下）
      { x: -95, z: 175, w: 32, d: 28, h: 78, color: 0xaba296 },
      { x: -45, z: 185, w: 30, d: 28, h: 74, color: 0xb8b0a4 },
      { x: 12, z: 190, w: 40, d: 28, h: 66, color: 0xdce2e6 },
      { x: 65, z: 195, w: 44, d: 28, h: 62, color: 0xb2aba0 },
    ];

    // さらに周囲にランダムな街区ビルを配置して奥行きを出す
    let s = 42;
    function r() {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    }
    for (let i = 0; i < 85; i++) {
      const angle = r() * Math.PI * 2;
      const dist = 240 + r() * 950;
      const bx = Math.cos(angle) * dist;
      const bz = Math.sin(angle) * dist;
      // カメラの手前（象山側）の視界を塞がないように調整
      if (bz > 230 && Math.abs(bx - 100) < 260) continue;

      const palette = [0xc8c2b8, 0x9eb0bc, 0xd8e0e6, 0x7c8c96, 0xb8aa98];
      bldgConfigs.push({
        x: bx,
        z: bz,
        w: 22 + r() * 34,
        d: 22 + r() * 34,
        h: 28 + r() * 95,
        color: palette[Math.floor(r() * palette.length)],
      });
    }

    bldgConfigs.forEach((b) => {
      const geo = new THREE.BoxGeometry(b.w, b.h, b.d);
      const mat = new THREE.MeshStandardMaterial({
        color: b.color,
        roughness: 0.65,
        metalness: 0.18,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(b.x, b.h / 2, b.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      cityGroup.add(mesh);
    });
  }
  createCityBuildings();

  // 9-E. 背景の台北盆地の山並み（写真1枚目・2枚目の背後に見える青い山脈シルエット）
  function createMountainRange() {
    const mountainMat = new THREE.MeshStandardMaterial({
      color: 0x5c84a6,
      roughness: 0.95,
      metalness: 0.0,
      flatShading: true,
    });

    const peaks = [
      { x: -650, z: -1350, r: 480, h: 250 },
      { x: -180, z: -1450, r: 520, h: 270 },
      { x: 420, z: -1400, r: 580, h: 295 },
      { x: 1050, z: -1250, r: 520, h: 240 },
      { x: -1150, z: -1050, r: 460, h: 210 },
    ];
    peaks.forEach((p) => {
      const mGeo = new THREE.ConeGeometry(p.r, p.h, 9);
      mGeo.scale(1.6, 1.0, 0.8);
      const mMesh = new THREE.Mesh(mGeo, mountainMat);
      mMesh.position.set(p.x, p.h / 2 - 10, p.z);
      cityGroup.add(mMesh);
    });
  }
  createMountainRange();

  // 9-F. 写真1枚目の「象山（Xiangshan）展望台の手すりと手前の森」オブジェクト
  // （普段は遠くにあるので邪魔にならず、「象山展望台（写真1再現）」ボタンを押すとまさに写真1の構図になる！）
  const xiangshanPoint = new THREE.Group();
  xiangshanPoint.position.set(95, 165, 580);
  cityGroup.add(xiangshanPoint);

  // 手前の緑の樹冠（森）
  const foliageMat = new THREE.MeshStandardMaterial({
    color: 0x2d4c22,
    roughness: 0.9,
    flatShading: true,
  });
  for (let t = 0; t < 28; t++) {
    const treeR = 14 + (t % 5) * 5;
    const treeGeo = new THREE.DodecahedronGeometry(treeR, 1);
    const tree = new THREE.Mesh(treeGeo, foliageMat);
    tree.position.set(
      (t - 14) * 9.5,
      -26 - (t % 4) * 4 + (t * 0.4),
      -35 - (t % 3) * 14
    );
    xiangshanPoint.add(tree);
  }

  // 写真1枚目の手前に写っている黒い鉄製の手すり（斜めの展望デッキ欄干）
  const railMat = new THREE.MeshStandardMaterial({
    color: 0x151c22,
    metalness: 0.7,
    roughness: 0.35,
  });
  const railGroup = new THREE.Group();
  railGroup.position.set(0, -3.2, -11.5);
  railGroup.rotation.y = -0.08;
  railGroup.rotation.z = 0.045; // 写真1枚目と同じく左から右へ少し上がる角度
  xiangshanPoint.add(railGroup);

  const topRailGeo = new THREE.BoxGeometry(22, 0.42, 0.55);
  const topRail = new THREE.Mesh(topRailGeo, railMat);
  topRail.position.y = 1.6;
  railGroup.add(topRail);

  const midRailGeo = new THREE.BoxGeometry(22, 0.22, 0.3);
  const midRail1 = new THREE.Mesh(midRailGeo, railMat);
  midRail1.position.y = 0.4;
  const midRail2 = new THREE.Mesh(midRailGeo, railMat);
  midRail2.position.y = -0.8;
  railGroup.add(midRail1, midRail2);

  [-4.5, -1.2, 3.8].forEach((px) => {
    const postGeo = new THREE.BoxGeometry(0.35, 4.5, 0.35);
    const post = new THREE.Mesh(postGeo, railMat);
    post.position.set(px, -0.4, 0);
    railGroup.add(post);
  });

  // ============================================================================
  // 10. 建築部位アノテーション（3D空間に追従する解説ピン＆クリックでフォーカス）
  // ============================================================================
  const annotationData = [
    {
      id: "spire",
      num: "1",
      title: "尖塔 (Spire) 508.0m",
      desc: "約60mの白銀のスパイア。15段の水平フランジリングが刻まれ、根元には円盤状のソーサーキャップを備えています。",
      pos: new THREE.Vector3(0, 482, 0),
      camKey: "spire",
    },
    {
      id: "observatory",
      num: "2",
      title: "91F-101F 展望台＆上部タワー",
      desc: "第8節の上にそびえる逆テーパーの細身タワーと屋外展望台。四隅の斜めストラットと頂部コーニスが特徴です。",
      pos: new THREE.Vector3(14, 416, 14),
      camKey: "spire",
    },
    {
      id: "damper",
      num: "3",
      title: "黄金ウィンド・ダンパー (TMD)",
      desc: "87F〜92Fの内部に吊り下げられた直径5.5m・重さ660トンの制振球。強風や地震の揺れを最大40%軽減します。",
      pos: new THREE.Vector3(0, 366, 26),
      camKey: "damper",
    },
    {
      id: "pagoda",
      num: "4",
      title: "8節の「斗」＆如意 (Ruyi) 装飾",
      desc: "縁起の良い数字「8」にちなんだ8階建て×8節の逆台形モジュール。各節上端の中央には伝統的な双雲紋「如意」が輝きます。",
      pos: new THREE.Vector3(0, 282, 30),
      camKey: "ruyi",
    },
    {
      id: "coin",
      num: "5",
      title: "巨大古銭（方孔円銭）＆雲紋帯",
      desc: "24F〜27Fの4面に配置された直径約19mの古代銅銭モチーフ。中央に正方形の枠（方孔）を持ち、金融の繁栄を象徴します。",
      pos: new THREE.Vector3(0, 115, 28),
      camKey: "coin",
    },
    {
      id: "base",
      num: "6",
      title: "末広がりの基壇部（1F-26F）",
      desc: "耐震性と安定感を高める角錐台のベース。2組の水平ダブルルーバー帯と四隅の階段状コーナーピラーを備えています。",
      pos: new THREE.Vector3(-28, 56, 28),
      camKey: "low",
    },
  ];

  const annotationElements = [];
  annotationData.forEach((item) => {
    const el = document.createElement("div");
    el.className = "annotation-pin";
    el.innerHTML = `
      <span class="pin-dot">${item.num}</span>
      <span class="pin-label">${item.title}</span>
      <div class="annotation-tooltip">${item.desc}</div>
    `;
    el.addEventListener("click", () => {
      moveToPreset(item.camKey);
    });
    annotationsContainer.appendChild(el);
    annotationElements.push({ data: item, el });
  });

  // ============================================================================
  // 11. カメラプリセット＆スムーズトランジション制御
  // ============================================================================
  const cameraPresets = {
    // 写真2枚目（台北101の正面切り出し写真）を再現する望遠フレーミング
    photo2: {
      pos: new THREE.Vector3(95, 255, 640),
      target: new THREE.Vector3(0, 255, 0),
      fov: 40,
      xray: false,
    },
    // 写真1枚目（象山展望台からの手すり＆台北南山広場とのツーショット風景）を完全再現
    photo1: {
      pos: new THREE.Vector3(96, 166.2, 578),
      target: new THREE.Vector3(85, 215, 0),
      fov: 45,
      xray: false,
      forceCity: true,
    },
    // 足元からの迫力ある見上げローアングル
    low: {
      pos: new THREE.Vector3(-95, 22, 135),
      target: new THREE.Vector3(0, 220, 0),
      fov: 52,
      xray: false,
    },
    // 24F-27Fの巨大古銭と四隅の雲紋レリーフのクローズアップ
    coin: {
      pos: new THREE.Vector3(42, 112, 82),
      target: new THREE.Vector3(0, 115, 0),
      fov: 38,
      xray: false,
    },
    // 竹の節（逆テーパー・W字コーナー断面）と上端の如意（双雲紋）のクローズアップ
    ruyi: {
      pos: new THREE.Vector3(38, 272, 78),
      target: new THREE.Vector3(0, 280, 12),
      fov: 36,
      xray: false,
    },
    // 91F展望台・101F細身タワー・円盤ソーサー・508m尖塔のクローズアップ
    spire: {
      pos: new THREE.Vector3(65, 442, 110),
      target: new THREE.Vector3(0, 442, 0),
      fov: 38,
      xray: false,
    },
    // 87F-92Fの660t黄金ウィンド・ダンパーをシースルーで観察
    damper: {
      pos: new THREE.Vector3(36, 368, 62),
      target: new THREE.Vector3(0, 365, 0),
      fov: 38,
      xray: true,
    },
    // 真上から見下ろして台北101特有の「W字ステップコーナー断面」を確認
    top: {
      pos: new THREE.Vector3(0, 740, 25),
      target: new THREE.Vector3(0, 250, 0),
      fov: 42,
      xray: false,
    },
  };

  let camAnim = null;

  function moveToPreset(key) {
    const preset = cameraPresets[key];
    if (!preset) return;

    // ボタンのアクティブ状態を更新
    document.querySelectorAll(".preset-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.cam === key);
    });

    // 写真1プリセットなら街並み表示を自動でONにする
    if (preset.forceCity) {
      const cityChk = document.getElementById("toggle-city");
      if (!cityChk.checked) {
        cityChk.checked = true;
        cityGroup.visible = true;
      }
    }

    // ダンパープリセットなら自動で透視モードを切り替え
    const xrayChk = document.getElementById("toggle-xray");
    if (preset.xray !== undefined) {
      xrayChk.checked = preset.xray;
      updateGlassTransparency();
    }

    camAnim = {
      startPos: camera.position.clone(),
      endPos: preset.pos.clone(),
      startTarget: controls.target.clone(),
      endTarget: preset.target.clone(),
      startFov: camera.fov,
      endFov: preset.fov || 42,
      startTime: performance.now(),
      duration: 950,
    };
  }

  // ============================================================================
  // 12. UI イベントハンドラの登録（時間帯・曜日ライトアップ・透過度・トグル）
  // ============================================================================
  // カメラプリセットボタン
  document.querySelectorAll(".preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => moveToPreset(btn.dataset.cam));
  });

  // 太陽角度スライダー
  let currentTimeMode = "day";
  const sunSlider = document.getElementById("sun-angle");
  const sunVal = document.getElementById("sun-angle-val");

  function updateSunPosition() {
    const deg = parseFloat(sunSlider.value);
    sunVal.textContent = `${deg}°`;
    const rad = (deg * Math.PI) / 180;
    const radius = 450;
    const height = currentTimeMode === "sunset" ? 140 : 460;
    sunLight.position.set(
      Math.cos(rad) * radius,
      height,
      Math.sin(rad) * radius
    );
  }
  sunSlider.addEventListener("input", updateSunPosition);

  // 時間帯切り替え（昼・夕景・夜景）
  function setTimeMode(mode) {
    currentTimeMode = mode;
    document.querySelectorAll(".time-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.time === mode);
    });

    scene.environment = envTextures[mode];

    if (mode === "day") {
      scene.background.setHex(0x8ab8dc);
      scene.fog.color.setHex(0x9dc2df);
      hemiLight.color.setHex(0xdff0ff);
      hemiLight.groundColor.setHex(0x4b6268);
      hemiLight.intensity = 0.85;
      sunLight.color.setHex(0xfff9ee);
      sunLight.intensity = 1.45;
      fillLight.intensity = 0.45;
      glassMaterials.forEach((m) => (m.emissiveIntensity = 0.0));
      accentLightMat.emissiveIntensity = 0.0;
    } else if (mode === "sunset") {
      scene.background.setHex(0x4a3d5c);
      scene.fog.color.setHex(0xc87d65);
      hemiLight.color.setHex(0xffb07c);
      hemiLight.groundColor.setHex(0x2d2438);
      hemiLight.intensity = 0.65;
      sunLight.color.setHex(0xff8c42);
      sunLight.intensity = 1.6;
      fillLight.intensity = 0.25;
      glassMaterials.forEach((m) => (m.emissiveIntensity = 0.35));
      accentLightMat.emissiveIntensity = 0.8;
    } else if (mode === "night") {
      scene.background.setHex(0x07101c);
      scene.fog.color.setHex(0x091526);
      hemiLight.color.setHex(0x284878);
      hemiLight.groundColor.setHex(0x080d14);
      hemiLight.intensity = 0.32;
      sunLight.color.setHex(0x6b92c8);
      sunLight.intensity = 0.28;
      fillLight.intensity = 0.15;
      glassMaterials.forEach((m) => (m.emissiveIntensity = 1.15));
      accentLightMat.emissiveIntensity = 2.4;
    }
    updateSunPosition();
  }

  document.querySelectorAll(".time-btn").forEach((btn) => {
    btn.addEventListener("click", () => setTimeMode(btn.dataset.time));
  });

  // 曜日別ライトアップカラー切り替え（台北101は月〜日で赤・橙・黄・緑・青・藍・紫に変化）
  const dayColors = {
    mon: 0xff3b3b,
    tue: 0xff9500,
    wed: 0xffd60a,
    thu: 0x30d158,
    fri: 0x0a84ff,
    sat: 0x5e5ce6,
    sun: 0xbf5af2,
  };
  document.querySelectorAll(".color-pill").forEach((pill) => {
    pill.addEventListener("click", () => {
      document.querySelectorAll(".color-pill").forEach((p) => p.classList.remove("active"));
      pill.classList.add("active");
      const hex = dayColors[pill.dataset.day] || 0x30d158;
      accentLightMat.emissive.setHex(hex);
      // 昼間にカラーボタンを押した場合は自動で夜景モードに切り替えてライトアップを見せる
      if (currentTimeMode === "day") {
        setTimeMode("night");
      }
    });
  });

  // 外装ガラス不透明度スライダー＆ダンパーX-Rayトグル
  const opacitySlider = document.getElementById("glass-opacity");
  const opacityVal = document.getElementById("glass-opacity-val");
  const xrayCheckbox = document.getElementById("toggle-xray");

  function updateGlassTransparency() {
    const sliderOp = parseFloat(opacitySlider.value) / 100;
    opacityVal.textContent = `${Math.round(sliderOp * 100)}%`;
    const isXray = xrayCheckbox.checked;

    glassMaterials.forEach((mat) => {
      if (mat === section8GlassMat && isXray) {
        mat.transparent = true;
        mat.opacity = Math.min(sliderOp, 0.25);
        mat.depthWrite = false;
      } else if (sliderOp < 0.99) {
        mat.transparent = true;
        mat.opacity = sliderOp;
        mat.depthWrite = sliderOp > 0.7;
      } else {
        mat.transparent = false;
        mat.opacity = 1.0;
        mat.depthWrite = true;
      }
      mat.needsUpdate = true;
    });
  }

  opacitySlider.addEventListener("input", updateGlassTransparency);
  xrayCheckbox.addEventListener("change", updateGlassTransparency);

  // 周辺の街並み表示切り替え
  document.getElementById("toggle-city").addEventListener("change", (e) => {
    cityGroup.visible = e.target.checked;
  });

  // アノテーション（部位ラベル）表示切り替え
  let showAnnotations = true;
  document.getElementById("toggle-annotations").addEventListener("change", (e) => {
    showAnnotations = e.target.checked;
    annotationsContainer.style.display = showAnnotations ? "block" : "none";
  });

  // 自動回転
  document.getElementById("toggle-autorotate").addEventListener("change", (e) => {
    controls.autoRotate = e.target.checked;
    controls.autoRotateSpeed = 1.0;
  });

  // ワイヤーフレーム表示
  document.getElementById("toggle-wireframe").addEventListener("change", (e) => {
    const wf = e.target.checked;
    taipei101Group.traverse((obj) => {
      if (obj.isMesh && obj.material) {
        obj.material.wireframe = wf;
      }
    });
  });

  // パネル折りたたみボタン
  const togglePanelBtn = document.getElementById("toggle-panel-btn");
  const panelBody = document.getElementById("panel-body");
  togglePanelBtn.addEventListener("click", () => {
    const collapsed = panelBody.classList.toggle("collapsed");
    togglePanelBtn.textContent = collapsed ? "＋" : "−";
  });

  // ポリゴン数・メッシュ数の集計表示
  function updateModelStats() {
    let meshes = 0;
    let triangles = 0;
    scene.traverse((obj) => {
      if (obj.isMesh && obj.geometry) {
        meshes++;
        const geo = obj.geometry;
        if (geo.index) {
          triangles += geo.index.count / 3;
        } else if (geo.attributes.position) {
          triangles += geo.attributes.position.count / 3;
        }
      }
    });
    statsEl.textContent = `3Dオブジェクト数: ${meshes.toLocaleString()} | ポリゴン数: ${Math.round(
      triangles
    ).toLocaleString()} tris | 実寸スケール: 1 unit = 1m`;
  }
  updateModelStats();

  // ============================================================================
  // 13. アニメーションループ＆リサイズ処理
  // ============================================================================
  const tempVec = new THREE.Vector3();

  function animate(now) {
    requestAnimationFrame(animate);

    const t = now * 0.001;

    // 1) カメラプリセット移動の補間アニメーション
    if (camAnim) {
      const elapsed = now - camAnim.startTime;
      const p = Math.min(1.0, elapsed / camAnim.duration);
      // イーズイン・アウト (Cubic)
      const ease = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;

      camera.position.lerpVectors(camAnim.startPos, camAnim.endPos, ease);
      controls.target.lerpVectors(camAnim.startTarget, camAnim.endTarget, ease);
      camera.fov = camAnim.startFov + (camAnim.endFov - camAnim.startFov) * ease;
      camera.updateProjectionMatrix();

      if (p >= 1.0) {
        camAnim = null;
      }
    }

    // 2) 660トン黄金ウィンド・ダンパーのゆったりとした制振振り子運動
    damperPendulumGroup.rotation.z = Math.sin(t * 1.15) * 0.045;
    damperPendulumGroup.rotation.x = Math.cos(t * 0.85) * 0.032;

    // 3) 頂上508m航空障害灯の点滅
    const blink = (Math.sin(t * 3.5) + 1) * 0.5;
    beaconMat.color.setRGB(0.35 + blink * 0.65, 0.05, 0.05);

    controls.update();
    renderer.render(scene, camera);

    // 4) 3D空間アノテーションピンのスクリーン座標更新
    if (showAnnotations) {
      const halfW = window.innerWidth / 2;
      const halfH = window.innerHeight / 2;

      annotationElements.forEach(({ data, el }) => {
        tempVec.copy(data.pos);
        tempVec.project(camera);

        // カメラの背後にある場合は非表示
        if (tempVec.z > 1.0) {
          el.style.display = "none";
          return;
        }
        const sx = tempVec.x * halfW + halfW;
        const sy = -tempVec.y * halfH + halfH;

        if (
          sx < -50 ||
          sx > window.innerWidth + 50 ||
          sy < -50 ||
          sy > window.innerHeight + 50
        ) {
          el.style.display = "none";
        } else {
          el.style.display = "flex";
          el.style.left = `${sx}px`;
          el.style.top = `${sy}px`;
        }
      });
    }
  }

  requestAnimationFrame(animate);

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
})();
