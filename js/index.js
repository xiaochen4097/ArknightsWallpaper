export const controlSpin = (status) => {
    const dom = document.querySelector("#spinWrapper");
    if (dom) {
        dom.style.display = status === "close" ? "none" : "flex";
    }
};


let bgTexture = null;
let bgProgram = null;
let bgPositionBuffer = null;
let bgTexCoordBuffer = null;
let bgImageBaseW = 1;
let bgImageBaseH = 1;

// 背景图的手动位置偏移量（相对于骨骼包围盒中心的位置微调，单位为像素级/Spine内的世界坐标单位）
let bgOffsetX = 90;
let bgOffsetY = 50;

function loadWebGLBackground(gl, imageUrl) {
    // 1. Compile a simple shader just for the background
    const vsSource = `
        attribute vec2 a_position;
        attribute vec2 a_texCoord;
        uniform mat4 u_mvp;
        uniform vec2 u_center;
        uniform vec2 u_size;
        varying vec2 v_texCoord;
        void main() {
            // 将 -1 到 1 的位置转换到世界坐标的真实图像尺寸和中心点
            vec2 pos = a_position * u_size + u_center;
            gl_Position = u_mvp * vec4(pos, 0.0, 1.0);
            v_texCoord = vec2(a_texCoord.x, 1.0 - a_texCoord.y); // Flip Y for WebGL
        }
    `;
    const fsSource = `
        precision mediump float;
        varying vec2 v_texCoord;
        uniform sampler2D u_image;
        void main() {
            gl_FragColor = texture2D(u_image, v_texCoord);
        }
    `;

    const compileShader = (type, source) => {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        return shader;
    };

    const vs = compileShader(gl.VERTEX_SHADER, vsSource);
    const fs = compileShader(gl.FRAGMENT_SHADER, fsSource);

    bgProgram = gl.createProgram();
    gl.attachShader(bgProgram, vs);
    gl.attachShader(bgProgram, fs);
    gl.linkProgram(bgProgram);

    // 2. Define a full-screen quad (two triangles)
    const positions = new Float32Array([
        -1.0, -1.0,   1.0, -1.0,  -1.0,  1.0,
        -1.0,  1.0,   1.0, -1.0,   1.0,  1.0,
    ]);
    bgPositionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, bgPositionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    const texCoords = new Float32Array([
        0.0, 0.0,   1.0, 0.0,   0.0, 1.0,
        0.0, 1.0,   1.0, 0.0,   1.0, 1.0,
    ]);
    bgTexCoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, bgTexCoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);

    // 3. Load the image and map it to a WebGL texture
    const image = new Image();
    image.crossOrigin = "anonymous"; // Important if loading from another domain
    image.src = imageUrl;
    image.onload = () => {
        bgImageBaseW = image.width || 1;
        bgImageBaseH = image.height || 1;
        bgTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, bgTexture);
        // Clamp to edge to support non-power-of-two images
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    };
}

