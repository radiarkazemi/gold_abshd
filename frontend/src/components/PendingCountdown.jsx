import { useEffect, useRef, useState } from "react";
import { formatMMSS, localDeadlineMsFromOrder } from "../utils/orderCountdown";

/**
 * Live MM:SS countdown for a pending order on the admin side.
 * Calls onExpire once when the local window hits zero so the parent
 * can drop the card without waiting for the next poll.
 */
export default function PendingCountdown({ order, onExpire }) {
  const deadlineRef = useRef(localDeadlineMsFromOrder(order));
  const expiredRef = useRef(false);
  const [secondsLeft, setSecondsLeft] = useState(() =>
    Math.max(0, Math.ceil((deadlineRef.current - Date.now()) / 1000))
  );

  useEffect(() => {
    deadlineRef.current = localDeadlineMsFromOrder(order);
    expiredRef.current = false;
    setSecondsLeft(Math.max(0, Math.ceil((deadlineRef.current - Date.now()) / 1000)));
    // Re-anchor only when the server window itself changes - not on every
    // parent re-render of the order object identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id, order?.pending_deadline_at, order?.seconds_remaining, order?.retry_count]);

  useEffect(() => {
    const id = setInterval(() => {
      const left = Math.max(0, Math.ceil((deadlineRef.current - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left <= 0 && !expiredRef.current) {
        expiredRef.current = true;
        onExpire?.(order.id);
      }
    }, 250);
    return () => clearInterval(id);
  }, [order?.id, onExpire]);

  if (secondsLeft <= 0) {
    return <span className="order-card__countdown order-card__countdown--expired">۰۰:۰۰</span>;
  }

  return (
    <span className={`order-card__countdown ${secondsLeft <= 15 ? "order-card__countdown--urgent" : ""}`}>
      {formatMMSS(secondsLeft)}
    </span>
  );
}
