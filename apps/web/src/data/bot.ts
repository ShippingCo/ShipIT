/* ============================================================
   AI Agent — intent engine for the customer WhatsApp bot

   Every reply is classified, and the outcome is recorded via logBotTurn so the
   business console can show what the agent actually did: how many questions it
   answered, how many customers thanked it, and which conversations it could not
   handle and had to hand to a person.
   ============================================================ */

import {
  db, save, bookingsByPhone, findByDocket, activeDelayFor, logBotTurn,
  fmtMoney, fmtDT, STATUS_LABEL, grossOf } from './store';
import type { Booking, Chat, ChatSender, DispatchRoute, RouteEvent } from './types';

export function ensureChat(phone: string): Chat {
  const data = db();
  let chat = data.chats[phone];
  if (!chat) { chat = { updatesOptIn: true, msgs: [] }; data.chats[phone] = chat; }
  return chat;
}

export function pushChat(phone: string, from: ChatSender, text: string) {
  const chat = ensureChat(phone);
  chat.msgs.push({ from, text, ts: Date.now() });
  save();
}

const detectDockets = (t: string): string[] => String(t || '').toUpperCase().match(/SBC\d{5,}/g) || [];

function etaLine(b: Booking) {
  return `Estimated delivery: *${fmtDT(b.etaTs || Date.now() + b.etaDays * 864e5)}*`;
}

function trackCard(b: Booking) {
  const delay = activeDelayFor(b);
  let s = `📦 *${b.docket}*
To: ${b.to} • ${b.serviceType}
Status: *${STATUS_LABEL[b.status]}*
${etaLine(b)}`;
  if (delay) s += `\n⚠️ Currently delayed — ${delay.event.title}${delay.event.note && delay.event.note !== delay.event.title ? ' — ' + delay.event.note : ''}`;
  return s;
}

function delayDesc(ev: RouteEvent) {
  return `${ev.title}${ev.note && ev.note !== ev.title ? ' — ' + ev.note : ''}`;
}

function noParcelReply() {
  return `I don't see any parcel booked on this number yet. If you booked at the counter today, the confirmation will reach here within a few minutes 📩`;
}

export function welcomeText(name: string | undefined, bizName: string, botName: string) {
  return `Namaste ${name ? name.split(' ')[0] + ' ' : ''}ji 🙏 Welcome to *${bizName}*.\nI am ${botName}, your delivery assistant on WhatsApp.\n\nYou can ask me things like:\n• "Where is my parcel?"\n• "When will it be delivered?"\n• "Any delay?"\n• Type *MENU* anytime.`;
}