function drawWebGLBackground(gl) {
    if (!bgTexture || !bgProgram) return; // Wait until image loads

    gl.useProgram(bgProgram);

    // 将骨骼的 MVP 矩阵传递给背景，使其与骨骼缩放完全同步在同一个世界坐标系
    const mvpLocation = gl.getUniformLocation(bgProgram, "u_mvp");
    gl.uniformMatrix4fv(mvpLocation, false, mvp.values);

    // 背景图位置：对齐在包围盒中心，并加上自定义位置偏移量 bgOffsetX/bgOffsetY
    let cx = bgOffsetX, cy = bgOffsetY;
    if (typeof spineboy !== 'undefined' && spineboy?.bounds) {
        const offset = spineboy.bounds.offset;
        const size = spineboy.bounds.size;
        cx += offset.x + size.x / 2;
        cy += offset.y + size.y / 2;
    }
    const centerLocation = gl.getUniformLocation(bgProgram, "u_center");
    gl.uniform2f(centerLocation, cx, cy);

    // a_position 的值是从 -1.0 到 1.0 (总跨度为2), 所以尺寸这里传真实图片宽高的 1/2
    const sizeLocation = gl.getUniformLocation(bgProgram, "u_size");
    gl.uniform2f(sizeLocation, bgImageBaseW / 2, bgImageBaseH / 2);

    // Bind positions
    const positionLocation = gl.getAttribLocation(bgProgram, "a_position");
    gl.enableVertexAttribArray(positionLocation);
    gl.bindBuffer(gl.ARRAY_BUFFER, bgPositionBuffer);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    // Bind texture coordinates
    const texCoordLocation = gl.getAttribLocation(bgProgram, "a_texCoord");
    gl.enableVertexAttribArray(texCoordLocation);
    gl.bindBuffer(gl.ARRAY_BUFFER, bgTexCoordBuffer);
    gl.vertexAttribPointer(texCoordLocation, 2, gl.FLOAT, false, 0, 0);

    // Bind texture
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, bgTexture);
    gl.uniform1i(gl.getUniformLocation(bgProgram, "u_image"), 0);

    // Draw the background quad
    gl.drawArrays(gl.TRIANGLES, 0, 6);
}

let canvas;
let gl;
let shader;
let batcher;
let mvp = new spine.webgl.Matrix4();
let assetManager;
let skeletonRenderer;

let lastFrameTime;
let spineboy;

let dir = "Ark-Models/models/2025_shu_nian#11/";
let skelFile = "build_char_2025_shu_nian#11.skel";
let atlasFile = "build_char_2025_shu_nian#11.atlas";

// 设置居中基准（历史兼容参数）。默认 1 表示严格按包围盒中心居中。
// 如某些模型需要微调，可在 init 里传 positionBaseValX/Y（不推荐用大于 1 的默认值，否则会导致“看起来不居中”）
let positionBaseValX = 1;
let positionBaseValY = 1;

let dpr = window.devicePixelRatio;
// 额外超采样倍率：仅提升 canvas 后备缓冲分辨率，不改变视觉尺寸（默认温和一点）
let supersample = 1.25;
// 视野缩放：控制"视觉大小"。默认用 dpr，让高分屏下视觉尺寸更接近旧版（不至于过大）。
let viewScale;

// 是否自动缩放以完整显示模型（皮肤立绘专用）。默认 false 保持首页逻辑不变。
let fitToCanvas = false;

let AnimaName = "";

const AUTO_CYCLE_ANIMATIONS = ["Idle", "Special"];
const INTERACTIVE_ANIMATION = "Interact";
let autoCycleQueue = [];
let autoCycleIndex = 0;
let isInteractivePlaying = false;
let shouldAutoCycle = false;
let isCycleAnimationPlaying = false;
let hasPendingInteractiveRequest = false;

// 缓存画布尺寸，避免每帧都触发实际 resize（更省性能，也更稳定）
let lastCanvasW = 0;
let lastCanvasH = 0;

const onCanvasPointerDown = () => {
    playInteractiveAnimation();
};

