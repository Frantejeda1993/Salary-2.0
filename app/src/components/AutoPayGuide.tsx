/** «Apuntar pagos automáticamente»: la guía de iPhone (Apple Pay + Atajos) y la de Android (app + avisos). */
import { useState } from "react";
import type { Platform } from "../lib/platform";
import AndroidGuide from "./AndroidGuide";
import ShortcutGuide from "./ShortcutGuide";

export default function AutoPayGuide({ platform }: { platform: Platform }) {
  const [os, setOs] = useState<"iphone" | "android">(platform === "other" ? "iphone" : "android");
  return (
    <>
      <div className="segmented autopay-tabs" role="tablist" aria-label="Tu móvil">
        <button role="tab" aria-selected={os === "iphone"} aria-pressed={os === "iphone"} onClick={() => setOs("iphone")}>iPhone</button>
        <button role="tab" aria-selected={os === "android"} aria-pressed={os === "android"} onClick={() => setOs("android")}>Android</button>
      </div>
      {os === "iphone" ? <ShortcutGuide /> : <AndroidGuide platform={platform} />}
    </>
  );
}
