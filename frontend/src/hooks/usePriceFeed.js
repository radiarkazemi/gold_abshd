import { useEffect, useRef, useState } from "react";
import { fetchPrice, openPriceSocket } from "../api";

export function usePriceFeed() {
  const [price, setPrice] = useState(null);
  const [connected, setConnected] = useState(false);
  const [prevPrice, setPrevPrice] = useState(null);
  const wsRef = useRef(null);
  const retryRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    // Initial value via REST so the UI isn't empty while the socket connects
    fetchPrice()
      .then((p) => !cancelled && setPrice(p))
      .catch(() => {});

    function connect() {
      const ws = openPriceSocket((newPrice) => {
        setPrice((old) => {
          setPrevPrice(old);
          return newPrice;
        });
      });
      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        if (!cancelled) {
          retryRef.current = setTimeout(connect, 2000);
        }
      };
      ws.onerror = () => ws.close();
      wsRef.current = ws;
    }

    connect();

    return () => {
      cancelled = true;
      clearTimeout(retryRef.current);
      wsRef.current?.close();
    };
  }, []);

  return { price, prevPrice, connected };
}