export function init(params) {
    // 设置默认值
    if (params) {
        dir = params.dir || dir;
        skelFile = params.skelFile || skelFile;
        atlasFile = params.atlasFile || atlasFile;
        positionBaseValX = params.positionBaseValX || positionBaseValX;
        positionBaseValY = params.positionBaseValY || positionBaseValY;
        dpr = params.dpr || dpr;
        supersample = params.supersample ?? supersample;
        viewScale = params.viewScale ?? viewScale;
        fitToCanvas = params.fitToCanvas ?? fitToCanvas;
        AnimaName = params.animaName;
        bgOffsetX = params.bgOffsetX ?? bgOffsetX;
        bgOffsetY = params.bgOffsetY ?? bgOffsetY;
    }
    // Setup canvas and WebGL context. We pass alpha: false to canvas.getContext() so we don't use premultiplied alpha when
    // loading textures. That is handled separately by PolygonBatcher.
    canvas = document.getElementById("canvas");
    autoCycleQueue = [];
    autoCycleIndex = 0;
    canvas.removeEventListener("pointerdown", onCanvasPointerDown);
    canvas.addEventListener("pointerdown", onCanvasPointerDown);
    let config = { alpha: true };
    gl = canvas.getContext("webgl", config) || canvas.getContext("experimental-webgl", config);
    if (!gl) {
        alert("WebGL is unavailable.");
        return;
    }

    loadWebGLBackground(gl, "./dyn_illust_char_1028_texas2_bg.png");


    // Create a simple shader, mesh, model-view-projection matrix, SkeletonRenderer, and AssetManager.
    shader = spine.webgl.Shader.newTwoColoredTextured(gl);
    batcher = new spine.webgl.PolygonBatcher(gl);
    mvp.ortho2d(0, 0, canvas.width - 1, canvas.height - 1);
    skeletonRenderer = new spine.webgl.SkeletonRenderer(gl);
    assetManager = new spine.webgl.AssetManager(gl);

    // Tell AssetManager to load the resources for each skeleton, including the exported .skel file, the .atlas file and the .png
    // file for the atlas. We then wait until all resources are loaded in the load() method.
    const isSkel = skelFile.includes(".skel");
    if (isSkel) {
        assetManager.loadBinary(`${dir}${skelFile}`);
    } else {
        assetManager.loadText(`${dir}${skelFile}`);
    }
    assetManager.loadTextureAtlas(`${dir}${atlasFile}`);
    requestAnimationFrame(load);
}

function hasAnimation(skeletonData, animationName) {
    return Boolean(skeletonData?.findAnimation(animationName));
}

function getPlayableAnimationName(skeletonData, preferredName) {
    if (preferredName && hasAnimation(skeletonData, preferredName)) {
        return preferredName;
    }
    const firstAnimation = skeletonData?.animations?.[0]?.name;
    return firstAnimation || null;
}

function scheduleNextAutoCycle(state) {
    if (!state || autoCycleQueue.length === 0) return;
    const animationName = autoCycleQueue[autoCycleIndex % autoCycleQueue.length];
    autoCycleIndex = (autoCycleIndex + 1) % autoCycleQueue.length;
    isCycleAnimationPlaying = true;
    state.setAnimation(0, animationName, false);
}

function playInteractiveAnimation() {
    if (!spineboy?.state || !spineboy?.skeleton?.data) {
        return;
    }
    if (isInteractivePlaying) {
        return;
    }
    const skeletonData = spineboy.skeleton.data;
    if (!hasAnimation(skeletonData, INTERACTIVE_ANIMATION)) {
        return;
    }

    // 自动轮播段（Idle/Special）播放期间不打断，记录为待执行交互请求。
    if (shouldAutoCycle && isCycleAnimationPlaying) {
        hasPendingInteractiveRequest = true;
        return;
    }

    hasPendingInteractiveRequest = false;
    isInteractivePlaying = true;
    spineboy.state.setAnimation(0, INTERACTIVE_ANIMATION, false);
}

async function load(animaName = "Move") {
    console.log("调试animaName", animaName);
    // Wait until the AssetManager has loaded all resources, then load the skeletons.
    try {
        if (assetManager.isLoadingComplete()) {
            spineboy = await loadSpineboy(typeof animaName === "string" ? animaName : AnimaName || "Move", true);
            controlSpin("close");
            lastFrameTime = Date.now() / 1000;
            requestAnimationFrame(render); // Loading is done, call render every frame.
        } else {
            requestAnimationFrame(load);
        }
    } catch (error) {
        controlSpin(false);
        console.log("加载资源错误", error);
    }
}
// 自定义逻辑
const renderBtn = (actionNameArr) => {
    const btnPanel = document.querySelector("#panel");
    if (btnPanel) {
        btnPanel.innerHTML = "";
        actionNameArr.forEach((item) => {
            const btn = document.createElement("button");
            btn.textContent = item;
            btn.addEventListener("click", () => {
                window.load(item);
            });
            btnPanel.appendChild(btn);
        });
    }
};

