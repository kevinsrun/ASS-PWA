"use client";

import { useEffect, useState } from "react";

function isIosStandalone() {
  if (typeof window === "undefined") return false;

  const navigatorWithStandalone = window.navigator as Navigator & {
    standalone?: boolean;
  };

  return Boolean(navigatorWithStandalone.standalone);
}

export default function InstallPrompt() {
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    const isIos = /iphone|ipad|ipod/i.test(window.navigator.userAgent);
    const dismissed = localStorage.getItem("ass_install_prompt_dismissed");

    setShowPrompt(isIos && !isIosStandalone() && dismissed !== "true");
  }, []);

  if (!showPrompt) return null;

  return (
    <div className="fixed inset-x-3 bottom-[calc(5.25rem+env(safe-area-inset-bottom))] z-40 rounded-3xl border border-emerald-100 bg-white/95 p-4 text-sm text-slate-700 shadow-2xl shadow-emerald-900/10 backdrop-blur md:hidden">
      <div className="font-semibold text-emerald-950">Install ASS on iPhone</div>
      <p className="mt-1">
        In Safari, tap Share, then Add to Home Screen for the app-style version.
      </p>
      <button
        onClick={() => {
          localStorage.setItem("ass_install_prompt_dismissed", "true");
          setShowPrompt(false);
        }}
        className="mt-3 rounded-full bg-emerald-600 px-4 py-2 text-xs font-medium text-white"
      >
        Got it
      </button>
    </div>
  );
}
