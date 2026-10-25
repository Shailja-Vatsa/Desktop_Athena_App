import { useState, useEffect, useRef } from "react";

function App() {
  // Permission & Environment states
  const [videoGranted, setVideoGranted] = useState(false);
  const [audioGranted, setAudioGranted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [escAttempted, setEscAttempted] = useState(false);
  const [cameraDevice, setCameraDevice] = useState("");
  const [audioDevice, setAudioDevice] = useState("");
  const [audioLevel, setAudioLevel] = useState(0);
  const [activeScreen, setActiveScreen] = useState("onboarding"); // "onboarding" | "exam" | "results"

  // Restricted Action Violation Modal State
  const [violationModal, setViolationModal] = useState({
    open: false,
    reason: "",
    count: 0,
  });

  // Quit Warning & Permanently Locked State
  const [quitWarning, setQuitWarning] = useState({
    open: false,
    attempts: 0,
  });
  const [isPermanentlyLocked, setIsPermanentlyLocked] = useState(false);

  // UFM Lockdown State
  const [ufmLocked, setUfmLocked] = useState(false);

  // Backend connection error state
  const [backendError, setBackendError] = useState(false);

  // Exam Rules Dialog & Backend Modals State
  const [showRulesModal, setShowRulesModal] = useState(false);
  const [showBackendModal, setShowBackendModal] = useState(false);
  const [snapshotStatus, setSnapshotStatus] = useState("");
  const [candidateName, setCandidateName] = useState("");

  // Backend state from IPC/REST API
  const [questions, setQuestions] = useState([
    {
      id: 1,
      question: "What is the time complexity of searching in a Balanced Binary Search Tree (AVL / Red-Black Tree)?",
      options: ["O(1)", "O(log n)", "O(n)", "O(n log n)"],
      correct: 1,
    },
    {
      id: 2,
      question: "Which HTTP status code corresponds to 'Unauthorized' access?",
      options: ["400 Bad Request", "401 Unauthorized", "403 Forbidden", "404 Not Found"],
      correct: 1,
    },
    {
      id: 3,
      question: "In Electron architecture, which process is responsible for creating native OS windows?",
      options: ["Renderer Process", "Main Process", "Worker Thread", "Preload Bridge"],
      correct: 1,
    },
  ]);

  const [backendStats, setBackendStats] = useState(null);
  const [backendLogs, setBackendLogs] = useState([]);
  const [backendHealth, setBackendHealth] = useState(null);
  const [submissionResult, setSubmissionResult] = useState(null);

  // Stream and Audio Context references
  const videoRef = useRef(null);
  const examVideoRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const audioContextRef = useRef(null);
  const animationFrameRef = useRef(null);
  const escTimeoutRef = useRef(null);
  const isManuallyExitingRef = useRef(false);
  const screenStreamRef = useRef(null);
  const screenIntervalRef = useRef(null);
  const hasSubmittedExamRef = useRef(false);
  const selectedAnswersRef = useRef({});
  const candidateNameRef = useRef("");

  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState({});
  const [timeLeft, setTimeLeft] = useState(5400); // 90 minutes in seconds
  const timerRef = useRef(null);
  const [screenSnapshots, setScreenSnapshots] = useState([]);
  const [ipcWarning, setIpcWarning] = useState("");
  const ipcWarningTimeoutRef = useRef(null);

  // Fetch Questions & Backend Info on Mount / Retry
  const loadBackendData = async () => {
    try {
      setBackendError(false);
      if (window.electronAPI?.getQuestions) {
        const res = await window.electronAPI.getQuestions();
        if (res && res.success && res.questions && res.questions.length > 0) {
          setQuestions(res.questions);
        } else if (res && !res.success) {
          throw new Error(res.error || "Failed to load questions");
        }
      }
      await refreshBackendStats();
    } catch (err) {
      console.error("Backend fetch error:", err);
      setBackendError(true);
    }
  };

  useEffect(() => {
    loadBackendData();
  }, []);

  const refreshBackendStats = async () => {
    try {
      if (window.electronAPI?.getProctorStats) {
        const res = await window.electronAPI.getProctorStats();
        if (res.success) setBackendStats(res.stats);
      }
      if (window.electronAPI?.getProctorLogs) {
        const logsRes = await window.electronAPI.getProctorLogs();
        if (logsRes.success) setBackendLogs(logsRes.auditLogs.logs || []);
      }
      fetch("http://localhost:5000/api/health")
        .then((r) => r.json())
        .then((data) => setBackendHealth(data))
        .catch(() => setBackendHealth({ status: "Connected via IPC" }));
    } catch (e) {
      console.warn("Error refreshing backend stats:", e);
    }
  };

  // Sync active exam state to main process
  useEffect(() => {
    if (activeScreen === "exam") {
      if (window.electronAPI?.setExamActive) {
        window.electronAPI.setExamActive(true);
      }
    } else {
      if (window.electronAPI?.setExamActive) {
        window.electronAPI.setExamActive(false);
      }
    }
  }, [activeScreen]);

  // Results screen mount actions — set isManuallyExiting BEFORE exiting fullscreen
  // to prevent the fullscreenchange listener from re-entering kiosk
  useEffect(() => {
    if (activeScreen === "results") {
      isManuallyExitingRef.current = true;
      if (navigator.keyboard?.unlock) navigator.keyboard.unlock();
      if (window.electronAPI?.setKiosk) window.electronAPI.setKiosk(false);
      if (window.electronAPI?.setFullscreen) window.electronAPI.setFullscreen(false);
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
      if (window.electronAPI?.setExamActive) window.electronAPI.setExamActive(false);
      // Stop audio visualizer
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      // Stop screen capture interval
      if (screenIntervalRef.current) {
        clearInterval(screenIntervalRef.current);
        screenIntervalRef.current = null;
      }
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((t) => t.stop());
        screenStreamRef.current = null;
      }
    }
  }, [activeScreen]);

  // Listen to IPC events from main process (quit warning, permanent lock, UFM lockdown)
  useEffect(() => {
    if (window.electronAPI?.onWarnBeforeQuit) {
      window.electronAPI.onWarnBeforeQuit((count) => {
        setQuitWarning({ open: true, attempts: count });
      });
    }
    if (window.electronAPI?.onExamPermanentlyLocked) {
      window.electronAPI.onExamPermanentlyLocked(() => {
        setQuitWarning({ open: false, attempts: 3 });
        setIsPermanentlyLocked(true);
      });
    }
    if (window.electronAPI?.onUfmLockdown) {
      window.electronAPI.onUfmLockdown(() => {
        setUfmLocked(true);
      });
    }
  }, []);

  // UFM keyboard lock: block all keys except Cmd+Q
  useEffect(() => {
    if (!ufmLocked) return;
    const blockKeyboardExceptQuit = (e) => {
      const isQuit = (e.key === "q" || e.key === "Q" || e.code === "KeyQ") && (e.metaKey || e.ctrlKey);
      if (isQuit) {
        return; // Allow Cmd+Q to pass to main process
      }
      e.preventDefault();
      e.stopPropagation();
      return false;
    };

    window.addEventListener("keydown", blockKeyboardExceptQuit, true);
    window.addEventListener("keyup", blockKeyboardExceptQuit, true);
    window.addEventListener("keypress", blockKeyboardExceptQuit, true);

    return () => {
      window.removeEventListener("keydown", blockKeyboardExceptQuit, true);
      window.removeEventListener("keyup", blockKeyboardExceptQuit, true);
      window.removeEventListener("keypress", blockKeyboardExceptQuit, true);
    };
  }, [ufmLocked]);

  // Block copy, cut, paste, context menu in exam and UFM modes
  useEffect(() => {
    const blockClipboard = (e) => {
      if (activeScreen === "exam" || ufmLocked) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener("copy", blockClipboard, true);
    document.addEventListener("cut", blockClipboard, true);
    document.addEventListener("paste", blockClipboard, true);
    document.addEventListener("contextmenu", blockClipboard, true);
    return () => {
      document.removeEventListener("copy", blockClipboard, true);
      document.removeEventListener("cut", blockClipboard, true);
      document.removeEventListener("paste", blockClipboard, true);
      document.removeEventListener("contextmenu", blockClipboard, true);
    };
  }, [activeScreen, ufmLocked]);

  // Capture Image using Web ImageCapture API (with HTML5 canvas fallback) and save via IPC to backend
  const captureSnapshot = async () => {
    try {
      if (!mediaStreamRef.current) {
        alert("Camera stream is not active. Please grant camera permission first.");
        return;
      }

      const videoTrack = mediaStreamRef.current.getVideoTracks()[0];
      if (!videoTrack) {
        alert("No active video track found.");
        return;
      }

      let base64Data = null;

      if ("ImageCapture" in window) {
        try {
          const imageCapture = new ImageCapture(videoTrack);
          const blob = await imageCapture.takePhoto();
          base64Data = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        } catch (e) {
          console.warn("ImageCapture error, falling back to canvas:", e);
        }
      }

      if (!base64Data) {
        const videoEl = examVideoRef.current || videoRef.current;
        if (videoEl && videoEl.videoWidth) {
          const canvas = document.createElement("canvas");
          canvas.width = videoEl.videoWidth;
          canvas.height = videoEl.videoHeight;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
          base64Data = canvas.toDataURL("image/png");
        }
      }

      if (base64Data && window.electronAPI?.saveProctorSnapshot) {
        const res = await window.electronAPI.saveProctorSnapshot(base64Data);
        if (res.success) {
          setSnapshotStatus(`Saved: ${res.fileName}`);
          refreshBackendStats();
          setTimeout(() => setSnapshotStatus(""), 4000);
        } else {
          setSnapshotStatus("Failed to save snapshot");
        }
      } else {
        alert("Unable to capture snapshot frame.");
      }
    } catch (err) {
      console.error("Capture snapshot error:", err);
      alert("Error capturing image: " + err.message);
    }
  };

  // Request Video Permission
  const requestVideo = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 } },
      });

      if (!mediaStreamRef.current) {
        mediaStreamRef.current = stream;
      } else {
        stream.getVideoTracks().forEach((track) => mediaStreamRef.current.addTrack(track));
      }

      if (videoRef.current) {
        videoRef.current.srcObject = mediaStreamRef.current;
      }

      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDev = devices.find((d) => d.kind === "videoinput");
      setCameraDevice(videoDev?.label || "Native System Camera");
      setVideoGranted(true);
    } catch (err) {
      console.error("Video permission denied:", err);
      alert("Please allow camera access in your browser or system settings to proceed.");
    }
  };

  // Request Audio Permission & setup real-time audio visualizer
  const requestAudio = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      if (!mediaStreamRef.current) {
        mediaStreamRef.current = stream;
      } else {
        stream.getAudioTracks().forEach((track) => mediaStreamRef.current.addTrack(track));
      }

      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioDev = devices.find((d) => d.kind === "audioinput");
      setAudioDevice(audioDev?.label || "Built-in Microphone");
      setAudioGranted(true);

      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      audioContextRef.current = audioContext;
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 64;
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const updateVolume = () => {
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const average = sum / dataArray.length;
        setAudioLevel(Math.min(100, Math.round((average / 128) * 100)));
        animationFrameRef.current = requestAnimationFrame(updateVolume);
      };
      updateVolume();
    } catch (err) {
      console.error("Audio permission denied:", err);
      alert("Please allow microphone access in your browser or system settings to proceed.");
    }
  };

  // Request & Toggle Fullscreen
  const toggleFullscreen = async () => {
    try {
      if (!isFullscreen) {
        isManuallyExitingRef.current = false;
        if (window.electronAPI?.setFullscreen) {
          await window.electronAPI.setFullscreen(true);
        }
        if (window.electronAPI?.setKiosk) {
          await window.electronAPI.setKiosk(true);
        }
        if (document.documentElement.requestFullscreen) {
          await document.documentElement.requestFullscreen().catch(() => {});
        }
        if (navigator.keyboard?.lock) {
          try {
            await navigator.keyboard.lock(["Escape"]);
          } catch (e) {}
        }
        setIsFullscreen(true);
      } else {
        isManuallyExitingRef.current = true;
        if (navigator.keyboard?.unlock) {
          navigator.keyboard.unlock();
        }
        if (window.electronAPI?.setKiosk) {
          await window.electronAPI.setKiosk(false);
        }
        if (window.electronAPI?.setFullscreen) {
          await window.electronAPI.setFullscreen(false);
        }
        if (document.fullscreenElement && document.exitFullscreen) {
          await document.exitFullscreen().catch(() => {});
        }
        setIsFullscreen(false);
      }
    } catch (err) {
      console.error("Fullscreen toggle error:", err);
    }
  };

  // Listen to fullscreen changes
  useEffect(() => {
    const handleFsChange = async () => {
      if (!document.fullscreenElement && isFullscreen && !isManuallyExitingRef.current) {
        try {
          if (window.electronAPI?.setKiosk) {
            await window.electronAPI.setKiosk(true);
          }
          if (window.electronAPI?.setFullscreen) {
            await window.electronAPI.setFullscreen(true);
          }
          if (document.documentElement.requestFullscreen) {
            await document.documentElement.requestFullscreen();
            if (navigator.keyboard?.lock) {
              await navigator.keyboard.lock(["Escape"]);
            }
          }
        } catch (e) {}
      } else if (document.fullscreenElement) {
        setIsFullscreen(true);
      } else if (isManuallyExitingRef.current) {
        setIsFullscreen(false);
      }
    };
    document.addEventListener("fullscreenchange", handleFsChange);
    return () => document.removeEventListener("fullscreenchange", handleFsChange);
  }, [isFullscreen]);

  // Disable Escape key across renderer only during exam
  useEffect(() => {
    const blockEscape = (e) => {
      if (activeScreen !== "exam") return;

      if (e.key === "Escape" || e.code === "Escape" || e.keyCode === 27) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        setEscAttempted(true);
        if (escTimeoutRef.current) clearTimeout(escTimeoutRef.current);
        escTimeoutRef.current = setTimeout(() => {
          setEscAttempted(false);
        }, 2200);

        return false;
      }
    };

    window.addEventListener("keydown", blockEscape, true);
    window.addEventListener("keyup", blockEscape, true);
    window.addEventListener("keypress", blockEscape, true);

    return () => {
      window.removeEventListener("keydown", blockEscape, true);
      window.removeEventListener("keyup", blockEscape, true);
      window.removeEventListener("keypress", blockEscape, true);
      if (escTimeoutRef.current) clearTimeout(escTimeoutRef.current);
    };
  }, [activeScreen]);

  // Handle Restricted Actions and log to backend
  useEffect(() => {
    if (activeScreen !== "exam") return;

    // Grace period: wait 3s after exam starts before activating listeners
    // This prevents false violations from the screen-share picker stealing focus
    let ready = false;
    const graceTimer = setTimeout(() => { ready = true; }, 3000);

    const triggerViolation = (reason) => {
      if (!ready) return;
      if (activeScreen !== "exam") return;

      if (ufmLocked && window.electronAPI?.focusWindow) {
        window.electronAPI.focusWindow();
      }

      setViolationModal((prev) => {
        const newCount = prev.count + 1;

        if (window.electronAPI?.logViolation) {
          window.electronAPI.logViolation(reason, newCount, { screen: activeScreen, isUfm: ufmLocked, ufmLocked });
          refreshBackendStats();
        }

        return {
          open: true,
          reason,
          count: newCount,
        };
      });
    };

    const handleBlur = () => {
      triggerViolation("Window Focus Lost (Tab or App Switch Attempt)");
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        triggerViolation("Tab Switched / App Backgrounded");
      }
    };

    window.addEventListener("blur", handleBlur);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearTimeout(graceTimer);
      window.removeEventListener("blur", handleBlur);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [activeScreen, ufmLocked]);

  // Listen for IPC Warnings (e.g. from main process)
  useEffect(() => {
    if (window.electronAPI?.onShowWarning) {
      window.electronAPI.onShowWarning((msg) => {
        setIpcWarning(msg);
        if (ipcWarningTimeoutRef.current) clearTimeout(ipcWarningTimeoutRef.current);
        ipcWarningTimeoutRef.current = setTimeout(() => {
          setIpcWarning("");
        }, 3000);
      });
    }
    return () => {
      if (ipcWarningTimeoutRef.current) clearTimeout(ipcWarningTimeoutRef.current);
    };
  }, []);

  // Sync stream to onboarding and exam video elements
  useEffect(() => {
    if (videoGranted && mediaStreamRef.current) {
      if (activeScreen === "onboarding" && videoRef.current) {
        videoRef.current.srcObject = mediaStreamRef.current;
      } else if (activeScreen === "exam" && examVideoRef.current) {
        examVideoRef.current.srcObject = mediaStreamRef.current;
      }
    }
  }, [activeScreen, videoGranted]);

  // Screen tracking during exam
  useEffect(() => {
    if (activeScreen === "exam") {
      navigator.mediaDevices
        .getDisplayMedia({ video: true, audio: false })
        .then((stream) => {
          screenStreamRef.current = stream;
          const videoTrack = stream.getVideoTracks()[0];

          if ("ImageCapture" in window) {
            const imageCapture = new ImageCapture(videoTrack);
            screenIntervalRef.current = setInterval(async () => {
              try {
                const blob = await imageCapture.takePhoto();
                const reader = new FileReader();
                reader.onloadend = () => {
                  setScreenSnapshots((prev) => [...prev, reader.result]);
                  if (window.electronAPI?.saveScreenSnapshot) {
                    window.electronAPI.saveScreenSnapshot(reader.result);
                  }
                };
                reader.readAsDataURL(blob);
              } catch (e) {
                console.warn("Failed to capture screen frame:", e);
              }
            }, 10000);
          } else {
            const hiddenVideo = document.createElement("video");
            hiddenVideo.srcObject = stream;
            hiddenVideo.play();
            screenIntervalRef.current = setInterval(() => {
              if (hiddenVideo.videoWidth) {
                const canvas = document.createElement("canvas");
                canvas.width = hiddenVideo.videoWidth;
                canvas.height = hiddenVideo.videoHeight;
                const ctx = canvas.getContext("2d");
                ctx.drawImage(hiddenVideo, 0, 0, canvas.width, canvas.height);
                const base64Data = canvas.toDataURL("image/png");
                setScreenSnapshots((prev) => [...prev, base64Data]);
                if (window.electronAPI?.saveScreenSnapshot) {
                  window.electronAPI.saveScreenSnapshot(base64Data);
                }
              }
            }, 10000);
          }
        })
        .catch((err) => console.error("Screen capture error:", err));
    } else {
      if (screenIntervalRef.current) {
        clearInterval(screenIntervalRef.current);
      }
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((track) => track.stop());
      }
    }

    return () => {
      if (screenIntervalRef.current) clearInterval(screenIntervalRef.current);
      if (screenStreamRef.current) screenStreamRef.current.getTracks().forEach((track) => track.stop());
    };
  }, [activeScreen]);

  // Keep refs in sync with state so timer/auto-submit always reads latest values
  useEffect(() => { selectedAnswersRef.current = selectedAnswers; }, [selectedAnswers]);
  useEffect(() => { candidateNameRef.current = candidateName; }, [candidateName]);

  // Submit Exam Handler — reads from refs so it's safe to call from timer callbacks
  const handleSubmitExam = async () => {
    if (hasSubmittedExamRef.current) return;
    hasSubmittedExamRef.current = true;

    // Stop timer immediately
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    try {
      let submission = null;
      const name = candidateNameRef.current;
      const answers = selectedAnswersRef.current;

      if (window.electronAPI?.submitExam) {
        const res = await window.electronAPI.submitExam(name, answers);
        if (res && res.success) submission = res.submission;
      } else {
        const res = await fetch("http://localhost:5000/api/exam/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ candidateName: name, selectedAnswers: answers }),
        });
        const data = await res.json();
        if (data && data.success) submission = data.submission;
      }

      if (submission) {
        setSubmissionResult(submission);
        setActiveScreen("results");
        refreshBackendStats();
      } else {
        alert("Submission failed. Please check backend connection.");
        hasSubmittedExamRef.current = false;
      }
    } catch (err) {
      console.error("Exam submission error:", err);
      alert("Error submitting exam to backend: " + err.message);
      hasSubmittedExamRef.current = false;
    }
  };

  // Exam Countdown Timer — single interval, started once when exam begins
  useEffect(() => {
    if (activeScreen !== "exam") {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          timerRef.current = null;
          handleSubmitExam();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [activeScreen]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (audioContextRef.current) audioContextRef.current.close();
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  const formatTimer = (seconds) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hrs.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const allChecksPassed = videoGranted && audioGranted && isFullscreen;

  const renderEscToast = () => {
    if (!escAttempted) return null;
    return (
      <div className="fixed top-5 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-white border border-red-300 text-red-700 shadow-xl backdrop-blur-md animate-fade-in transition-all">
        <span className="text-base">🔒</span>
        <div className="text-left">
          <p className="text-xs font-semibold text-[#111827] flex items-center gap-1.5">
            Escape (Esc) is Disabled
            <span className="text-[10px] font-mono bg-red-100 text-red-700 border border-red-200 px-1.5 py-0.2 rounded font-bold">LOCKED</span>
          </p>
          <p className="text-[10px] text-gray-500">Proctored session does not allow exiting via Escape key.</p>
        </div>
      </div>
    );
  };

  const renderIpcWarningToast = () => {
    if (!ipcWarning) return null;
    return (
      <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-white border border-amber-300 text-amber-800 shadow-xl backdrop-blur-md animate-fade-in transition-all">
        <span className="text-base">⚠️</span>
        <div className="text-left">
          <p className="text-xs font-bold text-[#111827] flex items-center gap-1.5 uppercase tracking-wide">
            {ipcWarning}
          </p>
        </div>
      </div>
    );
  };

  const renderViolationModal = () => {
    if (!violationModal.open) return null;

    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
        <div className="w-full max-w-lg bg-white border-2 border-red-500 rounded-2xl p-6 sm:p-8 shadow-2xl space-y-5 text-center relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-red-600 via-amber-500 to-red-600" />

          <div className="w-16 h-16 mx-auto rounded-full bg-red-50 border border-red-200 flex items-center justify-center text-3xl text-red-600 shadow-inner">
            🛑
          </div>

          <div className="space-y-1.5">
            <span className="text-[10px] font-mono tracking-widest text-red-700 font-bold uppercase bg-red-100 border border-red-200 px-3 py-1 rounded-full">
              RESTRICTED ACTION DETECTED • WARNING #{violationModal.count}
            </span>
            <h2 className="text-xl sm:text-2xl font-black text-[#111827] tracking-wide pt-2">
              Security Violation Alert
            </h2>
            <p className="text-xs text-red-600 font-medium">
              Detected Action: <span className="font-bold underline">{violationModal.reason}</span>
            </p>
          </div>

          <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-left space-y-2">
            <div className="flex items-center gap-2 text-xs font-bold text-red-800">
              <span>⚠️</span> STRICT PROCTORING POLICY NOTICE
            </div>
            <p className="text-xs text-gray-700 leading-relaxed">
              Copying, pasting content, right-clicking, or switching tabs/applications is <strong className="text-[#111827]">strictly prohibited</strong> during this proctored examination.
            </p>
            <div className="p-2.5 rounded-lg bg-red-100 border border-red-200 text-xs text-red-800 font-semibold leading-relaxed">
              🚨 Incident logged in Express Backend database. Continuing will result in exam invalidation.
            </div>
          </div>

          <button
            onClick={() => setViolationModal((prev) => ({ ...prev, open: false }))}
            className="w-full py-3.5 px-6 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-sm shadow-lg shadow-red-600/30 transition-all cursor-pointer transform active:scale-95"
          >
            I Understand & Acknowledge (Return to Exam)
          </button>
        </div>
      </div>
    );
  };

  const renderQuitWarningModal = () => {
    if (!quitWarning.open || isPermanentlyLocked) return null;

    return (
      <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
        <div className="w-full max-w-lg bg-white border border-blue-200 rounded-2xl p-6 sm:p-8 shadow-2xl text-center space-y-5">
          <div className="w-16 h-16 mx-auto rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center text-3xl text-amber-600">
            ⚠️
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-bold text-[#111827]">Quit Warning</h2>
            <p className="text-sm text-gray-700 leading-relaxed">
              Warning: You have attempted to quit {quitWarning.attempts} time(s). After 3 quit attempts, this exam will be permanently locked and you will not be able to attempt it again.
            </p>
          </div>
          <div className="flex gap-3 pt-2">
            <button
              onClick={() => setQuitWarning((prev) => ({ ...prev, open: false }))}
              className="flex-1 py-3 px-4 rounded-xl bg-gray-100 hover:bg-gray-200 text-[#111827] font-semibold text-sm transition cursor-pointer"
            >
              Cancel (Return to Exam)
            </button>
            <button
              onClick={() => {
                if (window.electronAPI?.confirmQuit) {
                  window.electronAPI.confirmQuit();
                }
              }}
              className="flex-1 py-3 px-4 rounded-xl bg-red-600 hover:bg-red-700 text-white font-semibold text-sm transition cursor-pointer shadow-md shadow-red-600/20"
            >
              Quit Anyway
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderBackendModal = () => {
    if (!showBackendModal) return null;

    return (
      <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
        <div className="w-full max-w-2xl bg-white border border-blue-200 rounded-2xl p-6 shadow-2xl space-y-5 text-left relative max-h-[85vh] flex flex-col">
          <div className="flex items-center justify-between border-b border-blue-100 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-100 border border-blue-200 flex items-center justify-center text-xl text-[#1d4ed8] font-bold">
                🖥️
              </div>
              <div>
                <h2 className="text-base font-bold text-[#111827] flex items-center gap-2">
                  Backend API & Database Dashboard
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-100 text-[#1d4ed8] border border-blue-200">
                    HTTP 5000 / IPC
                  </span>
                </h2>
                <p className="text-xs text-gray-500">Real-time status, database stats, and audit logs.</p>
              </div>
            </div>
            <button
              onClick={() => setShowBackendModal(false)}
              className="text-gray-400 hover:text-[#111827] text-lg px-2 py-1 rounded bg-gray-100 cursor-pointer"
            >
              ✕
            </button>
          </div>

          {/* Stats Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 bg-blue-50/50 border border-blue-200 rounded-xl text-center">
              <span className="text-[10px] text-gray-500 uppercase font-semibold">Questions Loaded</span>
              <p className="text-lg font-bold text-[#1d4ed8] font-mono">{questions.length}</p>
            </div>
            <div className="p-3 bg-blue-50/50 border border-blue-200 rounded-xl text-center">
              <span className="text-[10px] text-gray-500 uppercase font-semibold">Violations Recorded</span>
              <p className="text-lg font-bold text-red-600 font-mono">{backendStats?.totalViolations || 0}</p>
            </div>
            <div className="p-3 bg-blue-50/50 border border-blue-200 rounded-xl text-center">
              <span className="text-[10px] text-gray-500 uppercase font-semibold">Proctor Snapshots</span>
              <p className="text-lg font-bold text-amber-600 font-mono">{backendStats?.totalSnapshots || 0}</p>
            </div>
            <div className="p-3 bg-blue-50/50 border border-blue-200 rounded-xl text-center">
              <span className="text-[10px] text-gray-500 uppercase font-semibold">Submissions</span>
              <p className="text-lg font-bold text-indigo-600 font-mono">{backendStats?.totalSubmissions || 0}</p>
            </div>
          </div>

          {/* Backend Logs Stream */}
          <div className="flex-1 overflow-y-auto space-y-2 bg-gray-50 p-4 rounded-xl border border-blue-200 font-mono text-xs">
            <div className="flex items-center justify-between text-[11px] text-gray-500 border-b border-gray-200 pb-2 mb-2 font-sans font-semibold">
              <span>BACKEND EVENT STREAM</span>
              <span className="text-[#1d4ed8]">● LIVE IPC / EXPRESS SYNC</span>
            </div>
            {backendLogs.length === 0 ? (
              <p className="text-gray-400 text-center py-4">No events logged yet. Perform actions to view live audit stream.</p>
            ) : (
              backendLogs.slice().reverse().map((log, i) => (
                <div key={i} className="flex gap-2 text-gray-700 border-b border-gray-200 pb-1.5 pt-1">
                  <span className="text-gray-400 text-[10px] shrink-0">
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </span>
                  <span className={`text-[10px] font-bold shrink-0 ${
                    log.event === 'SECURITY_VIOLATION' || log.event === 'UFM_VIOLATION' ? 'text-red-600' :
                    log.event === 'EXAM_SUBMITTED' ? 'text-emerald-600' : 'text-blue-600'
                  }`}>
                    [{log.event}]
                  </span>
                  <span className="text-gray-700 text-[11px] truncate">{log.details}</span>
                </div>
              ))
            )}
          </div>

          <div className="pt-2 flex justify-between items-center text-xs text-gray-500">
            <span>Express API Endpoint: <code className="text-[#1d4ed8] bg-blue-50 px-2 py-0.5 rounded border border-blue-200">http://localhost:5000/api</code></span>
            <button
              onClick={refreshBackendStats}
              className="py-2 px-4 rounded-xl bg-blue-50 hover:bg-blue-100 border border-blue-200 text-[#1d4ed8] font-medium transition cursor-pointer"
            >
              🔄 Refresh Backend Logs
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderRulesModal = () => {
    if (!showRulesModal) return null;

    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
        <div className="w-full max-w-lg bg-white border border-blue-200 rounded-2xl p-6 sm:p-8 shadow-2xl space-y-5 text-left relative">
          <div className="flex items-center gap-3 border-b border-blue-100 pb-4">
            <div className="w-10 h-10 rounded-xl bg-blue-100 border border-blue-200 flex items-center justify-center text-xl text-[#1d4ed8] font-bold">
              📋
            </div>
            <div>
              <h2 className="text-lg font-bold text-[#111827]">Examination Rules & Guidelines</h2>
              <p className="text-xs text-gray-500">Please review and agree to the rules before starting.</p>
            </div>
          </div>

          <div className="space-y-3 max-h-60 overflow-y-auto pr-1 text-xs text-gray-700">
            <div className="flex gap-2.5 items-start">
              <span className="text-[#1d4ed8] font-bold">1.</span>
              <p><strong className="text-[#111827]">Active Proctor Monitoring:</strong> Camera and microphone must remain ON and unblocked at all times.</p>
            </div>
            <div className="flex gap-2.5 items-start">
              <span className="text-[#1d4ed8] font-bold">2.</span>
              <p><strong className="text-[#111827]">Display Lockdown:</strong> You must remain in full-screen kiosk mode. Leaving focus logs a security violation in backend.</p>
            </div>
            <div className="flex gap-2.5 items-start">
              <span className="text-[#1d4ed8] font-bold">3.</span>
              <p><strong className="text-[#111827]">No Copy/Paste or Tab Switching:</strong> Right-clicking, copying, pasting, and switching tabs/apps are strictly prohibited and recorded by the Express backend API.</p>
            </div>
            <div className="flex gap-2.5 items-start">
              <span className="text-[#1d4ed8] font-bold">4.</span>
              <p><strong className="text-[#111827]">Timer & Submission:</strong> You have 90 minutes. Results will be calculated and saved automatically to the server.</p>
            </div>
          </div>

          <div className="pt-3 border-t border-blue-100 flex items-center gap-3">
            <button
              onClick={() => setShowRulesModal(false)}
              className="flex-1 py-3 px-4 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium text-xs border border-gray-300 transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                setShowRulesModal(false);
                setActiveScreen("exam");
              }}
              className="flex-1 py-3 px-4 rounded-xl bg-[#1d4ed8] hover:bg-blue-700 text-white font-bold text-xs shadow-md shadow-blue-600/20 transition cursor-pointer"
            >
              Agree & Start Test →
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ----------------------------------------------------
  // SCREEN: BACKEND CONNECTION ERROR
  // ----------------------------------------------------
  if (backendError) {
    return (
      <div className="min-h-screen bg-[#f0f4ff] text-[#111827] flex flex-col items-center justify-center p-6 select-none font-sans">
        <div className="bg-white border border-blue-200 rounded-2xl p-8 shadow-xl max-w-md w-full text-center space-y-5">
          <div className="w-14 h-14 mx-auto rounded-full bg-red-50 border border-red-200 flex items-center justify-center text-2xl text-red-600">
            ⚠️
          </div>
          <p className="text-base font-semibold text-[#111827]">Could not connect to backend.</p>
          <button
            onClick={loadBackendData}
            className="w-full py-3 px-6 rounded-xl bg-[#1d4ed8] hover:bg-blue-700 text-white font-semibold text-sm transition cursor-pointer shadow-md shadow-blue-600/20"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // ----------------------------------------------------
  // SCREEN: PERMANENTLY LOCKED STATE
  // ----------------------------------------------------
  if (isPermanentlyLocked) {
    return (
      <div className="min-h-screen bg-[#f0f4ff] text-[#111827] flex flex-col items-center justify-center p-6 select-none font-sans">
        <div className="w-full max-w-lg bg-white border-2 border-red-500 rounded-2xl p-8 shadow-2xl text-center space-y-4">
          <div className="w-16 h-16 mx-auto rounded-full bg-red-50 border border-red-200 flex items-center justify-center text-3xl text-red-600">
            🔒
          </div>
          <h2 className="text-xl font-bold text-red-600">Exam Permanently Locked</h2>
          <p className="text-base font-semibold text-[#111827] leading-relaxed">
            This exam has been permanently locked due to repeated quit attempts. Contact your examiner.
          </p>
        </div>
      </div>
    );
  }

  // ----------------------------------------------------
  // SCREEN 3: RESULTS (POST-SUBMISSION FLOW)
  // ----------------------------------------------------
  if (activeScreen === "results") {
    const scoreVal = submissionResult?.score ?? 0;
    const totalMarksVal = submissionResult?.totalMarks ?? (questions.length * 2);
    const pct = submissionResult?.percentage ?? (totalMarksVal > 0 ? ((scoreVal / totalMarksVal) * 100).toFixed(1) : 0);
    const breakdown = submissionResult?.breakdown ?? [];
    const correctCount = breakdown.filter((b) => b.isCorrect).length;
    const submittedAt = submissionResult?.submittedAt ? new Date(submissionResult.submittedAt).toLocaleTimeString() : "";

    return (
      <div className="min-h-screen bg-[#f0f4ff] text-[#111827] flex flex-col items-center justify-center p-6 select-none font-sans">
        <div className="w-full max-w-lg bg-white border border-blue-200 rounded-2xl p-8 shadow-xl space-y-6">
          {/* Header */}
          <div className="text-center space-y-2">
            <div className="w-16 h-16 mx-auto rounded-full bg-blue-50 border border-blue-200 flex items-center justify-center text-3xl text-[#1d4ed8]">
              ✓
            </div>
            <h1 className="text-2xl font-bold text-[#111827]">Exam Completed</h1>
            <p className="text-sm text-gray-500">Your responses have been submitted{submittedAt ? ` at ${submittedAt}` : ""}</p>
          </div>

          {/* Score block */}
          <div className="grid grid-cols-3 gap-3">
            <div className="p-4 bg-blue-50/50 border border-blue-100 rounded-xl text-center">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold mb-1">Score</p>
              <p className="text-2xl font-extrabold text-[#1d4ed8] font-mono">{scoreVal}/{totalMarksVal}</p>
            </div>
            <div className="p-4 bg-blue-50/50 border border-blue-100 rounded-xl text-center">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold mb-1">Percentage</p>
              <p className="text-2xl font-extrabold text-[#1d4ed8] font-mono">{pct}%</p>
            </div>
            <div className="p-4 bg-blue-50/50 border border-blue-100 rounded-xl text-center">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold mb-1">Correct</p>
              <p className="text-2xl font-extrabold text-emerald-600 font-mono">{correctCount}/{questions.length}</p>
            </div>
          </div>

          {/* Per-question breakdown */}
          {breakdown.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Question Breakdown</p>
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {breakdown.map((b, i) => (
                  <div key={i} className={`flex items-center justify-between px-3 py-2 rounded-lg border text-xs ${
                    b.isCorrect ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-red-50 border-red-200 text-red-800"
                  }`}>
                    <span className="font-medium">Q{i + 1}</span>
                    <span>{b.isCorrect ? "✓ Correct" : "✗ Incorrect"}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Exit button */}
          <button
            onClick={() => { if (window.electronAPI?.closeApp) window.electronAPI.closeApp(); }}
            className="w-full py-3 px-6 rounded-xl bg-[#1d4ed8] hover:bg-blue-700 text-white font-bold text-sm shadow-md shadow-blue-600/20 transition cursor-pointer"
          >
            Close Application
          </button>
        </div>
      </div>
    );
  }

  // ----------------------------------------------------
  // SCREEN 2: ACTIVE EXAMINATION INTERFACE
  // ----------------------------------------------------
  if (activeScreen === "exam") {
    return (
      <div className="min-h-screen bg-[#f0f4ff] text-[#111827] flex flex-col font-sans relative select-none">
        {renderEscToast()}
        {renderIpcWarningToast()}
        {renderViolationModal()}
        {renderQuitWarningModal()}
        {renderRulesModal()}
        {renderBackendModal()}

        {/* Persistent Non-Dismissable UFM Banner */}
        {ufmLocked && (
          <div className="w-full bg-red-600 text-white font-bold text-center py-2.5 px-4 text-xs sm:text-sm tracking-wide shadow-md flex items-center justify-center gap-2 z-50">
            <span>⚠️ UFM Suspected — Your session is under enhanced monitoring. All actions are being recorded.</span>
          </div>
        )}

        {/* Top Header */}
        <header className="h-16 border-b border-blue-200 bg-white px-6 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-100 border border-blue-200 flex items-center justify-center font-bold text-[#1d4ed8]">
              ⚡
            </div>
            <div>
              <h1 className="font-semibold text-sm text-[#111827]">Example Test</h1>
              <p className="text-xs text-gray-500">Computer Science & Systems Architecture</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* Backend Status Button */}
            <button
              onClick={() => {
                refreshBackendStats();
                setShowBackendModal(true);
              }}
              className="flex items-center gap-2 bg-blue-50 border border-blue-200 hover:border-blue-400 px-3 py-1.5 rounded-lg text-xs transition cursor-pointer"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="text-gray-700 font-medium">Backend Sync Active</span>
            </button>

            {/* Live Proctor Status */}
            <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 px-3 py-1.5 rounded-full">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span>
              <span className="text-xs font-medium text-[#1d4ed8]">Proctor Monitoring Active</span>
              <span className="text-[10px] font-mono text-red-600 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded flex items-center gap-1 font-bold">
                <span>🔒</span> ESC LOCKED
              </span>
            </div>

            {/* Timer */}
            <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 px-4 py-1.5 rounded-lg">
              <span className="text-xs text-gray-500 font-medium">Time Left:</span>
              <span className="font-mono text-sm font-bold text-[#1d4ed8]">{formatTimer(timeLeft)}</span>
            </div>
          </div>
        </header>

        {/* Main Exam Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left Column: Questions */}
          <main className="flex-1 p-8 overflow-y-auto max-w-4xl mx-auto">
            <div className="bg-white border border-blue-200 rounded-2xl p-6 shadow-md space-y-6">
              <div className="flex items-center justify-between border-b border-blue-100 pb-4">
                <span className="text-xs uppercase tracking-wider font-semibold text-[#1d4ed8] bg-blue-50 border border-blue-200 px-2.5 py-1 rounded">
                  Question {currentQuestion + 1} of {questions.length}
                </span>
                <span className="text-xs text-gray-500">Single Choice • {questions[currentQuestion]?.marks || 2.0} Marks</span>
              </div>

              <h2 className="text-lg font-semibold text-[#111827] leading-relaxed">
                {questions[currentQuestion]?.question}
              </h2>

              <div className="space-y-3 pt-2">
                {questions[currentQuestion]?.options?.map((option, idx) => {
                  const isSelected = selectedAnswers[currentQuestion] === idx;
                  return (
                    <button
                      key={idx}
                      onClick={() => setSelectedAnswers({ ...selectedAnswers, [currentQuestion]: idx })}
                      className={`w-full text-left p-4 rounded-xl border transition flex items-center gap-3.5 cursor-pointer ${
                        isSelected
                          ? "bg-blue-50 border-2 border-[#1d4ed8] text-[#1d4ed8] font-medium"
                          : "bg-white border-blue-200 hover:bg-blue-50/50 text-[#111827]"
                      }`}
                    >
                      <div
                        className={`w-5 h-5 rounded-full border flex items-center justify-center text-xs font-semibold ${
                          isSelected ? "border-[#1d4ed8] bg-[#1d4ed8] text-white" : "border-gray-300 text-gray-500"
                        }`}
                      >
                        {String.fromCharCode(65 + idx)}
                      </div>
                      <span className="text-sm">{option}</span>
                    </button>
                  );
                })}
              </div>

              {/* Navigation Controls */}
              <div className="flex items-center justify-between pt-6 border-t border-blue-100">
                <button
                  disabled={currentQuestion === 0}
                  onClick={() => setCurrentQuestion((prev) => prev - 1)}
                  className="px-4 py-2 text-sm rounded-lg bg-gray-100 hover:bg-gray-200 border border-gray-300 text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
                >
                  ← Previous
                </button>

                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      if (currentQuestion < questions.length - 1) {
                        setCurrentQuestion((prev) => prev + 1);
                      }
                    }}
                    className="px-5 py-2 text-sm rounded-lg bg-[#1d4ed8] hover:bg-blue-700 text-white font-medium shadow-md shadow-blue-600/20 transition cursor-pointer"
                  >
                    {currentQuestion === questions.length - 1 ? "Save & Review" : "Save & Next →"}
                  </button>
                </div>
              </div>
            </div>
          </main>

          {/* Right Sidebar: Floating Proctor Cam & Palette */}
          <aside className="w-80 border-l border-blue-200 bg-white p-5 flex flex-col gap-6">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Live Video Feed</span>
                <span className="flex items-center gap-1.5 text-[10px] text-red-600 font-bold bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></span> REC
                </span>
              </div>
              <div className="relative w-full aspect-video bg-gray-100 rounded-xl overflow-hidden border border-blue-200 shadow-inner">
                <video
                  ref={examVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover -scale-x-100"
                />
                <div className="absolute bottom-2 left-2 bg-white/80 backdrop-blur px-2 py-0.5 rounded text-[10px] text-gray-700 border border-gray-200">
                  AI Proctor ID: 884-X
                </div>
              </div>

              <button
                onClick={captureSnapshot}
                className="w-full py-2 px-3 rounded-lg bg-blue-50 hover:bg-blue-100 border border-blue-200 text-[#1d4ed8] text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer shadow-sm"
              >
                📸 Capture Snapshot (ImageCapture API)
              </button>

              {snapshotStatus && (
                <div className="text-[10px] text-emerald-700 font-mono text-center animate-fade-in bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-md">
                  ✓ {snapshotStatus}
                </div>
              )}
            </div>

            {/* Question Palette */}
            <div className="space-y-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Questions Overview</span>
              <div className="grid grid-cols-4 gap-2">
                {questions.map((_, i) => {
                  const isAnswered = selectedAnswers[i] !== undefined;
                  const isCurrent = currentQuestion === i;
                  return (
                    <button
                      key={i}
                      onClick={() => setCurrentQuestion(i)}
                      className={`h-10 rounded-lg text-xs font-semibold transition border cursor-pointer ${
                        isCurrent
                          ? "border-[#1d4ed8] ring-2 ring-blue-300 text-[#1d4ed8] bg-blue-50"
                          : isAnswered
                          ? "bg-[#1d4ed8] border-[#1d4ed8] text-white"
                          : "bg-gray-50 border-blue-200 text-gray-700 hover:bg-blue-50/50"
                      }`}
                    >
                      {i + 1}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Submit Exam Button */}
            <div className="mt-auto pt-4 border-t border-blue-100">
              <button
                onClick={handleSubmitExam}
                className="w-full py-3 bg-[#1d4ed8] hover:bg-blue-700 text-white font-semibold rounded-xl text-sm shadow-md shadow-blue-600/20 transition cursor-pointer"
              >
                Submit Exam
              </button>
            </div>
          </aside>
        </div>
      </div>
    );
  }

  // ----------------------------------------------------
  // SCREEN 1: PERMISSIONS & SYSTEM DIAGNOSTIC (DESKTOP ATHENA)
  // ----------------------------------------------------
  return (
    <div className="min-h-screen bg-[#f0f4ff] text-[#111827] flex flex-col items-center justify-center p-6 select-none font-sans relative">
      {renderEscToast()}
      {renderIpcWarningToast()}
      {renderViolationModal()}
      {renderQuitWarningModal()}
      {renderRulesModal()}
      {renderBackendModal()}

      {/* Top Brand Banner */}
      <div className="w-full max-w-2xl text-center mb-8 space-y-2">
        <div className="inline-flex items-center gap-3 px-3 py-1 rounded-full bg-white border border-blue-200 text-xs text-gray-700 mb-1 shadow-sm">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            Desktop Athena is monitoring your test
          </span>
          <span className="text-gray-300">|</span>
          <button
            onClick={() => {
              refreshBackendStats();
              setShowBackendModal(true);
            }}
            className="text-[#1d4ed8] hover:underline font-semibold cursor-pointer flex items-center gap-1"
          >
            <span>🖥️</span> Backend Status & Logs
          </button>
        </div>

        <div className="flex items-center justify-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-blue-100 border border-blue-200 flex items-center justify-center text-lg text-[#1d4ed8] font-bold">
            🛡️
          </div>
          <h1 className="text-2xl font-black tracking-wider text-[#111827] uppercase">Desktop Athena</h1>
        </div>
        <p className="text-xs text-gray-500">
          Complete all system checks below to unlock your assessment.
        </p>
      </div>

      {/* Main Container Card */}
      <div className="w-full max-w-2xl bg-white border border-blue-200 rounded-2xl shadow-xl p-6 md:p-8 space-y-6">
        {/* Step 1: Camera Permission */}
        <div className="p-5 rounded-xl bg-blue-50/40 border border-blue-200 transition-all hover:border-blue-300">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1.5 flex-1">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-100 border border-blue-200 flex items-center justify-center text-[#1d4ed8]">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </div>
                <h3 className="font-semibold text-base text-[#111827]">Turn on Your Camera</h3>
              </div>
              <p className="text-xs text-gray-600">Start your camera to proceed with the test.</p>

              {videoGranted ? (
                <div className="pt-2">
                  <div className="flex items-center gap-1.5 text-xs text-emerald-600 font-semibold">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                    </svg>
                    Permission Given
                  </div>
                  <p className="text-[11px] text-gray-500 pt-0.5">Using your {cameraDevice || "Native Camera"}.</p>
                </div>
              ) : (
                <div className="pt-2">
                  <button
                    onClick={requestVideo}
                    className="px-4 py-2 text-xs font-semibold rounded-lg bg-[#1d4ed8] hover:bg-blue-700 text-white transition shadow-sm cursor-pointer"
                  >
                    Grant Camera Access
                  </button>
                </div>
              )}
            </div>

            {/* Video Preview Box */}
            <div className="w-full md:w-56 h-36 bg-gray-100 rounded-xl overflow-hidden border border-blue-200 relative flex items-center justify-center">
              {videoGranted ? (
                <>
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover -scale-x-100"
                  />
                  <div className="absolute top-2 right-2 flex items-center gap-1 bg-white/90 px-2 py-0.5 rounded text-[10px] text-emerald-600 font-bold border border-emerald-200">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span> LIVE
                  </div>
                </>
              ) : (
                <div className="text-center p-3 text-gray-400 space-y-1">
                  <svg className="w-8 h-8 mx-auto opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  <p className="text-[11px]">Camera Inactive</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Step 2: Audio / Microphone Permission */}
        <div className="p-5 rounded-xl bg-blue-50/40 border border-blue-200 transition-all hover:border-blue-300">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1.5 flex-1">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-100 border border-blue-200 flex items-center justify-center text-[#1d4ed8]">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                </div>
                <h3 className="font-semibold text-base text-[#111827]">Enable Your Microphone</h3>
              </div>
              <p className="text-xs text-gray-600">Kindly allow microphone access for acoustic integrity check.</p>

              {audioGranted ? (
                <div className="pt-2">
                  <div className="flex items-center gap-1.5 text-xs text-emerald-600 font-semibold">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                    </svg>
                    Permission Given
                  </div>
                  <p className="text-[11px] text-gray-500 pt-0.5">Using your {audioDevice || "Default Microphone"}.</p>
                </div>
              ) : (
                <div className="pt-2">
                  <button
                    onClick={requestAudio}
                    className="px-4 py-2 text-xs font-semibold rounded-lg bg-[#1d4ed8] hover:bg-blue-700 text-white transition shadow-sm cursor-pointer"
                  >
                    Grant Audio Access
                  </button>
                </div>
              )}
            </div>

            {/* Audio Visualizer Level Meter */}
            <div className="w-full md:w-56 h-36 bg-gray-100 rounded-xl border border-blue-200 p-4 flex flex-col justify-center items-center space-y-3">
              {audioGranted ? (
                <div className="w-full space-y-2 text-center">
                  <span className="text-[10px] text-gray-500 font-medium tracking-wider uppercase">Live Audio Signal</span>
                  <div className="flex items-center justify-center gap-1.5 h-12">
                    {[1, 2, 3, 4, 5, 6, 7].map((bar) => {
                      const dynamicHeight = Math.max(8, Math.min(48, (audioLevel * (bar % 3 + 1)) / 2));
                      return (
                        <div
                          key={bar}
                          style={{ height: `${dynamicHeight}px` }}
                          className="w-2 rounded-full bg-gradient-to-t from-blue-600 to-blue-400 transition-all duration-75"
                        />
                      );
                    })}
                  </div>
                  <div className="text-[11px] font-mono text-[#1d4ed8] font-semibold">{audioLevel > 5 ? "Mic Active (Speaking)" : "Mic Ready"}</div>
                </div>
              ) : (
                <div className="text-center p-3 text-gray-400 space-y-1">
                  <svg className="w-8 h-8 mx-auto opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                  <p className="text-[11px]">Microphone Inactive</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Step 3: Fullscreen Mode */}
        <div className="p-5 rounded-xl bg-blue-50/40 border border-blue-200 transition-all hover:border-blue-300">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1.5 flex-1">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-100 border border-blue-200 flex items-center justify-center text-[#1d4ed8]">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 8V4m0 0h4M4 4l5 5m11-5h-4m4 0v4m0-4l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                  </svg>
                </div>
                <h3 className="font-semibold text-base text-[#111827]">Share your Entire Screen / Fullscreen</h3>
              </div>
              <p className="text-xs text-gray-600">Kindly enter fullscreen mode to ensure proctor compliance.</p>

              {isFullscreen ? (
                <div className="pt-2 space-y-1">
                  <div className="flex items-center gap-2 text-xs text-emerald-600 font-semibold">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                    </svg>
                    Fullscreen Active
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-red-50 text-red-700 border border-red-200 flex items-center gap-1 font-bold">
                      <span>🔒</span> ESC LOCKED
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-500">
                    Application locked in focus mode. Pressing <kbd className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 border border-gray-300 font-mono text-[10px]">Esc</kbd> has no effect.
                  </p>
                </div>
              ) : (
                <div className="pt-2">
                  <button
                    onClick={toggleFullscreen}
                    className="px-4 py-2 text-xs font-semibold rounded-lg bg-[#1d4ed8] hover:bg-blue-700 text-white transition shadow-sm cursor-pointer"
                  >
                    Enter Fullscreen Mode
                  </button>
                </div>
              )}
            </div>

            {/* Fullscreen Status Visual */}
            <div className="w-full md:w-56 h-36 bg-gray-100 rounded-xl border border-blue-200 p-4 flex flex-col justify-center items-center text-center">
              <div
                className={`w-14 h-10 rounded border-2 transition-all flex items-center justify-center font-bold text-xs ${
                  isFullscreen ? "border-[#1d4ed8] bg-blue-50 text-[#1d4ed8] scale-105" : "border-gray-300 text-gray-400"
                }`}
              >
                {isFullscreen ? "🔒 FULL" : "⛶"}
              </div>
              <span className="text-[11px] text-gray-700 mt-2 font-medium">
                {isFullscreen ? "Display Locked" : "Windowed Mode"}
              </span>
              <span className={`text-[10px] font-mono mt-0.5 ${isFullscreen ? "text-[#1d4ed8] font-semibold" : "text-gray-400"}`}>
                {isFullscreen ? "Esc Key Disabled" : "Press button to lock"}
              </span>
            </div>
          </div>
        </div>

        {/* Privacy Policy / Academic Integrity Notice */}
        <div className="pt-2 border-t border-blue-100 text-left space-y-1.5">
          <h4 className="text-xs font-bold text-gray-700">Desktop Athena & Privacy Audit</h4>
          <p className="text-[11px] text-gray-500 leading-relaxed">
            Audit logs, submissions, violation markers, and camera frames are securely processed by the Express backend (port 5000) and synced with the Electron main process. Access is restricted to authorized proctoring personnel only.
          </p>
        </div>

        {/* Action Button & Start Page Indicator */}
        <div className="pt-2 text-center space-y-3">
          {allChecksPassed ? (
            <div className="space-y-3">
              <p className="text-xs font-semibold text-emerald-600">
                All checks verified — Desktop Athena is active and connected.
              </p>
              <button
                onClick={() => setShowRulesModal(true)}
                className="w-full py-3.5 px-6 rounded-xl bg-[#1d4ed8] hover:bg-blue-700 text-white font-bold text-sm shadow-xl shadow-blue-600/30 transition-all cursor-pointer"
              >
                Begin Examination →
              </button>
            </div>
          ) : (
            <div className="p-3 bg-blue-50/60 border border-blue-200 rounded-xl text-center">
              <p className="text-xs text-gray-600">
                Please complete all 3 requirements above (
                <span className={videoGranted ? "text-emerald-600 font-semibold" : "text-amber-600 font-semibold"}>Camera</span>,{" "}
                <span className={audioGranted ? "text-emerald-600 font-semibold" : "text-amber-600 font-semibold"}>Audio</span>,{" "}
                <span className={isFullscreen ? "text-emerald-600 font-semibold" : "text-amber-600 font-semibold"}>Fullscreen</span>) to unlock the exam.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Display Screen Snapshots on Onboarding screen */}
      {screenSnapshots.length > 0 && (
        <div className="w-full max-w-2xl mt-8 pt-4 border-t border-blue-200">
          <h3 className="text-gray-700 font-bold mb-3 text-center">Taken Screen Snapshots</h3>
          <div className="flex flex-wrap justify-center gap-4 overflow-y-auto max-h-48 custom-scrollbar">
            {screenSnapshots.map((src, i) => (
              <img
                key={i}
                src={src}
                alt={`Screenshot ${i + 1}`}
                className="w-48 h-auto border border-blue-200 rounded-md shadow-md"
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;