function loadSpineboy(initialAnimation, premultipliedAlpha) {
    // Load the texture atlas from the AssetManager.
    let atlas = assetManager.get(`${dir}${atlasFile}`);

    // Create a AtlasAttachmentLoader that resolves region, mesh, boundingbox and path attachments
    let atlasLoader = new spine.AtlasAttachmentLoader(atlas);

    // Create a SkeletonBinary instance for parsing the .skel file.
    let skeletonBinary = new spine.SkeletonBinary(atlasLoader);

    // Set the scale to apply during parsing, parse the file, and create a new skeleton.
    skeletonBinary.scale = 1;
    let skeletonData;
    // 区分是否是skel
    if (skelFile.includes(".skel")) {
        skeletonData = skeletonBinary.readSkeletonData(assetManager.get(`${dir}${skelFile}`));
    } else {
        var skeletonJson = new spine.SkeletonJson(atlasLoader);
        skeletonData = skeletonJson.readSkeletonData(assetManager.get(`${dir}${skelFile}`));
    }

    let skeleton = new spine.Skeleton(skeletonData);
    let bounds = calculateSetupPoseBounds(skeleton);

    // Create an AnimationState, and set the initial animation in looping mode.
    let animationStateData = new spine.AnimationStateData(skeleton.data);
    let animationState = new spine.AnimationState(animationStateData);
    autoCycleQueue = AUTO_CYCLE_ANIMATIONS.filter((name) => hasAnimation(skeletonData, name));
    autoCycleIndex = 0;
    isInteractivePlaying = false;
    isCycleAnimationPlaying = false;
    hasPendingInteractiveRequest = false;

    const preferredAnimation = typeof initialAnimation === "string" ? initialAnimation : "";
    const useAutoCycle = preferredAnimation === "" || preferredAnimation === "Move";
    shouldAutoCycle = useAutoCycle && autoCycleQueue.length > 0;

    animationState.addListener({
        complete: (entry) => {
            if (entry?.trackIndex !== 0) return;
            const currentAnimationName = entry?.animation?.name;

            if (currentAnimationName === INTERACTIVE_ANIMATION) {
                isInteractivePlaying = false;
                if (shouldAutoCycle) {
                    scheduleNextAutoCycle(animationState);
                }
                return;
            }

            if (AUTO_CYCLE_ANIMATIONS.includes(currentAnimationName)) {
                isCycleAnimationPlaying = false;
                if (hasPendingInteractiveRequest && hasAnimation(skeletonData, INTERACTIVE_ANIMATION)) {
                    hasPendingInteractiveRequest = false;
                    isInteractivePlaying = true;
                    animationState.setAnimation(0, INTERACTIVE_ANIMATION, false);
                    return;
                }
            }

            if (shouldAutoCycle && !isInteractivePlaying) {
                scheduleNextAutoCycle(animationState);
            }
        },
    });

    if (shouldAutoCycle) {
        scheduleNextAutoCycle(animationState);
    } else {
        const playableAnimation = getPlayableAnimationName(skeletonData, preferredAnimation);
        if (playableAnimation) {
            animationState.setAnimation(0, playableAnimation, true);
        }
    }
    //   渲染动作按钮
    renderBtn(
        animationState.data.skeletonData.animations.reduce((total, item) => {
            if (item.name !== "Default") {
                total.push(item.name);
            }
            return total;
        }, [])
    );
    // Pack everything up and return to caller.
    return {
        skeleton: skeleton,
        state: animationState,
        bounds: bounds,
        premultipliedAlpha: premultipliedAlpha,
    };
}

function calculateSetupPoseBounds(skeleton) {
    skeleton.setToSetupPose();
    skeleton.updateWorldTransform();
    let offset = new spine.Vector2();
    let size = new spine.Vector2();
    skeleton.getBounds(offset, size, []);
    console.log("调试尺寸", size);
    return { offset: offset, size: size };
}

