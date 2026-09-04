import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Msym } from '../components/m3/Icon';
import { Card, EmptyState } from '../components/m3/Surface';
import { Button } from '../components/m3/Button';
import { db, allCustomers, prettyPhone, waFmt, esc } from '../data/store';
import { ensureChat, pushChat, botReply, welcomeText } from '../data/bot';
import { useDB } from '../context/AppContext';

const QUICK = ['Where is my parcel?', 'When will it be delivered?', 'Any delay?', 'Charges', 'Resend OTP', 'Talk to team'];

function timeHM(ts) {
  return new Date(ts).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase();
}

function dayLabel(ts) {
  return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function CustomerWhatsApp() {
  const data = useDB();
  const biz = data.business;
  const customers = allCustomers();
  const [params] = useSearchParams();

  const [me, setMe] = useState(() => {
    return params.get('phone')
      || localStorage.getItem('shippingco_current_phone')
      || customers[0]?.phone
      || '';
  });
  const [draft, setDraft] = useState('');
  const [typing, setTyping] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);
  /* Messages that arrived while the tab was hidden, replayed when it comes back. */
  const pendingRef = useRef<string[]>([]);

  useEffect(() => { localStorage.setItem('shippingco_current_phone', me); }, [me]);

  // seed welcome message for fresh personas
  useEffect(() => {
    if (!me) return;
    const chat = ensureChat(me);
    if (chat.msgs.length === 0) {
      const cust = data.bookings.find((b) => b.phone === me);
      pushChat(me, 'bot', welcomeText(cust?.name, biz.name, biz.botName));
    }
  }, [me]);

  const msgs = me ? (data.chats[me]?.msgs || []) : [];

  // auto-scroll
  useEffect(() => {
    const el = chatRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs.length, typing]);

  // outbox flush: business actions -> proactive WhatsApp messages
  useEffect(() => {
    function flush() {
      const ob = db().outbox.filter((m) => m.phone === me && !m.delivered);
      if (!ob.length) return;
      if (document.hidden) {
        ob.forEach((m) => (m.delivered = true));
        pendingRef.current.push(...ob.map((m) => m.text));
        document.title = `(${pendingRef.current.length}) ${biz.name} — WhatsApp`;
        return;
      }
      ob.forEach((m) => { m.delivered = true; pushChat(me, 'bot', m.text); });
    }
    const iv = setInterval(flush, 900);
    const onVis = () => {
      if (!document.hidden && pendingRef.current.length) {
        pendingRef.current.forEach((t) => pushChat(me, 'bot', t));
        pendingRef.current = [];
        document.title = `${biz.name} — WhatsApp`;
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', onVis); };
  }, [me, biz.name]);

  function send(text) {
    if (!text.trim() || !me) return;
    pushChat(me, 'me', text.trim());
    setDraft('');
    setTyping(true);
    setTimeout(() => {
      let reply;
      try { reply = botReply(me, text); } catch { reply = 'Sorry, something went wrong. Please try again.'; }
      pushChat(me, 'bot', reply);
      setTyping(false);
    }, 650 + Math.min(1200, text.length * 18));
  }

  const cust = data.bookings.find((b) => b.phone === me);

  if (!customers.length) {
    return (
      <div className="wa-stage" style={{ justifyContent: 'center' }}>
        <Card style={{ maxWidth: 420 }}>
          <EmptyState icon="person_off" title="No customers yet"
            sub="Book a parcel in the Business Console first — its confirmation and AI assistant will appear here."
            action={<a href="#/business"><Button icon="storefront" style={{ marginTop: 10 }}>Open Business Console</Button></a>} />
        </Card>
      </div>
    );
  }

  return (
    <div className="wa-stage">
      <div className="wa-persona-bar">
        <span className="t-label-md muted">SIMULATING WHATSAPP FOR</span>
        <label className="persona-select">
          <select value={me} onChange={(e) => setMe(e.target.value)} aria-label="Simulated customer">
            {customers.map((c) => (
              <option key={c.phone} value={c.phone}>{c.name} · {prettyPhone(c.phone)}</option>
            ))}
          </select>
          <Msym name="expand_more" />
        </label>
        <a href="#/" className="btn btn-text btn-sm">← Launcher</a>
        <a href="#/business" target="_blank" rel="noreferrer" className="btn btn-tonal btn-sm">
          <Msym name="open_in_new" /> Business Console
        </a>
      </div>

      <div className="phone">
        {/* WA header */}
        <div className="wa-head">
          <Msym name="arrow_back" />
          <div className="wa-avatar">{biz.logo ? <img src={biz.logo} alt="" /> : esc(biz.name.charAt(0))}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 14.5, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="u-truncate">{biz.name}</span>
              <span style={{ background: 'rgba(255,255,255,.16)', borderRadius: 6, fontSize: 9.5, fontWeight: 700, padding: '1px 5px', letterSpacing: '.04em' }}>AI BOT</span>
            </div>
            <div style={{ fontSize: 11.5, color: '#cfe9e2' }}>{typing ? 'typing…' : 'online'}</div>
          </div>
          <Msym name="more_vert" />
        </div>

        {/* chat body */}
        <div className="wa-chat" ref={chatRef}>
          <div className="day-chip"><span>{dayLabel(Date.now())}</span></div>
          {cust && (
            <div className="msg msg-bot" style={{ background: '#fdf4d9', maxWidth: '92%' }}>
              🔒 Messages with this business are simulated end-to-end for this prototype demo.
              <span className="msg-time">{timeHM(Date.now())}</span>
            </div>
          )}
          {msgs.map((m, i) => {
            const prev = msgs[i - 1];
            const newDay = prev && new Date(prev.ts).toDateString() !== new Date(m.ts).toDateString();
            return (
              <React.Fragment key={m.ts + '_' + i}>
                {newDay && <div className="day-chip"><span>{dayLabel(m.ts)}</span></div>}
                <div className={`msg ${m.from === 'bot' ? 'msg-bot' : 'msg-me'}`}>
                  <span dangerouslySetInnerHTML={{ __html: waFmt(m.text) }} />
                  <span className="msg-time">
                    {timeHM(m.ts)}
                    {m.from === 'me' && (
                      <svg className="tick-svg" viewBox="0 0 20 14" fill="none" stroke="#53bdeb" strokeWidth="1.8">
                        <path d="M1 8l3.5 3.5L11 5" /><path d="M8 11l6.5-6.5" opacity="0.9" />
                      </svg>
                    )}
                  </span>
                </div>
              </React.Fragment>
            );
          })}
          {typing && (
            <div className="msg msg-bot typing-bubble"><i></i><i></i><i></i></div>
          )}
        </div>

        {/* quick replies */}
        <div className="qr-row">
          {QUICK.map((q) => (
            <button key={q} className="qr-chip" onClick={() => send(q)}>{q}</button>
          ))}
        </div>

        {/* composer */}
        <form className="wa-inputbar" onSubmit={(e) => { e.preventDefault(); send(draft); }}>
          <input
            placeholder="Type a message"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoComplete="off"
          />
          <button type="submit" className="wa-send" aria-label="Send">
            <Msym name="send" fill />
          </button>
        </form>
      </div>

      <p className="t-body-sm faint" style={{ marginTop: 14, textAlign: 'center', maxWidth: 480 }}>
        Try: book a parcel in the Business Console → this chat receives the docket instantly.
        Report a route delay → every affected customer gets an alert here automatically.
      </p>
    </div>
  );
}
