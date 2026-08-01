import { useEffect, useRef, useState } from "react";
import { fetchPrice, openPriceSocket, fetchOrderLimits } from "../api";
import { personalizePrice } from "../utils/priceCommission";

export function usePriceFeed() {
  const [cards, setCards] = useState([]);          // every enabled card, personalized with this user's commission
  const [prevCards, setPrevCards] = useState([]);   // previous tick's cards, for up/down flash comparisons
  const [connected, setConnected] = useState(false);
  const [priceLabelMode, setPriceLabelMode] = useState("mesghal_and_gram18");
  const [tradingBanned, setTradingBanned] = useState(false);
  const wsRef = useRef(null);
  const retryRef = useRef(null);
  // Kept in a ref (not state) so the WS onmessage closure below always
  // reads the latest value without needing to reconnect the socket
  // whenever it changes.
  const commissionRef = useRef({
    commission_type: "fixed",
    commission_value: 0,
    // goldbridge_item_id -> { commission_type, commission_value }
    by_card: {},
  });
  const rawCardsRef = useRef([]); // last raw (pre-commission) cards, for re-personalizing when commission arrives late

  useEffect(() => {
    let cancelled = false;

    function personalizeAll(rawCards) {
      const { commission_type, commission_value, by_card } = commissionRef.current;
      return (rawCards || []).map((c) => {
        const override = c.goldbridge_item_id != null ? by_card[c.goldbridge_item_id] : null;
        return personalizePrice(
          c,
          override?.commission_type ?? commission_type,
          override?.commission_value ?? commission_value,
        );
      });
    }

    function applyPayload(payload) {
      const raw = payload.cards || [];
      rawCardsRef.current = raw;
      setCards((old) => {
        setPrevCards(old);
        return personalizeAll(raw);
      });
    }

    // Load this user's own commission (role default + per-card overrides)
    // so every card's price reflects what THEY would actually pay/receive.
    // Re-poll periodically so admin commission edits on قیمت‌ها land without
    // forcing a full page reload.
    function applyLimits(limits) {
      if (cancelled || !limits) return;
      const byCard = {};
      for (const row of limits.card_commissions || []) {
        byCard[row.goldbridge_item_id] = {
          commission_type: row.commission_type,
          commission_value: row.commission_value,
        };
      }
      commissionRef.current = {
        commission_type: limits.commission_type,
        commission_value: limits.commission_value,
        by_card: byCard,
      };
      setPriceLabelMode(limits.price_label_mode || "mesghal_and_gram18");
      setTradingBanned(!!limits.trading_banned);
      setCards(personalizeAll(rawCardsRef.current));
    }

    fetchOrderLimits().then(applyLimits).catch(() => {});
    const limitsPoll = setInterval(() => {
      fetchOrderLimits().then(applyLimits).catch(() => {});
    }, 15000);

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
      clearInterval(limitsPoll);
      wsRef.current?.close();
    };
  }, []);

  return { cards, prevCards, connected, priceLabelMode, tradingBanned };
}