function render() {
    let now = Date.now() / 1000;
    let delta = now - lastFrameTime;
    lastFrameTime = now;

    // 先同步画布真实尺寸/viewport，避免 resize 发生在 clear 之后导致偶发残影
    syncCanvasSize();

    // Apply the animation state based on the delta time.
    let skeleton = spineboy.skeleton;
    let state = spineboy.state;
    let premultipliedAlpha = spineboy.premultipliedAlpha;
    state.update(delta);
    state.apply(skeleton);
    skeleton.updateWorldTransform();

    // 更新 viewport 与 MVP：始终以“当前帧包围盒中心”对齐到画布正中心
    updateMvpToCenter(skeleton);

    // 设置背景色
    // gl.clearColor(1, 1, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    drawWebGLBackground(gl);

    // Bind the shader and set the texture and model-view-projection matrix.
    shader.bind();
    shader.setUniformi(spine.webgl.Shader.SAMPLER, 0);
    shader.setUniform4x4f(spine.webgl.Shader.MVP_MATRIX, mvp.values);

    // Start the batch and tell the SkeletonRenderer to render the active skeleton.
    batcher.begin(shader);
    skeletonRenderer.premultipliedAlpha = premultipliedAlpha;
    skeletonRenderer.draw(batcher, skeleton);
    batcher.end();

    shader.unbind();

    requestAnimationFrame(render);
}
function syncCanvasSize() {
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    // 物理像素 = CSS 像素 * dpr * supersample（适当超采样提清晰度）
    const ss = Math.max(1, Math.min(2, Number(supersample) || 1));
    const scale = (Number(dpr) || 1) * ss;
    const nextW = Math.floor(cw * scale);
    const nextH = Math.floor(ch * scale);

    if (nextW === lastCanvasW && nextH === lastCanvasH) return;

    lastCanvasW = nextW;
    lastCanvasH = nextH;
    canvas.width = nextW;
    canvas.height = nextH;
    gl.viewport(0, 0, nextW, nextH);
}

function updateMvpToCenter(skeleton) {
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;

    // 使用初始 setup pose 的包围盒中心，避免动画过程中包围盒变化导致画面抖动
    const offset = spineboy.bounds.offset;
    const size = spineboy.bounds.size;
    const centerX = offset.x + size.x / 2;
    const centerY = offset.y + size.y / 2;

    // fitToCanvas 模式：自动缩放以完整显示模型（皮肤立绘专用）
    if (fitToCanvas) {
        // 计算需要多大的视野才能完整显示包围盒
        const boundsW = size.x || 1;
        const boundsH = size.y || 1;
        // 按宽高比决定缩放：取较小的缩放比保证完整显示
        const scaleX = cw / boundsW;
        const scaleY = ch / boundsH;
        const fitScale = Math.min(scaleX, scaleY);
        // 视野大小 = 包围盒大小 / fitScale（反过来算：让包围盒刚好填满画布短边）
        const worldW = cw / fitScale;
        const worldH = ch / fitScale;
        // 中心对齐包围盒中心
        mvp.ortho2d(centerX - worldW / 2, centerY - worldH / 2, worldW, worldH);
        return;
    }

    // 保持历史语义：positionBaseValX/Y 只影响"中心点平移缩放"（不影响模型大小）
    // 之前代码是 centerX / base - canvasWidth/2，因此默认 20 不会把模型缩小，只是改变居中参考点
    const baseX = Number(positionBaseValX) || 1;
    const baseY = Number(positionBaseValY) || 1;
    const worldCenterX = centerX / baseX;
    const worldCenterY = centerY / baseY;

    // 视觉尺寸控制：这里用 css * viewScale 来决定视野大小
    // - 默认 viewScale = dpr（更贴近旧版在高分屏的观感：不至于过大）
    // - supersample 只用于提高清晰度，不参与这里的视野计算
    const vs = Number(viewScale ?? dpr) || 1;
    const worldW = cw * vs;
    const worldH = ch * vs;

    mvp.ortho2d(worldCenterX - worldW / 2, worldCenterY - worldH / 2, worldW, worldH);
}
// 全局init
window.init = init;
// 全局加载
window.load = load;
