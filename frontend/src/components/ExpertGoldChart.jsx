import { useEffect, useId, useRef } from "react";
import { useTheme } from "../context/ThemeContext";

/**
 * Live XAU/USD chart for the expert desk — fills spare vertical space
 * so the admin can watch spot gold while clearing pending orders.
 */
export default function ExpertGoldChart() {
  const { theme } = useTheme();
  const hostRef = useRef(null);
  const reactId = useId().replace(/:/g, "");
  const containerId = `expert-tv-${reactId}`;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    host.innerHTML = "";
    const chartBox = document.createElement("div");
    chartBox.id = containerId;
    chartBox.style.height = "100%";
    chartBox.style.width = "100%";
    host.appendChild(chartBox);

    let cancelled = false;

    function mount() {
      if (cancelled || !window.TradingView) return;
      // eslint-disable-next-line no-new
      new window.TradingView.widget({
        autosize: true,
        symbol: "OANDA:XAUUSD",
        interval: "1",
        timezone: "Asia/Tehran",
        theme: theme === "light" ? "light" : "dark",
        style: "1",
        locale: "en",
        toolbar_bg: theme === "light" ? "#f7f2e4" : "#1a1508",
        enable_publishing: false,
        hide_top_toolbar: false,
        hide_legend: false,
        save_image: false,
        container_id: containerId,
        backgroundColor: theme === "light" ? "#f7f2e4" : "#12100b",
        gridColor: theme === "light" ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.06)",
        allow_symbol_change: true,
        studies: [],
      });
    }

    if (window.TradingView) {
      mount();
    } else {
      const existing = document.querySelector('script[data-expert-tv="1"]');
      if (existing) {
        existing.addEventListener("load", mount);
      } else {
        const script = document.createElement("script");
        script.src = "https://s3.tradingview.com/tv.js";
        script.async = true;
        script.dataset.expertTv = "1";
        script.addEventListener("load", mount);
        document.body.appendChild(script);
      }
    }

    return () => {
      cancelled = true;
      if (host) host.innerHTML = "";
    };
  }, [theme, containerId]);

  return (
    <section className="expert-chart" aria-label="نمودار طلای جهانی">
      <header className="expert-chart__head">
        <h4>نمودار طلا (XAU/USD)</h4>
        <span>۱ دقیقه‌ای · تهران</span>
      </header>
      <div className="expert-chart__frame">
        <div ref={hostRef} className="expert-chart__host" />
      </div>
    </section>
  );
}
