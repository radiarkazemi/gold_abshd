import { useEffect, useRef, useState } from "react";
import { fetchPrice, openPriceSocket, fetchOrderLimits } from "../api";
import { personalizePrice } from "../utils/priceCommission";

export function usePriceFeed() {
  const [cards, setCards] = useState([]);          // every enabled card, personalized with this user's commission
  const [prevCards, setPrevCards] = useState([]);   // previous tick's cards, for up/down flash comparisons
  const [connected, setConnected] = useState(false);
  const [priceLabelMode, setPriceLabelMode] = useState("mesghal_and_gram18");
  const wsRef = useRef(null);
  const retryRef = useRef(null);
  // Kept in a ref (not state) so the WS onmessage closure below always
  // reads the latest value without needing to reconnect the socket
  // whenever it changes.
  const commissionRef = useRef({ commission_type: "fixed", commission_value: 0 });
  const rawCardsRef = useRef([]); // last raw (pre-commission) cards, for re-personalizing when commission arrives late

  useEffect(() => {
    let cancelled = false;

    function personalizeAll(rawCards) {
      const { commission_type, commission_value } = commissionRef.current;
      return (rawCards || []).map((c) => personalizePrice(c, commission_type, commission_value));
    }

    function applyPayload(payload) {
      const raw = payload.cards || [];
      rawCardsRef.current = raw;
      setCards((old) => {
        setPrevCards(old);
        return personalizeAll(raw);
      });
    }

    // Load this user's own commission (from their role) once, so every
    // card's price reflects what THEY would actually pay/receive - not
    // the raw source price everyone would otherwise see identically.
    // Also picks up their price_label_mode (مثقال+گرم۱۸ vs گرم۱۸ only).
    fetchOrderLimits()
      .then((limits) => {
        if (cancelled) return;
        commissionRef.current = {
          commission_type: limits.commission_type,
          commission_value: limits.commission_value,
        };
        setPriceLabelMode(limits.price_label_mode || "mesghal_and_gram18");
        // Re-personalize whatever cards we already have, in case they
        // arrived before this resolved.
        setCards(personalizeAll(rawCardsRef.current));
      })
      .catch(() => {});

    // Initial value via REST so the UI isn't empty while the socket connects
    fetchPrice()
      .then((payload) => !cancelled && applyPayload(payload))
      .catch(() => {});

    function connect() {
      const ws = openPriceSocket((payload) => {
        applyPayload(payload);
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

  return { cards, prevCards, connected, priceLabelMode };
}