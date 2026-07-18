import { useEffect, useRef, useState } from "react";
import { fetchPrice, openPriceSocket, fetchOrderLimits } from "../api";
import { personalizePrice } from "../utils/priceCommission";

export function usePriceFeed() {
  const [price, setPrice] = useState(null);
  const [connected, setConnected] = useState(false);
  const [prevPrice, setPrevPrice] = useState(null);
  const wsRef = useRef(null);
  const retryRef = useRef(null);
  // Kept in a ref (not state) so the WS onmessage closure below always
  // reads the latest value without needing to reconnect the socket
  // whenever it changes.
  const commissionRef = useRef({ commission_type: "fixed", commission_value: 0 });

  useEffect(() => {
    let cancelled = false;

    function personalize(raw) {
      const { commission_type, commission_value } = commissionRef.current;
      const personalized = personalizePrice(raw, commission_type, commission_value);
      // Keep the raw values around so a late-arriving commission fetch
      // can re-personalize this exact tick instead of waiting for the
      // next one.
      return { ...personalized, __raw: raw };
    }

    // Load this user's own commission (from their role) once, so every
    // price shown reflects what THEY would actually pay/receive - not
    // the raw source price everyone would otherwise see identically.
    fetchOrderLimits()
      .then((limits) => {
        if (cancelled) return;
        commissionRef.current = {
          commission_type: limits.commission_type,
          commission_value: limits.commission_value,
        };
        // Re-personalize whatever price we already have, in case it
        // arrived before this resolved.
        setPrice((old) => (old ? personalize(old.__raw || old) : old));
      })
      .catch(() => {});

    // Initial value via REST so the UI isn't empty while the socket connects
    fetchPrice()
      .then((p) => !cancelled && setPrice(personalize(p)))
      .catch(() => {});

    function connect() {
      const ws = openPriceSocket((newPrice) => {
        setPrice((old) => {
          setPrevPrice(old);
          return personalize(newPrice);
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