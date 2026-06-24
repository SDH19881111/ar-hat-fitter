import { FaceLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/+esm";

// Global Traditional Hat AR App Logic
document.addEventListener("DOMContentLoaded", async () => {
  // Elements
  const video = document.getElementById("webcam");
  const canvas = document.getElementById("output-canvas");
  const ctx = canvas.getContext("2d");
  
  const loadingOverlay = document.getElementById("loading-overlay");
  const permissionOverlay = document.getElementById("permission-overlay");
  const btnRequestPermission = document.getElementById("btn-request-permission");
  const noFaceWarning = document.getElementById("no-face-warning");
  const flashScreen = document.getElementById("flash-screen");
  
  const btnFlip = document.getElementById("btn-flip");
  const btnCapture = document.getElementById("btn-capture");
  const btnFullscreen = document.getElementById("btn-fullscreen");
  
  const hatCards = document.querySelectorAll(".hat-card");
  const sliderScale = document.getElementById("slider-scale");
  const sliderOffset = document.getElementById("slider-offset");
  const valScale = document.getElementById("val-scale");
  const valOffset = document.getElementById("val-offset");
  const btnResetAdjust = document.getElementById("btn-reset-adjust");

  const photoModal = document.getElementById("photo-modal");
  const modalPreviewImg = document.getElementById("modal-preview-img");
  const btnDownload = document.getElementById("btn-download");
  const btnShareDummy = document.getElementById("btn-share-dummy");
  const modalCloseBtn = document.querySelector(".close-btn");

  // State Variables
  let faceLandmarker = null;
  let webcamStream = null;
  let activeHat = "headdress";
  let useFrontCamera = true;
  let isModelLoaded = false;
  let lastVideoTime = -1;

  // Custom offset and scale adjusters (user sliders)
  let userScaleAdj = 100; // in percentage (50% to 250%)
  let userOffsetAdj = 0;   // in percentage (-100% to 100%)

  // Hat Settings config (default positions for individual high-res hats)
  const hatConfigs = {
    headdress: {
      url: "assets/headdress.png?v=2",
      offsetY: 0.08,  // relative to faceHeight (vertical offset)
      scale: 1.85,    // multiplier for faceWidth
      processedCanvas: null,
      loaded: false
    },
    cowboy: {
      url: "assets/cowboy.png?v=2",
      offsetY: 0.15,
      scale: 1.80,
      processedCanvas: null,
      loaded: false
    },
    nonla: {
      url: "assets/nonla.png?v=2",
      offsetY: 0.10,  // rests on forehead
      scale: 2.10,
      processedCanvas: null,
      loaded: false
    },
    pharaoh: {
      url: "assets/pharaoh.png?v=2",
      offsetY: 0.35,  // aligns headband to eyebrows
      scale: 1.80,
      processedCanvas: null,
      loaded: false
    },
    turban: {
      url: "assets/turban.png?v=2",
      offsetY: 0.15,  // rests on forehead
      scale: 1.90,
      processedCanvas: null,
      loaded: false
    },
    white_hat: {
      url: "assets/white_hat.png?v=2",
      offsetY: 0.15,  // rests on forehead
      scale: 1.90,
      processedCanvas: null,
      loaded: false
    },
    sombrero: {
      url: "assets/sombrero.png?v=2",
      offsetY: 0.15,  // rests on forehead
      scale: 2.00,
      processedCanvas: null,
      loaded: false
    }
  };

  // Preprocess hat images to remove white backgrounds (Chroma Key -> Flood Fill)
  function preprocessHats() {
    const promises = Object.keys(hatConfigs).map((key) => {
      return new Promise((resolve) => {
        const config = hatConfigs[key];
        const img = new Image();
        img.src = config.url;
        img.onload = () => {
          const offscreenCanvas = document.createElement("canvas");
          const width = img.naturalWidth;
          const height = img.naturalHeight;
          offscreenCanvas.width = width;
          offscreenCanvas.height = height;
          const oCtx = offscreenCanvas.getContext("2d");
          oCtx.drawImage(img, 0, 0);

          const imgData = oCtx.getImageData(0, 0, width, height);
          const data = imgData.data;

          // Flood-fill background removal: only removes white connected to the image border
          // This prevents removing white/pink colors inside the hat body!
          const visited = new Uint8Array(width * height);
          const queue = [];

          function isBg(x, y) {
            if (x < 0 || x >= width || y < 0 || y >= height) return false;
            const idx = (y * width + x) * 4;
            // If already fully or mostly transparent, consider it bg
            if (data[idx + 3] < 10) return true;

            const r = data[idx];
            const g = data[idx + 1];
            const b = data[idx + 2];
            // Distance from pure white
            const dist = Math.sqrt((255 - r) ** 2 + (255 - g) ** 2 + (255 - b) ** 2);
            return dist < 40;
          }

          // Enqueue borders
          for (let x = 0; x < width; x++) {
             if (isBg(x, 0)) { queue.push(x, 0); visited[x] = 1; }
             if (isBg(x, height - 1)) { queue.push(x, height - 1); visited[(height - 1) * width + x] = 1; }
          }
          for (let y = 0; y < height; y++) {
             if (isBg(0, y)) { queue.push(0, y); visited[y * width] = 1; }
             if (isBg(width - 1, y)) { queue.push(width - 1, y); visited[y * width + width - 1] = 1; }
          }
          
          let head = 0;
          while (head < queue.length) {
             const x = queue[head++];
             const y = queue[head++];
             
             // Make transparent
             const idx = (y * width + x) * 4;
             data[idx + 3] = 0;
             
             // Neighbors
             if (x > 0 && !visited[y * width + x - 1] && isBg(x - 1, y)) { visited[y * width + x - 1] = 1; queue.push(x - 1, y); }
             if (x < width - 1 && !visited[y * width + x + 1] && isBg(x + 1, y)) { visited[y * width + x + 1] = 1; queue.push(x + 1, y); }
             if (y > 0 && !visited[(y - 1) * width + x] && isBg(x, y - 1)) { visited[(y - 1) * width + x] = 1; queue.push(x, y - 1); }
             if (y < height - 1 && !visited[(y + 1) * width + x] && isBg(x, y + 1)) { visited[(y + 1) * width + x] = 1; queue.push(x, y + 1); }
          }

          // Soften the edges (optional feathering to remove white halos)
          for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3] > 0) {
              const r = data[i];
              const g = data[i + 1];
              const b = data[i + 2];
              const dist = Math.sqrt((255 - r) ** 2 + (255 - g) ** 2 + (255 - b) ** 2);
              if (dist < 60) {
                 const idx = i / 4;
                 const x = idx % width;
                 const y = Math.floor(idx / width);
                 let isEdge = false;
                 if (x > 0 && data[i - 4 + 3] === 0) isEdge = true;
                 else if (x < width - 1 && data[i + 4 + 3] === 0) isEdge = true;
                 else if (y > 0 && data[i - width * 4 + 3] === 0) isEdge = true;
                 else if (y < height - 1 && data[i + width * 4 + 3] === 0) isEdge = true;

                 if (isEdge) {
                   const ratio = Math.max(0, (dist - 40) / 20); // 0 to 1
                   data[i + 3] = Math.floor(ratio * 255);
                 }
              }
            }
          }

          oCtx.putImageData(imgData, 0, 0);
          config.processedCanvas = offscreenCanvas;
          config.loaded = true;
          resolve();
        };
        img.onerror = () => {
          console.error(`Failed to load hat image asset: ${config.url}`);
          resolve();
        };
      });
    });
    return Promise.all(promises);
  }

  // Initialize MediaPipe Face Landmarker
  async function initFaceLandmarker() {
    try {
      // Initialize the fileset resolver for vision tasks
      const filesetResolver = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/wasm"
      );

      // Create FaceLandmarker
      faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
          delegate: "GPU"
        },
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
        runningMode: "VIDEO",
        numFaces: 1
      });

      isModelLoaded = true;
      console.log("MediaPipe Face Landmarker loaded successfully!");
    } catch (err) {
      console.error("Error loading MediaPipe Face Landmarker:", err);
      alert("AR 엔진을 초기화하지 못했습니다. 새로고침 후 다시 시도해 주세요.");
    }
  }

  // Start Camera Stream
  async function startCamera() {
    if (webcamStream) {
      webcamStream.getTracks().forEach((track) => track.stop());
    }

    const constraints = {
      video: {
        facingMode: useFrontCamera ? "user" : "environment",
        width: { ideal: 640 },
        height: { ideal: 480 }
      },
      audio: false
    };

    try {
      webcamStream = await navigator.mediaDevices.getUserMedia(constraints);
      video.srcObject = webcamStream;
      video.addEventListener("loadedmetadata", () => {
        video.play();
        permissionOverlay.classList.add("hidden");
        // Adjust canvas dimensions to match the video feed aspect ratio
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        requestAnimationFrame(predictLoop);
      });
    } catch (err) {
      console.error("Camera access denied or failed:", err);
      permissionOverlay.classList.remove("hidden");
      loadingOverlay.classList.add("hidden");
    }
  }

  // Main real-time prediction and rendering loop
  function predictLoop() {
    if (!video.srcObject || video.ended) {
      return;
    }
    if (video.paused) {
      requestAnimationFrame(predictLoop);
      return;
    }

    // Check if we have new video frames
    let now = video.currentTime;
    if (now !== lastVideoTime) {
      lastVideoTime = now;

      // Draw original video frame onto canvas
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      if (isModelLoaded && faceLandmarker) {
        // Detect landmarks
        const result = faceLandmarker.detectForVideo(video, performance.now());
        
        if (result && result.faceLandmarks && result.faceLandmarks.length > 0) {
          noFaceWarning.classList.add("hidden");
          const landmarks = result.faceLandmarks[0];

          // Key Landmarks used for head mounting:
          // 10: Forehead/hairline center
          // 152: Chin center
          // 234: Left temple (relative to camera coordinates)
          // 454: Right temple (relative to camera coordinates)
          const landmark10 = landmarks[10];
          const landmark152 = landmarks[152];
          const landmark234 = landmarks[234];
          const landmark454 = landmarks[454];

          // Dimensions & distance metrics
          const faceWidth = Math.hypot(landmark454.x - landmark234.x, landmark454.y - landmark234.y);
          const faceHeight = Math.hypot(landmark10.x - landmark152.x, landmark10.y - landmark152.y);

          // Position target
          const anchorX = landmark10.x * canvas.width;
          const anchorY = landmark10.y * canvas.height;

          // Rotation angle (Roll)
          const dx = landmark454.x - landmark234.x;
          const dy = landmark454.y - landmark234.y;
          const rollAngle = Math.atan2(dy, dx);

          // Draw the active hat
          const hatConfig = hatConfigs[activeHat];
          if (hatConfig && hatConfig.loaded && hatConfig.processedCanvas) {
            ctx.save();
            ctx.translate(anchorX, anchorY);
            ctx.rotate(rollAngle);
            ctx.scale(-1, 1); // Flip horizontally so CSS transform doesn't make it backward

            // Compute scaling and offsets
            const scaleMultiplier = userScaleAdj / 100;
            const offsetAdjustY = userOffsetAdj / 100; // Range [-1.0, 1.0]

            const finalScale = hatConfig.scale * scaleMultiplier;
            // The vertical offset adjusts down/up based on faceHeight (increased range to 2.5)
            const finalOffsetY = hatConfig.offsetY + (offsetAdjustY * 2.5);

            const hatWidth = faceWidth * canvas.width * finalScale;
            const hatHeight = hatWidth * (hatConfig.processedCanvas.height / hatConfig.processedCanvas.width);

            const drawY = (finalOffsetY * faceHeight * canvas.height) - hatHeight;

            // Draw pre-processed transparent hat canvas
            ctx.drawImage(hatConfig.processedCanvas, -hatWidth / 2, drawY, hatWidth, hatHeight);
            ctx.restore();
          }
        } else {
          // No face detected
          noFaceWarning.classList.remove("hidden");
        }
      }
    }

    requestAnimationFrame(predictLoop);
  }

  // Interactivity: Hat card selections
  hatCards.forEach((card) => {
    card.addEventListener("click", () => {
      hatCards.forEach((c) => c.classList.remove("active"));
      card.classList.add("active");
      activeHat = card.getAttribute("data-hat");
      
      // Reset custom sliders when swapping hats to default configs
      resetAdjustments();
    });
  });

  // Sliders input events
  sliderScale.addEventListener("input", (e) => {
    userScaleAdj = parseInt(e.target.value);
    valScale.textContent = `${userScaleAdj}%`;
  });

  sliderOffset.addEventListener("input", (e) => {
    userOffsetAdj = parseInt(e.target.value);
    valOffset.textContent = userOffsetAdj > 0 ? `+${userOffsetAdj}` : userOffsetAdj;
  });

  function resetAdjustments() {
    userScaleAdj = 100;
    userOffsetAdj = 0;
    sliderScale.value = 100;
    sliderOffset.value = 0;
    valScale.textContent = "100%";
    valOffset.textContent = "0";
  }

  btnResetAdjust.addEventListener("click", resetAdjustments);

  // Snapshot capture button
  btnCapture.addEventListener("click", () => {
    // 1. Flash effect
    flashScreen.classList.add("active");
    setTimeout(() => flashScreen.classList.remove("active"), 500);

    // 2. Export canvas to dataURL
    // The canvas is mirrored via CSS, but to save the photo exactly as the user sees it,
    // we can draw the canvas to a temporary canvas, mirror it, and export that!
    // Since users prefer selfie shots to look exactly as they see on screen (mirrored),
    // we should horizontally flip the image for export.
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const tCtx = tempCanvas.getContext("2d");

    // Mirror horizontal drawing
    tCtx.translate(tempCanvas.width, 0);
    tCtx.scale(-1, 1);
    tCtx.drawImage(canvas, 0, 0);

    const dataUrl = tempCanvas.toDataURL("image/png");

    // Generate timestamp filename (e.g. ar-hat-20260624_161511.png)
    const now = new Date();
    const pad = (n) => n.toString().padStart(2, '0');
    const filename = `ar-hat-${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.png`;

    // 3. Show photo modal
    modalPreviewImg.src = dataUrl;
    btnDownload.href = dataUrl;
    btnDownload.download = filename;
    photoModal.classList.remove("hidden");

  });

  // Flip Camera Front/Back
  btnFlip.addEventListener("click", () => {
    useFrontCamera = !useFrontCamera;
    // Rotate button animation
    btnFlip.style.transform = `rotate(${useFrontCamera ? 0 : 180}deg)`;
    startCamera();
  });

  // Fullscreen support
  btnFullscreen.addEventListener("click", () => {
    const wrapper = document.querySelector(".camera-wrapper");
    if (!document.fullscreenElement) {
      wrapper.requestFullscreen().catch((err) => {
        alert(`전체화면 모드를 켤 수 없습니다: ${err.message}`);
      });
    } else {
      document.exitFullscreen();
    }
  });

  // Request camera permission button manually
  btnRequestPermission.addEventListener("click", () => {
    permissionOverlay.classList.add("hidden");
    loadingOverlay.classList.remove("hidden");
    startCamera();
  });

  // Modal Actions
  function resumeAfterModal() {
    photoModal.classList.add("hidden");
    if (video && video.paused) {
      video.play().catch(e => console.error("Could not resume video:", e));
    }
  }

  modalCloseBtn.addEventListener("click", resumeAfterModal);

  photoModal.addEventListener("click", (e) => {
    if (e.target === photoModal) {
      resumeAfterModal();
    }
  });

  btnShareDummy.addEventListener("click", () => {
    alert("데모 페이지입니다. 나만의 멋진 모자 쓴 사진이 저장되었습니다!");
  });

  // Bootstrapping App
  console.log("Loading Assets and Engine...");
  await preprocessHats();
  await initFaceLandmarker();
  
  // Hide loading spinner and start camera
  loadingOverlay.classList.add("hidden");
  startCamera();
});