/* Returns { intent, text }. botReply unwraps it and records the outcome. */
function compose(phone: string, raw: string): { intent: string; text: string } {
  const t = String(raw || '').trim();
  const q = t.toLowerCase();
  const mine = bookingsByPhone(phone);
  const biz = db().business;

  // 0. explicit docket(s)
  const dockets = detectDockets(t);
  if (dockets.length) {
    const found = dockets.map(findByDocket).filter((b): b is Booking => !!b);
    const valid = found.filter((b) => b.phone === phone);
    if (!valid.length) {
      return {
        intent: 'track',
        text: found.length
          ? `That docket belongs to a different mobile number 🔒 For privacy, I can only share details on the registered number.`
          : `I couldn't find ${dockets[0]} 😕 Please check the number, or type *"my parcels"*.`,
      };
    }
    return { intent: 'track', text: valid.map(trackCard).join('\n\n') };
  }

  // 0b. gratitude — the clearest signal the agent actually helped, so it is measured
  if (/(thank|thanks|thnx|dhanyavad|dhanyawad|shukriya|great job|well done|good service|nice service)/.test(q)) {
    return {
      intent: 'thanks',
      text: `Thank you for the kind words 🙏 Glad I could help! Ask me anytime about your parcels.`,
    };
  }

  // 1. greeting / menu
  if (/^(hi|hii+|hello|hey|namaste|namaskar|start|menu)\b/.test(q)) {
    return {
      intent: 'menu',
      text: `Namaste! 🙏 I am *${biz.botName}*, assistant at *${biz.name}*.\nI can help with:\n\n1️⃣ Track my parcel\n2️⃣ Estimated delivery time\n3️⃣ Delay updates\n4️⃣ Charges / receipt copy\n5️⃣ Delivery OTP\n6️⃣ Talk to team (complaint)\n\nJust type your question or docket number.`,
    };
  }

  // 2. OTP
  if (/otp|password/.test(q)) {
    const ofd = mine.find((b) => b.status === 'out_for_delivery');
    if (ofd) {
      return {
        intent: 'otp',
        text: `🔐 Your delivery OTP for parcel *${ofd.docket}* is *${ofd.otp}*.\nShare it only after receiving the parcel in your hands.`,
      };
    }
    return {
      intent: 'otp',
      text: `An OTP is generated when your parcel goes *out for delivery*. It protects you from lost/stolen parcels — delivery can't complete without it.`,
    };
  }

  // 3. delays
  if (/delay|late|deri|problem|issue|stuck/.test(q)) {
    if (!mine.length) return { intent: 'delay', text: noParcelReply() };
    type Delayed = { b: Booking; d: { route: DispatchRoute; event: RouteEvent } };
    const delayed = mine
      .map((b) => ({ b, d: activeDelayFor(b) }))
      .filter((x): x is Delayed => !!x.d && x.b.status !== 'delivered');
    if (!delayed.length) {
      return {
        intent: 'delay',
        text: `Good news — none of your parcels (${mine.length}) are delayed right now ✅\n\n` + mine.map(trackCard).join('\n\n'),
      };
    }
    return {
      intent: 'delay',
      text: delayed.map(({ b, d }) => `⚠️ Parcel *${b.docket}* to ${b.to}: ${delayDesc(d.event)}\nCarrier: ${d.route.carrierCode}`).join('\n\n'),
    };
  }

  // 4. charges
  if (/charge|price|cost|amount|paid|receipt|bill|paise|rupees/.test(q)) {
    if (!mine.length) return { intent: 'charges', text: noParcelReply() };
    return {
      intent: 'charges',
      text: mine.slice(0, 3).map((b) =>
        `🧾 *${b.docket}* (${STATUS_LABEL[b.status]})\nPacking: ${fmtMoney(b.amount.packing)}\nFreight: ${fmtMoney(b.amount.freight)}\n*Total: ${fmtMoney(grossOf(b))}*\nBooked: ${fmtDT(b.createdAt)}`).join('\n\n'),
    };
  }

  // 5. ETA
  if (/when|eta|time|deliver|kab|pahuch|reach|expected/.test(q)) {
    if (!mine.length) return { intent: 'eta', text: noParcelReply() };
    const open = mine.filter((b) => b.status !== 'delivered');
    if (!open.length) return { intent: 'eta', text: `All your parcels have been delivered ✅` };
    return {
      intent: 'eta',
      text: open.map((b) => `📦 *${b.docket}* → ${b.to}\nStatus: ${STATUS_LABEL[b.status]}\n${etaLine(b)}`).join('\n\n'),
    };
  }

  // 6. human handoff — escalates
  if (/human|agent|team|call|complaint|manager|baat/.test(q)) {
    return {
      intent: 'human',
      text: `Sure 🙏 Our support team will call you within 2 working hours (Mon–Sat, 10AM–8PM).\nMeanwhile, please share your concern in one message and I'll attach it to your booking.`,
    };
  }

  // 7. subscribe toggles
  if (/(stop|pause|no).*(update|message)|unsubscribe/.test(q)) {
    ensureChat(phone).updatesOptIn = false; save();
    return { intent: 'optout', text: `Okay, automatic updates are OFF for your parcels. Type *START UPDATES* anytime to switch them back on.` };
  }
  if (/start.*updates|subscribe|resume/.test(q)) {
    ensureChat(phone).updatesOptIn = true; save();
    return { intent: 'optin', text: `Done ✅ Automatic updates are ON again. You'll hear about every dispatch, delay and delivery here.` };
  }

  // 8. generic tracking
  if (/track|where|status|kahan|kaha|parcel|shipment|courier|booked|my /.test(q)) {
    if (!mine.length) return { intent: 'track', text: noParcelReply() };
    return {
      intent: 'track',
      text: `You have ${mine.length} parcel${mine.length > 1 ? 's' : ''} with us:\n\n` + mine.map(trackCard).join('\n\n'),
    };
  }

  // fallback — also escalates, because the agent could not help
  return {
    intent: 'unknown',
    text: `I'm not sure I understood that 🤔 Try:\n• *"Where is my parcel?"*\n• *"When will SBC104201 be delivered?"*\n• *"Any delay?"*, *"Charges"*, *"OTP"*\nOr type *TALK TO TEAM* and our staff will call you.`,
  };
}

export function botReply(phone: string, raw: string) {
  const { intent, text } = compose(phone, raw);
  logBotTurn(phone, intent, String(raw || '').trim());
  return text;
}
